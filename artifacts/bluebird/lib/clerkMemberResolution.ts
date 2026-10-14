import {
  createAuthenticatedProductionApiClient,
  ProductionAuthRequestError,
  type ProductionCurrentUser,
} from './productionAuthApi';
import {
  createClerkProductionTokenProvider,
  type ClerkSessionSnapshot,
} from './clerkProductionTokenProvider';

export type ClerkMemberResolution =
  | { status: 'signed_out' }
  | { status: 'resolving'; clerkUserId?: string | null }
  | { status: 'linked'; memberId: string }
  | { status: 'registration_required' }
  | { status: 'onboarding_required' }
  | { status: 'unresolved'; reason: 'projection_only' | 'missing_authoritative_decision' }
  | {
      status: 'error';
      reason: 'unauthorized' | 'network' | 'backend' | 'invalid_response' | 'token' | 'cancelled' | 'unknown';
    };

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
  clerkUserId?: string | null;
  baseUrl?: string;
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
    });
    const api = createAuthenticatedProductionApiClient({
      tokenProvider,
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
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

/** Prepared destination mapping; actual routing remains closed by the auth gate. */
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
