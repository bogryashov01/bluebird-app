import type { ClerkMemberResolution } from './clerkMemberResolution';

export type { ClerkMemberResolution } from './clerkMemberResolution';

export type ClerkEntryState =
  | 'loading'
  | 'signed-out'
  | 'member-pending'
  | 'member-not-checked'
  | 'member-unlinked'
  | 'member-linked'
  | 'registered-home'
  | 'profile-required'
  | 'registration-required'
  | 'onboarding-required'
  | 'error';

export function getClerkEntryState(input: {
  isLoaded: boolean;
  isSignedIn: boolean | undefined;
  memberResolution?: ClerkMemberResolution;
}): ClerkEntryState {
  if (!input.isLoaded) return 'loading';
  if (input.isSignedIn !== true) return 'signed-out';
  const resolution = input.memberResolution ?? { status: 'resolving' };
  switch (resolution.status) {
    case 'profile_complete':
    case 'registered':
      return 'registered-home';
    case 'profile_incomplete':
      return 'profile-required';
    case 'linked':
      return resolution.memberId.trim() ? 'member-linked' : 'member-unlinked';
    case 'registration_required':
      return 'registration-required';
    case 'onboarding_required':
      return 'onboarding-required';
    case 'error':
      return 'error';
    case 'unresolved':
      return 'member-unlinked';
    case 'signed_out':
      return 'signed-out';
    case 'resolving':
      return 'member-pending';
    case 'not_checked':
      return 'member-not-checked';
  }
}

export function canAccessClerkMemberScreens(input: {
  isLoaded: boolean;
  isSignedIn: boolean | undefined;
  memberResolution?: ClerkMemberResolution;
}): boolean {
  return getClerkEntryState(input) === 'member-linked';
}

const CLERK_JOIN_FLOW_ROUTES = new Set([
  'join',
  'demo-policy',
  'demo-intl',
  'demo-joined',
  'demo-status',
  'demo-pass',
  'demo-purchase',
  'demo-winner',
  'demo-confirmed',
]);

export function isClerkJoinFlowPath(segments: readonly string[], pathname = ''): boolean {
  const path = pathname.split(/[?#]/, 1)[0].replace(/\/+$/, '');
  if (path === '/flight/join' || /^\/flight\/demo-[a-z]+$/.test(path)) return true;
  return segments[0] === 'flight' &&
    segments.length === 2 &&
    CLERK_JOIN_FLOW_ROUTES.has(segments[1] ?? '');
}

export function shouldRedirectClerkRoute(
  segments: readonly string[],
  memberAccessResolved: boolean,
  registeredHomeReady = false,
  pathname = '',
): boolean {
  if (memberAccessResolved) return false;
  const group = segments[0];
  const route = segments[1];
  if (!group || group === 'index' || group === '(clerk-auth)') return false;
  if (
    registeredHomeReady &&
    group === '(tabs)' &&
    isClerkCoreTabRoute(segments)
  ) return false;
  // These destinations are available to complete Clerk profiles. Screen-level
  // reads remain separately gated by their verified Main API contracts.
  if (
    registeredHomeReady &&
    ((group === 'account' && route === 'personal-info' && segments.length === 2) ||
      (group === 'account' && route === 'payment-methods' && segments.length === 2) ||
      (group === 'notifications' && segments.length === 1) ||
      (group === 'airport-picker' && segments.length === 1))
  ) return false;
  // Flight details render the public flight read in Clerk mode. This does not
  // authorize queue, booking, or other member-only operations on that screen.
  if (registeredHomeReady && group === 'flight' && route === '[id]' && segments.length === 2) {
    return false;
  }
  // The join review and development-only demo screens do not submit a
  // production request. Match both the route name and the pathname so an
  // unmatched segment cannot send this flow back to the start screen.
  if (registeredHomeReady && isClerkJoinFlowPath(segments, pathname)) {
    return false;
  }
  if (group === '(auth)' && (route === 'splash' || route === 'welcome')) return false;
  // Referral codes are available to signed-in non-members as well as members.
  // The referral screen itself requires a valid Clerk session for account data.
  if (group === 'referral' && segments.length === 1) return false;
  // The Concierge screen for a complete Clerk profile is a local demo. It does
  // not send messages or call the concierge API.
  if (registeredHomeReady && group === 'concierge' && segments.length === 1) return false;
  // This one account route is explicitly user-opened and reads only the
  // authenticated user's API profile; it does not grant member capabilities.
  if (group === 'account' && route === 'bluebird-profile') return false;
  // The plan catalog is a public, read-only surface. Purchase and membership
  // actions remain unavailable until their own API contract is supported.
  if (group === 'membership' && route === 'plans') return false;
  return true;
}

/** Safe navigation tabs available to a complete Clerk profile, not member capabilities. */
export function isClerkCoreTabRoute(segments: readonly string[]): boolean {
  if (segments[0] !== '(tabs)') return false;
  const route = segments[1];
  if (route !== 'discover' && route !== 'trips' && route !== 'membership' && route !== 'profile') return false;
  return segments.length === 2 || (segments.length === 3 && segments[2] === 'index');
}

export function isLegacyMemberQueryEnabled(input: {
  authMode: 'legacy' | 'clerk';
  localDemoFlow: boolean;
  hasLegacyUser: boolean;
}): boolean {
  return input.authMode === 'legacy' && input.localDemoFlow && input.hasLegacyUser;
}

export function shouldUseLocalFlightReadMode(
  authMode: 'legacy' | 'clerk',
  localReadMode: boolean,
): boolean {
  return authMode === 'legacy' && localReadMode;
}

export function shouldClearClerkMemberCache(
  previousIdentity: string | null | undefined,
  nextIdentity: string | null,
  isLoaded: boolean,
): boolean {
  return isLoaded && previousIdentity !== nextIdentity;
}

export function clearClerkMemberCacheOnIdentityChange(
  cache: { clear: () => void },
  previousIdentity: string | null | undefined,
  nextIdentity: string | null,
  isLoaded: boolean,
): boolean {
  if (!shouldClearClerkMemberCache(previousIdentity, nextIdentity, isLoaded)) return false;
  cache.clear();
  return true;
}

export function createLegacyAuthTokenGetter(
  clerkAuthEnabled: boolean,
  readStoredToken: () => Promise<string | null>,
): () => Promise<string | null> {
  return async () => clerkAuthEnabled ? null : readStoredToken();
}
