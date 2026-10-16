import {
  createAuthenticatedProductionApiClient,
  ProductionAuthRequestError,
  type ProductionCurrentUser,
} from './productionAuthApi';
import {
  createClerkProductionTokenProvider,
  type ClerkSessionSnapshot,
} from './clerkProductionTokenProvider';
import type { MainBluebirdApiConfiguration } from './mainBluebirdApiConfig';

export type ClerkMemberResolution =
  | { status: 'signed_out' }
  | { status: 'resolving'; clerkUserId?: string | null }
  | { status: 'not_checked'; clerkUserId?: string | null }
  | {
      status: 'profile_complete';
      clerkUserId: string;
      currentUser: ProductionCurrentUser;
    }
  | {
      status: 'profile_incomplete';
      clerkUserId: string;
      currentUser: ProductionCurrentUser;
    }
  | { status: 'registered'; memberId?: string | null }
  | { status: 'linked'; memberId: string }
  | { status: 'registration_required' }
  | { status: 'onboarding_required' }
  | {
      status: 'unresolved';
      reason: 'projection_only' | 'missing_authoritative_decision' | 'unauthenticated';
    }
  | {
      status: 'error';
      reason: 'unauthorized' | 'network' | 'backend' | 'invalid_response' | 'token' | 'cancelled' | 'unknown';
    };

export function shouldAutomaticallyResolveClerkMember(input: {
  isClerkMode: boolean;
  isLoaded: boolean;
  isSignedIn: boolean | undefined;
}): boolean {
  return input.isClerkMode && input.isLoaded && input.isSignedIn === true;
}

/**
 * A semantic decision, not an API wire shape. Only an adapter backed by an
 * approved backend contract may provide one. The current /api/me adapter does
 * not return this type and must not derive it from projection booleans.
 */
export type AuthoritativeMemberDecision =
  | { status: 'registered'; memberId?: string | null }
  | { status: 'registration_required' }
  | { status: 'onboarding_required' };

export interface ClerkMemberResolutionOptions {
  session: ClerkSessionSnapshot;
  configuration: MainBluebirdApiConfiguration;
  clerkUserId?: string | null;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * Resolve only the profile-routing decision explicitly supported by the
 * authenticated /api/me projection. This does not grant member capabilities.
 */
export async function resolveClerkMember(
  options: ClerkMemberResolutionOptions,
): Promise<ClerkMemberResolution> {
  const { session } = options;
  if (!session.isLoaded) return { status: 'resolving', clerkUserId: options.clerkUserId };
  if (session.isSignedIn !== true) return { status: 'signed_out' };

  try {
    const tokenProvider = createClerkProductionTokenProvider({
      getCurrentSession: () => session,
    }, options.configuration.environment);
    const api = createAuthenticatedProductionApiClient({
      tokenProvider,
      environment: options.configuration.environment,
      baseUrl: options.configuration.apiBaseUrl,
      ...(options.fetcher ? { fetcher: options.fetcher } : {}),
    });
    const currentUser = await api.getMe({ signal: options.signal });
    return resolveProjection(currentUser, options.clerkUserId);
  } catch (error) {
    return { status: 'error', reason: getResolutionErrorReason(error) };
  }
}

/** Profile booleans guide navigation only; they do not identify a Bluebird member. */
export function resolveProjection(
  currentUser: ProductionCurrentUser,
  clerkUserId?: string | null,
): ClerkMemberResolution {
  if (
    typeof currentUser.isAuthenticated !== 'boolean' ||
    typeof currentUser.isProfileComplete !== 'boolean' ||
    typeof currentUser.isMember !== 'boolean'
  ) {
    return { status: 'error', reason: 'invalid_response' };
  }
  if (currentUser.isAuthenticated !== true) {
    return { status: 'unresolved', reason: 'unauthenticated' };
  }
  if (typeof clerkUserId !== 'string' || !clerkUserId.trim()) {
    return { status: 'unresolved', reason: 'missing_authoritative_decision' };
  }
  if (currentUser.isProfileComplete === true) {
    return { status: 'profile_complete', clerkUserId, currentUser };
  }
  if (currentUser.isProfileComplete === false) {
    return { status: 'profile_incomplete', clerkUserId, currentUser };
  }
  return { status: 'unresolved', reason: 'missing_authoritative_decision' };
}

/** Do not let a result for the previous Clerk account authorize current routes. */
export function getClerkResolutionForIdentity(
  resolution: ClerkMemberResolution,
  clerkUserId: string | null,
): ClerkMemberResolution {
  if (
    (resolution.status === 'profile_complete' || resolution.status === 'profile_incomplete') &&
    resolution.clerkUserId !== clerkUserId
  ) {
    return clerkUserId
      ? { status: 'resolving', clerkUserId }
      : { status: 'signed_out' };
  }
  return resolution;
}

export function isClerkMemberResolutionCurrent(input: {
  requestedClerkUserId: string;
  currentClerkUserId: string | null;
  aborted: boolean;
}): boolean {
  return !input.aborted &&
    !!input.requestedClerkUserId &&
    input.requestedClerkUserId === input.currentClerkUserId;
}

/**
 * State mapping for a future verified adapter. This function accepts only the
 * typed semantic result; raw /api/me fields are never coerced into a decision.
 */
export function mapAuthoritativeMemberDecision(
  decision: AuthoritativeMemberDecision | null,
): ClerkMemberResolution {
  if (!decision) return { status: 'unresolved', reason: 'missing_authoritative_decision' };
  if (decision.status === 'registered') {
    if (decision.memberId !== undefined && decision.memberId !== null &&
        (typeof decision.memberId !== 'string' || !decision.memberId.trim())) {
      return { status: 'unresolved', reason: 'missing_authoritative_decision' };
    }
    return {
      status: 'registered',
      ...(decision.memberId === undefined ? {} : { memberId: decision.memberId }),
    };
  }
  return decision;
}

export type ClerkMemberDestination =
  | '/(tabs)/discover'
  | '/account/bluebird-profile';

/** Explicit capabilities required before a semantic outcome can open its route. */
export interface ClerkMemberNavigationReadiness {
  registeredHome: boolean;
  linkedMember: boolean;
}

export const CLERK_NEW_USER_JOURNEY_STEPS = [
  'complete_profile',
  'airport_selection',
  'onboarding',
  'home',
] as const;

export type ClerkPostLoginJourney =
  | { kind: 'home'; destination: '/(tabs)/discover' }
  | { kind: 'profile'; destination: '/account/bluebird-profile' }
  | { kind: 'new_user_blocked'; steps: typeof CLERK_NEW_USER_JOURNEY_STEPS }
  | { kind: 'unverified'; reason: string }
  | { kind: 'error'; reason: string };

export function getClerkPostLoginJourney(
  resolution: ClerkMemberResolution,
  readiness: ClerkMemberNavigationReadiness,
): ClerkPostLoginJourney {
  if (resolution.status === 'profile_complete') {
    return { kind: 'home', destination: '/(tabs)/discover' };
  }
  if (resolution.status === 'profile_incomplete') {
    return { kind: 'profile', destination: '/account/bluebird-profile' };
  }
  if (resolution.status === 'registered') {
    return isClerkHomeAvailable(resolution, readiness)
      ? { kind: 'home', destination: '/(tabs)/discover' }
      : { kind: 'unverified', reason: 'registered_home_not_ready' };
  }
  if (resolution.status === 'linked') {
    return isClerkHomeAvailable(resolution, readiness)
      ? { kind: 'home', destination: '/(tabs)/discover' }
      : { kind: 'unverified', reason: 'linked_member_not_ready' };
  }
  if (resolution.status === 'registration_required') {
    return { kind: 'new_user_blocked', steps: CLERK_NEW_USER_JOURNEY_STEPS };
  }
  if (resolution.status === 'onboarding_required') {
    return { kind: 'unverified', reason: 'onboarding_contract_not_ready' };
  }
  if (resolution.status === 'error') return { kind: 'error', reason: resolution.reason };
  return {
    kind: 'unverified',
    reason: resolution.status === 'unresolved'
      ? resolution.reason
      : 'registration_not_confirmed',
  };
}

export function getClerkPostLoginStatusMessage(
  resolution: ClerkMemberResolution,
  readiness: ClerkMemberNavigationReadiness,
): string {
  const journey = getClerkPostLoginJourney(resolution, readiness);
  if (journey.kind === 'home') {
    return 'The Main API confirmed your profile is complete. Home is ready.';
  }
  if (journey.kind === 'profile') {
    return 'The Main API confirmed that your profile needs completion. Your saved profile values will be loaded before you make changes.';
  }
  if (journey.kind === 'new_user_blocked') {
    return 'The Main API confirmed a new account. Setup is paused until Bluebird can save the complete profile and every selected home airport.';
  }
  if (journey.kind === 'error') {
    return 'Bluebird could not verify the next step with the Main API. No registration state was inferred and no account changes were made.';
  }
  if (journey.reason === 'unauthenticated') {
    return 'The Main API did not confirm this Clerk session. No profile, airport, or membership changes were made.';
  }
  if (journey.reason === 'projection_only' || journey.reason === 'missing_authoritative_decision') {
    return 'The Main API has not supplied an authoritative registered-versus-new result. Bluebird will not infer the route from profile or membership fields.';
  }
  if (journey.reason === 'onboarding_contract_not_ready') {
    return 'The Main API indicates onboarding is required, but Bluebird cannot safely continue until the profile and multi-airport contracts support the full setup flow.';
  }
  if (journey.reason === 'registered_home_not_ready' || journey.reason === 'linked_member_not_ready') {
    return 'The Main API confirmed registration, but Home is not enabled until the mobile app can keep Home separate from backend-authorized member features.';
  }
  return 'The app has not received an authoritative registration result. No profile, airport, or membership changes were made.';
}

export function isClerkHomeAvailable(
  resolution: ClerkMemberResolution,
  readiness: ClerkMemberNavigationReadiness,
): boolean {
  if (resolution.status === 'registered') return readiness.registeredHome;
  if (resolution.status === 'linked') return readiness.linkedMember;
  if (resolution.status === 'profile_complete') return true;
  return false;
}

/** A registered account may open Home without granting member-only capabilities. */
export function getClerkMemberDestination(
  resolution: ClerkMemberResolution,
): ClerkMemberDestination | null {
  switch (resolution.status) {
    case 'profile_complete':
    case 'registered':
    case 'linked':
      return '/(tabs)/discover';
    case 'profile_incomplete':
      return '/account/bluebird-profile';
    default:
      return null;
  }
}

/**
 * A semantic outcome alone is not permission to enter a screen. In particular,
 * registration and onboarding currently depend on the legacy Bluebird JWT.
 */
export function getAvailableClerkMemberDestination(
  resolution: ClerkMemberResolution,
  readiness: ClerkMemberNavigationReadiness,
): ClerkMemberDestination | null {
  const destination = getClerkMemberDestination(resolution);
  if (!destination) return null;
  return isClerkHomeAvailable(resolution, readiness) ? destination : null;
}

export type ClerkAuthRootDestination =
  | '/(auth)/splash'
  | '/(clerk-auth)/signed-in'
  | ClerkMemberDestination;

export function getClerkAuthRootDestination(input: {
  clerkSignedIn: boolean;
  resolution: ClerkMemberResolution;
  readiness: ClerkMemberNavigationReadiness;
}): ClerkAuthRootDestination {
  const journey = getClerkPostLoginJourney(input.resolution, input.readiness);
  if (journey.kind === 'home') return journey.destination;
  if (journey.kind === 'profile') return journey.destination;
  return input.clerkSignedIn ? '/(clerk-auth)/signed-in' : '/(auth)/splash';
}

function getResolutionErrorReason(error: unknown): Extract<ClerkMemberResolution, { status: 'error' }>['reason'] {
  if (!(error instanceof ProductionAuthRequestError)) return 'unknown';
  switch (error.code) {
    case 'session_expired':
      return 'unauthorized';
    case 'network':
    case 'timeout':
      return 'network';
    case 'invalid_json':
    case 'invalid_schema':
      return 'invalid_response';
    case 'http':
      return 'backend';
    case 'token':
      return 'token';
    case 'cancelled':
      return 'cancelled';
  }
}
