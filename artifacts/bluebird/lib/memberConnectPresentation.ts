import type {
  ConnectionRelationshipConflict,
  ConnectionRelationshipDirection,
  ConnectionStatus,
} from '@/lib/memberConnections';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const DAY_MS = 86_400_000;

export type DiscoveredMemberState =
  | 'available'
  | 'connected'
  | 'incoming'
  | 'outgoing'
  /** Relationship exists (e.g. HTTP 409) but status is not server-confirmed. */
  | 'unavailable';

/**
 * Uses lists the account already loaded plus optional discover metadata.
 * `outgoingRecipientIds` must be stable user IDs (confirmed creates).
 * `outgoingRequestPending` is the discover field: true/false when the server
 * sent it; omit/undefined when the old API is deployed (never treat missing as false).
 * Session-local pending wins over a stale discover `false` when discover did
 * not send relationship fields. An explicit discover relationship (including
 * `relationshipStatus: null` with `outgoingRequestPending: false`) replaces a
 * stale unclassified 409 `unavailable` override.
 * `relationshipOverride` applies Task #1844 HTTP 409 facts so Send Request
 * cannot stay available for a known pending/accepted/incoming relationship.
 * Never invent "Request pending" from an unclassified conflict — use `unavailable`.
 */
export function presentDiscoveredMember(input: {
  userId: string;
  acceptedUserIds: readonly string[];
  incomingRequesterIds: readonly string[];
  outgoingRecipientIds?: readonly string[];
  outgoingRequestPending?: boolean;
  relationshipOverride?: DiscoveredMemberState | null;
  /** From the latest discover payload. Null when that payload did not include relationship fields. */
  serverDiscoveryState?: DiscoveredMemberState | null;
}): DiscoveredMemberState {
  if (input.serverDiscoveryState === 'available') {
    if (input.acceptedUserIds.includes(input.userId)) return 'connected';
    if (input.incomingRequesterIds.includes(input.userId)) return 'incoming';
    return 'available';
  }
  if (input.serverDiscoveryState === 'connected'
    || input.serverDiscoveryState === 'incoming'
    || input.serverDiscoveryState === 'outgoing') {
    if (input.acceptedUserIds.includes(input.userId)) return 'connected';
    if (input.incomingRequesterIds.includes(input.userId) && input.serverDiscoveryState !== 'outgoing') {
      return 'incoming';
    }
    return input.serverDiscoveryState;
  }
  if (input.relationshipOverride === 'connected'
    || input.relationshipOverride === 'incoming'
    || input.relationshipOverride === 'outgoing'
    || input.relationshipOverride === 'unavailable') {
    return input.relationshipOverride;
  }
  if (input.acceptedUserIds.includes(input.userId)) return 'connected';
  if (input.incomingRequesterIds.includes(input.userId)) return 'incoming';
  const sessionPending = (input.outgoingRecipientIds ?? []).includes(input.userId);
  if (sessionPending || input.outgoingRequestPending === true) return 'outgoing';
  return 'available';
}

/**
 * Maps a structured 409 relationship to Find Member chrome.
 * Declined/removed stay null so reconnect can remain available after migration 0107.
 */
/**
 * Maps a discover member that includes the post-redeploy relationship fields.
 * Returns null when those fields were omitted (old contract).
 * `relationshipStatus: null` with `outgoingRequestPending: false` is explicit
 * eligibility — Send Request may be shown, and it replaces a stale 409.
 */
export function discoveredStateFromDiscoveryMember(member: {
  outgoingRequestPending?: boolean;
  relationshipStatus?: ConnectionStatus | null;
  relationshipDirection?: ConnectionRelationshipDirection | null;
} | null | undefined): DiscoveredMemberState | null {
  if (!member || !Object.prototype.hasOwnProperty.call(member, 'relationshipStatus')) return null;
  if (member.relationshipStatus === 'accepted') return 'connected';
  if (member.relationshipStatus === 'pending') {
    return member.relationshipDirection === 'incoming' ? 'incoming' : 'outgoing';
  }
  if (member.relationshipStatus === 'declined' || member.relationshipStatus === 'removed') {
    return 'available';
  }
  if (member.outgoingRequestPending === true) return 'outgoing';
  if (member.relationshipStatus === null && member.outgoingRequestPending === false) return 'available';
  return null;
}

export function discoveredStateFromRelationshipConflict(
  relationship: ConnectionRelationshipConflict | null | undefined,
): DiscoveredMemberState | null {
  if (!relationship) return null;
  if (relationship.status === 'accepted') return 'connected';
  if (relationship.status === 'pending') {
    return relationship.direction === 'incoming' ? 'incoming' : 'outgoing';
  }
  return null;
}

/**
 * When Production returns HTTP 409 without Task #1844 fields, infer Find Member
 * chrome from lists the account already loaded (or just refreshed).
 */
export function inferDiscoveredStateFromConnectionLists(input: {
  userId: string;
  acceptedUserIds: readonly string[];
  incomingRequesterIds: readonly string[];
  outgoingRecipientIds?: readonly string[];
}): DiscoveredMemberState | null {
  if (input.acceptedUserIds.includes(input.userId)) return 'connected';
  if (input.incomingRequesterIds.includes(input.userId)) return 'incoming';
  if ((input.outgoingRecipientIds ?? []).includes(input.userId)) return 'outgoing';
  return null;
}

/**
 * Prefer structured 409 facts; otherwise fall back to server-confirmed list /
 * discover evidence. `blockUnspecifiedConflict` disables Send for a bare
 * relationship_exists payload — as `unavailable`, never as invented pending.
 */
export function resolveConflictDiscoveredState(input: {
  relationship: ConnectionRelationshipConflict | null | undefined;
  userId: string;
  acceptedUserIds: readonly string[];
  incomingRequesterIds: readonly string[];
  outgoingRecipientIds?: readonly string[];
  /** Server discover field — only `true` counts as confirmed outgoing pending. */
  outgoingRequestPending?: boolean;
  blockUnspecifiedConflict?: boolean;
}): DiscoveredMemberState | null {
  const fromRelationship = discoveredStateFromRelationshipConflict(input.relationship);
  if (fromRelationship) return fromRelationship;
  if (input.relationship?.status === 'declined' || input.relationship?.status === 'removed') {
    return null;
  }
  const fromLists = inferDiscoveredStateFromConnectionLists(input);
  if (fromLists) return fromLists;
  if (input.outgoingRequestPending === true) return 'outgoing';
  if (input.blockUnspecifiedConflict === true && !input.relationship) return 'unavailable';
  return null;
}

export function memberInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter((part) => part.length > 0);
  const first = parts[0]?.charAt(0) ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]?.charAt(0) ?? '' : '';
  const initials = `${first}${last}`.toLocaleUpperCase();
  return initials || 'B';
}

export function formatMemberActivityTime(value: string, nowMs: number): string {
  const date = new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time)) return '';
  const dayStart = (ms: number) => {
    const day = new Date(ms);
    return new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  };
  const diff = dayStart(nowMs) - dayStart(time);
  if (diff === 0) {
    const hour24 = date.getHours();
    const suffix = hour24 >= 12 ? 'PM' : 'AM';
    const hour = hour24 % 12 || 12;
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${hour}:${minute} ${suffix}`;
  }
  if (diff === DAY_MS) return 'Yesterday';
  if (diff > DAY_MS && diff < 7 * DAY_MS) return WEEKDAYS[date.getDay()] ?? '';
  const month = MONTHS[date.getMonth()] ?? '';
  return `${month} ${date.getDate()}`;
}
