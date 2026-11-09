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

/** Queue Status is a read of the signed-in member's queue. Opening it does not join or leave. */
export function isClerkQueueStatusPath(segments: readonly string[], pathname = ''): boolean {
  const path = pathname.split(/[?#]/, 1)[0].replace(/\/+$/, '');
  if (path === '/flight/queue-status') return true;
  return segments[0] === 'flight' &&
    segments[1] === 'queue-status' &&
    segments.length === 2;
}

/** The winner celebration opens refreshed flight details. Opening it does not confirm or decline. */
export function isClerkWinnerPath(segments: readonly string[], pathname = ''): boolean {
  const path = pathname.split(/[?#]/, 1)[0].replace(/\/+$/, '');
  if (path === '/flight/winner') return true;
  return segments[0] === 'flight' &&
    segments[1] === 'winner' &&
    segments.length === 2;
}

/**
 * A Clerk snapshot that has not loaded yet is still restoring the previous
 * session. Redirecting during that gap sends a signed-in member to sign-in.
 */
export function shouldApplyClerkRouteRedirect(input: {
  sessionLoaded: boolean;
  routeRequiresRedirect: boolean;
}): boolean {
  if (!input.sessionLoaded) return false;
  return input.routeRequiresRedirect;
}

export function shouldRedirectClerkRoute(
  segments: readonly string[],
  memberAccessResolved: boolean,
  registeredHomeReady = false,
  pathname = '',
  connectionsPreviewEnabled = false,
  developmentDiagnosticsEnabled = false,
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
      (group === 'account' && route === 'contacts' && segments.length === 2) ||
      (group === 'support' && (route === 'help-center' || route === 'legal') && segments.length === 2) ||
      (group === 'notifications' && segments.length === 1) ||
      (group === 'airport-picker' && segments.length === 1))
  ) return false;
  // Flight details may read GET /api/empty-legs/:id for a complete Clerk profile.
  // Opening the screen does not authorize queue joins, booking, or membership changes.
  if (registeredHomeReady && group === 'flight' && route === '[id]' && segments.length === 2) {
    return false;
  }
  // The checklist is opened by the member. Its screen performs the trip read.
  // Opening it does not confirm, decline, or award the flight.
  if (registeredHomeReady && group === 'flight' && route === 'checklist' && segments.length === 2) {
    return false;
  }
  // Passenger Information is opened from the checklist. Its screen reads the
  // manifest. Opening it does not create, edit, or remove passengers.
  if (registeredHomeReady && group === 'flight' && route === 'passengers' && segments.length === 2) {
    return false;
  }
  // The active flight policy is a public document. Opening it does not
  // acknowledge the checklist step.
  if (registeredHomeReady && group === 'flight' && route === 'policy-review' && segments.length === 2) {
    return false;
  }
  // Queue Status reads the member's server queue. A missing allowlist entry
  // sends the signed-in member back through the home redirect.
  if (registeredHomeReady && isClerkQueueStatusPath(segments, pathname)) {
    return false;
  }
  if (registeredHomeReady && isClerkWinnerPath(segments, pathname)) {
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
  // The device-local Connections Preview stays available only in a development
  // build. Production Clerk sessions are redirected before the screen renders.
  if (
    connectionsPreviewEnabled &&
    registeredHomeReady &&
    isConnectionsPreviewPath(segments) &&
    !pathnameHasLegacyConversationTarget(pathname)
  ) return false;
  // Development builds can open a manual read-only Connections diagnostic.
  // Release builds keep the route behind the normal redirect.
  if (
    developmentDiagnosticsEnabled &&
    registeredHomeReady &&
    isConnectionDiagnosticsPath(segments, pathname)
  ) return false;
  // Member message threads use the messages client. Opening this route does
  // not enable the feature or send a message. A demo or non-numeric id is not
  // a member thread and is redirected with the other legacy conversation links.
  if (
    registeredHomeReady &&
    isMemberMessagePath(segments) &&
    !isInvalidMemberMessageLocation(segments, pathname)
  ) return false;
  // This one account route is explicitly user-opened and reads only the
  // authenticated user's API profile; it does not grant member capabilities.
  if (group === 'account' && route === 'bluebird-profile') return false;
  // The plan catalog is a public, read-only surface. Purchase and membership
  // actions remain unavailable until their own API contract is supported.
  if (group === 'membership' && route === 'plans') return false;
  return true;
}

const CONNECTIONS_PREVIEW_ID = /^(?:\[id\]|demo-[A-Za-z0-9-]{1,80})$/;
const MEMBER_MESSAGE_ID = /^(?:\[conversationId\]|[1-9]\d*)$/;
const SAFE_MEMBER_MESSAGE_PATH = /^\/messages\/([1-9]\d*)$/;

export const CLERK_CONNECTIONS_TAB = '/(tabs)/connections' as const;

export function isConnectionDiagnosticsPath(segments: readonly string[], pathname = ''): boolean {
  const path = locationPath(pathname);
  if (path === '/dev/connection-diagnostics') return true;
  return segments[0] === 'dev' &&
    segments[1] === 'connection-diagnostics' &&
    segments.length === 2;
}

/** Development builds may open the device-local preview. Release builds cannot. */
export function isConnectionsPreviewDevelopmentEnabled(
  developmentBuild: boolean = typeof __DEV__ !== 'undefined' && __DEV__ === true,
): boolean {
  return developmentBuild === true;
}

function locationPath(pathname: string): string {
  const path = pathname.split(/[?#]/, 1)[0].replace(/\/+$/, '');
  return path || '/';
}

function pathnameHasLegacyConversationTarget(pathname: string): boolean {
  const path = locationPath(pathname);
  return path === '/networking' ||
    path.startsWith('/networking/') ||
    path === '/messages' ||
    (path.startsWith('/messages/') && !SAFE_MEMBER_MESSAGE_PATH.test(path));
}

export function isLegacyNetworkingLocation(
  segments: readonly string[],
  pathname = '',
): boolean {
  if (segments[0] === 'networking') return true;
  const path = locationPath(pathname);
  return path === '/networking' || path.startsWith('/networking/');
}

export function isConnectionsPreviewLocation(
  segments: readonly string[],
  pathname = '',
): boolean {
  if (segments[0] === 'connections-preview') return true;
  const path = locationPath(pathname);
  return path === '/connections-preview' || path.startsWith('/connections-preview/');
}

export function isInvalidMemberMessageLocation(
  segments: readonly string[],
  pathname = '',
): boolean {
  const path = locationPath(pathname);
  if (path === '/messages' || path.startsWith('/messages/')) {
    return !SAFE_MEMBER_MESSAGE_PATH.test(path);
  }
  return segments[0] === 'messages' && !isMemberMessagePath(segments);
}

/**
 * A ready Clerk home leaves legacy demo chats and local JWT networking for
 * the Connections tab. Signed-out and incomplete sessions use the existing
 * sign-in route. Legacy JWT sessions are unchanged.
 */
export function clerkLegacyConversationHref(input: {
  authMode: 'legacy' | 'clerk';
  segments: readonly string[];
  pathname?: string;
  homeReady: boolean;
  developmentPreview: boolean;
}): typeof CLERK_CONNECTIONS_TAB | null {
  if (input.authMode !== 'clerk' || !input.homeReady) return null;
  const pathname = input.pathname ?? '';
  const legacyNetworking = isLegacyNetworkingLocation(input.segments, pathname);
  const allowedPreview = input.developmentPreview &&
    isConnectionsPreviewPath(input.segments) &&
    !pathnameHasLegacyConversationTarget(pathname);
  const demoPreview = isConnectionsPreviewLocation(input.segments, pathname) && !allowedPreview;
  const invalidMessage = isInvalidMemberMessageLocation(input.segments, pathname);
  if (!legacyNetworking && !demoPreview && !invalidMessage) return null;
  return CLERK_CONNECTIONS_TAB;
}

export function isMemberMessagePath(segments: readonly string[]): boolean {
  return segments.length === 2 &&
    segments[0] === 'messages' &&
    MEMBER_MESSAGE_ID.test(segments[1] ?? '');
}

export function isConnectionsPreviewPath(segments: readonly string[]): boolean {
  if (segments[0] !== 'connections-preview') return false;
  if (segments.length === 1 || (segments.length === 2 && segments[1] === 'index')) return true;
  return segments.length === 3 &&
    (segments[1] === 'member' || segments[1] === 'chat') &&
    CONNECTIONS_PREVIEW_ID.test(segments[2] ?? '');
}

/** Safe navigation tabs available to a complete Clerk profile, not member capabilities. */
export function isClerkCoreTabRoute(segments: readonly string[]): boolean {
  if (segments[0] !== '(tabs)') return false;
  const route = segments[1];
  if (
    route !== 'discover' &&
    route !== 'trips' &&
    route !== 'connections' &&
    route !== 'membership' &&
    route !== 'profile'
  ) return false;
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
