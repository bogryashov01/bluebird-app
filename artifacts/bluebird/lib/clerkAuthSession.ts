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
    case 'registered':
      return 'registered-home';
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

export function shouldRedirectClerkRoute(
  segments: readonly string[],
  memberAccessResolved: boolean,
  registeredHomeReady = false,
): boolean {
  if (memberAccessResolved) return false;
  const group = segments[0];
  const route = segments[1];
  if (!group || group === 'index' || group === '(clerk-auth)') return false;
  if (
    registeredHomeReady &&
    group === '(tabs)' &&
    route === 'discover' &&
    (segments.length === 2 || (segments.length === 3 && segments[2] === 'index'))
  ) return false;
  if (group === '(auth)' && (route === 'splash' || route === 'welcome')) return false;
  // This one account route is explicitly user-opened and reads only the
  // authenticated user's API profile; it does not grant member capabilities.
  if (group === 'account' && route === 'bluebird-profile') return false;
  // The plan catalog is a public, read-only surface. Purchase and membership
  // actions remain unavailable until their own API contract is supported.
  if (group === 'membership' && route === 'plans') return false;
  return true;
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
