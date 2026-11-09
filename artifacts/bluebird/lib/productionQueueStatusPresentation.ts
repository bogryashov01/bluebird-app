import { presentJoinQueueWindow, presentQueueCloseCountdown } from './joinFlightPresentation';

export interface ProductionQueuePosition {
  position: number | null;
  total: number | null;
}

export interface ProductionQueueRing {
  positionText: string | null;
  totalText: string | null;
  fraction: number | null;
}

export interface SessionQueueMovement {
  from: number;
  to: number;
  text: string;
  observedAt: string;
  scope: 'session';
}

export type ProductionQueueDecision =
  | { kind: 'countdown'; label: string }
  | { kind: 'closed'; label: string }
  | { kind: 'unavailable' };

export type ProductionQueueStatusTone = 'open' | 'closed' | 'pending' | 'awarded' | 'cancelled';

export interface ProductionQueueFlightStatus {
  label: 'Open' | 'Closed' | 'Pending Decision' | 'Awarded' | 'Cancelled';
  tone: ProductionQueueStatusTone;
}

function wholeNumber(value: number | null | undefined, minimum: number): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) return null;
  return value;
}

/**
 * Position prefers the flight's viewerQueuePosition, then the queue read.
 * Total prefers queueCount, then the queue read's participant count.
 * A total smaller than the position is ignored instead of being shown.
 */
export function resolveProductionQueuePosition(input: {
  rosterPosition: number | null;
  rosterCount: number | null;
  flightPosition: number | null;
  flightCount: number | null;
}): ProductionQueuePosition {
  const position = wholeNumber(input.flightPosition, 1) ?? wholeNumber(input.rosterPosition, 1);
  const counts = [wholeNumber(input.flightCount, 0), wholeNumber(input.rosterCount, 0)];
  const total = counts.find((count) => count !== null && (position === null || count >= position)) ?? null;
  return { position, total };
}

/** The ring fill is omitted when the total is missing. No placeholder total is invented. */
export function presentQueuePositionRing(position: number | null, total: number | null): ProductionQueueRing {
  const safePosition = wholeNumber(position, 1);
  const safeTotal = wholeNumber(total, 0);
  if (safePosition === null) return { positionText: null, totalText: null, fraction: null };
  if (safeTotal === null || safeTotal < safePosition) {
    return { positionText: String(safePosition), totalText: null, fraction: null };
  }
  const fraction = safeTotal <= 1 ? 1 : (safeTotal - safePosition) / (safeTotal - 1);
  return {
    positionText: String(safePosition),
    totalText: String(safeTotal),
    fraction,
  };
}

/**
 * The first reading establishes the position and is not a movement event.
 * A later change during this visit is session-local. Repeating the same
 * position does not add another entry.
 */
export function noteQueuePositionChange(
  previous: number | null,
  position: number | null,
  observedAt: string,
): { previous: number | null; event: SessionQueueMovement | null } {
  const next = wholeNumber(position, 1);
  if (next === null) return { previous, event: null };
  if (previous === null || previous === next || !Number.isFinite(Date.parse(observedAt))) {
    return { previous: next, event: null };
  }
  return {
    previous: next,
    event: {
      from: previous,
      to: next,
      text: `Moved from #${previous} to #${next}`,
      observedAt,
      scope: 'session',
    },
  };
}

export function presentRelativeQueueTime(observedAt: string, nowMs: number): string | null {
  const then = Date.parse(observedAt);
  if (!Number.isFinite(then) || !Number.isFinite(nowMs)) return null;
  const minutes = Math.max(0, Math.floor((nowMs - then) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Countdown uses queueClosesAt. A missing or invalid time stays hidden. */
export function presentQueueDecision(queueClosesAt: string | null, nowMs: number): ProductionQueueDecision {
  const countdown = presentQueueCloseCountdown(queueClosesAt, nowMs);
  if (countdown === null) return { kind: 'unavailable' };
  if (countdown === 'closed') return { kind: 'closed', label: 'Queue closed' };
  return { kind: 'countdown', label: `Decision in ${countdown}` };
}

export function presentProductionQueueFlightStatus(input: {
  status: string | null;
  queueClosesAt: string | null;
  nowMs: number;
  viewerIsBookedPassenger: boolean | null;
  viewerConfirmationStatus: string | null;
  viewerIsEffectiveWinner: boolean | null;
}): ProductionQueueFlightStatus | null {
  const status = input.status?.trim().toLowerCase() ?? '';
  const queueState = presentJoinQueueWindow(input.queueClosesAt, input.nowMs).state;
  if (status === 'cancelled') return { label: 'Cancelled', tone: 'cancelled' };
  if (input.viewerIsBookedPassenger === true || input.viewerConfirmationStatus === 'confirmed') {
    return { label: 'Awarded', tone: 'awarded' };
  }
  if (
    input.viewerConfirmationStatus === 'pending' ||
    (input.viewerIsEffectiveWinner === true && queueState === 'closed')
  ) {
    return { label: 'Pending Decision', tone: 'pending' };
  }
  if (queueState === 'closed') return { label: 'Closed', tone: 'closed' };
  if (status === 'published' || status === 'available' || queueState === 'open') {
    return { label: 'Open', tone: 'open' };
  }
  return null;
}
