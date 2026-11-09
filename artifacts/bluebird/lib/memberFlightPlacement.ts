/**
 * Upcoming and In Queue share one flight id. A current trip from GET /api/trips
 * owns that id. Queue rank and a closed countdown do not.
 */

export interface PlacementTrip {
  leg: { id: number };
  checklist: { emptyLegId: number; awarded: boolean };
}

export interface PlacementQueueFlight {
  id: string;
  userInQueue: boolean | null;
  viewerIsEffectiveWinner: boolean | null;
  viewerConfirmationStatus: string | null;
  viewerIsBookedPassenger?: boolean | null;
  queueClosesAt?: string | null;
}

const shownWinnerNotices = new Set<string>();

export function canonicalTripFlightId(trip: PlacementTrip): number | null {
  const checklistId = trip.checklist?.emptyLegId;
  const id = Number.isSafeInteger(checklistId) && checklistId >= 1 ? checklistId : trip.leg?.id;
  if (!Number.isSafeInteger(id) || id < 1) return null;
  return id;
}

export function upcomingFlightDetailsTarget(input: {
  list: 'current' | 'past';
  legId: number;
}): { pathname: '/flight/[id]'; params: { id: string } } | null {
  if (input.list !== 'current') return null;
  if (!Number.isSafeInteger(input.legId) || input.legId < 1) return null;
  return { pathname: '/flight/[id]', params: { id: String(input.legId) } };
}

function confirmationOf(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function numericFlightId(id: string): number | null {
  if (!/^[1-9]\d*$/.test(id)) return null;
  const numeric = Number(id);
  return Number.isSafeInteger(numeric) ? numeric : null;
}

export function queueClosedAt(queueClosesAt: string | null | undefined, nowMs: number): boolean | null {
  if (typeof queueClosesAt !== 'string' || queueClosesAt.trim().length === 0) return null;
  const closes = Date.parse(queueClosesAt);
  if (!Number.isFinite(closes) || !Number.isFinite(nowMs)) return null;
  return nowMs >= closes;
}

/** Pending and awarded current trips move to Upcoming. A declined offer does not. */
export function upcomingOwnedFlightIds(
  trips: readonly PlacementTrip[] | null | undefined,
  confirmationByFlightId?: ReadonlyMap<number, string | null>,
): number[] {
  if (!trips) return [];
  const ids: number[] = [];
  for (const trip of trips) {
    const id = canonicalTripFlightId(trip);
    if (id === null || ids.includes(id)) continue;
    const confirmation = confirmationOf(confirmationByFlightId?.get(id));
    if (trip.checklist?.awarded !== true && confirmation === 'declined') continue;
    ids.push(id);
  }
  return ids;
}

export function declinedCurrentFlightIds(
  trips: readonly PlacementTrip[] | null | undefined,
  confirmationByFlightId?: ReadonlyMap<number, string | null>,
): number[] {
  if (!trips || !confirmationByFlightId) return [];
  const ids: number[] = [];
  for (const trip of trips) {
    const id = canonicalTripFlightId(trip);
    if (id === null || trip.checklist?.awarded === true) continue;
    if (confirmationOf(confirmationByFlightId.get(id)) === 'declined') ids.push(id);
  }
  return ids;
}

export function queueEntryVisible(input: {
  userInQueue: boolean | null;
  viewerIsEffectiveWinner: boolean | null;
  viewerConfirmationStatus: string | null;
  viewerIsBookedPassenger?: boolean | null;
  queueClosed: boolean | null;
  ownedByUpcoming: boolean;
}): boolean {
  if (input.userInQueue !== true) return false;
  if (input.ownedByUpcoming) return false;
  if (input.viewerIsBookedPassenger === true) return false;
  const confirmation = confirmationOf(input.viewerConfirmationStatus);
  if (confirmation === 'confirmed' || confirmation === 'pending') return false;
  if (input.viewerIsEffectiveWinner === true && input.queueClosed === true && confirmation !== 'declined') {
    return false;
  }
  return true;
}

export function visibleQueueFlightIds(
  flights: readonly PlacementQueueFlight[],
  upcomingIds: readonly number[],
  nowMs: number,
): number[] {
  const owned = new Set(upcomingIds);
  const ids: number[] = [];
  for (const flight of flights) {
    const id = numericFlightId(flight.id);
    if (id === null || ids.includes(id)) continue;
    if (queueEntryVisible({
      userInQueue: flight.userInQueue,
      viewerIsEffectiveWinner: flight.viewerIsEffectiveWinner,
      viewerConfirmationStatus: flight.viewerConfirmationStatus,
      viewerIsBookedPassenger: flight.viewerIsBookedPassenger,
      queueClosed: queueClosedAt(flight.queueClosesAt, nowMs),
      ownedByUpcoming: owned.has(id),
    })) ids.push(id);
  }
  return ids;
}

/** Queue buttons stay with members who are still waiting. Winner offers use Confirm and Decline. */
export function productionQueueActionsVisible(input: {
  userInQueue: boolean | null;
  viewerIsEffectiveWinner: boolean | null;
  viewerConfirmationStatus: string | null;
  viewerIsBookedPassenger?: boolean | null;
  queueClosed: boolean | null;
}): boolean {
  return queueEntryVisible({ ...input, ownedByUpcoming: false });
}

export const WINNER_OFFER_POLL_MS = 15_000;

/**
 * Pending current trips: unawarded entries after queue join (and until award).
 * Product rule: a flight appearing in Trips as Pending immediately after joining
 * a queue is CORRECT. These IDs must remain visible in Trips and must NOT be
 * treated as pending winner-selection offers by themselves.
 */
export function pendingTripFlightIds(trips: readonly PlacementTrip[] | null | undefined): number[] {
  if (!trips) return [];
  const ids: number[] = [];
  for (const trip of trips) {
    if (trip.checklist?.awarded === true) continue;
    const id = canonicalTripFlightId(trip);
    if (id === null || ids.includes(id)) continue;
    ids.push(id);
  }
  return ids;
}

/** @deprecated Use pendingTripFlightIds. Same Pending-trip set; not winner offers. */
export function pendingOfferFlightIds(trips: readonly PlacementTrip[] | null | undefined): number[] {
  return pendingTripFlightIds(trips);
}

/**
 * Winner-selection offer IDs derived from the trips list alone.
 * Trips currently expose only checklist.awarded — not viewerIsEffectiveWinner
 * or confirmation status — so this returns [] until the Replit trips contract
 * adds verified winner-offer fields. Queue Status / flight detail still use
 * empty-leg winner fields for the real offer path.
 */
export function pendingWinnerOfferFlightIdsFromTrips(
  _trips: readonly PlacementTrip[] | null | undefined,
): number[] {
  return [];
}

export function winnerNoticeKey(accountKey: string, flightId: number): string {
  return `${accountKey.trim()}:${flightId}:pending`;
}

export function resetWinnerNotices(): void {
  shownWinnerNotices.clear();
}

export function clearWinnerNoticesForAccount(accountKey: string): void {
  const prefix = `${accountKey.trim()}:`;
  if (prefix === ':') return;
  for (const key of [...shownWinnerNotices]) {
    if (key.startsWith(prefix)) shownWinnerNotices.delete(key);
  }
}

export function rememberWinnerNotice(accountKey: string, flightId: number): void {
  const account = accountKey.trim();
  if (!account || !Number.isSafeInteger(flightId) || flightId < 1) return;
  shownWinnerNotices.add(winnerNoticeKey(account, flightId));
}

export function winnerNoticeWasShown(accountKey: string, flightId: number): boolean {
  return shownWinnerNotices.has(winnerNoticeKey(accountKey, flightId));
}

/**
 * One unseen pending offer at a time. A loaded trips response is required.
 * The Queue Status celebration covers the same offer without a second modal.
 */
export function nextWinnerNotice(input: {
  accountKey: string;
  pendingFlightIds: readonly number[];
  tripsLoaded: boolean;
  celebrationVisible: boolean;
}): { flightId: number; action: 'show' | 'suppress' } | null {
  const account = input.accountKey.trim();
  if (!account || input.tripsLoaded !== true) return null;
  const pending = [...new Set(input.pendingFlightIds.filter((id) => Number.isSafeInteger(id) && id >= 1))].sort((a, b) => a - b);
  const live = new Set(pending.map((id) => winnerNoticeKey(account, id)));
  for (const key of [...shownWinnerNotices]) {
    if (key.startsWith(`${account}:`) && !live.has(key)) shownWinnerNotices.delete(key);
  }
  const unseen = pending.find((id) => !shownWinnerNotices.has(winnerNoticeKey(account, id)));
  if (input.celebrationVisible) {
    for (const id of pending) shownWinnerNotices.add(winnerNoticeKey(account, id));
    return unseen === undefined ? null : { flightId: unseen, action: 'suppress' };
  }
  if (unseen === undefined) return null;
  return { flightId: unseen, action: 'show' };
}

export function winnerCelebrationVisible(pathname: string): boolean {
  const path = pathname.split(/[?#]/, 1)[0].replace(/\/+$/, '');
  return path === '/flight/queue-status' || path === '/flight/winner';
}

export function winnerOfferPollInterval(input: {
  foreground: boolean;
  signedIn: boolean;
  pathname: string;
}): number | false {
  if (input.foreground !== true || input.signedIn !== true) return false;
  const path = input.pathname.split(/[?#]/, 1)[0].replace(/\/+$/, '');
  if (path === '/flight/queue-status') return false;
  return WINNER_OFFER_POLL_MS;
}
