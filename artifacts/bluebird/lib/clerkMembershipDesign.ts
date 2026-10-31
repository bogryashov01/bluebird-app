import type { MobileMembershipSnapshot } from './mobileMembership';

export interface ClerkMembershipMetric {
  label: string;
  value: string;
}

export interface AccountMembershipProjection {
  resolved: boolean;
  isMember?: boolean;
  memberTier?: 'base' | 'plus' | null;
}

export interface ClerkMembershipDesign {
  displayName: string;
  tierBadge: string;
  metrics: ClerkMembershipMetric[];
  upgradeBody: string;
  statusNote: string | null;
}

export const MEMBERSHIP_STATUS_UNAVAILABLE = 'Membership status unavailable';
export const MEMBERSHIP_METRICS_NOTE = 'Flight totals, savings, and passes appear after Bluebird confirms them.';
export const MEMBERSHIP_PURCHASE_NOTE = 'Membership purchases are not available in the app.';
const MEMBERSHIP_CONFLICT_NOTE = 'Membership details do not match, so a tier is not shown.';

/**
 * Visual model for the Clerk Membership screen.
 * A tier comes from a verified mobile snapshot when one exists, otherwise from
 * the parsed account projection. Counts and prices are omitted unless the
 * snapshot itself contains them.
 */
export function presentClerkMembershipDesign(input: {
  verifiedFirstName?: string | null;
  verifiedLastName?: string | null;
  membership: MobileMembershipSnapshot | null;
  account?: AccountMembershipProjection;
}): ClerkMembershipDesign {
  const fromSnapshot = input.membership ? snapshotLabel(input.membership) : null;
  const fromAccount = accountLabel(input.account);
  const labelsDisagree = fromAccount !== null && fromSnapshot !== null && fromAccount !== fromSnapshot;
  const tierBadge = labelsDisagree
    ? MEMBERSHIP_STATUS_UNAVAILABLE
    : fromSnapshot ?? fromAccount ?? MEMBERSHIP_STATUS_UNAVAILABLE;
  const metrics = labelsDisagree ? [] : verifiedMetrics(input.membership);
  const confirmedAbsence = tierBadge === 'Not a member yet' || tierBadge === 'Not a member';
  return {
    displayName: verifiedDisplayName(input.verifiedFirstName, input.verifiedLastName),
    tierBadge,
    metrics,
    upgradeBody: MEMBERSHIP_PURCHASE_NOTE,
    statusNote: labelsDisagree
      ? MEMBERSHIP_CONFLICT_NOTE
      : metrics.length > 0 || confirmedAbsence
        ? null
        : MEMBERSHIP_METRICS_NOTE,
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

function snapshotLabel(membership: MobileMembershipSnapshot): string {
  if (!membership.isMember || membership.tier === null) return 'Not a member yet';
  if (membership.tier === 'plus') return 'Plus Member';
  return 'Base Member';
}

function accountLabel(account: AccountMembershipProjection | undefined): string | null {
  if (!account?.resolved) return null;
  if (account.isMember !== true) return 'Not a member';
  if (account.memberTier === 'plus') return 'Plus Member';
  if (account.memberTier === 'base') return 'Base Member';
  return null;
}

function verifiedMetrics(membership: MobileMembershipSnapshot | null): ClerkMembershipMetric[] {
  if (!membership?.isMember || !membership.tier || membership.skipTheLinePasses == null) return [];
  return [{ label: 'Skip the Line Passes', value: String(membership.skipTheLinePasses) }];
}

export const MEMBERSHIP_STAT_UNAVAILABLE = '\u2014';

export interface MembershipDashboardStat {
  label: string;
  value: string;
  available: boolean;
  accessibilityLabel: string;
}

export interface MembershipUpgradeOffer {
  eyebrow: 'UPGRADE';
  title: 'Base → Plus';
  description: string;
  buttonLabel: 'Upgrade available soon';
  paymentEnabled: false;
}

export interface MembershipDashboard {
  displayName: string;
  tierBadge: string;
  metrics: MembershipDashboardStat[];
  upgrade: MembershipUpgradeOffer | null;
  statusNote: string | null;
  statusLine: string | null;
  paymentLine: string | null;
  periodLine: string | null;
  annualUsage: null;
}

const PLUS_UPGRADE_DESCRIPTION = 'Priority queue placement, international empty-leg access, and 5 included Skip-the-Line upgrades.';

/**
 * Membership dashboard for the signed-in Clerk account.
 * An active Base or Plus tier comes from the membership response. Payment
 * status is shown separately and does not hide that tier. A tier name on the
 * account projection is not that confirmation. Flight totals and savings are
 * not in a reliable account contract, so those stats stay unavailable.
 */
/**
 * Fields the dashboard may use. A production membership response is adapted
 * into this shape. Payment methods, charges, and event history are not part
 * of it.
 */
export interface MembershipDashboardMembership {
  isMember: boolean;
  tier: 'base' | 'plus' | null;
  status: 'active' | 'canceled' | 'expired' | 'pending_payment' | null;
  paymentStatus: 'none' | 'pending' | 'succeeded' | 'failed' | null;
  currentPeriodEnd: string | null;
  skipTheLinePasses: number | null;
}

export function presentMembershipDashboard(input: {
  signedIn: boolean;
  verifiedFirstName?: string | null;
  verifiedLastName?: string | null;
  membership: MembershipDashboardMembership | null;
  account?: AccountMembershipProjection;
  referralBalanceCents?: number | null;
}): MembershipDashboard {
  if (input.signedIn !== true) {
    return {
      displayName: 'Name unavailable',
      tierBadge: 'Sign in required',
      metrics: dashboardMetrics(null, null),
      upgrade: null,
      statusNote: null,
      statusLine: null,
      paymentLine: null,
      periodLine: null,
      annualUsage: null,
    };
  }
  const membership = input.membership;
  const accountTier = accountLabel(input.account);
  const confirmedTier = confirmedActiveTier(membership);
  const snapshotTierLabel = confirmedTier === 'plus'
    ? 'Plus Member'
    : confirmedTier === 'base'
      ? 'Base Member'
      : null;
  const labelsDisagree = accountTier !== null &&
    snapshotTierLabel !== null &&
    accountTier !== snapshotTierLabel &&
    accountTier !== 'Not a member';
  const nonMemberConflict = membership?.isMember === true &&
    confirmedTier !== null &&
    input.account?.resolved === true &&
    input.account.isMember === false;
  if (labelsDisagree || nonMemberConflict) {
    return {
      displayName: verifiedDisplayName(input.verifiedFirstName, input.verifiedLastName),
      tierBadge: MEMBERSHIP_STATUS_UNAVAILABLE,
      metrics: dashboardMetrics(null, null),
      upgrade: null,
      statusNote: MEMBERSHIP_CONFLICT_NOTE,
      statusLine: null,
      paymentLine: null,
      periodLine: null,
      annualUsage: null,
    };
  }
  const stateNote = membershipStateNote(membership);
  const tierBadge = snapshotTierLabel ??
    (membership?.isMember === false
      ? 'Not a member yet'
      : accountTier === 'Not a member'
        ? 'Not a member'
        : stateNote.badge);
  return {
    displayName: verifiedDisplayName(input.verifiedFirstName, input.verifiedLastName),
    tierBadge,
    metrics: dashboardMetrics(membership, input.referralBalanceCents),
    upgrade: confirmedTier === 'base' ? baseUpgradeOffer() : null,
    statusNote: snapshotTierLabel || membership?.isMember === false || accountTier === 'Not a member'
      ? null
      : stateNote.note,
    statusLine: snapshotTierLabel ? 'Active Membership' : null,
    paymentLine: snapshotTierLabel ? paymentStatusLine(membership) : null,
    periodLine: snapshotTierLabel ? currentPeriodLine(membership) : null,
    annualUsage: null,
  };
}

function paymentStatusLine(
  membership: MembershipDashboardMembership | null,
): string | null {
  switch (membership?.paymentStatus) {
    case 'succeeded':
      return 'Payment confirmed';
    case 'pending':
      return 'Payment pending';
    case 'failed':
      return 'Payment failed';
    case 'none':
      return 'Payment not confirmed';
    default:
      return null;
  }
}

function currentPeriodLine(
  membership: MembershipDashboardMembership | null,
): string | null {
  const end = formatPeriodEnd(membership?.currentPeriodEnd);
  return end ? `Current period ends ${end}` : null;
}

function formatPeriodEnd(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function confirmedActiveTier(
  membership: MembershipDashboardMembership | null,
): 'base' | 'plus' | null {
  if (!membership?.isMember || membership.status !== 'active') return null;
  if (membership.tier === 'base' || membership.tier === 'plus') return membership.tier;
  return null;
}

function membershipStateNote(
  membership: MembershipDashboardMembership | null,
): { badge: string; note: string | null } {
  if (!membership) {
    return {
      badge: MEMBERSHIP_STATUS_UNAVAILABLE,
      note: 'Membership status is not confirmed, so a tier is not shown.',
    };
  }
  if (!membership.isMember) {
    return { badge: 'Not a member yet', note: null };
  }
  if (membership.status === 'pending_payment' || membership.paymentStatus === 'pending') {
    return {
      badge: 'Payment pending',
      note: 'Payment is still pending. A membership badge is not shown.',
    };
  }
  if (membership.status === 'expired') {
    return { badge: 'Membership expired', note: 'This membership is expired.' };
  }
  if (membership.status === 'canceled') {
    return { badge: 'Membership inactive', note: 'This membership is not active.' };
  }
  return {
    badge: MEMBERSHIP_STATUS_UNAVAILABLE,
    note: 'Membership status is not confirmed, so a tier is not shown.',
  };
}

function dashboardMetrics(
  membership: MembershipDashboardMembership | null,
  referralBalanceCents: number | null | undefined,
): MembershipDashboardStat[] {
  const passes = membership?.skipTheLinePasses;
  const passesKnown = typeof passes === 'number' && Number.isSafeInteger(passes) && passes >= 0;
  const referralKnown = typeof referralBalanceCents === 'number' &&
    Number.isSafeInteger(referralBalanceCents) &&
    referralBalanceCents >= 0;
  return [
    unavailableStat('Flights Flown'),
    unavailableStat('Total Saved'),
    passesKnown
      ? {
          label: 'Skip the Line Passes',
          value: String(passes),
          available: true,
          accessibilityLabel: `Skip the Line passes, ${passes}`,
        }
      : unavailableStat('Skip the Line Passes'),
    referralKnown
      ? {
          label: 'Referral Balance',
          value: formatDashboardCents(referralBalanceCents),
          available: true,
          accessibilityLabel: `Referral balance, ${formatDashboardCents(referralBalanceCents)}`,
        }
      : unavailableStat('Referral Balance'),
  ];
}

function unavailableStat(label: string): MembershipDashboardStat {
  return {
    label,
    value: MEMBERSHIP_STAT_UNAVAILABLE,
    available: false,
    accessibilityLabel: `${label} unavailable`,
  };
}

function formatDashboardCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function baseUpgradeOffer(): MembershipUpgradeOffer {
  return {
    eyebrow: 'UPGRADE',
    title: 'Base → Plus',
    description: PLUS_UPGRADE_DESCRIPTION,
    buttonLabel: 'Upgrade available soon',
    paymentEnabled: false,
  };
}
