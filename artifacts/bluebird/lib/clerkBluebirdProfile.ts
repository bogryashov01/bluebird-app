import type {
  ProductionCurrentUser,
  ProductionMembership,
  ProductionProfileDiagnosticSummary,
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
  getProfileDiagnostic: (
    options?: ProductionRequestOptions,
  ) => Promise<ProductionProfileDiagnosticSummary>;
  getMembership: (options?: ProductionRequestOptions) => Promise<ProductionMembership>;
  updateProfile: (
    data: UpdateProductionUserProfileRequest,
    options?: ProductionRequestOptions,
  ) => Promise<ProductionCurrentUser>;
}

export type ClerkRegistrationProfileDiagnostic =
  | {
      kind: 'loaded';
      meHttpStatus: number | null;
      profileHttpStatus: number | null;
      isAuthenticated: true;
      isProfileComplete: boolean;
      profile: ProductionProfileDiagnosticSummary;
    }
  | {
      kind: 'not_authenticated';
      meHttpStatus: number | null;
      profileHttpStatus: null;
      isAuthenticated: false;
      isProfileComplete: boolean | null;
    }
  | {
      kind: 'unavailable';
      failedEndpoint: 'me' | 'profile';
      meHttpStatus: number | null;
      profileHttpStatus: number | null;
    };

/**
 * Explicit recovery read. It never writes, retries, or fetches profile details
 * until /api/me confirms that the current request is authenticated.
 */
export async function diagnoseClerkBluebirdRegistrationProfile(
  api: Pick<ClerkBluebirdProfileApi, 'getMe' | 'getProfileDiagnostic'>,
): Promise<ClerkRegistrationProfileDiagnostic> {
  let meHttpStatus: number | null = null;
  try {
    const currentUser = await api.getMe({
      onResponseStatus: (status) => { meHttpStatus = status; },
    });
    if (currentUser.isAuthenticated !== true) {
      return {
        kind: 'not_authenticated',
        meHttpStatus,
        profileHttpStatus: null,
        isAuthenticated: false,
        isProfileComplete: currentUser.isProfileComplete,
      };
    }
    let profileHttpStatus: number | null = null;
    try {
      const profile = await api.getProfileDiagnostic({
        onResponseStatus: (status) => { profileHttpStatus = status; },
      });
      return {
        kind: 'loaded',
        meHttpStatus,
        profileHttpStatus,
        isAuthenticated: true,
        isProfileComplete: currentUser.isProfileComplete,
        profile,
      };
    } catch {
      return {
        kind: 'unavailable',
        failedEndpoint: 'profile',
        meHttpStatus,
        profileHttpStatus,
      };
    }
  } catch {
    return {
      kind: 'unavailable',
      failedEndpoint: 'me',
      meHttpStatus,
      profileHttpStatus: null,
    };
  }
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
  onResponseStatus?: (status: number) => void,
): Promise<ProductionCurrentUser> {
  if (!canEditClerkBluebirdProfile(result)) {
    throw new Error('The API has not verified that this profile can be edited.');
  }
  return api.updateProfile(data, {
    ...(signal ? { signal } : {}),
    ...(onResponseStatus ? { onResponseStatus } : {}),
  });
}

export interface ClerkRegistrationSaveDiagnostic {
  writeEndpoint: '/api/me/profile';
  writeHttpStatus: number | null;
  writeResponse: 'valid' | 'malformed' | 'failed';
  writeResponseIssue: string | null;
  verificationEndpoint: '/api/me';
  verificationHttpStatus: number | null;
  verificationReadFailed: boolean;
  isAuthenticated: boolean | null;
  isProfileComplete: boolean | null;
  emailPresent: boolean | null;
}

export class ClerkRegistrationCompletionError extends Error {
  constructor(readonly diagnostic: ClerkRegistrationSaveDiagnostic) {
    super('The API did not confirm an authenticated, complete profile after saving.');
    this.name = 'ClerkRegistrationCompletionError';
  }
}

export interface ClerkRegistrationSaveResult {
  /** Null only when the CurrentUser response was malformed. */
  updatedCurrentUser: ProductionCurrentUser | null;
  currentUser: ProductionCurrentUser;
  weightSaved: boolean;
  diagnostic: ClerkRegistrationSaveDiagnostic;
}

export type ClerkRegistrationWriteOutcome =
  | { kind: 'rejected'; httpStatus: number }
  | { kind: 'unknown' }
  | { kind: 'malformed_response'; httpStatus: number; issue: string | null }
  | { kind: 'valid_response' };

export type ClerkRegistrationCompletionCheck =
  | { kind: 'confirmed_complete'; currentUser?: ProductionCurrentUser; httpStatus: number | null }
  | {
      kind: 'incomplete';
      currentUser?: ProductionCurrentUser;
      emailMissing?: true;
      httpStatus: number | null;
    }
  | { kind: 'unauthenticated'; currentUser?: ProductionCurrentUser; httpStatus: number | null }
  | { kind: 'unavailable'; httpStatus: number | null };

/** Describe the write response without inferring whether the server persisted it. */
export function getClerkRegistrationWriteOutcome(
  diagnostic: ClerkRegistrationSaveDiagnostic,
): ClerkRegistrationWriteOutcome {
  if (diagnostic.writeResponse === 'malformed' && diagnostic.writeHttpStatus !== null) {
    return {
      kind: 'malformed_response',
      httpStatus: diagnostic.writeHttpStatus,
      issue: diagnostic.writeResponseIssue,
    };
  }
  if (diagnostic.writeResponse === 'failed') {
    const status = diagnostic.writeHttpStatus;
    if (status !== null && (status < 200 || status >= 300)) {
      return { kind: 'rejected', httpStatus: status };
    }
    return { kind: 'unknown' };
  }
  return { kind: 'valid_response' };
}

/** Convert the save attempt's single /me read into a safe, renderable state. */
export function getClerkRegistrationCompletionCheck(
  diagnostic: ClerkRegistrationSaveDiagnostic,
): ClerkRegistrationCompletionCheck {
  if (
    diagnostic.verificationReadFailed ||
    diagnostic.isAuthenticated === null ||
    diagnostic.isProfileComplete === null
  ) {
    return { kind: 'unavailable', httpStatus: diagnostic.verificationHttpStatus };
  }
  if (!diagnostic.isAuthenticated) {
    return { kind: 'unauthenticated', httpStatus: diagnostic.verificationHttpStatus };
  }
  return diagnostic.isProfileComplete
    ? { kind: 'confirmed_complete', httpStatus: diagnostic.verificationHttpStatus }
    : {
        kind: 'incomplete',
        ...(diagnostic.emailPresent === false ? { emailMissing: true as const } : {}),
        httpStatus: diagnostic.verificationHttpStatus,
      };
}

/** A separate read-only recovery check; it never calls updateProfile. */
export async function checkClerkBluebirdRegistrationStatus(
  api: ClerkBluebirdProfileApi,
  signal?: AbortSignal,
): Promise<ClerkRegistrationCompletionCheck> {
  let httpStatus: number | null = null;
  let currentUser: ProductionCurrentUser;
  try {
    currentUser = await api.getMe({
      ...(signal ? { signal } : {}),
      onResponseStatus: (status) => { httpStatus = status; },
    });
  } catch {
    return { kind: 'unavailable', httpStatus };
  }
  if (currentUser.isAuthenticated !== true) {
    return { kind: 'unauthenticated', currentUser, httpStatus };
  }
  return currentUser.isProfileComplete === true
    ? { kind: 'confirmed_complete', currentUser, httpStatus }
    : {
        kind: 'incomplete',
        currentUser,
        ...(currentUser.email === null ||
          (typeof currentUser.email === 'string' && !currentUser.email.trim())
          ? { emailMissing: true as const }
          : {}),
        httpStatus,
      };
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
  const diagnostic: ClerkRegistrationSaveDiagnostic = {
    writeEndpoint: '/api/me/profile',
    writeHttpStatus: null,
    writeResponse: 'failed',
    writeResponseIssue: null,
    verificationEndpoint: '/api/me',
    verificationHttpStatus: null,
    verificationReadFailed: false,
    isAuthenticated: null,
    isProfileComplete: null,
    emailPresent: null,
  };
  let updatedCurrentUser: ProductionCurrentUser | null = null;
  try {
    updatedCurrentUser = await updateClerkBluebirdProfileExplicitly(
      api,
      result,
      data,
      signal,
      (status) => { diagnostic.writeHttpStatus = status; },
    );
    diagnostic.writeResponse = 'valid';
  } catch (error) {
    const typed = error as { code?: string; field?: string };
    diagnostic.writeResponse = typed?.code === 'invalid_schema' || typed?.code === 'invalid_json'
      ? 'malformed'
      : 'failed';
    diagnostic.writeResponseIssue = typed?.code === 'invalid_schema'
      ? typed.field ?? 'response schema mismatch'
      : typed?.code === 'invalid_json'
        ? 'invalid JSON response body'
      : null;
  }

  // Never retry a profile write. A single authenticated /me read distinguishes
  // an unconfirmed response from a write that completed despite a bad response.
  let currentUser: ProductionCurrentUser | null = null;
  try {
    currentUser = await api.getMe({
      ...(signal ? { signal } : {}),
      onResponseStatus: (status) => { diagnostic.verificationHttpStatus = status; },
    });
    diagnostic.isAuthenticated = currentUser.isAuthenticated;
    diagnostic.isProfileComplete = currentUser.isProfileComplete;
    diagnostic.emailPresent = currentUser.email === undefined
      ? null
      : typeof currentUser.email === 'string' && currentUser.email.trim().length > 0;
  } catch (error) {
    diagnostic.verificationReadFailed = true;
  }

  const confirmed = currentUser?.isAuthenticated === true &&
    currentUser.isProfileComplete === true;
  if (!confirmed || !currentUser) {
    throw new ClerkRegistrationCompletionError(diagnostic);
  }

  return {
    updatedCurrentUser,
    currentUser,
    // CurrentUser intentionally omits profile details such as weight. Do not
    // claim the optional weight was saved without a profile response confirming it.
    weightSaved: data.weightLbs === undefined,
    diagnostic,
  };
}
