import type { ClerkMemberResolution } from './clerkMemberResolution';
import type {
  BluebirdProfileLoadResult,
} from './clerkBluebirdProfile';
import type {
  ProductionCurrentUser,
  ProductionUserProfile,
  UpdateProductionUserProfileRequest,
  UserGender,
} from './productionAuthApi';

export interface ClerkProfileFormValues {
  firstName: string;
  lastName: string;
  phoneE164: string;
  dob: string;
  gender: UserGender | null;
  weightLbs: string;
}

export interface ClerkProfileRegistrationDraft {
  values: ClerkProfileFormValues;
  homeAirportCode: string;
  additionalAirportCodes: string[];
  favoriteCityKeys: string[];
  preferredCityConfirmed: boolean;
}

export function getVerifiedClerkPhoneNumber(input: {
  sessionUserId: string | null;
  clerkUserId: string | null;
  phoneNumber: string | null;
  verificationStatus: string | null;
}): string | null {
  if (
    !input.sessionUserId ||
    input.clerkUserId !== input.sessionUserId ||
    input.verificationStatus !== 'verified'
  ) return null;
  return input.phoneNumber;
}

export function prefillClerkProfileForm(
  profile: ProductionUserProfile,
  verifiedPhoneNumber: string | null,
): ClerkProfileFormValues {
  return {
    firstName: profile.firstName ?? '',
    lastName: profile.lastName ?? '',
    phoneE164: verifiedPhoneNumber ?? '',
    dob: profile.dob ?? '',
    gender: profile.gender,
    weightLbs: profile.weightLbs == null ? '' : String(profile.weightLbs),
  };
}

export function validateClerkProfileForm(values: ClerkProfileFormValues): string | null {
  if (!values.firstName.trim() || values.firstName.trim().length > 80) {
    return 'Enter your first name (up to 80 characters).';
  }
  if (!values.lastName.trim() || values.lastName.trim().length > 80) {
    return 'Enter your last name (up to 80 characters).';
  }
  if (!/^\+[1-9]\d{7,14}$/.test(values.phoneE164)) {
    return 'A verified phone number is required to continue.';
  }
  if (!isValidClerkDateOfBirth(values.dob)) {
    return 'Enter your date of birth as YYYY-MM-DD.';
  }
  if (!values.gender) return 'Choose a gender to continue.';
  if (values.weightLbs.trim()) {
    const weight = Number(values.weightLbs);
    if (!/^\d{1,4}$/.test(values.weightLbs) || !Number.isSafeInteger(weight) || weight < 1 || weight > 1500) {
      return 'Enter a whole-number weight between 1 and 1,500 lbs.';
    }
  }
  return null;
}

export function isValidClerkDateOfBirth(value: string, now = new Date()): boolean {
  const date = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) return false;
  return parsed <= new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export const CLERK_PROFILE_SAVE_LIMITATION =
  'The Main API requires date of birth, one home airport, and one Preferred City. Weight is optional; we’ll tell you if the API does not return it as saved.';

const registrationDraftsByUser = new Map<string, ClerkProfileRegistrationDraft>();
const registrationProfileResultsByUser = new Map<
  string,
  Extract<BluebirdProfileLoadResult, { kind: 'authenticated' }>
>();

function normalizeAirportCode(code: string | null | undefined): string {
  const normalized = code?.trim().toUpperCase() ?? '';
  return /^[A-Z0-9]{3,4}$/.test(normalized) ? normalized : '';
}

function copyRegistrationDraft(draft: ClerkProfileRegistrationDraft): ClerkProfileRegistrationDraft {
  return {
    values: { ...draft.values },
    homeAirportCode: draft.homeAirportCode,
    additionalAirportCodes: [...draft.additionalAirportCodes],
    favoriteCityKeys: [...draft.favoriteCityKeys],
    preferredCityConfirmed: draft.preferredCityConfirmed,
  };
}

/** Keep the registration draft in memory and scoped to the active Clerk subject. */
export function getClerkProfileRegistrationDraft(
  clerkUserId: string,
  profile?: ProductionUserProfile,
  verifiedPhoneNumber: string | null = null,
): ClerkProfileRegistrationDraft {
  const existing = registrationDraftsByUser.get(clerkUserId);
  if (existing) return copyRegistrationDraft(existing);
  const draft = {
    values: profile
      ? prefillClerkProfileForm(profile, verifiedPhoneNumber)
      : {
          firstName: '',
          lastName: '',
          phoneE164: verifiedPhoneNumber ?? '',
          dob: '',
          gender: null,
          weightLbs: '',
        },
    homeAirportCode: normalizeAirportCode(profile?.homeAirportCode),
    additionalAirportCodes: [],
    favoriteCityKeys: [...(profile?.favoriteCityKeys ?? [])],
    preferredCityConfirmed: false,
  };
  registrationDraftsByUser.set(clerkUserId, draft);
  return copyRegistrationDraft(draft);
}

export function setClerkProfileRegistrationDraft(
  clerkUserId: string,
  draft: ClerkProfileRegistrationDraft,
): void {
  if (!clerkUserId.trim()) return;
  registrationDraftsByUser.set(clerkUserId, {
    values: { ...draft.values },
    homeAirportCode: normalizeAirportCode(draft.homeAirportCode),
    additionalAirportCodes: [...new Set(
      draft.additionalAirportCodes
        .map(normalizeAirportCode)
        .filter((code) => code && code !== normalizeAirportCode(draft.homeAirportCode)),
    )],
    favoriteCityKeys: [...new Set(draft.favoriteCityKeys.filter((key) => key.trim()))],
    preferredCityConfirmed: draft.preferredCityConfirmed,
  });
}

export function setClerkRegistrationProfileResult(
  clerkUserId: string,
  result: Extract<BluebirdProfileLoadResult, { kind: 'authenticated' }>,
): void {
  if (!clerkUserId.trim()) return;
  registrationProfileResultsByUser.set(clerkUserId, result);
}

export function getClerkRegistrationProfileResult(
  clerkUserId: string,
): Extract<BluebirdProfileLoadResult, { kind: 'authenticated' }> | null {
  return registrationProfileResultsByUser.get(clerkUserId) ?? null;
}

const verifiedRegistrationCompletions = new Map<string, ProductionCurrentUser>();

export function setClerkVerifiedRegistrationCompletion(
  clerkUserId: string,
  currentUser: ProductionCurrentUser,
): boolean {
  if (
    !clerkUserId.trim() ||
    currentUser.isAuthenticated !== true ||
    currentUser.isProfileComplete !== true
  ) return false;
  verifiedRegistrationCompletions.set(clerkUserId, currentUser);
  return true;
}

export function consumeClerkVerifiedRegistrationCompletion(
  clerkUserId: string,
): ProductionCurrentUser | null {
  const currentUser = verifiedRegistrationCompletions.get(clerkUserId) ?? null;
  verifiedRegistrationCompletions.delete(clerkUserId);
  if (
    !currentUser ||
    currentUser.isAuthenticated !== true ||
    currentUser.isProfileComplete !== true
  ) return null;
  return currentUser;
}

export function setClerkProfileFormDraft(
  clerkUserId: string,
  values: ClerkProfileFormValues,
): void {
  const draft = getClerkProfileRegistrationDraft(clerkUserId);
  setClerkProfileRegistrationDraft(clerkUserId, { ...draft, values });
}

export function setClerkHomeAirportDraft(clerkUserId: string, airportCode: string): void {
  const draft = getClerkProfileRegistrationDraft(clerkUserId);
  setClerkProfileRegistrationDraft(clerkUserId, { ...draft, homeAirportCode: airportCode });
}

export function toggleClerkAdditionalAirportDraft(
  clerkUserId: string,
  airportCode: string,
): string[] {
  const code = normalizeAirportCode(airportCode);
  const draft = getClerkProfileRegistrationDraft(clerkUserId);
  if (!code || code === draft.homeAirportCode) return draft.additionalAirportCodes;
  const additionalAirportCodes = draft.additionalAirportCodes.includes(code)
    ? draft.additionalAirportCodes.filter((selected) => selected !== code)
    : [...draft.additionalAirportCodes, code];
  setClerkProfileRegistrationDraft(clerkUserId, { ...draft, additionalAirportCodes });
  return additionalAirportCodes;
}

export function setClerkPreferredCityDraft(
  clerkUserId: string,
  cityKey: string,
  catalogKeys: readonly string[],
): boolean {
  if (!catalogKeys.includes(cityKey)) return false;
  const draft = getClerkProfileRegistrationDraft(clerkUserId);
  setClerkProfileRegistrationDraft(clerkUserId, {
    ...draft,
    favoriteCityKeys: [cityKey],
    preferredCityConfirmed: false,
  });
  return true;
}

export function setClerkPreferredCityConfirmed(
  clerkUserId: string,
  confirmed: boolean,
): void {
  const draft = getClerkProfileRegistrationDraft(clerkUserId);
  setClerkProfileRegistrationDraft(clerkUserId, {
    ...draft,
    preferredCityConfirmed: confirmed,
  });
}

/** Return a suggestion only when exactly one catalog group contains the airport. */
export function suggestClerkPreferredCity(
  homeAirportCode: string,
  cities: readonly { key: string; airportCodes: readonly string[] }[],
): string | null {
  const airportCode = normalizeAirportCode(homeAirportCode);
  if (!airportCode) return null;
  const matches = cities.filter((city) =>
    city.airportCodes.some((code) => normalizeAirportCode(code) === airportCode),
  );
  return matches.length === 1 ? matches[0].key : null;
}

export function toggleClerkFavoriteCityDraft(
  clerkUserId: string,
  cityKey: string,
  catalogKeys: readonly string[],
): string[] {
  if (!catalogKeys.includes(cityKey)) return getClerkProfileRegistrationDraft(clerkUserId).favoriteCityKeys;
  const draft = getClerkProfileRegistrationDraft(clerkUserId);
  const favoriteCityKeys = draft.favoriteCityKeys.includes(cityKey)
    ? draft.favoriteCityKeys.filter((key) => key !== cityKey)
    : [...draft.favoriteCityKeys, cityKey];
  setClerkProfileRegistrationDraft(clerkUserId, { ...draft, favoriteCityKeys });
  return favoriteCityKeys;
}

export function validateClerkAirportCitySelection(input: {
  homeAirportCode: string;
  favoriteCityKeys: readonly string[];
  catalogKeys: readonly string[];
  preferredCityConfirmed?: boolean;
}): string | null {
  if (!normalizeAirportCode(input.homeAirportCode)) return 'Choose one home airport to continue.';
  if (input.favoriteCityKeys.length !== 1) return 'Choose one Preferred City to continue.';
  if (input.preferredCityConfirmed === false) return 'Confirm your Preferred City before saving.';
  const canonicalKeys = new Set(input.catalogKeys);
  if (input.favoriteCityKeys.some((key) => !canonicalKeys.has(key))) {
    return 'Your Preferred City is no longer available. Choose it again from the city catalog.';
  }
  return null;
}

export function buildClerkProfileUpdateRequest(input: {
  values: ClerkProfileFormValues;
  homeAirportCode: string;
  favoriteCityKeys: readonly string[];
  catalogKeys: readonly string[];
  preferredCityConfirmed: boolean;
  profile: ProductionUserProfile;
}): UpdateProductionUserProfileRequest {
  const profileError = validateClerkProfileForm(input.values);
  if (profileError) throw new TypeError(profileError);
  const selectionError = validateClerkAirportCitySelection({
    ...input,
    preferredCityConfirmed: input.preferredCityConfirmed,
  });
  if (selectionError) throw new TypeError(selectionError);

  const data: UpdateProductionUserProfileRequest = {
    firstName: input.values.firstName.trim(),
    lastName: input.values.lastName.trim(),
    dob: input.values.dob.trim(),
    gender: input.values.gender!,
    homeAirportCode: normalizeAirportCode(input.homeAirportCode),
    favoriteCityKeys: [...input.favoriteCityKeys],
  };
  if (input.values.phoneE164 && input.profile.phoneCountry) {
    data.phoneE164 = input.values.phoneE164;
    data.phoneCountry = input.profile.phoneCountry;
  }
  if (input.values.weightLbs.trim()) {
    data.weightLbs = Number(input.values.weightLbs);
  } else if (input.profile.weightLbs !== null) {
    data.weightLbs = null;
  }
  return data;
}

/** Compatibility helpers for the legacy Home Airports settings flow. */
export function getClerkAirportSelectionDraft(
  clerkUserId: string,
  initialCodes: readonly string[] = [],
): string[] {
  const draft = getClerkProfileRegistrationDraft(clerkUserId);
  if (!draft.homeAirportCode && initialCodes.length) {
    const code = normalizeAirportCode(initialCodes[0]);
    if (code) setClerkHomeAirportDraft(clerkUserId, code);
  }
  const selected = getClerkProfileRegistrationDraft(clerkUserId).homeAirportCode;
  return selected ? [selected] : [];
}

export function setClerkAirportSelectionDraft(clerkUserId: string, codes: readonly string[]): void {
  setClerkHomeAirportDraft(clerkUserId, codes[0] ?? '');
}

export function canAccessClerkProfileOnboardingRoute(
  segments: readonly string[],
  resolution: ClerkMemberResolution,
  currentClerkUserId: string | null,
): boolean {
  if (
    (resolution.status !== 'profile_incomplete' && resolution.status !== 'profile_complete') ||
    !currentClerkUserId ||
    resolution.clerkUserId !== currentClerkUserId
  ) return false;

  const isAirportStep = segments.length === 1 && segments[0] === 'airport-picker';
  const isReviewStep = segments.length === 1 && segments[0] === 'registration-review';
  const isWelcomeTour = segments.length === 2 &&
    segments[0] === '(auth)' &&
    segments[1] === 'welcome-tour';
  return isAirportStep || isReviewStep
    ? resolution.status === 'profile_incomplete'
    : isWelcomeTour &&
        (resolution.status === 'profile_incomplete' || resolution.status === 'profile_complete');
}

export function getClerkOnboardingAfterTourDestination(clerkFlow: boolean):
  '/(tabs)/discover' | '/(auth)/onboarding' {
  return clerkFlow ? '/(tabs)/discover' : '/(auth)/onboarding';
}
