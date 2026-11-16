import {
  formatJoinFlightDate,
  formatJoinFlightTime,
  joinFlightQueueCountLabel,
  joinFlightQueuePositionLabel,
} from './joinFlightPresentation';
import { deriveProductionQueueRead, type ProductionQueueRead } from './productionQueue';
import type { ProductionPublicQueueEntry } from './productionAuthApi';

export const MY_QUEUES_EMPTY_TITLE = 'No Active Queues';
export const MY_QUEUES_EMPTY_BODY = 'Flights you join will appear here.';
export const MY_QUEUES_EMPTY = MY_QUEUES_EMPTY_TITLE;
export const MY_QUEUES_SERVER_EMPTY = MY_QUEUES_EMPTY_TITLE;
export const MY_QUEUES_NONE_SAVED = MY_QUEUES_EMPTY_TITLE;
export const MY_QUEUES_PARTIAL = 'Some queues couldn’t be checked.';
export const MY_QUEUES_UNAVAILABLE = 'Queues are unavailable right now.';
export const MY_QUEUES_LOAD_ERROR = 'Queues couldn’t be loaded.';
export const MY_QUEUES_SIGNED_OUT = 'Sign in to view your queues.';
export const MY_QUEUES_POSITION_UNAVAILABLE = 'Position unavailable';
export const MY_QUEUES_NOT_BOOKING = 'Not a confirmed seat.';
export const MY_QUEUES_STATUS = 'In queue';
export const MY_QUEUES_DETAILS_UNAVAILABLE = 'Flight details are not available yet.';
export const MY_QUEUES_LISTED_ON_CURRENT = MY_QUEUES_EMPTY_TITLE;
export const QUEUE_CLOSING_UNAVAILABLE = 'Closing time unavailable';
export const QUEUE_CLOSING_REACHED = 'Queue closing time reached';
export const QUEUE_STATUS_UNAVAILABLE = 'Status Unavailable';
export const QUEUE_CLOSING_SOON_MS = 60 * 60 * 1000;

const QUEUE_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
export const ROSTER_REQUEST_CONCURRENCY = 3;
export const ROSTER_CACHE_MAX_AGE_MS = 30_000;

export interface QueueFlightMetadataInput {
  fromAirport: string | null;
  toAirport: string | null;
  fromCity: string | null;
  toCity: string | null;
  departureDate: string | null;
  departureTime: string | null;
}

export interface QueueFlightMetadata {
  routeLabel: string | null;
  departureLabel: string | null;
}

export type MyQueueRosterResult =
  | { kind: 'confirmed'; position: number; participantCount: number; positionLabel: string; countLabel: string }
  | { kind: 'absent' };

export type MyQueueCheck =
  | { flightId: number; status: 'pending' }
  | {
      flightId: number;
      status: 'confirmed';
      position: number;
      participantCount: number;
      positionLabel: string;
      countLabel: string;
    }
  | { flightId: number; status: 'absent' }
  | { flightId: number; status: 'unauthorized' }
  | { flightId: number; status: 'unavailable' };

function place(value: string | null): string | null {
  const text = value?.trim() ?? '';
  return text || null;
}

function pair(left: string | null, right: string | null): string | null {
  if (!left || !right) return null;
  return `${left} → ${right}`;
}

export function presentQueueFlightMetadata(flight: QueueFlightMetadataInput | null): QueueFlightMetadata {
  if (!flight) return { routeLabel: null, departureLabel: null };
  const routeLabel = pair(place(flight.fromAirport), place(flight.toAirport))
    ?? pair(place(flight.fromCity), place(flight.toCity));
  const date = formatJoinFlightDate(flight.departureDate);
  const time = formatJoinFlightTime(flight.departureTime);
  const departureLabel = [date, time].filter((part): part is string => !!part).join(' · ') || null;
  return { routeLabel, departureLabel };
}

export function presentMyQueueRoster(read: ProductionQueueRead): MyQueueRosterResult {
  if (read.viewer.status !== 'in-queue' || read.entries.length < 1) return { kind: 'absent' };
  const positionLabel = joinFlightQueuePositionLabel(read.viewer.position);
  const countLabel = joinFlightQueueCountLabel(read.entries.length);
  if (!positionLabel || !countLabel) return { kind: 'absent' };
  return {
    kind: 'confirmed',
    position: read.viewer.position,
    participantCount: read.entries.length,
    positionLabel,
    countLabel,
  };
}

export function presentRosterEntries(entries: readonly ProductionPublicQueueEntry[]): MyQueueRosterResult {
  return presentMyQueueRoster(deriveProductionQueueRead([...entries]));
}

export function presentMyQueueRequestFailure(error: unknown): 'unauthorized' | 'unavailable' {
  if (!error || typeof error !== 'object') return 'unavailable';
  const record = error as { status?: unknown; code?: unknown };
  if (record.status === 401 || record.code === 'session_expired') return 'unauthorized';
  return 'unavailable';
}

export function isRosterCancellation(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === 'cancelled';
}

export function uniqueQueueCandidateIds(ids: readonly unknown[]): number[] {
  const unique: number[] = [];
  for (const value of ids) {
    const id = typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : null;
    if (id !== null && !unique.includes(id)) unique.push(id);
  }
  return unique;
}

export function shouldAcceptRosterResult(input: {
  requestedUserId: string;
  activeUserId: string | null;
  requestedGeneration: number;
  activeGeneration: number;
  signedIn: boolean;
}): boolean {
  return input.signedIn &&
    input.activeUserId !== null &&
    input.requestedUserId === input.activeUserId &&
    input.requestedGeneration === input.activeGeneration;
}

export function isRosterCacheFresh(
  updatedAt: number | undefined,
  now: number,
  maxAge = ROSTER_CACHE_MAX_AGE_MS,
): boolean {
  return typeof updatedAt === 'number' && now >= updatedAt && now - updatedAt <= maxAge;
}

export function shouldRequestRoster(input: { refresh: boolean; cacheFresh: boolean }): boolean {
  return input.refresh || !input.cacheFresh;
}

export async function runRosterPool<T>(input: {
  ids: readonly number[];
  concurrency?: number;
  requestedUserId: string;
  generation: number;
  signal: AbortSignal;
  isCurrent: () => { signedIn: boolean; activeUserId: string | null; generation: number };
  read: (flightId: number, signal: AbortSignal) => Promise<T>;
  onResult: (flightId: number, result: T) => void;
  onError: (flightId: number, error: unknown) => void;
}): Promise<void> {
  const ids = uniqueQueueCandidateIds(input.ids);
  const workerCount = Math.min(input.concurrency ?? ROSTER_REQUEST_CONCURRENCY, ids.length);
  let cursor = 0;
  const currentEnough = () => {
    const current = input.isCurrent();
    return shouldAcceptRosterResult({
      requestedUserId: input.requestedUserId,
      requestedGeneration: input.generation,
      signedIn: current.signedIn,
      activeUserId: current.activeUserId,
      activeGeneration: current.generation,
    });
  };

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (!input.signal.aborted && currentEnough()) {
      const index = cursor;
      cursor += 1;
      if (index >= ids.length) return;
      const flightId = ids[index];
      try {
        const result = await input.read(flightId, input.signal);
        if (input.signal.aborted || !currentEnough()) return;
        input.onResult(flightId, result);
      } catch (error) {
        if (isRosterCancellation(error, input.signal) || !currentEnough()) return;
        input.onError(flightId, error);
      }
    }
  }));
}

export interface MyQueuesDescription {
  showLoading: boolean;
  emptyTitle: string | null;
  partialNotice: string | null;
  verified: Array<Extract<MyQueueCheck, { status: 'confirmed' }>>;
  failed: Array<Extract<MyQueueCheck, { status: 'unauthorized' | 'unavailable' }>>;
}

export function parseQueueInstant(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || !QUEUE_INSTANT.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function queueClosingInstant(input: {
  queueClosesAt: string | null;
  departureInstant: string | null;
}): number | null {
  return parseQueueInstant(input.queueClosesAt) ?? parseQueueInstant(input.departureInstant);
}

export function presentQueueCountdown(nowMs: number, closingMs: number | null): string {
  if (closingMs === null || !Number.isFinite(nowMs) || !Number.isFinite(closingMs)) {
    return QUEUE_CLOSING_UNAVAILABLE;
  }
  const remainingMs = closingMs - nowMs;
  if (remainingMs <= 0) return QUEUE_CLOSING_REACHED;
  const totalSeconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [
    ...(days > 0 ? [`${days}d`] : []),
    ...(days > 0 || hours > 0 ? [`${hours}h`] : []),
    `${minutes}m`,
    `${seconds}s`,
  ];
  return `Closes in ${parts.join(' ')}`;
}

export interface QueueViewerFacts {
  viewerFieldsAvailable: boolean;
  userInQueue: boolean | null;
  viewerIsBookedPassenger: boolean | null;
  viewerIsEffectiveWinner: boolean | null;
  viewerConfirmationStatus: string | null;
  closingMs: number | null;
  nowMs: number;
}

export function presentQueueLifecycle(input: QueueViewerFacts): string {
  if (input.viewerFieldsAvailable) {
    if (input.viewerIsBookedPassenger === true) return 'Booked Passenger';
    const confirmation = input.viewerConfirmationStatus?.trim().toLowerCase() ?? '';
    if (confirmation === 'confirmed') return 'Confirmed';
    if (confirmation === 'declined') return 'Declined';
    if (confirmation === 'pending') return 'Confirmation Pending';
    if (confirmation) return QUEUE_STATUS_UNAVAILABLE;
    if (input.viewerIsEffectiveWinner === true) return 'Current Winner — Not Yet Formally Awarded';
  }
  if (input.closingMs === null || !Number.isFinite(input.nowMs)) {
    return input.viewerFieldsAvailable ? 'Decision Pending' : QUEUE_STATUS_UNAVAILABLE;
  }
  const remainingMs = input.closingMs - input.nowMs;
  if (remainingMs <= 0) return 'Queue Closing Time Reached';
  if (remainingMs <= QUEUE_CLOSING_SOON_MS) return 'Queue Closing Soon';
  return 'Queue Open';
}

export function applyViewerMembership(
  checks: readonly MyQueueCheck[],
  membership: Readonly<Record<number, boolean | null>> | null,
): MyQueueCheck[] {
  if (!membership) return [...checks];
  return checks.map((check) => {
    if (check.status !== 'confirmed' || membership[check.flightId] !== false) return check;
    return { flightId: check.flightId, status: 'absent' };
  });
}

export function awardedCurrentFlightIds(
  trips: readonly { checklist: { emptyLegId: number; awarded: boolean } }[] | null | undefined,
): number[] {
  if (!trips) return [];
  return uniqueQueueCandidateIds(
    trips.filter((trip) => trip.checklist?.awarded === true).map((trip) => trip.checklist.emptyLegId),
  );
}

export function queueFlightDetailsTarget(
  flightId: number,
  metadata: QueueFlightMetadata,
): { pathname: '/flight/[id]'; params: { id: string } } | null {
  if (!Number.isSafeInteger(flightId) || flightId < 1 || !metadata.routeLabel) return null;
  return { pathname: '/flight/[id]', params: { id: String(flightId) } };
}

export function describeMyQueues(input: {
  storageState: 'loading' | 'ready' | 'failed';
  checks: readonly MyQueueCheck[];
  awardedFlightIds?: readonly number[];
  viewerMembership?: Readonly<Record<number, boolean | null>> | null;
}): MyQueuesDescription {
  const membershipChecks = applyViewerMembership(input.checks, input.viewerMembership ?? null);
  const awarded = new Set(uniqueQueueCandidateIds(input.awardedFlightIds ?? []));
  const hiddenAwarded = membershipChecks.some((check) => check.status === 'confirmed' && awarded.has(check.flightId));
  const visibleChecks = membershipChecks.filter((check) => !(check.status === 'confirmed' && awarded.has(check.flightId)));
  const cards = myQueueCards(visibleChecks);
  const noneSaved = input.storageState === 'ready' && input.checks.length === 0;
  const settled = input.storageState === 'ready' && !cards.pending && cards.failed.length === 0 && cards.verified.length === 0;
  const listedOnCurrent = settled && hiddenAwarded && visibleChecks.every((check) => check.status === 'absent' || check.status === 'confirmed');
  const noneVerified = settled && !hiddenAwarded && input.checks.length > 0;
  return {
    showLoading: input.storageState === 'loading' || (
      cards.pending && cards.verified.length === 0 && cards.failed.length === 0 && !noneSaved
    ),
    emptyTitle: noneSaved
      ? MY_QUEUES_NONE_SAVED
      : listedOnCurrent
        ? MY_QUEUES_LISTED_ON_CURRENT
        : noneVerified
          ? MY_QUEUES_EMPTY
          : null,
    partialNotice: cards.failed.length > 0 ? MY_QUEUES_PARTIAL : null,
    verified: cards.verified,
    failed: cards.failed,
  };
}

export function myQueueCards(checks: readonly MyQueueCheck[]): {
  verified: Array<Extract<MyQueueCheck, { status: 'confirmed' }>>;
  failed: Array<Extract<MyQueueCheck, { status: 'unauthorized' | 'unavailable' }>>;
  pending: boolean;
} {
  return {
    verified: checks.filter((check): check is Extract<MyQueueCheck, { status: 'confirmed' }> => check.status === 'confirmed'),
    failed: checks.filter((check): check is Extract<MyQueueCheck, { status: 'unauthorized' | 'unavailable' }> =>
      check.status === 'unauthorized' || check.status === 'unavailable'),
    pending: checks.some((check) => check.status === 'pending'),
  };
}

export function queueFlightReference(flightId: number, metadata: QueueFlightMetadata): string {
  return metadata.routeLabel ?? `Flight ${flightId}`;
}

const MEMBER_CONFIRMATION = new Set(['pending', 'confirmed', 'declined']);

export interface UpcomingMemberFlightFacts {
  id: string;
  userInQueue: boolean | null;
  viewerQueuePosition: number | null;
  queueCount: number | null;
  viewerIsEffectiveWinner: boolean | null;
  viewerConfirmationStatus: string | null;
}

export function memberQueueFlightId(id: string): number | null {
  if (!/^[1-9]\d*$/.test(id)) return null;
  const numeric = Number(id);
  return Number.isSafeInteger(numeric) ? numeric : null;
}

export function isUpcomingMemberQueue(flight: UpcomingMemberFlightFacts): boolean {
  if (memberQueueFlightId(flight.id) === null) return false;
  if (flight.userInQueue === true || flight.viewerIsEffectiveWinner === true) return true;
  const status = flight.viewerConfirmationStatus?.trim().toLowerCase() ?? '';
  return MEMBER_CONFIRMATION.has(status);
}

export function memberQueuePosition(flight: UpcomingMemberFlightFacts): number | null {
  if (flight.userInQueue !== true) return null;
  const position = flight.viewerQueuePosition;
  if (typeof position !== 'number' || !Number.isSafeInteger(position) || position < 1) return null;
  return position;
}

export function memberQueueCount(flight: UpcomingMemberFlightFacts): number | null {
  const count = flight.queueCount;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1) return null;
  return count;
}

export function presentServerMemberQueues<T extends UpcomingMemberFlightFacts>(flights: readonly T[]): T[] {
  return flights.filter(isUpcomingMemberQueue);
}
