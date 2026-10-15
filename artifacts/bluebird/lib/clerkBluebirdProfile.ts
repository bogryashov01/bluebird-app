import type {
  ProductionCurrentUser,
  ProductionMembership,
  ProductionUserProfile,
  ProductionRequestOptions,
  UpdateProductionUserProfileRequest,
} from './productionAuthApi';
import type { ClerkSessionSnapshot } from './clerkProductionTokenProvider';
import type { MainBluebirdApiConfiguration } from './mainBluebirdApiConfig';

export type ClerkBluebirdProfileSession = Pick<
  ClerkSessionSnapshot,
  'isLoaded' | 'isSignedIn'
> & { userId: string | null };

/**
 * React effect dependencies must describe the values that configure a request,
 * not freshly allocated configuration/session wrapper objects.
 */
export function getClerkBluebirdProfileEffectDependencies(input: {
  configuration: MainBluebirdApiConfiguration | null;
  session: ClerkBluebirdProfileSession | null;
  loadAttempt: number;
}): readonly [
  MainBluebirdApiConfiguration['environment'] | null,
  string | null,
  string | null,
  boolean,
  boolean | undefined,
  string | null,
  number,
] {
  const { configuration, session, loadAttempt } = input;
  return [
    configuration?.environment ?? null,
    configuration?.apiBaseUrl ?? null,
    configuration?.clerkPublishableKey ?? null,
    session?.isLoaded ?? false,
    session?.isSignedIn,
    session?.userId ?? null,
    loadAttempt,
  ];
}

export interface ClerkBluebirdProfileApi {
  getMe: (options?: ProductionRequestOptions) => Promise<ProductionCurrentUser>;
  getProfile: (options?: ProductionRequestOptions) => Promise<ProductionUserProfile>;
  getMembership: (options?: ProductionRequestOptions) => Promise<ProductionMembership>;
  updateProfile: (
    data: UpdateProductionUserProfileRequest,
    options?: ProductionRequestOptions,
  ) => Promise<ProductionUserProfile>;
}

export type BluebirdProfileLoadResult =
  | { kind: 'api_not_authenticated'; currentUser: ProductionCurrentUser }
  | {
      kind: 'authenticated';
      currentUser: ProductionCurrentUser;
      profile: ProductionUserProfile;
      completion: 'complete' | 'completion_required' | 'unverified';
      membership: ProductionMembership | null;
      membershipState: 'available' | 'unavailable' | 'conflict';
    };

/**
 * Called only after the user opens their profile. /me is the auth projection;
 * profile GET may synchronize Clerk-verified phone data, so it must not be
 * used as a startup or member-resolution probe.
 */
export async function loadClerkBluebirdProfile(
  api: ClerkBluebirdProfileApi,
  signal?: AbortSignal,
  verifiedCurrentUser?: ProductionCurrentUser,
): Promise<BluebirdProfileLoadResult> {
  const options = signal ? { signal } : undefined;
  const currentUser = verifiedCurrentUser ?? await api.getMe(options);
  if (!currentUser.isAuthenticated) {
    return { kind: 'api_not_authenticated', currentUser };
  }

  const [profile, membership] = await Promise.all([
    api.getProfile(options),
    api.getMembership(options).catch(() => null),
  ]);
  const completion = profile.isComplete === currentUser.isProfileComplete
    ? profile.isComplete ? 'complete' : 'completion_required'
    : 'unverified';
  const membershipState = membership === null
    ? 'unavailable'
    : membershipMatchesProjection(currentUser, membership) ? 'available' : 'conflict';
  return { kind: 'authenticated', currentUser, profile, completion, membership, membershipState };
}

function membershipMatchesProjection(
  currentUser: ProductionCurrentUser,
  membership: ProductionMembership,
): boolean {
  if (currentUser.isMember !== membership.isMember) return false;
  if (!currentUser.isMember) return currentUser.memberTier === null && membership.tier === null;
  return currentUser.memberTier !== null &&
    membership.tier !== null &&
    currentUser.memberTier === membership.tier;
}

export type ClerkOnboardingStep = 'profile' | 'complete' | 'unverified';

/** Profile completion is only a profile display state, not a registration decision. */
export function getClerkOnboardingStep(result: BluebirdProfileLoadResult): ClerkOnboardingStep {
  if (result.kind !== 'authenticated') return 'unverified';
  if (result.completion === 'completion_required') return 'profile';
  return result.completion === 'complete' ? 'complete' : 'unverified';
}

export function canEditClerkBluebirdProfile(
  result: BluebirdProfileLoadResult,
): result is Extract<BluebirdProfileLoadResult, { kind: 'authenticated' }> {
  return result.kind === 'authenticated' && result.completion !== 'unverified';
}

/** Reject a result if the route's Clerk subject changed while it was loading. */
export function isClerkBluebirdProfileResultCurrent(input: {
  requestedClerkUserId: string;
  currentClerkUserId: string | null;
  aborted: boolean;
}): boolean {
  return !input.aborted &&
    !!input.requestedClerkUserId &&
    input.requestedClerkUserId === input.currentClerkUserId;
}

/** Profile writes are allowed only from an authenticated, contract-verified form. */
export async function updateClerkBluebirdProfileExplicitly(
  api: ClerkBluebirdProfileApi,
  result: BluebirdProfileLoadResult,
  data: UpdateProductionUserProfileRequest,
  signal?: AbortSignal,
): Promise<ProductionUserProfile> {
  if (!canEditClerkBluebirdProfile(result)) {
    throw new Error('The API has not verified that this profile can be edited.');
  }
  return api.updateProfile(data, signal ? { signal } : undefined);
}

export class ClerkRegistrationCompletionError extends Error {
  constructor() {
    super('The API did not confirm an authenticated, complete profile after saving.');
    this.name = 'ClerkRegistrationCompletionError';
  }
}

export interface ClerkRegistrationSaveResult {
  profile: ProductionUserProfile;
  currentUser: ProductionCurrentUser;
  weightSaved: boolean;
}

/** Save only from an API-confirmed incomplete profile, then verify the refreshed projection. */
export async function saveClerkBluebirdRegistration(
  api: ClerkBluebirdProfileApi,
  result: BluebirdProfileLoadResult,
  data: UpdateProductionUserProfileRequest,
  signal?: AbortSignal,
): Promise<ClerkRegistrationSaveResult> {
  if (result.kind !== 'authenticated' || result.completion !== 'completion_required') {
    throw new Error('The API has not verified that this profile requires registration.');
  }
  const options = signal ? { signal } : undefined;
  const profile = await updateClerkBluebirdProfileExplicitly(api, result, data, signal);
  const currentUser = await api.getMe(options);
  if (
    currentUser.isAuthenticated !== true ||
    currentUser.isProfileComplete !== true ||
    profile.isComplete !== true
  ) {
    throw new ClerkRegistrationCompletionError();
  }
  return {
    profile,
    currentUser,
    weightSaved: data.weightLbs === undefined || profile.weightLbs === data.weightLbs,
  };
}
