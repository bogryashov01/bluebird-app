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
  | { status: 'registered'; memberId?: string | null }
  | { status: 'linked'; memberId: string }
  | { status: 'registration_required' }
  | { status: 'onboarding_required' }
  | { status: 'unresolved'; reason: 'projection_only' | 'missing_authoritative_decision' }
  | {
      status: 'error';
      reason: 'unauthorized' | 'network' | 'backend' | 'invalid_response' | 'token' | 'cancelled' | 'unknown';
    };

export function shouldAutomaticallyResolveClerkMember(input: {
  isDevelopment: boolean;
  isClerkMode: boolean;
  isLoaded: boolean;
  isSignedIn: boolean | undefined;
}): boolean {
  // A signed-in session is not consent to call the Main API. Resolution is
  // available only through an explicit user-driven action.
  void input;
  return false;
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
 * Resolve through the existing authenticated GET /api/me adapter. The checked
 * in endpoint is projection-only, so all successful projections remain
 * unresolved until an authoritative decision is added to the backend contract.
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
    return resolveProjection(currentUser);
  } catch (error) {
    return { status: 'error', reason: getResolutionErrorReason(error) };
  }
}

/**
 * The existing /api/me fields are not identity evidence: neither a positive
 * member projection nor an anonymous/negative projection identifies an account.
 */
export function resolveProjection(_currentUser: ProductionCurrentUser): ClerkMemberResolution {
  return { status: 'unresolved', reason: 'projection_only' };
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
  | '/(tabs)/discover';

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
  | { kind: 'new_user_blocked'; steps: typeof CLERK_NEW_USER_JOURNEY_STEPS }
  | { kind: 'unverified'; reason: string }
  | { kind: 'error'; reason: string };

export function getClerkPostLoginJourney(
  resolution: ClerkMemberResolution,
  readiness: ClerkMemberNavigationReadiness,
): ClerkPostLoginJourney {
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
    return 'The Main API confirmed a registered account. Home is ready.';
  }
  if (journey.kind === 'new_user_blocked') {
    return 'The Main API confirmed a new account. Setup is paused until Bluebird can save the complete profile and every selected home airport.';
  }
  if (journey.kind === 'error') {
    return 'Bluebird could not verify the next step with the Main API. No registration state was inferred and no account changes were made.';
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
  return false;
}

/** A registered account may open Home without granting member-only capabilities. */
export function getClerkMemberDestination(
  resolution: ClerkMemberResolution,
): ClerkMemberDestination | null {
  switch (resolution.status) {
    case 'registered':
    case 'linked':
      return '/(tabs)/discover';
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
