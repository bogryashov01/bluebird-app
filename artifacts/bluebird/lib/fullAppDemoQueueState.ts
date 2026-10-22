import { parseProductionFlightId, type FlightView } from './productionFlights';

export const FULL_APP_DEMO_QUEUE_STORAGE_KEY = 'bluebird:full-app-demo:queue:v1';

export type FullAppDemoQueueStatus = 'waiting' | 'changed-position' | 'won' | 'lost' | 'closed';
export type FullAppDemoQueueFlight = Pick<
  FlightView,
  | 'id' | 'status' | 'fromAirport' | 'fromCity' | 'toAirport' | 'toCity'
  | 'departureDate' | 'departureTime' | 'departureTimeZone' | 'duration'
  | 'aircraftType' | 'aircraftTypeName' | 'aircraftTypeCode' | 'imageUrl' | 'international'
>;

export interface FullAppDemoQueueEntry {
  id: string;
  flightId: string;
  status: FullAppDemoQueueStatus;
  position: number;
  totalInQueue: number;
  createdAt: string;
  flight: FullAppDemoQueueFlight;
}

export interface FullAppDemoQueueState {
  entries: FullAppDemoQueueEntry[];
  passCount: number;
}

const STATUSES: readonly FullAppDemoQueueStatus[] = [
  'waiting', 'changed-position', 'won', 'lost', 'closed',
];
const TEXT_FIELDS = [
  'status', 'fromAirport', 'fromCity', 'toAirport', 'toCity', 'departureDate',
  'departureTime', 'departureTimeZone', 'duration', 'aircraftType', 'aircraftTypeName',
  'aircraftTypeCode', 'imageUrl',
] as const satisfies readonly (keyof FullAppDemoQueueFlight)[];

function isNullableText(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function parseStoredEntry(value: unknown, fallbackPosition: number): FullAppDemoQueueEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.flightId !== 'string' && typeof raw.flightId !== 'number') return null;
  const flightId = parseProductionFlightId(raw.flightId);
  const rawFlight = raw.flight;
  if (flightId === null || !rawFlight || typeof rawFlight !== 'object' || Array.isArray(rawFlight)) return null;
  const flight = rawFlight as Record<string, unknown>;
  if ((typeof flight.id !== 'string' && typeof flight.id !== 'number') ||
      parseProductionFlightId(flight.id) !== flightId || String(flight.id) !== String(flightId)) return null;
  for (const field of TEXT_FIELDS) {
    if (flight[field] !== undefined && !isNullableText(flight[field])) return null;
  }
  const status = STATUSES.includes(raw.status as FullAppDemoQueueStatus) ? raw.status as FullAppDemoQueueStatus : 'waiting';
  const position = Number.isSafeInteger(raw.position) && Number(raw.position) > 0 ? Number(raw.position) : fallbackPosition;
  const totalInQueue = Number.isSafeInteger(raw.totalInQueue) && Number(raw.totalInQueue) >= position
    ? Number(raw.totalInQueue)
    : position;
  const createdAt = typeof raw.createdAt === 'string' && Number.isFinite(Date.parse(raw.createdAt))
    ? raw.createdAt
    : new Date(0).toISOString();
  return {
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : `demo-${flightId}`,
    flightId: String(flightId),
    status,
    position,
    totalInQueue,
    createdAt,
    flight: {
      id: String(flightId),
      status: (flight.status ?? null) as string | null,
      fromAirport: (flight.fromAirport ?? null) as string | null,
      fromCity: (flight.fromCity ?? null) as string | null,
      toAirport: (flight.toAirport ?? null) as string | null,
      toCity: (flight.toCity ?? null) as string | null,
      departureDate: (flight.departureDate ?? null) as string | null,
      departureTime: (flight.departureTime ?? null) as string | null,
      departureTimeZone: (flight.departureTimeZone ?? null) as string | null,
      duration: (flight.duration ?? null) as string | null,
      aircraftType: (flight.aircraftType ?? null) as string | null,
      aircraftTypeName: (flight.aircraftTypeName ?? null) as string | null,
      aircraftTypeCode: (flight.aircraftTypeCode ?? null) as string | null,
      imageUrl: (flight.imageUrl ?? null) as string | null,
      international: typeof flight.international === 'boolean' ? flight.international : null,
    },
  };
}

export function parseFullAppDemoQueueState(value: unknown): FullAppDemoQueueState {
  const rawState = Array.isArray(value)
    ? { entries: value, passCount: 0 }
    : value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  if (!rawState || !Array.isArray(rawState.entries)) return { entries: [], passCount: 0 };
  const entries: FullAppDemoQueueEntry[] = [];
  const seenIds = new Set<string>();
  for (const item of rawState.entries) {
    const entry = parseStoredEntry(item, entries.length + 1);
    if (!entry || seenIds.has(entry.flightId)) continue;
    seenIds.add(entry.flightId);
    entries.push(entry);
  }
  const passCount = Number.isSafeInteger(rawState.passCount) && Number(rawState.passCount) >= 0
    ? Number(rawState.passCount)
    : 0;
  return { entries, passCount };
}

export function deserializeFullAppDemoQueueState(raw: string | null): FullAppDemoQueueState {
  if (raw === null) return { entries: [], passCount: 0 };
  try {
    return parseFullAppDemoQueueState(JSON.parse(raw) as unknown);
  } catch {
    return { entries: [], passCount: 0 };
  }
}

export function createFullAppDemoQueueEntry(
  flight: FlightView,
  position = 1,
  createdAt = new Date().toISOString(),
): FullAppDemoQueueEntry {
  const flightId = parseProductionFlightId(flight.id);
  if (!['production', 'local'].includes(flight.source) || flightId === null || String(flightId) !== flight.id) {
    throw new Error('A live or typed fallback flight with a valid ID is required for the local demo queue.');
  }
  if (flight.status !== 'available' && flight.status !== 'published') {
    throw new Error('This flight is no longer available to join.');
  }
  return {
    id: `demo-${flightId}`,
    flightId: String(flightId),
    status: 'waiting',
    position,
    totalInQueue: position,
    createdAt,
    flight: {
      id: String(flightId),
      status: flight.status,
      fromAirport: flight.fromAirport,
      fromCity: flight.fromCity,
      toAirport: flight.toAirport,
      toCity: flight.toCity,
      departureDate: flight.departureDate,
      departureTime: flight.departureTime,
      departureTimeZone: flight.departureTimeZone,
      duration: flight.duration,
      aircraftType: flight.aircraftType,
      aircraftTypeName: flight.aircraftTypeName,
      aircraftTypeCode: flight.aircraftTypeCode,
      imageUrl: flight.imageUrl,
      international: flight.international,
    },
  };
}

export function joinFullAppDemoQueue(
  entries: readonly FullAppDemoQueueEntry[],
  flight: FlightView,
): FullAppDemoQueueEntry[] {
  if (entries.some((entry) => entry.flightId === flight.id)) {
    throw new Error('You already have a local demo queue entry for this flight.');
  }
  return [...entries, createFullAppDemoQueueEntry(flight, entries.length + 1)];
}

export function leaveFullAppDemoQueue(
  entries: readonly FullAppDemoQueueEntry[],
  flightId: string | number,
): FullAppDemoQueueEntry[] {
  const parsedId = parseProductionFlightId(flightId);
  if (parsedId === null) throw new Error('A positive numeric flight ID is required.');
  return entries.filter((entry) => entry.flightId !== String(parsedId));
}

export function transitionFullAppDemoQueueEntry(
  entries: readonly FullAppDemoQueueEntry[],
  flightId: string | number,
  status: Exclude<FullAppDemoQueueStatus, 'won'>,
  changedPosition?: number,
): FullAppDemoQueueEntry[] {
  const parsedId = parseProductionFlightId(flightId);
  const entry = entries.find((item) => item.flightId === String(parsedId));
  if (!entry) throw new Error('The local demo queue entry was not found.');
  if (entry.status === 'won') throw new Error('A won demo flight cannot be changed.');
  if (status === 'changed-position' && entry.status !== 'waiting') {
    throw new Error('Only a waiting demo queue entry can change position.');
  }
  if (status === 'changed-position' &&
      (!Number.isSafeInteger(changedPosition) || Number(changedPosition) < 1 || changedPosition === entry.position)) {
    throw new Error('A changed demo queue position must be a different positive position from the observed read.');
  }
  return entries.map((item) => item.flightId === String(parsedId)
    ? {
        ...item,
        status,
        ...(status === 'changed-position'
          ? { position: changedPosition!, totalInQueue: Math.max(item.totalInQueue, changedPosition!) }
          : {}),
      }
    : item);
}

export function useFullAppDemoPass(
  state: FullAppDemoQueueState,
  flightId: string | number,
): FullAppDemoQueueState {
  const entry = state.entries.find((item) => item.flightId === String(parseProductionFlightId(flightId)));
  if (!entry || entry.status !== 'waiting') throw new Error('Only a waiting local demo queue can use a pass.');
  if (state.passCount < 1) throw new Error('You do not have a Skip the Line pass.');
  return {
    passCount: state.passCount - 1,
    entries: state.entries.map((item) => item.flightId === entry.flightId ? { ...item, status: 'won' } : item),
  };
}

export function addFullAppDemoPass(state: FullAppDemoQueueState): FullAppDemoQueueState {
  return { ...state, passCount: state.passCount + 1 };
}
