import type { ClerkMemberResolution } from './clerkMemberResolution';
import type { UserGender, ProductionUserProfile } from './productionAuthApi';

export interface ClerkProfileFormValues {
  firstName: string;
  lastName: string;
  phoneE164: string;
  gender: UserGender | null;
  weightLbs: string;
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
  if (!values.gender) return 'Choose a gender to continue.';
  if (values.weightLbs.trim()) {
    const weight = Number(values.weightLbs);
    if (!/^\d{1,4}$/.test(values.weightLbs) || !Number.isSafeInteger(weight) || weight < 1 || weight > 1500) {
      return 'Enter a whole-number weight between 1 and 1,500 lbs.';
    }
  }
  return null;
}

export const CLERK_PROFILE_SAVE_LIMITATION =
  'Changes to this form are not saved. The Main API requires date of birth, a home airport, and at least one favorite city to save a profile. The mobile client accepts weight in pounds, but server persistence for weight is not confirmed.';

const airportSelectionsByUser = new Map<string, string[]>();

function normalizeAirportCodes(codes: readonly string[]): string[] {
  return [...new Set(codes
    .map((code) => code.trim().toUpperCase())
    .filter((code) => /^[A-Z0-9]{3,4}$/.test(code)))];
}

/** In-memory only: selection survives profile↔airport navigation, not a restart or account write. */
export function getClerkAirportSelectionDraft(
  clerkUserId: string,
  initialCodes: readonly string[] = [],
): string[] {
  const existing = airportSelectionsByUser.get(clerkUserId);
  if (existing) return [...existing];
  const initial = normalizeAirportCodes(initialCodes);
  airportSelectionsByUser.set(clerkUserId, initial);
  return [...initial];
}

export function setClerkAirportSelectionDraft(clerkUserId: string, codes: readonly string[]): void {
  if (!clerkUserId.trim()) return;
  airportSelectionsByUser.set(clerkUserId, normalizeAirportCodes(codes));
}

export function canAccessClerkProfileOnboardingRoute(
  segments: readonly string[],
  resolution: ClerkMemberResolution,
  currentClerkUserId: string | null,
): boolean {
  if (
    resolution.status !== 'profile_incomplete' ||
    !currentClerkUserId ||
    resolution.clerkUserId !== currentClerkUserId
  ) return false;

  return (
    (segments.length === 1 && segments[0] === 'airport-picker') ||
    (segments.length === 2 && segments[0] === '(auth)' && segments[1] === 'welcome-tour')
  );
}

export function getClerkOnboardingAfterTourDestination(clerkFlow: boolean):
  '/(tabs)/discover' | '/(auth)/onboarding' {
  return clerkFlow ? '/(tabs)/discover' : '/(auth)/onboarding';
}
