const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const DAY_MS = 86_400_000;

export type DiscoveredMemberState = 'available' | 'connected' | 'incoming' | 'outgoing';

/**
 * Uses lists the account already loaded plus optional discover metadata.
 * `outgoingRecipientIds` must be stable user IDs (confirmed creates).
 * `outgoingRequestPending` is the discover field: true/false when the server
 * sent it; omit/undefined when the old API is deployed (never treat missing as false).
 * Session-local pending wins over a stale discover `false`.
 */
export function presentDiscoveredMember(input: {
  userId: string;
  acceptedUserIds: readonly string[];
  incomingRequesterIds: readonly string[];
  outgoingRecipientIds?: readonly string[];
  outgoingRequestPending?: boolean;
}): DiscoveredMemberState {
  if (input.acceptedUserIds.includes(input.userId)) return 'connected';
  if (input.incomingRequesterIds.includes(input.userId)) return 'incoming';
  const sessionPending = (input.outgoingRecipientIds ?? []).includes(input.userId);
  if (sessionPending || input.outgoingRequestPending === true) return 'outgoing';
  return 'available';
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
