import {
  withStoredProfilePhone,
  type ProductionUserProfile,
  type UpdateProductionUserProfileRequest,
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

export type IncomingConnectionPreferenceSaveResult =
  | { kind: 'confirmed'; profile: ProductionUserProfile }
  | {
      kind: 'unconfirmed';
      requestedValue: boolean;
      /** Last confirmation GET body when available; null if every confirmation read failed. */
      profile: ProductionUserProfile | null;
      writeAccepted: boolean;
    };

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

  const request: UpdateProductionUserProfileRequest = withStoredProfilePhone({
    firstName,
    lastName,
    dob,
    gender: profile.gender,
    homeAirportCode,
    favoriteCityKeys: [...favoriteCityKeys],
    notificationPrefs: { ...profile.notificationPrefs },
    smsConsent: profile.smsConsent,
    allowIncomingConnectionRequests,
  }, profile);
  if (typeof profile.weightLbs === 'number') request.weightLbs = profile.weightLbs;
  if (!profile.emailLocked && typeof profile.email === 'string' && profile.email.length > 0) {
    request.email = profile.email;
  }
  return request;
}

export function isIncomingConnectionPreferenceConfirmed(
  profile: ProductionUserProfile,
  allowIncomingConnectionRequests: boolean,
): boolean {
  return profile.allowIncomingConnectionRequestsSupported === true &&
    profile.allowIncomingConnectionRequests === allowIncomingConnectionRequests;
}

/** Apply a server-intended preference onto a previously loaded profile for local UI. */
export function withIncomingConnectionPreference(
  profile: ProductionUserProfile,
  allowIncomingConnectionRequests: boolean,
): ProductionUserProfile {
  return {
    ...profile,
    allowIncomingConnectionRequests,
    allowIncomingConnectionRequestsSupported: true,
  };
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * PUT then GET. Success requires the refreshed profile to return the boolean
 * that was sent. A missing field is the pre-deployment default, not a save.
 *
 * Unrelated profile field drift (phone, weight, labels) must not reject a
 * preference that the confirmation GET already returns correctly.
 *
 * When the write settles but confirmation cannot be established, the result is
 * `unconfirmed` — never a false "save failed".
 */
export async function saveIncomingConnectionRequestsPreference(input: {
  getCurrentSession: () => IncomingConnectionPreferenceSession | null;
  requestedClerkUserId: string;
  readProfile: (options?: { signal?: AbortSignal }) => Promise<ProductionUserProfile>;
  updateProfile: (data: UpdateProductionUserProfileRequest, options?: { signal?: AbortSignal }) => Promise<unknown>;
  allowIncomingConnectionRequests: boolean;
  signal?: AbortSignal;
  /** Confirmation GET attempts after the write. Default 3. */
  confirmationAttempts?: number;
  /** Delay between stale/failed confirmation retries. Default 200ms. */
  confirmationRetryDelayMs?: number;
}): Promise<IncomingConnectionPreferenceSaveResult> {
  const current = () => {
    const session = input.getCurrentSession();
    return session?.isLoaded === true &&
      session.isSignedIn === true &&
      session.userId === input.requestedClerkUserId;
  };
  const assertCurrentAccount = () => {
    if (input.signal?.aborted || !current()) {
      throw new IncomingConnectionPreferenceError('The signed-in account changed before this preference could be saved.');
    }
  };

  assertCurrentAccount();
  const profile = await input.readProfile({ signal: input.signal });
  assertCurrentAccount();
  const data = buildIncomingConnectionRequestsUpdate(profile, input.allowIncomingConnectionRequests);
  if (!data) {
    throw new IncomingConnectionPreferenceError('Complete your profile before changing this setting.');
  }

  let writeAccepted = false;
  let writeError: unknown = null;
  try {
    await input.updateProfile(data, { signal: input.signal });
    writeAccepted = true;
  } catch (error) {
    // PUT may still have persisted despite a malformed CurrentUser body.
    // Confirm via GET before claiming the save failed.
    writeError = error;
  }
  assertCurrentAccount();

  const attempts = Math.max(1, input.confirmationAttempts ?? 3);
  const retryDelayMs = input.confirmationRetryDelayMs ?? 200;
  let lastProfile: ProductionUserProfile | null = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      await delay(retryDelayMs, input.signal);
      assertCurrentAccount();
    }
    try {
      const refreshed = await input.readProfile({ signal: input.signal });
      assertCurrentAccount();
      lastProfile = refreshed;
      if (isIncomingConnectionPreferenceConfirmed(refreshed, input.allowIncomingConnectionRequests)) {
        return { kind: 'confirmed', profile: refreshed };
      }
      // Stale or missing field: retry while attempts remain.
    } catch (error) {
      if (error instanceof IncomingConnectionPreferenceError) throw error;
      // Network/schema on GET: retry; do not classify as write failure yet.
    }
  }

  if (writeAccepted) {
    return {
      kind: 'unconfirmed',
      requestedValue: input.allowIncomingConnectionRequests,
      profile: lastProfile,
      writeAccepted: true,
    };
  }

  if (writeError) {
    throw writeError instanceof IncomingConnectionPreferenceError
      ? writeError
      : new IncomingConnectionPreferenceError('Couldn’t save this preference. Try again.');
  }

  throw new IncomingConnectionPreferenceError('Connection request preferences are not available yet.');
}
