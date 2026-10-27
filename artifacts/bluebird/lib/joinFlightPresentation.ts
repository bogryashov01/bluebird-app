import type { ProductionQueueEntry } from './productionAuthApi';
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
}

export type JoinFlightQueuePanel =
  | { kind: 'not-published' }
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'unavailable' }
  | { kind: 'empty' }
  | { kind: 'participants'; participantCount: number; viewerPosition: number | null };

export const JOIN_FLIGHT_QUEUE_EMPTY = 'No one is currently in this queue.';
export const JOIN_FLIGHT_QUEUE_FOOTNOTE = 'The queue count is not a count of available seats. This response does not confirm that you can join.';

export interface QueueJoinSuccessModel {
  flightId: number;
  position: number;
  participantCount: number;
}

const DISPLAY_TEXT_LIMIT = 80;

export function canSubmitProductionQueueJoin(): boolean {
  return false;
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

export function presentJoinFlightQueuePanel(input: {
  flightStatus: 'published' | null;
  sessionReady: boolean;
  signedIn: boolean;
  loading: boolean;
  failed: boolean;
  read: ProductionQueueRead | null;
}): JoinFlightQueuePanel {
  if (!canReadJoinFlightQueue(input.flightStatus)) return { kind: 'not-published' };
  if (!input.sessionReady || input.loading) return { kind: 'loading' };
  if (!input.signedIn) return { kind: 'signed-out' };
  if (input.failed || input.read == null) return { kind: 'unavailable' };
  if (input.read.entries.length === 0) {
    return input.read.viewer.status === 'not-in-queue' ? { kind: 'empty' } : { kind: 'unavailable' };
  }
  return {
    kind: 'participants',
    participantCount: input.read.entries.length,
    viewerPosition: input.read.viewer.status === 'in-queue' ? input.read.viewer.position : null,
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
