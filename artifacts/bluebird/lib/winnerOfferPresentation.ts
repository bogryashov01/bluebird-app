export type WinnerOfferKind =
  | 'unavailable'
  | 'non-winner'
  | 'pending'
  | 'confirmed'
  | 'declined'
  | 'cancelled'
  | 'expired';

export interface WinnerOffer {
  kind: WinnerOfferKind;
  confirmation: 'pending' | 'confirmed' | 'declined' | 'none';
}

const playedCelebrations = new Set<string>();

/** Plays once per signed-in account and flight. A different account gets its own celebration. */
export function claimWinnerCelebration(accountKey: string, flightId: number): boolean {
  const account = accountKey.trim();
  if (!account || !Number.isSafeInteger(flightId) || flightId < 1) return false;
  const key = `${account}:${flightId}`;
  if (playedCelebrations.has(key)) return false;
  playedCelebrations.add(key);
  return true;
}

export function resetWinnerCelebrations(): void {
  playedCelebrations.clear();
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
 * Queue position and a closed countdown are not enough.
 * A deadline is used only when the caller already has one. This app has no deadline field.
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
}): WinnerOffer {
  const confirmation = confirmationOf(input.viewerConfirmationStatus);
  const status = input.flightStatus?.trim().toLowerCase() ?? '';
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
  if (input.viewerIsEffectiveWinner === null) return { kind: 'unavailable', confirmation };
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
}): { pathname: '/flight/winner'; params: { flightId: string } } | null {
  if (input.list !== 'current' || input.awarded === true) return null;
  if (!Number.isSafeInteger(input.legId) || input.legId < 1) return null;
  return { pathname: '/flight/winner', params: { flightId: String(input.legId) } };
}
