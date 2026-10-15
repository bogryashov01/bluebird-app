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
  | { status: 'linked'; memberId: string }
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
  if (decision.status === 'linked') {
    const memberId = decision.memberId.trim();
    return memberId
      ? { status: 'linked', memberId }
      : { status: 'unresolved', reason: 'missing_authoritative_decision' };
  }
  return decision;
}

export type ClerkMemberDestination =
  | '/(auth)/complete-registration'
  | '/(auth)/onboarding'
  | '/(tabs)/discover';

/** Explicit capabilities required before a semantic outcome can open its route. */
export interface ClerkMemberNavigationReadiness {
  linkedMember: boolean;
  registration: boolean;
  onboarding: boolean;
}

/** Prepared semantic destination mapping; the app keeps these capabilities closed. */
export function getClerkMemberDestination(
  resolution: ClerkMemberResolution,
): ClerkMemberDestination | null {
  switch (resolution.status) {
    case 'registration_required':
      return '/(auth)/complete-registration';
    case 'onboarding_required':
      return '/(auth)/onboarding';
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
  if (destination === '/(tabs)/discover') return readiness.linkedMember ? destination : null;
  if (destination === '/(auth)/complete-registration') return readiness.registration ? destination : null;
  return readiness.onboarding ? destination : null;
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
  const memberDestination = getAvailableClerkMemberDestination(
    input.resolution,
    input.readiness,
  );
  if (memberDestination) return memberDestination;
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
