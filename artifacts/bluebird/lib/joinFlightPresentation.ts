import type { JoinProductionQueueRequest, ProductionQueueEntry } from './productionAuthApi';
import { productionFlightDetailQueryKey } from './flightDetailPresentation';
import { mainBluebirdAuthenticatedQueryKey } from './mainBluebirdApi';
import type { MainBluebirdApiEnvironment } from './mainBluebirdApiConfig';
import { isProductionQueueMutationsEnabled } from './productionQueueCapability';
import { parseProductionFlightId } from './productionFlights';
import { isProductionQueueVerified } from './productionQueueReadiness';
import { validateProductionQueueJoin, type ProductionQueueRead } from './productionQueue';

/**
 * Display facts already shown for a loaded flight. This object never carries
 * a price, a queue position, or a claim about the signed-in member.
 */
export interface JoinFlightDisplay {
  flightId: number;
  fromAirport: string | null;
  toAirport: string | null;
  fromCity: string | null;
  toCity: string | null;
  departureDate: string | null;
  departureTime: string | null;
  aircraft: string | null;
  international: boolean | null;
  flightStatus: 'published' | null;
  queueClosesAt: string | null;
  internationalPassRequired: boolean | null;
}

export interface JoinFlightSource {
  fromAirport: string | null;
  toAirport: string | null;
  fromCity: string | null;
  toCity: string | null;
  departureDate: string | null;
  departureTime: string | null;
  aircraftType: string | null;
  aircraftTypeName: string | null;
  international: boolean | null;
  status: string | null;
  queueClosesAt?: string | null;
  internationalPassRequired?: boolean | null;
}

export interface QueueRosterRow {
  position: number;
  initials: string;
  tier: 'free' | 'base' | 'plus';
  hasLineSkip: boolean;
  isViewer: boolean;
}

export type JoinFlightQueuePanel =
  | { kind: 'not-published' }
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'unauthorized' }
  | { kind: 'unavailable' }
  | { kind: 'empty' }
  | {
      kind: 'participants';
      participantCount: number;
      viewerPosition: number | null;
      rows: QueueRosterRow[];
    };

export const JOIN_FLIGHT_QUEUE_EMPTY = 'No one is currently in this queue.';
export const JOIN_FLIGHT_QUEUE_FOOTNOTE = 'The queue count is not a count of available seats. This response does not confirm that you can join.';

export interface QueueJoinSuccessModel {
  flightId: number;
  position: number;
  participantCount: number;
}

const DISPLAY_TEXT_LIMIT = 80;

export function canSubmitProductionQueueJoin(): boolean {
  return isProductionQueueMutationsEnabled();
}

export function joinFlightRouteParams(
  flightId: number,
  flight: JoinFlightSource,
): Record<string, string> {
  const parsedId = parseProductionFlightId(flightId);
  if (parsedId === null) return {};
  return {
    flightId: String(parsedId),
    from: flight.fromAirport ?? '',
    to: flight.toAirport ?? '',
    fromCity: flight.fromCity ?? '',
    toCity: flight.toCity ?? '',
    departureDate: flight.departureDate ?? '',
    departureTime: flight.departureTime ?? '',
    aircraft: flight.aircraftTypeName ?? flight.aircraftType ?? '',
    international: flight.international === true ? '1' : flight.international === false ? '0' : '',
    flightStatus: flight.status === 'published' ? 'published' : '',
    ...(isoTimestamp(flight.queueClosesAt) ? { queueClosesAt: isoTimestamp(flight.queueClosesAt)! } : {}),
    ...(flight.internationalPassRequired === true
      ? { internationalPassRequired: '1' }
      : flight.internationalPassRequired === false
        ? { internationalPassRequired: '0' }
        : {}),
  };
}

export function parseJoinFlightDisplay(
  params: Record<string, string | string[] | undefined>,
): JoinFlightDisplay | null {
  const flightId = parseProductionFlightId(firstParam(params.flightId));
  if (flightId === null) return null;
  return {
    flightId,
    fromAirport: airportCode(params.from),
    toAirport: airportCode(params.to),
    fromCity: displayText(params.fromCity),
    toCity: displayText(params.toCity),
    departureDate: calendarDate(params.departureDate),
    departureTime: clockTime(params.departureTime),
    aircraft: displayText(params.aircraft),
    international: internationalFlag(params.international),
    flightStatus: firstParam(params.flightStatus) === 'published' ? 'published' : null,
    queueClosesAt: isoTimestamp(firstParam(params.queueClosesAt)),
    internationalPassRequired: requiredFlag(params.internationalPassRequired),
  };
}

export function canReadJoinFlightQueue(flightStatus: 'published' | null): boolean {
  return flightStatus === 'published';
}

export function joinFlightQueueCountLabel(count: number): string | null {
  if (!Number.isSafeInteger(count) || count < 1) return null;
  return count === 1 ? '1 person is in this queue.' : `${count} people are in this queue.`;
}

export function joinFlightQueuePositionLabel(position: number): string | null {
  if (!Number.isSafeInteger(position) || position < 1) return null;
  return `Your position is #${position}.`;
}

export function queueRosterTierLabel(tier: QueueRosterRow['tier']): string {
  if (tier === 'plus') return 'Plus';
  if (tier === 'base') return 'Base';
  return 'Free';
}

export function presentJoinFlightQueuePanel(input: {
  flightStatus: 'published' | null;
  sessionReady: boolean;
  signedIn: boolean;
  loading: boolean;
  failed: boolean;
  unauthorized?: boolean;
  read: ProductionQueueRead | null;
}): JoinFlightQueuePanel {
  if (!canReadJoinFlightQueue(input.flightStatus)) return { kind: 'not-published' };
  if (!input.sessionReady || input.loading) return { kind: 'loading' };
  if (!input.signedIn) return { kind: 'signed-out' };
  if (input.unauthorized) return { kind: 'unauthorized' };
  if (input.failed || input.read == null) return { kind: 'unavailable' };
  if (input.read.entries.length === 0) {
    return input.read.viewer.status === 'not-in-queue' ? { kind: 'empty' } : { kind: 'unavailable' };
  }
  const viewerPosition = input.read.viewer.status === 'in-queue' ? input.read.viewer.position : null;
  return {
    kind: 'participants',
    participantCount: input.read.entries.length,
    viewerPosition,
    rows: [...input.read.entries]
      .sort((left, right) => left.position - right.position)
      .map((entry) => ({
        position: entry.position,
        initials: entry.initials,
        tier: entry.tier,
        hasLineSkip: entry.hasLineSkip,
        isViewer: entry.isViewer,
      })),
  };
}

export function formatJoinFlightDate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export function formatJoinFlightTime(value: string | null): string | null {
  if (!value || !/^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hourText, minute] = value.split(':');
  const hour = Number(hourText);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${minute} ${suffix}`;
}

export function joinFlightDisclosures(international: boolean | null): readonly string[] {
  const lines = [
    'Joining enters this flight\'s queue. It does not create a confirmed booking or a Trips entry.',
    'A place in the queue does not guarantee a seat. After the queue closes, a winner must confirm before the flight is awarded.',
    'An active membership and a complete profile are required. This screen does not check either one.',
    'Skip the Line can use an existing credit. This screen does not use a credit or start a payment.',
  ];
  if (international === true) {
    lines.push('This flight is international. Pass authorization or a reserved credit may be required. No fee is shown here.');
  } else if (international === null) {
    lines.push('International flights can require pass authorization or a reserved credit. This flight\'s international status is not confirmed here, and no fee is shown.');
  }
  return lines;
}

/**
 * Maps a queue-join response into display fields. Callers must pass an entry
 * returned by the production queue adapter. Route parameters are not a source.
 */
export function queueJoinSuccessModel(
  flightId: number,
  entry: ProductionQueueEntry,
): QueueJoinSuccessModel | null {
  try {
    const validated = validateProductionQueueJoin(flightId, entry);
    if (!Number.isSafeInteger(validated.queueCount) || validated.queueCount < validated.position) {
      return null;
    }
    return {
      flightId: validated.emptyLegId,
      position: validated.position,
      participantCount: validated.queueCount,
    };
  } catch {
    return null;
  }
}

/** Success stays hidden until the production queue gate is open and the response validates. */
export function presentVerifiedQueueJoinSuccess(
  flightId: number,
  entry: ProductionQueueEntry | null,
): QueueJoinSuccessModel | null {
  if (!isProductionQueueVerified() || entry == null) return null;
  return queueJoinSuccessModel(flightId, entry);
}

export type QueueJoinConsent = 'none' | 'authorize-pass' | 'use-credit';

export type QueueJoinReview =
  | { status: 'disabled'; body: null }
  | { status: 'consent-required'; body: null }
  | { status: 'ready'; body: JoinProductionQueueRequest };

/** Standard join sends an empty object. A pass flag is included only after an explicit choice. */
export function prepareProductionQueueJoinBody(consent: QueueJoinConsent): JoinProductionQueueRequest {
  if (consent === 'authorize-pass') return { internationalPassAuthorized: true };
  if (consent === 'use-credit') return { useInternationalPassCredit: true };
  return {};
}

/**
 * Builds the join body without consulting the production gate.
 * A standard join is an empty object. A pass flag is included only after an explicit choice.
 */
export function assessProductionQueueJoin(input: {
  consent: QueueJoinConsent;
  internationalPassRequired: boolean | null;
  creditConfirmed?: boolean;
}): Exclude<QueueJoinReview, { status: 'disabled' }> {
  if (input.consent === 'use-credit') {
    if (input.internationalPassRequired !== true || input.creditConfirmed !== true) {
      return { status: 'consent-required', body: null };
    }
    return { status: 'ready', body: { useInternationalPassCredit: true } };
  }
  if (input.internationalPassRequired === true && input.consent === 'none') {
    return { status: 'consent-required', body: null };
  }
  if (input.internationalPassRequired !== true) return { status: 'ready', body: {} };
  return { status: 'ready', body: prepareProductionQueueJoinBody(input.consent) };
}

/**
 * The production gate short-circuits before a body can be submitted.
 * Pass consent is required only when the server marked the pass as required.
 */
export function reviewProductionQueueJoin(input: {
  consent: QueueJoinConsent;
  internationalPassRequired: boolean | null;
  creditConfirmed?: boolean;
}): QueueJoinReview {
  if (!canSubmitProductionQueueJoin()) return { status: 'disabled', body: null };
  return assessProductionQueueJoin(input);
}

export type ProductionInternationalJoinStep = 'skip' | 'not-required' | 'required' | 'unknown';

/** Domestic flights skip the international notice. The server pass flag chooses the international actions. */
export function productionInternationalJoinStep(input: {
  international: boolean | null;
  internationalPassRequired: boolean | null;
}): ProductionInternationalJoinStep {
  if (input.international !== true) return 'skip';
  if (input.internationalPassRequired === true) return 'required';
  if (input.internationalPassRequired === false) return 'not-required';
  return 'unknown';
}

/** Countdown uses the server queue closing time. A missing or invalid time stays hidden. */
export function presentQueueCloseCountdown(queueClosesAt: string | null, nowMs: number): string | null {
  if (!queueClosesAt || !Number.isFinite(nowMs)) return null;
  const closingMs = Date.parse(queueClosesAt);
  if (!Number.isFinite(closingMs)) return null;
  const diff = closingMs - nowMs;
  if (diff <= 0) return 'closed';
  const hours = Math.floor(diff / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  const secs = Math.floor((diff % 60_000) / 1_000);
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function presentJoinQueueWindow(
  queueClosesAt: string | null,
  nowMs: number,
): { state: 'unknown' | 'open' | 'closed'; label: string } {
  const unknown = {
    state: 'unknown' as const,
    label: 'Whether this queue is open is not confirmed on this screen.',
  };
  if (!queueClosesAt || !Number.isFinite(nowMs)) return unknown;
  const closingMs = Date.parse(queueClosesAt);
  if (!Number.isFinite(closingMs)) return unknown;
  if (closingMs <= nowMs) return { state: 'closed', label: 'This queue is closed.' };
  return { state: 'open', label: 'This queue is open.' };
}

export type QueueLeaveReview =
  | { status: 'disabled' }
  | { status: 'needs-confirmation' }
  | { status: 'ready' };

/** Leave uses the same production gate. A real delete still waits for an explicit confirmation. */
export function reviewProductionQueueLeave(explicitConfirm: boolean): QueueLeaveReview {
  if (!canSubmitProductionQueueJoin()) return { status: 'disabled' };
  if (explicitConfirm !== true) return { status: 'needs-confirmation' };
  return { status: 'ready' };
}

export interface JoinFlightConflictFlight {
  emptyLegId: number | null;
  originAirport: string | null;
  destinationAirport: string | null;
  departureTime: string | null;
}

export interface JoinFlightFailure {
  status: number | null;
  code: string | null;
  title: string;
  body: string;
  conflict: JoinFlightConflictFlight | null;
  keepsExistingQueue: boolean;
}

export function presentJoinFlightFailure(input: {
  status?: number | null;
  code?: string | null;
  body?: unknown;
}): JoinFlightFailure {
  const status = Number.isInteger(input.status) ? input.status! : null;
  const code = readErrorCode(input.code, input.body);
  const conflict = code === 'same_day_queue_conflict' ? readConflictFlight(input.body) : null;
  if (status === 401) {
    return failure(status, code, 'Sign in required', 'Sign in again before joining. No queue change was made.', null, false);
  }
  if (status === 402) {
    return failure(
      status,
      code,
      'International Pass required',
      'An International Pass authorization or an available credit is required before joining. No card was charged.',
      null,
      false,
    );
  }
  if (status === 403 && (code === 'membership_required' || code === 'inactive_membership' || code === 'not_a_member')) {
    return failure(
      status,
      code,
      'Membership required',
      'An active Bluebird membership is required to join this queue. No queue change was made.',
      null,
      false,
    );
  }
  if (status === 403 && (code === 'profile_incomplete' || code === 'incomplete_profile')) {
    return failure(
      status,
      code,
      'Profile incomplete',
      'A complete Bluebird profile is required to join this queue. No queue change was made.',
      null,
      false,
    );
  }
  if (status === 403) {
    return failure(
      status,
      code,
      'Unable to join',
      'Joining needs an active Bluebird membership and a complete Bluebird profile. This screen does not confirm either one.',
      null,
      false,
    );
  }
  if (status === 404) {
    return failure(status, code, 'Flight unavailable', 'This flight is no longer available.', null, false);
  }
  if (status === 409 && code === 'same_day_queue_conflict') {
    return failure(
      status,
      code,
      'You already have a queue that day',
      'Bluebird allows one active queue for each origin-local departure date. The existing queue was not changed.',
      conflict,
      true,
    );
  }
  if (status === 409 && (code === 'queue_closed' || code === 'closed')) {
    return failure(status, code, 'Queue closed', 'This queue is no longer open.', null, false);
  }
  if (status === 409 && (code === 'departed' || code === 'flight_departed')) {
    return failure(status, code, 'Flight departed', 'This flight has already departed.', null, false);
  }
  if (status === 409) {
    return failure(status, code, 'Queue unavailable', 'This queue is no longer open.', null, false);
  }
  if (status === 400) {
    return failure(status, code, 'Request not accepted', 'Bluebird did not accept this join request.', null, false);
  }
  if (status === null || status === 0) {
    return failure(null, code, 'Connection problem', 'The join request could not reach Bluebird. No queue change was confirmed.', null, false);
  }
  return failure(status, code, 'Unable to join', 'Joining could not be completed. No queue change was confirmed.', null, false);
}

export function presentQueueLeaveFailure(input: {
  status?: number | null;
  code?: string | null;
  body?: unknown;
}): JoinFlightFailure {
  const status = Number.isInteger(input.status) ? input.status! : null;
  const code = readErrorCode(input.code, input.body);
  if (status === 401) {
    return failure(status, code, 'Sign in required', 'Sign in again before leaving this queue. No queue change was made.', null, false);
  }
  if (status === 404) {
    return failure(status, code, 'Flight unavailable', 'This flight is no longer available.', null, false);
  }
  if (status === 409 && (code === 'queue_closed' || code === 'closed')) {
    return failure(status, code, 'Queue closed', 'This queue is no longer open. You were not removed.', null, false);
  }
  if (status === 409 && (code === 'departed' || code === 'flight_departed')) {
    return failure(status, code, 'Flight departed', 'This flight has already departed. You were not removed.', null, false);
  }
  if (status === 409) {
    return failure(status, code, 'Unable to leave', 'This queue could not be left. No queue change was confirmed.', null, false);
  }
  if (status === 400) {
    return failure(status, code, 'Request not accepted', 'Bluebird did not accept this leave request.', null, false);
  }
  if (status === null || status === 0) {
    return failure(null, code, 'Connection problem', 'The leave request could not reach Bluebird. No queue change was confirmed.', null, false);
  }
  return failure(status, code, 'Unable to leave', 'Leaving the queue could not be completed. No queue change was confirmed.', null, false);
}

export const QUEUE_JOIN_DUPLICATE = 'A queue request is already in progress. No second request was sent.';
export const QUEUE_LEAVE_UNAVAILABLE = 'Leaving the queue is not available in this build. No request is sent.';
export const QUEUE_JOIN_UNCONFIRMED = 'Bluebird did not confirm a queue position. No position was saved on this device.';
export const QUEUE_LEAVE_UNCONFIRMED = 'Bluebird did not confirm that you left the queue. Your place was not changed on this device.';
export const QUEUE_LEFT_CONFIRMED = 'Bluebird confirmed that you left this queue.';

export function formatQueueClosingTime(value: string | null): string | null {
  const timestamp = isoTimestamp(value);
  if (!timestamp) return null;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(date);
}

export function joinFlightRefreshTargets(input: {
  environment: MainBluebirdApiEnvironment;
  clerkUserId: string;
  flightId: number;
}) {
  const flightId = parseProductionFlightId(input.flightId);
  if (flightId === null) return null;
  return {
    detail: productionFlightDetailQueryKey(flightId, input.clerkUserId),
    queue: mainBluebirdAuthenticatedQueryKey(input.environment, input.clerkUserId, 'empty-leg-queue', flightId),
    myQueues: mainBluebirdAuthenticatedQueryKey(input.environment, input.clerkUserId, 'empty-leg-queue'),
    trips: mainBluebirdAuthenticatedQueryKey(input.environment, input.clerkUserId, 'trips'),
    flightList: mainBluebirdAuthenticatedQueryKey(input.environment, input.clerkUserId, 'empty-leg-list'),
  };
}

/** Refreshes the signed-in account's flight, roster, My Queues, and trips after a confirmed queue change. */
export function applyQueueMutationRefresh(input: {
  gateOpen: boolean;
  requestedUserId: string;
  activeUserId: string | null;
  signedIn: boolean;
  environment: MainBluebirdApiEnvironment;
  flightId: number;
  invalidate: (key: readonly unknown[]) => void;
}): boolean {
  const keys = joinFlightRefreshTargets({
    environment: input.environment,
    clerkUserId: input.requestedUserId,
    flightId: input.flightId,
  });
  if (!keys || !shouldRefreshAfterJoin({
    gateOpen: input.gateOpen,
    requestedUserId: input.requestedUserId,
    activeUserId: input.activeUserId,
    signedIn: input.signedIn,
  })) {
    return false;
  }
  input.invalidate(keys.detail);
  input.invalidate(keys.queue);
  input.invalidate(keys.myQueues);
  input.invalidate(keys.trips);
  input.invalidate(keys.flightList);
  return true;
}

/** A verified join may refresh only the account that submitted it, and only while the gate is open. */
export function shouldRefreshAfterJoin(input: {
  gateOpen: boolean;
  requestedUserId: string;
  activeUserId: string | null;
  signedIn: boolean;
}): boolean {
  const requested = input.requestedUserId.trim();
  return input.gateOpen === true &&
    input.signedIn === true &&
    requested.length > 0 &&
    input.activeUserId === requested;
}

export const JOIN_FLIGHT_MEMBERSHIP_NOTE = 'Bluebird requires an active Base or Plus membership and a complete profile. One live queue is allowed for each origin-local departure day, including a shared Plus Family day. This screen does not check those rules.';
export const JOIN_FLIGHT_CREDIT_CONFIRM_REQUIRED = 'Confirm the International Pass credit before joining. No request was sent.';
export const JOIN_FLIGHT_PASS_NOTE = 'Choosing an option stays on this screen. Joining is not enabled, so nothing is sent and no card is charged. International Pass payment is handled separately.';
export const JOIN_FLIGHT_PASS_READY = 'Choose one option. The join request includes that choice and does not charge a card.';
export const JOIN_FLIGHT_CONFIRM_UNAVAILABLE = 'Queue joining is not available in this build. No request is sent.';
export const JOIN_FLIGHT_CONFIRM_DEMO = 'DEMO — No real queue entry will be created.';
export const JOIN_FLIGHT_CONFIRM_READY = 'Joining places you in this queue. It does not confirm a seat.';
export const JOIN_FLIGHT_CONSENT_REQUIRED = 'Choose an International Pass option before joining. No request was sent.';

/** Closed-gate and demo copy stay exact. An open gate must not say that no request is sent. */
export function joinFlightConfirmNote(demoEnabled: boolean): string {
  if (canSubmitProductionQueueJoin()) return JOIN_FLIGHT_CONFIRM_READY;
  if (demoEnabled) return JOIN_FLIGHT_CONFIRM_DEMO;
  return JOIN_FLIGHT_CONFIRM_UNAVAILABLE;
}

export function joinFlightPassNote(): string {
  return canSubmitProductionQueueJoin() ? JOIN_FLIGHT_PASS_READY : JOIN_FLIGHT_PASS_NOTE;
}
export const JOIN_FLIGHT_PASS_UNKNOWN = 'This flight is international. A pass is not assumed for every membership tier, and this screen will not authorize one.';

function failure(
  status: number | null,
  code: string | null,
  title: string,
  body: string,
  conflict: JoinFlightConflictFlight | null,
  keepsExistingQueue: boolean,
): JoinFlightFailure {
  return { status, code, title, body, conflict, keepsExistingQueue };
}

function readErrorCode(explicit: string | null | undefined, body: unknown): string | null {
  const direct = normalizeCode(explicit);
  if (direct) return direct;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  return normalizeCode((body as { code?: unknown }).code);
}

function normalizeCode(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z0-9_]{1,80}$/.test(value) ? value : null;
}

function readConflictFlight(body: unknown): JoinFlightConflictFlight | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const raw = record.conflict ?? record.conflictingFlight ?? record.existingFlight;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const flight = raw as Record<string, unknown>;
  const numericId = flight.emptyLegId ?? flight.id;
  const emptyLegId = typeof numericId === 'number' && Number.isSafeInteger(numericId) && numericId > 0
    ? numericId
    : null;
  const originAirport = airportCode(textField(flight.originAirport ?? flight.fromAirport ?? flight.from));
  const destinationAirport = airportCode(textField(flight.destinationAirport ?? flight.toAirport ?? flight.to));
  const departureTime = textField(flight.departureTime);
  if (emptyLegId === null && !originAirport && !destinationAirport && !departureTime) return null;
  return {
    emptyLegId,
    originAirport,
    destinationAirport,
    departureTime: departureTime && departureTime.length <= 80 ? departureTime : null,
  };
}

function textField(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function displayText(value: string | string[] | undefined): string | null {
  const text = firstParam(value)?.trim() ?? '';
  if (!text || text.length > DISPLAY_TEXT_LIMIT || /[\u0000-\u001F]/.test(text)) return null;
  return text;
}

function airportCode(value: string | string[] | undefined): string | null {
  const text = displayText(value)?.toUpperCase() ?? null;
  return text && /^[A-Z0-9]{2,12}$/.test(text) ? text : null;
}

function calendarDate(value: string | string[] | undefined): string | null {
  const text = displayText(value);
  return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function clockTime(value: string | string[] | undefined): string | null {
  const text = displayText(value);
  return text && /^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(text) ? text : null;
}

function internationalFlag(value: string | string[] | undefined): boolean | null {
  const text = firstParam(value)?.trim();
  if (text === '1') return true;
  if (text === '0') return false;
  return null;
}

function requiredFlag(value: string | string[] | undefined): boolean | null {
  return internationalFlag(value);
}

function isoTimestamp(value: string | null | undefined): string | null {
  const text = value?.trim() ?? '';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(text)) return null;
  return Number.isFinite(Date.parse(text)) ? text : null;
}
