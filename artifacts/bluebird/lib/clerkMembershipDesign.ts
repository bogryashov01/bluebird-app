import type { MobileMembershipSnapshot } from './mobileMembership';

export const CLERK_MEMBERSHIP_UNAVAILABLE = 'Unavailable';

export interface ClerkMembershipDesign {
  displayName: string;
  tierBadge: string;
  flightsFlown: string;
  totalSaved: string;
  skipTheLinePasses: string;
  referralBalance: string;
  usageLabel: string;
  usageProgress: number;
  upgradeTitle: string;
  upgradeBody: string;
  statusNote: string | null;
}

/**
 * Visual model for the original Membership layout. Counts and prices stay
 * unavailable unless they come from a verified mobile membership payload.
 */
export function presentClerkMembershipDesign(input: {
  verifiedFirstName?: string | null;
  verifiedLastName?: string | null;
  membership: MobileMembershipSnapshot | null;
}): ClerkMembershipDesign {
  const membership = input.membership;
  const verifiedMember = membership?.isMember === true && membership.tier !== null;
  return {
    displayName: verifiedDisplayName(input.verifiedFirstName, input.verifiedLastName),
    tierBadge: tierBadge(membership),
    flightsFlown: CLERK_MEMBERSHIP_UNAVAILABLE,
    totalSaved: CLERK_MEMBERSHIP_UNAVAILABLE,
    skipTheLinePasses: verifiedMember && membership?.skipTheLinePasses !== null && membership?.skipTheLinePasses !== undefined
      ? String(membership.skipTheLinePasses)
      : CLERK_MEMBERSHIP_UNAVAILABLE,
    referralBalance: CLERK_MEMBERSHIP_UNAVAILABLE,
    usageLabel: CLERK_MEMBERSHIP_UNAVAILABLE,
    usageProgress: 0,
    upgradeTitle: verifiedMember && membership?.tier === 'base' ? 'Base → Plus' : 'Upgrade',
    upgradeBody: 'Membership purchases are unavailable.',
    statusNote: membership
      ? null
      : 'Membership status is unavailable until it can be verified.',
  };
}

function verifiedDisplayName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  const name = [firstName, lastName]
    .map((part) => typeof part === 'string' ? part.trim() : '')
    .filter((part) => part.length > 0)
    .join(' ');
  return name || 'Name unavailable';
}

function tierBadge(membership: MobileMembershipSnapshot | null): string {
  if (!membership) return 'Membership unverified';
  if (!membership.isMember || membership.tier === null) return 'Not a member yet';
  if (membership.tier === 'plus') return 'Plus Member';
  return 'Base Member';
}
