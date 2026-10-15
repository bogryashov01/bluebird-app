import type {
  ProductionCurrentUser,
  ProductionUserProfile,
  ProductionRequestOptions,
  UpdateProductionUserProfileRequest,
} from './productionAuthApi';

export interface ClerkBluebirdProfileApi {
  getMe: (options?: ProductionRequestOptions) => Promise<ProductionCurrentUser>;
  getProfile: (options?: ProductionRequestOptions) => Promise<ProductionUserProfile>;
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
    };

/**
 * Called only after the user opens their profile. /me is the auth projection;
 * profile GET may synchronize Clerk-verified phone data, so it must not be
 * used as a startup or member-resolution probe.
 */
export async function loadClerkBluebirdProfile(
  api: ClerkBluebirdProfileApi,
  signal?: AbortSignal,
): Promise<BluebirdProfileLoadResult> {
  const options = signal ? { signal } : undefined;
  const currentUser = await api.getMe(options);
  if (!currentUser.isAuthenticated) {
    return { kind: 'api_not_authenticated', currentUser };
  }

  const profile = await api.getProfile(options);
  const completion = profile.isComplete === currentUser.isProfileComplete
    ? profile.isComplete ? 'complete' : 'completion_required'
    : 'unverified';
  return { kind: 'authenticated', currentUser, profile, completion };
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
