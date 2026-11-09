import type {
  ProductionUserProfile,
  UpdateProductionUserProfileRequest,
} from './productionAuthApi';

export class IncomingConnectionPreferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IncomingConnectionPreferenceError';
  }
}

export interface IncomingConnectionPreferenceSession {
  isLoaded: boolean;
  isSignedIn: boolean | undefined;
  userId: string | null;
}

/**
 * A full profile upsert. Phone, country, and weight are copied when the
 * current profile has them. Read-only labels, verification timestamps, and
 * credit balances are left off the body.
 */
export function buildIncomingConnectionRequestsUpdate(
  profile: ProductionUserProfile,
  allowIncomingConnectionRequests: boolean,
): UpdateProductionUserProfileRequest | null {
  const firstName = profile.firstName?.trim() ?? '';
  const lastName = profile.lastName?.trim() ?? '';
  const dob = profile.dob ?? '';
  const homeAirportCode = profile.homeAirportCode?.trim() ?? '';
  const favoriteCityKeys = profile.favoriteCityKeys;
  if (
    firstName.length < 1 || firstName.length > 80 ||
    lastName.length < 1 || lastName.length > 80 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(dob) ||
    (profile.gender !== 'male' && profile.gender !== 'female') ||
    (homeAirportCode.length !== 3 && homeAirportCode.length !== 4) ||
    !Array.isArray(favoriteCityKeys) || favoriteCityKeys.length < 1 ||
    favoriteCityKeys.some((key) => typeof key !== 'string' || key.length < 1 || key.length > 64)
  ) return null;

  const request: UpdateProductionUserProfileRequest = {
    firstName,
    lastName,
    dob,
    gender: profile.gender,
    homeAirportCode,
    favoriteCityKeys: [...favoriteCityKeys],
    notificationPrefs: { ...profile.notificationPrefs },
    smsConsent: profile.smsConsent,
    allowIncomingConnectionRequests,
  };
  if (typeof profile.phoneE164 === 'string' && profile.phoneE164.length > 0 &&
      typeof profile.phoneCountry === 'string' && profile.phoneCountry.length > 0) {
    request.phoneE164 = profile.phoneE164;
    request.phoneCountry = profile.phoneCountry;
  }
  if (typeof profile.weightLbs === 'number') request.weightLbs = profile.weightLbs;
  if (!profile.emailLocked && typeof profile.email === 'string' && profile.email.length > 0) {
    request.email = profile.email;
  }
  return request;
}

function sameProfileIdentity(before: ProductionUserProfile, after: ProductionUserProfile): boolean {
  const sameList = (left: string[], right: string[]) =>
    left.length === right.length && left.every((value, index) => value === right[index]);
  return after.firstName === before.firstName &&
    after.lastName === before.lastName &&
    after.dob === before.dob &&
    after.gender === before.gender &&
    after.homeAirportCode === before.homeAirportCode &&
    sameList(after.favoriteCityKeys, before.favoriteCityKeys) &&
    after.phoneE164 === before.phoneE164 &&
    after.phoneCountry === before.phoneCountry &&
    after.weightLbs === before.weightLbs &&
    after.email === before.email &&
    after.smsConsent === before.smsConsent &&
    after.notificationPrefs.mode === before.notificationPrefs.mode &&
    after.notificationPrefs.queueUpdates === before.notificationPrefs.queueUpdates &&
    after.notificationPrefs.winningNotifications === before.notificationPrefs.winningNotifications;
}

/**
 * PUT then GET. Success requires the refreshed profile to return the boolean
 * that was sent. A missing field is the pre-deployment default, not a save.
 */
export async function saveIncomingConnectionRequestsPreference(input: {
  getCurrentSession: () => IncomingConnectionPreferenceSession | null;
  requestedClerkUserId: string;
  readProfile: (options?: { signal?: AbortSignal }) => Promise<ProductionUserProfile>;
  updateProfile: (data: UpdateProductionUserProfileRequest, options?: { signal?: AbortSignal }) => Promise<unknown>;
  allowIncomingConnectionRequests: boolean;
  signal?: AbortSignal;
}): Promise<ProductionUserProfile> {
  const current = () => {
    const session = input.getCurrentSession();
    return session?.isLoaded === true &&
      session.isSignedIn === true &&
      session.userId === input.requestedClerkUserId;
  };
  if (input.signal?.aborted || !current()) {
    throw new IncomingConnectionPreferenceError('The signed-in account changed before this preference could be saved.');
  }
  const profile = await input.readProfile({ signal: input.signal });
  if (input.signal?.aborted || !current()) {
    throw new IncomingConnectionPreferenceError('The signed-in account changed before this preference could be saved.');
  }
  const data = buildIncomingConnectionRequestsUpdate(profile, input.allowIncomingConnectionRequests);
  if (!data) {
    throw new IncomingConnectionPreferenceError('Complete your profile before changing this setting.');
  }
  await input.updateProfile(data, { signal: input.signal });
  const refreshed = await input.readProfile({ signal: input.signal });
  if (input.signal?.aborted || !current()) {
    throw new IncomingConnectionPreferenceError('The signed-in account changed before this preference could be saved.');
  }
  if (!refreshed.allowIncomingConnectionRequestsSupported ||
      refreshed.allowIncomingConnectionRequests !== input.allowIncomingConnectionRequests ||
      !sameProfileIdentity(profile, refreshed)) {
    throw new IncomingConnectionPreferenceError('Connection request preferences are not available yet.');
  }
  return refreshed;
}
