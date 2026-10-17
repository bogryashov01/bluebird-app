import type { ProductionNotificationPrefs, ProductionUserProfile, UpdateProductionUserProfileRequest } from './productionAuthApi';

export interface ClerkNotificationProfileSession {
  isLoaded: boolean;
  isSignedIn: boolean | undefined;
  userId: string | null;
}

export interface ClerkNotificationProfileReader {
  getProfile: (options?: { signal?: AbortSignal }) => Promise<ProductionUserProfile>;
}

/**
 * Read the authenticated profile as the basis of a safe preference update.
 * The server's profile GET may synchronize verified phone fields; callers
 * must make that side effect explicit before invoking this function.
 */
export async function readClerkNotificationProfile(input: {
  getCurrentSession: () => ClerkNotificationProfileSession | null;
  requestedClerkUserId: string;
  readProfile: ClerkNotificationProfileReader['getProfile'];
  signal?: AbortSignal;
}): Promise<ProductionUserProfile> {
  const isRequestedIdentityCurrent = () => {
    const session = input.getCurrentSession();
    return session?.isLoaded === true &&
      session.isSignedIn === true &&
      session.userId === input.requestedClerkUserId;
  };

  if (input.signal?.aborted) throw new Error('Preference request cancelled.');
  if (!isRequestedIdentityCurrent()) {
    throw new Error('The signed-in account changed before preferences could be loaded.');
  }

  const profile = await input.readProfile({ signal: input.signal });

  if (!isRequestedIdentityCurrent()) {
    throw new Error('The signed-in account changed while preferences were loading.');
  }

  if (input.signal?.aborted) throw new Error('Preference request cancelled.');
  return profile;
}

export async function readClerkNotificationPreferences(
  input: Parameters<typeof readClerkNotificationProfile>[0],
): Promise<ProductionNotificationPrefs> {
  return (await readClerkNotificationProfile(input)).notificationPrefs;
}

/** No defaults or registration drafts: every required value comes from GET. */
export function buildNotificationProfileUpdate(
  profile: ProductionUserProfile,
  notificationPrefs: ProductionNotificationPrefs,
  now = new Date(),
): UpdateProductionUserProfileRequest | null {
  return buildClerkProfileSettingsUpdate(profile, { notificationPrefs }, now);
}

export function buildHomeAirportProfileUpdate(
  profile: ProductionUserProfile,
  homeAirportCode: string,
  now = new Date(),
): UpdateProductionUserProfileRequest | null {
  return buildClerkProfileSettingsUpdate(profile, { homeAirportCode }, now);
}

export function buildClerkProfileSettingsUpdate(
  profile: ProductionUserProfile,
  changes: {
    homeAirportCode?: string;
    notificationPrefs?: ProductionNotificationPrefs;
  },
  now = new Date(),
): UpdateProductionUserProfileRequest | null {
  const { firstName, lastName, dob, gender, homeAirportCode, favoriteCityKeys, email } = profile;
  const nextHomeAirportCode = changes.homeAirportCode ?? homeAirportCode;
  const nextNotificationPrefs = changes.notificationPrefs ?? profile.notificationPrefs;
  const birth = dob ? new Date(`${dob}T00:00:00.000Z`) : null;
  const adultCutoff = new Date(Date.UTC(now.getUTCFullYear() - 18, now.getUTCMonth(), now.getUTCDate()));
  if (
    !profile.isComplete ||
    !firstName?.trim() || firstName.length > 80 ||
    !lastName?.trim() || lastName.length > 80 ||
    !dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob) ||
    !birth || Number.isNaN(birth.valueOf()) || birth.toISOString().slice(0, 10) !== dob || birth > adultCutoff ||
    (gender !== 'male' && gender !== 'female') ||
    !nextHomeAirportCode || !/^[A-Z0-9]{3,4}$/.test(nextHomeAirportCode) ||
    !Array.isArray(favoriteCityKeys) || !favoriteCityKeys.length ||
    favoriteCityKeys.some((key) => !key.trim() || key.length > 64) ||
    !email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    (profile.weightLbs !== null && (!Number.isSafeInteger(profile.weightLbs) || profile.weightLbs < 1 || profile.weightLbs > 1500))
  ) return null;
  const channels = [
    nextNotificationPrefs.allChannels, nextNotificationPrefs.emptyLegHomeAirport,
    nextNotificationPrefs.departingFavorite, nextNotificationPrefs.arrivingFavorite,
    nextNotificationPrefs.queueUpdates, nextNotificationPrefs.winningNotifications,
  ];
  if (
    !['off', 'all', 'specific'].includes(nextNotificationPrefs.mode) ||
    (nextNotificationPrefs.mode === 'all' && nextNotificationPrefs.allChannels === null) ||
    (nextNotificationPrefs.mode === 'specific' && nextNotificationPrefs.emptyLegHomeAirport === null) ||
    channels.some((value) => value !== null && !['email', 'sms', 'both'].includes(value)) ||
    nextNotificationPrefs.queueUpdates == null || nextNotificationPrefs.winningNotifications == null ||
    (channels.some((value) => value === 'sms' || value === 'both') &&
      (!profile.smsConsent || !profile.phoneE164 || !profile.phoneVerifiedAt || profile.phoneVerificationRequired))
  ) return null;
  return {
    firstName, lastName, dob, gender, homeAirportCode: nextHomeAirportCode,
    favoriteCityKeys: [...favoriteCityKeys],
    notificationPrefs: { ...nextNotificationPrefs },
    ...(!profile.emailLocked ? { email } : {}),
    weightLbs: profile.weightLbs,
    // Omitted phone and consent fields preserve server-owned verification and
    // existing consent. Selecting SMS never grants consent.
  };
}

export function notificationPreferenceRows(prefs: ProductionNotificationPrefs) {
  return [
    { key: 'mode' as const, label: 'Flight alert mode', value: prefs.mode },
    ...(prefs.mode === 'all' ? [
      { key: 'allChannels' as const, label: 'All flight alerts', value: prefs.allChannels },
    ] : prefs.mode === 'specific' ? [
      { key: 'emptyLegHomeAirport' as const, label: 'Home airport flights', value: prefs.emptyLegHomeAirport },
      { key: 'departingFavorite' as const, label: 'Departing from favorites', value: prefs.departingFavorite },
      { key: 'arrivingFavorite' as const, label: 'Arriving at favorites', value: prefs.arrivingFavorite },
    ] : []),
    { key: 'queueUpdates' as const, label: 'Queue updates', value: prefs.queueUpdates },
    { key: 'winningNotifications' as const, label: 'Flight confirmations', value: prefs.winningNotifications },
  ];
}

export function getClerkNotificationPreferencesQueryKey(
  environment: string | null | undefined,
  apiBaseUrl: string | null | undefined,
  clerkUserId: string | null | undefined,
) {
  return [
    'clerk-notification-preferences',
    environment ?? 'unconfigured',
    apiBaseUrl ?? 'unconfigured',
    clerkUserId ?? 'signed-out',
  ] as const;
}

/** PUT's CurrentUser response is not a preference projection; always re-read. */
export async function saveClerkNotificationPreferences(input: Parameters<typeof readClerkNotificationProfile>[0] & {
  preferences: ProductionNotificationPrefs;
  updateProfile: (data: UpdateProductionUserProfileRequest, options?: { signal?: AbortSignal }) => Promise<unknown>;
}): Promise<ProductionUserProfile> {
  // Re-read before writing so unrelated fields are not taken from an old draft.
  const profile = await readClerkNotificationProfile(input);
  const data = buildNotificationProfileUpdate(profile, input.preferences);
  if (!data) throw new Error('Preferences are read-only because a safe complete profile update is unavailable.');
  const session = input.getCurrentSession();
  if (input.signal?.aborted || !session?.isLoaded || !session.isSignedIn || session.userId !== input.requestedClerkUserId) {
    throw new Error('The signed-in account changed before preferences could be saved.');
  }
  await input.updateProfile(data, { signal: input.signal });
  const refreshed = await readClerkNotificationProfile(input);
  if (
    !areNotificationPreferencesEqual(refreshed.notificationPrefs, input.preferences) ||
    !areProfileSettingsPreserved(profile, refreshed, 'notificationPrefs')
  ) {
    throw new Error('The refreshed profile did not confirm the requested preferences and preserved account settings.');
  }
  return refreshed;
}

export async function saveClerkHomeAirport(input: Parameters<typeof readClerkNotificationProfile>[0] & {
  homeAirportCode: string;
  updateProfile: (data: UpdateProductionUserProfileRequest, options?: { signal?: AbortSignal }) => Promise<unknown>;
}): Promise<ProductionUserProfile> {
  const profile = await readClerkNotificationProfile(input);
  const data = buildHomeAirportProfileUpdate(profile, input.homeAirportCode);
  if (!data) throw new Error('Home airport is read-only because a safe complete profile update is unavailable.');
  const session = input.getCurrentSession();
  if (input.signal?.aborted || !session?.isLoaded || !session.isSignedIn || session.userId !== input.requestedClerkUserId) {
    throw new Error('The signed-in account changed before the home airport could be saved.');
  }
  await input.updateProfile(data, { signal: input.signal });
  const refreshed = await readClerkNotificationProfile(input);
  if (
    refreshed.homeAirportCode !== input.homeAirportCode ||
    !areProfileSettingsPreserved(profile, refreshed, 'homeAirportCode')
  ) {
    throw new Error('The refreshed profile did not confirm the selected home airport and preserved account settings.');
  }
  return refreshed;
}

function areProfileSettingsPreserved(
  before: ProductionUserProfile,
  after: ProductionUserProfile,
  changing: 'notificationPrefs' | 'homeAirportCode',
): boolean {
  const sameStringSet = (left: string[], right: string[]) => {
    const sortedLeft = [...left].sort();
    const sortedRight = [...right].sort();
    return sortedLeft.length === sortedRight.length &&
      sortedLeft.every((value, index) => value === sortedRight[index]);
  };
  return after.isComplete === before.isComplete &&
    after.firstName === before.firstName &&
    after.lastName === before.lastName &&
    after.dob === before.dob &&
    after.gender === before.gender &&
    (changing === 'homeAirportCode' || after.homeAirportCode === before.homeAirportCode) &&
    sameStringSet(after.favoriteCityKeys, before.favoriteCityKeys) &&
    sameStringSet(after.favoriteAirportCodes, before.favoriteAirportCodes) &&
    (changing === 'notificationPrefs' || areNotificationPreferencesEqual(after.notificationPrefs, before.notificationPrefs)) &&
    after.smsConsent === before.smsConsent &&
    after.smsConsentAt === before.smsConsentAt &&
    after.smsConsentRevokedAt === before.smsConsentRevokedAt &&
    after.email === before.email &&
    after.emailLocked === before.emailLocked &&
    after.signupChannel === before.signupChannel &&
    after.weightLbs === before.weightLbs &&
    JSON.stringify(after.upgradeCreditBalances) === JSON.stringify(before.upgradeCreditBalances);
}

function areNotificationPreferencesEqual(
  left: ProductionNotificationPrefs,
  right: ProductionNotificationPrefs,
): boolean {
  return left.mode === right.mode &&
    left.allChannels === right.allChannels &&
    left.emptyLegHomeAirport === right.emptyLegHomeAirport &&
    left.departingFavorite === right.departingFavorite &&
    left.arrivingFavorite === right.arrivingFavorite &&
    left.queueUpdates === right.queueUpdates &&
    left.winningNotifications === right.winningNotifications;
}
