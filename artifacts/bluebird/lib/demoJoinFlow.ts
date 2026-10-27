/**
 * Local Join the Flight simulation. It never represents a production booking
 * and it has no access to the production queue client.
 */
export const DEMO_JOIN_FLOW_DEFAULT_ENABLED = false;
export const DEMO_JOIN_FLOW_SETTING_VALUE = 'enabled';
export const DEMO_JOIN_NOTICE = 'DEMO — No real queue entry created';

export const DEMO_POLICY_ACKNOWLEDGEMENTS = [
  'Flights may be cancelled or changed due to operational requirements.',
  'Baggage restrictions apply based on aircraft type and available space.',
  'Pet policies apply — please confirm your pet meets carrier requirements.',
] as const;

/** Display-only value for the demo international notice. It is not a production fee. */
export const DEMO_SIMULATED_INTERNATIONAL_FEE_USD = 1000;
export const DEMO_SIMULATED_PASS_BALANCE = 2;

export type DemoJoinPhase = 'joined' | 'winner' | 'confirmed' | 'pass-simulated';

export interface DemoJoinFlightInput {
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

export interface DemoJoinEntry {
  source: 'demo-join-flow';
  simulated: true;
  booked: false;
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
  position: number;
  participantCount: number;
  phase: DemoJoinPhase;
  joinedAt: string | null;
}

export interface DemoJoinTrip {
  source: 'demo-join-flow';
  simulated: true;
  booked: false;
  flightId: number;
  routeLabel: string;
  detailLabel: string;
}

export function isDemoJoinFlowAllowed(isDevelopment: boolean, explicitSetting: boolean): boolean {
  return isDevelopment === true && explicitSetting === true;
}

export function readDemoJoinSetting(stored: string | null | undefined): boolean {
  return stored === DEMO_JOIN_FLOW_SETTING_VALUE;
}

export function canContinueDemoPolicy(checked: readonly boolean[]): boolean {
  return checked.length === DEMO_POLICY_ACKNOWLEDGEMENTS.length && checked.every((item) => item === true);
}

export function shouldShowDemoInternationalNotice(international: boolean | null): boolean {
  return international === true;
}

export function simulatedInternationalFeeLabel(): string {
  return `Simulated $${DEMO_SIMULATED_INTERNATIONAL_FEE_USD.toLocaleString('en-US')}`;
}

export function simulatedQueuePlacement(flightId: number): { position: number; participantCount: number } | null {
  if (!Number.isSafeInteger(flightId) || flightId < 1) return null;
  const position = (flightId % 3) + 2;
  return { position, participantCount: position + 3 };
}

export function createDemoJoin(flight: DemoJoinFlightInput, now = Date.now()): DemoJoinEntry | null {
  const placement = simulatedQueuePlacement(flight.flightId);
  if (!placement || !Number.isFinite(now)) return null;
  return {
    source: 'demo-join-flow',
    simulated: true,
    booked: false,
    flightId: flight.flightId,
    fromAirport: flight.fromAirport,
    toAirport: flight.toAirport,
    fromCity: flight.fromCity,
    toCity: flight.toCity,
    departureDate: flight.departureDate,
    departureTime: flight.departureTime,
    aircraft: flight.aircraft,
    international: flight.international,
    flightStatus: flight.flightStatus,
    position: placement.position,
    participantCount: placement.participantCount,
    phase: 'joined',
    joinedAt: new Date(now).toISOString(),
  };
}

export function simulatedQueueMovement(entry: DemoJoinEntry): readonly { text: string; time: string }[] {
  return [
    { text: 'You joined this simulated queue', time: 'On this device' },
    { text: `Demo position #${entry.position} assigned locally`, time: 'Not a production position' },
  ];
}

export function applySimulatedSkipLine(entry: DemoJoinEntry, passBalance: number): DemoJoinEntry | null {
  if (entry.phase !== 'joined' || entry.booked !== false || !Number.isSafeInteger(passBalance) || passBalance < 1) {
    return null;
  }
  return { ...entry, phase: 'pass-simulated', booked: false, simulated: true, source: 'demo-join-flow' };
}

export function simulateDemoWinner(entry: DemoJoinEntry): DemoJoinEntry | null {
  if (entry.phase !== 'joined' || entry.booked !== false || entry.simulated !== true) return null;
  return { ...entry, phase: 'winner', booked: false, simulated: true, source: 'demo-join-flow' };
}

export function confirmDemoFlight(entry: DemoJoinEntry): DemoJoinEntry | null {
  if (entry.phase !== 'winner' || entry.booked !== false || entry.simulated !== true) return null;
  return { ...entry, phase: 'confirmed', booked: false, simulated: true, source: 'demo-join-flow' };
}

export function demoTripFromEntry(entry: DemoJoinEntry | null): DemoJoinTrip | null {
  if (!entry || entry.phase !== 'confirmed' || entry.booked !== false || entry.source !== 'demo-join-flow') return null;
  const route = [entry.fromAirport, entry.toAirport].filter(Boolean).join(' → ');
  const places = [entry.fromCity, entry.toCity].filter(Boolean).join(' → ');
  return {
    source: 'demo-join-flow',
    simulated: true,
    booked: false,
    flightId: entry.flightId,
    routeLabel: route || 'Simulated flight',
    detailLabel: [places, entry.aircraft].filter(Boolean).join(' · '),
  };
}

export function separateDemoTrip<T extends { current: readonly unknown[]; past: readonly unknown[] }>(
  trips: T,
  entry: DemoJoinEntry | null,
): { current: T['current']; past: T['past']; demo: DemoJoinTrip | null } {
  return {
    current: trips.current,
    past: trips.past,
    demo: demoTripFromEntry(entry),
  };
}

export function parseStoredDemoEntry(raw: string | null | undefined): DemoJoinEntry | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.source !== 'demo-join-flow' || record.simulated !== true || record.booked !== false) return null;
  if (
    record.phase !== 'joined' &&
    record.phase !== 'winner' &&
    record.phase !== 'confirmed' &&
    record.phase !== 'pass-simulated'
  ) return null;
  if (!Number.isSafeInteger(record.flightId) || (record.flightId as number) < 1) return null;
  if (!Number.isSafeInteger(record.position) || (record.position as number) < 1) return null;
  if (!Number.isSafeInteger(record.participantCount) || (record.participantCount as number) < record.position) return null;
  return {
    source: 'demo-join-flow',
    simulated: true,
    booked: false,
    flightId: record.flightId as number,
    fromAirport: textOrNull(record.fromAirport),
    toAirport: textOrNull(record.toAirport),
    fromCity: textOrNull(record.fromCity),
    toCity: textOrNull(record.toCity),
    departureDate: textOrNull(record.departureDate),
    departureTime: textOrNull(record.departureTime),
    aircraft: textOrNull(record.aircraft),
    international: record.international === true ? true : record.international === false ? false : null,
    flightStatus: record.flightStatus === 'published' ? 'published' : null,
    position: record.position as number,
    participantCount: record.participantCount as number,
    phase: record.phase,
    joinedAt: typeof record.joinedAt === 'string' && !Number.isNaN(Date.parse(record.joinedAt)) ? record.joinedAt : null,
  };
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() && value.length <= 80 ? value : null;
}
