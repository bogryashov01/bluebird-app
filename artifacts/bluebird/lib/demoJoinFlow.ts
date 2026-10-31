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

/** Display-only demo amount confirmed by the product owner. It is not a production charge. */
export const DEMO_PET_FEE_USD = 500;
export const DEMO_PET_QUESTION = 'Are you bringing a pet?';
export const DEMO_PET_FEE_LABEL = 'Pet Fee — $500';
export const DEMO_PET_FEE_ACKNOWLEDGEMENT = 'I understand that an additional $500 pet fee applies to my flight.';
export const DEMO_PET_CHOICE_MESSAGE = 'Choose whether you are bringing a pet.';
export const DEMO_PET_WEIGHT_REQUIRED_MESSAGE = 'Enter the pet weight in pounds.';
export const DEMO_PET_WEIGHT_INVALID_MESSAGE = 'Pet weight must be greater than zero.';
export const DEMO_PET_FEE_ACK_MESSAGE = 'Acknowledge the $500 pet fee to continue.';

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
  /** Local demo answer. Null means this entry was created without a pet answer. */
  pet: DemoJoinPet | null;
}

export interface DemoPetSelection {
  bringingPet: boolean | null;
  weightLbs: string;
  feeAcknowledged: boolean;
}

export type DemoJoinPet =
  | { bringingPet: false }
  | { bringingPet: true; weightLbs: number };

export const EMPTY_DEMO_PET: DemoPetSelection = {
  bringingPet: null,
  weightLbs: '',
  feeAcknowledged: false,
};

export interface DemoJoinTrip {
  source: 'demo-join-flow';
  simulated: true;
  booked: false;
  flightId: number;
  routeLabel: string;
  detailLabel: string;
}

export function isDemoJoinFlowAllowed(
  isDevelopment: boolean,
  explicitSetting: boolean,
  productionMemberData = false,
): boolean {
  if (productionMemberData) return false;
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

export function sanitizeDemoPetSelection(selection: DemoPetSelection): DemoPetSelection {
  if (selection.bringingPet !== true) {
    return {
      bringingPet: selection.bringingPet === false ? false : null,
      weightLbs: '',
      feeAcknowledged: false,
    };
  }
  return {
    bringingPet: true,
    weightLbs: selection.weightLbs.replace(/\D/g, '').slice(0, 4),
    feeAcknowledged: selection.feeAcknowledged === true,
  };
}

export function chooseDemoPet(selection: DemoPetSelection, bringingPet: boolean): DemoPetSelection {
  if (!bringingPet) return { bringingPet: false, weightLbs: '', feeAcknowledged: false };
  return sanitizeDemoPetSelection({ ...selection, bringingPet: true });
}

export function updateDemoPetWeight(selection: DemoPetSelection, weightLbs: string): DemoPetSelection {
  return sanitizeDemoPetSelection({ ...selection, weightLbs });
}

export function acknowledgeDemoPetFee(selection: DemoPetSelection, feeAcknowledged: boolean): DemoPetSelection {
  return sanitizeDemoPetSelection({ ...selection, feeAcknowledged });
}

export function demoPetWeightLbs(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const weight = Number(value);
  if (!Number.isSafeInteger(weight) || weight < 1) return null;
  return weight;
}

export function demoPetValidationMessage(selection: DemoPetSelection): string | null {
  const pet = sanitizeDemoPetSelection(selection);
  if (pet.bringingPet === null) return DEMO_PET_CHOICE_MESSAGE;
  if (pet.bringingPet === false) return null;
  if (!pet.weightLbs) return DEMO_PET_WEIGHT_REQUIRED_MESSAGE;
  if (demoPetWeightLbs(pet.weightLbs) === null) return DEMO_PET_WEIGHT_INVALID_MESSAGE;
  if (!pet.feeAcknowledged) return DEMO_PET_FEE_ACK_MESSAGE;
  return null;
}

export function canContinueDemoPet(selection: DemoPetSelection): boolean {
  return demoPetValidationMessage(selection) === null;
}

export function demoPetSummary(
  selection: DemoPetSelection,
): { weightLbs: number; feeLabel: typeof DEMO_PET_FEE_LABEL } | null {
  const pet = sanitizeDemoPetSelection(selection);
  if (!canContinueDemoPet(pet) || pet.bringingPet !== true) return null;
  const weightLbs = demoPetWeightLbs(pet.weightLbs);
  if (weightLbs === null) return null;
  return { weightLbs, feeLabel: DEMO_PET_FEE_LABEL };
}

export function demoPetConfirmation(
  entry: DemoJoinEntry | null,
): { weightLbs: number; feeLabel: typeof DEMO_PET_FEE_LABEL } | null {
  if (!entry?.pet || entry.pet.bringingPet !== true) return null;
  return { weightLbs: entry.pet.weightLbs, feeLabel: DEMO_PET_FEE_LABEL };
}

function resolvedDemoPet(selection: DemoPetSelection): DemoJoinPet | null {
  const pet = sanitizeDemoPetSelection(selection);
  if (!canContinueDemoPet(pet)) return null;
  if (pet.bringingPet !== true) return { bringingPet: false };
  const weightLbs = demoPetWeightLbs(pet.weightLbs);
  return weightLbs === null ? null : { bringingPet: true, weightLbs };
}

export function simulatedQueuePlacement(flightId: number): { position: number; participantCount: number } | null {
  if (!Number.isSafeInteger(flightId) || flightId < 1) return null;
  const position = (flightId % 3) + 2;
  return { position, participantCount: position + 3 };
}

export function createDemoJoin(
  flight: DemoJoinFlightInput,
  now = Date.now(),
  petSelection?: DemoPetSelection,
): DemoJoinEntry | null {
  const placement = simulatedQueuePlacement(flight.flightId);
  if (!placement || !Number.isFinite(now)) return null;
  let pet: DemoJoinPet | null = null;
  if (petSelection !== undefined) {
    pet = resolvedDemoPet(petSelection);
    if (!pet) return null;
  }
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
    pet,
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

function positiveSafeInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) return null;
  return value;
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
  const flightId = positiveSafeInteger(record.flightId);
  const position = positiveSafeInteger(record.position);
  const participantCount = positiveSafeInteger(record.participantCount);
  if (flightId === null || position === null || participantCount === null || participantCount < position) return null;
  return {
    source: 'demo-join-flow',
    simulated: true,
    booked: false,
    flightId,
    fromAirport: textOrNull(record.fromAirport),
    toAirport: textOrNull(record.toAirport),
    fromCity: textOrNull(record.fromCity),
    toCity: textOrNull(record.toCity),
    departureDate: textOrNull(record.departureDate),
    departureTime: textOrNull(record.departureTime),
    aircraft: textOrNull(record.aircraft),
    international: record.international === true ? true : record.international === false ? false : null,
    flightStatus: record.flightStatus === 'published' ? 'published' : null,
    position,
    participantCount,
    phase: record.phase,
    joinedAt: typeof record.joinedAt === 'string' && !Number.isNaN(Date.parse(record.joinedAt)) ? record.joinedAt : null,
    pet: parseStoredDemoPet(record.pet),
  };
}

function parseStoredDemoPet(value: unknown): DemoJoinPet | null {
  if (!value || typeof value !== 'object') return null;
  const pet = value as Record<string, unknown>;
  if (pet.bringingPet === false) return { bringingPet: false };
  const weightLbs = typeof pet.weightLbs === 'number' ? demoPetWeightLbs(String(pet.weightLbs)) : null;
  if (pet.bringingPet === true && weightLbs !== null) return { bringingPet: true, weightLbs };
  return null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() && value.length <= 80 ? value : null;
}

export type DemoQueueExitDestination = 'discover' | 'trips';

/** Leaves the demo queue screens. It does not change queue membership. */
export function planDemoQueueExit(input: {
  destination: DemoQueueExitDestination;
  canDismiss: boolean;
}): {
  href: '/(tabs)/discover' | '/(tabs)/trips';
  dismissAll: boolean;
  mutatesQueue: false;
} {
  return {
    href: input.destination === 'trips' ? '/(tabs)/trips' : '/(tabs)/discover',
    dismissAll: input.canDismiss === true,
    mutatesQueue: false,
  };
}
