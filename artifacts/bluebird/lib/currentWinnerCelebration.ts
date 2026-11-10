import { presentQueueCloseCountdown } from '@/lib/joinFlightPresentation';

export const CURRENT_WINNER_TITLE = "You're the Current Queue Winner!";
export const CURRENT_WINNER_BODY = 'This queue stays open until its scheduled closing time. Final flight confirmation happens after the queue closes.';
export const CURRENT_WINNER_CONTINUE = 'Continue';

export function currentWinnerCountdownLabel(
  queueClosesAt: string | null,
  nowMs: number,
): string {
  const countdown = presentQueueCloseCountdown(queueClosesAt, nowMs);
  if (countdown === null) return 'Queue closing time is not available for this flight.';
  if (countdown === 'closed') return 'This queue is closed.';
  return `Queue closes in ${countdown}`;
}

export interface CurrentWinnerCelebration {
  clerkUserId: string;
  flightId: number;
  queueClosesAt: string | null;
}

type StoredCelebration = CurrentWinnerCelebration & {
  state: 'pending' | 'dismissed';
};

const celebrations = new Map<string, StoredCelebration>();

function celebrationKey(clerkUserId: string, flightId: number): string {
  return `${clerkUserId}:${flightId}`;
}

function validIdentity(clerkUserId: string, flightId: number): boolean {
  return clerkUserId.trim().length > 0 && Number.isSafeInteger(flightId) && flightId > 0;
}

/**
 * Records one celebration when the backend has already confirmed the viewer
 * is the current winner. Skip the Line redemption must not call this —
 * position updates are not a confirmed win.
 */
export function markCurrentWinnerCelebration(input: {
  clerkUserId: string;
  flightId: number;
  queueClosesAt: string | null;
  viewerIsEffectiveWinner: boolean;
}): 'pending' | 'ignored' {
  if (input.viewerIsEffectiveWinner !== true) return 'ignored';
  if (!validIdentity(input.clerkUserId, input.flightId)) return 'ignored';
  const key = celebrationKey(input.clerkUserId, input.flightId);
  if (celebrations.has(key)) return 'ignored';
  celebrations.set(key, {
    clerkUserId: input.clerkUserId,
    flightId: input.flightId,
    queueClosesAt: input.queueClosesAt,
    state: 'pending',
  });
  return 'pending';
}

/** Reads a celebration that has not been dismissed. It does not change the pass. */
export function readCurrentWinnerCelebration(input: {
  clerkUserId: string;
  flightId: number;
}): CurrentWinnerCelebration | null {
  if (!validIdentity(input.clerkUserId, input.flightId)) return null;
  const stored = celebrations.get(celebrationKey(input.clerkUserId, input.flightId));
  if (!stored || stored.state !== 'pending') return null;
  return {
    clerkUserId: stored.clerkUserId,
    flightId: stored.flightId,
    queueClosesAt: stored.queueClosesAt,
  };
}

/** Hides the celebration. It does not send a queue or pass request. */
export function dismissCurrentWinnerCelebration(input: {
  clerkUserId: string;
  flightId: number;
}): void {
  if (!validIdentity(input.clerkUserId, input.flightId)) return;
  const stored = celebrations.get(celebrationKey(input.clerkUserId, input.flightId));
  if (!stored) return;
  stored.state = 'dismissed';
}

export function resetCurrentWinnerCelebrations(): void {
  celebrations.clear();
}
