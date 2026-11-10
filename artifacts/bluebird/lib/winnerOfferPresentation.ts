export type WinnerOfferKind =
  | 'unavailable'
  | 'non-winner'
  | 'pending'
  | 'confirmed'
  | 'declined'
  | 'cancelled'
  | 'expired'
  | 'waiting';

export interface WinnerOffer {
  kind: WinnerOfferKind;
  confirmation: 'pending' | 'confirmed' | 'declined' | 'none';
}

export interface WinnerCelebrationStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const WINNER_CELEBRATION_STORAGE_KEY = 'bluebird.winnerCelebrations.v1';

const playedCelebrations = new Set<string>();
let celebrationStorage: WinnerCelebrationStorage | null = null;
let hydration: Promise<void> | null = null;

function celebrationKey(accountKey: string, flightId: number): string {
  return `${accountKey.trim()}:${flightId}`;
}

async function persistCelebrations(): Promise<void> {
  if (!celebrationStorage) return;
  try {
    await celebrationStorage.setItem(WINNER_CELEBRATION_STORAGE_KEY, JSON.stringify([...playedCelebrations]));
  } catch {
    // Persistence is best-effort; in-memory dedupe still applies for the session.
  }
}

/** Wire AsyncStorage (or a test double) for celebration acknowledgement across restarts. */
export function setWinnerCelebrationStorage(storage: WinnerCelebrationStorage | null): void {
  celebrationStorage = storage;
  hydration = null;
}

/** Loads acknowledged celebrations so app restart does not replay them. */
export function hydrateWinnerCelebrations(): Promise<void> {
  if (!celebrationStorage) return Promise.resolve();
  if (hydration) return hydration;
  hydration = (async () => {
    try {
      const raw = await celebrationStorage?.getItem(WINNER_CELEBRATION_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      for (const entry of parsed) {
        if (typeof entry === 'string' && entry.includes(':')) playedCelebrations.add(entry);
      }
    } catch {
      // Ignore corrupt storage.
    }
  })();
  return hydration;
}

/** Plays once per signed-in account and flight. Survives restart when storage is wired. */
export function claimWinnerCelebration(accountKey: string, flightId: number): boolean {
  const account = accountKey.trim();
  if (!account || !Number.isSafeInteger(flightId) || flightId < 1) return false;
  const key = celebrationKey(account, flightId);
  if (playedCelebrations.has(key)) return false;
  playedCelebrations.add(key);
  void persistCelebrations();
  return true;
}

export function resetWinnerCelebrations(): void {
  playedCelebrations.clear();
  hydration = null;
  if (celebrationStorage) {
    void celebrationStorage.removeItem(WINNER_CELEBRATION_STORAGE_KEY).catch(() => undefined);
  }
}

function confirmationOf(value: string | null): WinnerOffer['confirmation'] {
  const confirmation = value?.trim().toLowerCase() ?? '';
  if (confirmation === 'pending' || confirmation === 'confirmed' || confirmation === 'declined') {
    return confirmation;
  }
  return 'none';
}

/**
 * Winner state comes from the server winner and confirmation fields.
 * Queue position and a closed countdown are not enough — never invent a winner.
 * A deadline is used only when the caller already has one.
 */
export function presentWinnerOffer(input: {
  viewerIsEffectiveWinner: boolean | null;
  viewerConfirmationStatus: string | null;
  queueClosed: boolean | null;
  awarded: boolean | null;
  bookedPassenger: boolean | null;
  flightStatus: string | null;
  deadlineIso: string | null;
  nowMs: number;
  /** Optional trips lifecycle status; queue_pending must not look like a win. */
  tripStatus?: string | null;
}): WinnerOffer {
  const confirmation = confirmationOf(input.viewerConfirmationStatus);
  const status = input.flightStatus?.trim().toLowerCase() ?? '';
  const tripStatus = typeof input.tripStatus === 'string' ? input.tripStatus.trim().toLowerCase() : '';
  if (tripStatus === 'queue_pending') return { kind: 'waiting', confirmation: 'none' };
  if (status === 'cancelled') return { kind: 'cancelled', confirmation };
  if (confirmation === 'declined') return { kind: 'declined', confirmation };
  if (input.awarded === true || input.bookedPassenger === true || confirmation === 'confirmed') {
    return { kind: 'confirmed', confirmation };
  }
  const deadline = input.deadlineIso ? Date.parse(input.deadlineIso) : Number.NaN;
  if (
    input.viewerIsEffectiveWinner === true &&
    Number.isFinite(deadline) &&
    Number.isFinite(input.nowMs) &&
    input.nowMs >= deadline
  ) {
    return { kind: 'expired', confirmation };
  }
  if (input.viewerIsEffectiveWinner === null) {
    return input.queueClosed === true ? { kind: 'waiting', confirmation } : { kind: 'unavailable', confirmation };
  }
  if (input.viewerIsEffectiveWinner !== true) return { kind: 'non-winner', confirmation };
  if (input.queueClosed !== true) return { kind: 'unavailable', confirmation };
  return { kind: 'pending', confirmation };
}

export function presentWinnerOfferCopy(offer: WinnerOffer): { title: string; body: string } | null {
  if (offer.kind === 'pending') {
    return {
      title: "You've been selected for this flight",
      body: offer.confirmation === 'pending' ? 'Awaiting confirmation' : 'Not confirmed',
    };
  }
  if (offer.kind === 'waiting') {
    return {
      title: 'Waiting for the queue outcome',
      body: 'Bluebird has not selected a winner for this flight yet.',
    };
  }
  if (offer.kind === 'confirmed') {
    return { title: 'This flight is confirmed', body: 'The trip is in your upcoming flights.' };
  }
  if (offer.kind === 'declined') {
    return { title: 'You declined this flight', body: 'No further action is available on this flight.' };
  }
  if (offer.kind === 'cancelled') {
    return { title: 'This flight was cancelled', body: 'No confirmation is available for this flight.' };
  }
  if (offer.kind === 'expired') {
    return { title: 'This confirmation offer has expired', body: 'No confirmation request is sent from this screen.' };
  }
  if (offer.kind === 'non-winner') {
    return { title: 'This account is not the selected winner', body: 'Queue position does not award this flight.' };
  }
  return null;
}

export function winnerReviewTarget(input: {
  list: 'current' | 'past';
  awarded: boolean;
  legId: number;
  status?: string | null;
}): { pathname: '/flight/winner'; params: { flightId: string } } | null {
  if (input.list !== 'current' || input.awarded === true) return null;
  const status = typeof input.status === 'string' ? input.status.trim().toLowerCase() : '';
  if (status === 'queue_pending' || status === 'awaiting_award' || status === 'awarded') return null;
  if (status !== 'winner_confirmation_required') return null;
  if (!Number.isSafeInteger(input.legId) || input.legId < 1) return null;
  return { pathname: '/flight/winner', params: { flightId: String(input.legId) } };
}
