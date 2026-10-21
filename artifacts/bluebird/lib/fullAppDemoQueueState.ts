import {
  parseProductionFlightId,
  type FlightView,
} from './productionFlights';

export const FULL_APP_DEMO_QUEUE_STORAGE_KEY = 'bluebird:full-app-demo:queue:v1';

export type FullAppDemoQueueFlight = Pick<
  FlightView,
  | 'id'
  | 'fromAirport'
  | 'fromCity'
  | 'toAirport'
  | 'toCity'
  | 'departureDate'
  | 'departureTime'
  | 'departureTimeZone'
  | 'aircraftType'
  | 'aircraftTypeName'
  | 'aircraftTypeCode'
  | 'imageUrl'
>;

export interface FullAppDemoQueueEntry {
  flightId: string;
  flight: FullAppDemoQueueFlight;
}

const FLIGHT_TEXT_FIELDS = [
  'fromAirport',
  'fromCity',
  'toAirport',
  'toCity',
  'departureDate',
  'departureTime',
  'departureTimeZone',
  'aircraftType',
  'aircraftTypeName',
  'aircraftTypeCode',
  'imageUrl',
] as const satisfies readonly (keyof FullAppDemoQueueFlight)[];

function isNullableText(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function parseStoredEntry(value: unknown): FullAppDemoQueueEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.flightId !== 'string' && typeof raw.flightId !== 'number') return null;
  const flightId = parseProductionFlightId(raw.flightId);
  const flight = raw.flight;
  if (
    flightId === null ||
    !flight ||
    typeof flight !== 'object' ||
    Array.isArray(flight)
  ) return null;

  const rawFlight = flight as Record<string, unknown>;
  if (typeof rawFlight.id !== 'string' && typeof rawFlight.id !== 'number') return null;
  if (
    parseProductionFlightId(rawFlight.id) !== flightId ||
    String(flightId) !== rawFlight.id
  ) return null;

  for (const field of FLIGHT_TEXT_FIELDS) {
    if (!isNullableText(rawFlight[field])) return null;
  }

  return {
    flightId: String(flightId),
    flight: {
      id: String(flightId),
      fromAirport: rawFlight.fromAirport as string | null,
      fromCity: rawFlight.fromCity as string | null,
      toAirport: rawFlight.toAirport as string | null,
      toCity: rawFlight.toCity as string | null,
      departureDate: rawFlight.departureDate as string | null,
      departureTime: rawFlight.departureTime as string | null,
      departureTimeZone: rawFlight.departureTimeZone as string | null,
      aircraftType: rawFlight.aircraftType as string | null,
      aircraftTypeName: rawFlight.aircraftTypeName as string | null,
      aircraftTypeCode: rawFlight.aircraftTypeCode as string | null,
      imageUrl: rawFlight.imageUrl as string | null,
    },
  };
}

export function parseFullAppDemoQueueState(value: unknown): FullAppDemoQueueEntry[] {
  if (!Array.isArray(value)) return [];
  const seenIds = new Set<string>();
  const entries: FullAppDemoQueueEntry[] = [];
  for (const item of value) {
    const entry = parseStoredEntry(item);
    if (!entry || seenIds.has(entry.flightId)) continue;
    seenIds.add(entry.flightId);
    entries.push(entry);
  }
  return entries;
}

export function deserializeFullAppDemoQueueState(raw: string | null): FullAppDemoQueueEntry[] {
  if (raw === null) return [];
  try {
    return parseFullAppDemoQueueState(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export function createFullAppDemoQueueEntry(flight: FlightView): FullAppDemoQueueEntry {
  const flightId = parseProductionFlightId(flight.id);
  if (flight.source !== 'production' || flightId === null || String(flightId) !== flight.id) {
    throw new Error('A live Production flight with a valid ID is required for the demo queue.');
  }

  return {
    flightId: String(flightId),
    flight: {
      id: String(flightId),
      fromAirport: flight.fromAirport,
      fromCity: flight.fromCity,
      toAirport: flight.toAirport,
      toCity: flight.toCity,
      departureDate: flight.departureDate,
      departureTime: flight.departureTime,
      departureTimeZone: flight.departureTimeZone,
      aircraftType: flight.aircraftType,
      aircraftTypeName: flight.aircraftTypeName,
      aircraftTypeCode: flight.aircraftTypeCode,
      imageUrl: flight.imageUrl,
    },
  };
}

export function joinFullAppDemoQueue(
  entries: readonly FullAppDemoQueueEntry[],
  flight: FlightView,
): FullAppDemoQueueEntry[] {
  const entry = createFullAppDemoQueueEntry(flight);
  return [
    ...entries.filter((existing) => existing.flightId !== entry.flightId),
    entry,
  ];
}

export function leaveFullAppDemoQueue(
  entries: readonly FullAppDemoQueueEntry[],
  flightId: string | number,
): FullAppDemoQueueEntry[] {
  const parsedId = parseProductionFlightId(flightId);
  if (parsedId === null) {
    throw new Error('A positive numeric Production flight ID is required.');
  }
  return entries.filter((entry) => entry.flightId !== String(parsedId));
}
