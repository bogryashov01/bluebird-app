import type { ClerkMemberResolution } from './clerkMemberResolution';

export type { ClerkMemberResolution } from './clerkMemberResolution';

export type ClerkEntryState =
  | 'loading'
  | 'signed-out'
  | 'member-pending'
  | 'member-unlinked'
  | 'member-linked'
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
): boolean {
  if (memberAccessResolved) return false;
  const group = segments[0];
  const route = segments[1];
  if (!group || group === 'index' || group === '(clerk-auth)') return false;
  if (group === '(auth)' && (route === 'splash' || route === 'welcome')) return false;
  return true;
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
