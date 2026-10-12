import {
  PRODUCTION_API_BASE_URL,
  resolveFlightReadConfiguration,
} from './productionFlights';

/**
 * A token provider for a future production identity provider. It is
 * intentionally separate from AuthContext and the app's demo JWT storage.
 */
export interface VerifiedProductionTokenProvider {
  getVerifiedAccessToken: () => Promise<string | null>;
}

export interface ProductionAuthApiOptions {
  tokenProvider: VerifiedProductionTokenProvider;
  baseUrl?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

export interface ProductionRequestOptions {
  signal?: AbortSignal;
}

export type ProductionHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ProductionUser {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  photoAssetPath: string | null;
  photoUrl: string | null;
  weightKg: number | null;
  membershipTier: 'none' | 'base' | 'plus' | 'concierge';
  linePassCount: number;
  referralCode: string;
  homeAirports: string[];
  notificationChannel: 'app' | 'email' | 'both';
  createdAt: string;
}

export interface UpdateProductionUserRequest {
  name?: string;
  email?: string;
  weightKg?: number | null;
  homeAirports?: string[];
  notificationChannel?: 'app' | 'email' | 'both';
  photoAssetPath?: string | null;
}

export interface ProductionMembershipPlan {
  id?: string;
  label?: string;
  priceAnnualUsd?: number;
  features?: string[];
  membershipCount?: number;
  [key: string]: unknown;
}

export interface ProductionMembershipStatus {
  tier: 'none' | 'base' | 'plus' | 'concierge';
  plans?: ProductionMembershipPlan[];
  family?: Record<string, unknown>;
  linePassCount: number;
  renewalDate?: string;
  pendingTier?: 'base' | 'plus' | 'cancelled';
  features: string[];
  totalSavedUsd: number;
  lifetimeCompletedFlights: number;
  annualFlightAllowance: number;
  flightsThisYear: number;
}

export interface ProductionFlightSummary {
  id?: string;
  fromAirport?: string;
  fromCity?: string;
  toAirport?: string;
  toCity?: string;
  departureDate?: string;
  departureTime?: string;
  status?: string;
  [key: string]: unknown;
}

export interface ProductionManifestProgress {
  requiredCount: number;
  completedCount: number;
  isComplete: boolean;
  version: number;
  submittedAt?: string | null;
  deliveryStatus?: 'delivered' | 'demo_recorded' | null;
}

export interface ProductionTrip {
  id: string;
  flightId: string;
  flight?: ProductionFlightSummary;
  status: 'upcoming' | 'completed' | 'cancelled';
  bookedAt: string;
  cleaningFeeUsd: number;
  manifest?: ProductionManifestProgress;
}

export interface ProductionCancelBookingResponse {
  success: boolean;
  passRefunded: boolean;
  linePassCount: number;
  trip?: ProductionTrip;
}

export interface ProductionPassenger {
  passengerOrder: number;
  firstName: string;
  lastName: string;
  phone?: string | null;
  email?: string | null;
  dateOfBirth?: string | null;
  weightKg?: number | null;
}

export interface ProductionPetManifest {
  weightLb: number | null;
  crateLengthIn: number | null;
  crateWidthIn: number | null;
  crateHeightIn: number | null;
}

export interface ProductionPassengerManifest {
  tripId: string;
  requiredCount: number;
  completedCount: number;
  isComplete: boolean;
  international: boolean;
  bringingPet: boolean;
  pet?: ProductionPetManifest | null;
  passengers: ProductionPassenger[];
  version: number;
  submittedAt?: string | null;
  deliveryStatus?: 'delivered' | 'demo_recorded' | null;
  operationsNotified?: boolean;
}

export interface ProductionPassengerInput {
  passengerOrder: number;
  firstName: string;
  lastName: string;
  phone?: string | null;
  email?: string | null;
  dateOfBirth?: string | null;
  weightKg?: number | null;
}

export interface SaveProductionManifestRequest {
  passengers: ProductionPassengerInput[];
  pet?: Partial<ProductionPetManifest>;
}

export interface ProductionSavedPassenger {
  id: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  email?: string | null;
  weightKg: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductionSavedPassengerInput {
  firstName: string;
  lastName: string;
  phone?: string | null;
  email?: string | null;
  weightKg: number;
}

export interface ProductionQueueMember {
  initials: string;
  position: number;
}

export interface ProductionQueueEntry {
  id: string;
  flightId: string;
  flight?: ProductionFlightSummary;
  position: number;
  totalInQueue: number;
  status: 'waiting' | 'confirmed' | 'cancelled' | 'expired';
  usedLinePass?: boolean;
  usedFamilyPass?: boolean;
  familyPassCycle?: string | null;
  createdAt: string;
  movementHistory?: Array<Record<string, unknown>>;
  queueMembers?: ProductionQueueMember[];
  bringingPet?: boolean;
  petFeeAcknowledged?: boolean;
  petWeightLbs?: number | null;
  petCrateLengthIn?: number | null;
  petCrateWidthIn?: number | null;
  petCrateHeightIn?: number | null;
}

export interface ProductionJoinQueueRequest {
  flightId: string;
  useLinePass?: boolean;
  passengers?: number;
  acceptIntlFee?: boolean;
  bringingPet: boolean;
  petFeeAcknowledged?: boolean;
  petWeightLbs?: number;
  petCrateLengthIn?: number;
  petCrateWidthIn?: number;
  petCrateHeightIn?: number;
}

export interface ProductionCancelQueueResponse {
  success: boolean;
}

export interface ProductionUsePassResponse extends ProductionQueueEntry {
  linePassCount: number;
  usedFamilyPass?: boolean;
  alreadyConfirmed?: boolean;
  trip?: ProductionTrip;
}

export class ProductionAuthRequestError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'token'
      | 'network'
      | 'timeout'
      | 'cancelled'
      | 'http'
      | 'session_expired'
      | 'invalid_json'
      | 'invalid_schema',
  ) {
    super(message);
    this.name = 'ProductionAuthRequestError';
  }
}

export class ProductionAuthHttpError extends ProductionAuthRequestError {
  constructor(readonly status: number) {
    super(`Authenticated production request failed (HTTP ${status}).`, status === 401 ? 'session_expired' : 'http');
    this.name = 'ProductionAuthHttpError';
  }
}

export class ProductionAuthTimeoutError extends ProductionAuthRequestError {
  constructor(readonly timeoutMs: number) {
    super(`Authenticated production request timed out after ${timeoutMs} ms.`, 'timeout');
    this.name = 'ProductionAuthTimeoutError';
  }
}

export class ProductionAuthCancelledError extends ProductionAuthRequestError {
  constructor() {
    super('Authenticated production request was cancelled.', 'cancelled');
    this.name = 'ProductionAuthCancelledError';
  }
}

export class ProductionAuthNetworkError extends ProductionAuthRequestError {
  constructor() {
    super('Authenticated production request could not reach the service.', 'network');
    this.name = 'ProductionAuthNetworkError';
  }
}

export class ProductionAuthInvalidJsonError extends ProductionAuthRequestError {
  constructor() {
    super('Authenticated production response was not valid JSON.', 'invalid_json');
    this.name = 'ProductionAuthInvalidJsonError';
  }
}

export class ProductionAuthSchemaError extends ProductionAuthRequestError {
  constructor(readonly field: string) {
    super(`Authenticated production response did not match the API contract (${field}).`, 'invalid_schema');
    this.name = 'ProductionAuthSchemaError';
  }
}

export const PRODUCTION_AUTH_TIMEOUT_MS = 10_000;
export const PRODUCTION_AUTH_PATHS = {
  me: '/auth/me',
  membership: '/membership',
  trips: '/trips',
  passengers: '/passengers',
  queueStatus: '/queue/status',
} as const;

type Validator<T> = (value: unknown) => T;

function schemaFailure(field: string): never {
  throw new TypeError(field);
}

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return schemaFailure(field);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== 'string') return schemaFailure(field);
  return value;
}

function numberValue(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return schemaFailure(field);
  return value;
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') return schemaFailure(field);
  return value;
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) return schemaFailure(field);
  return value.map((item, index) => stringValue(item, `${field}[${index}]`));
}

function nullableString(value: unknown, field: string): string | null {
  return value === null ? null : stringValue(value, field);
}

function nullableNumber(value: unknown, field: string): number | null {
  return value === null ? null : numberValue(value, field);
}

function enumValue<T extends string>(
  value: unknown,
  values: readonly T[],
  field: string,
): T {
  if (typeof value !== 'string' || !values.includes(value as T)) return schemaFailure(field);
  return value as T;
}

function parseUser(value: unknown): ProductionUser {
  const raw = objectValue(value, 'user');
  const tier = enumValue(raw.membershipTier, ['none', 'base', 'plus', 'concierge'] as const, 'user.membershipTier');
  const notificationChannel = enumValue(raw.notificationChannel, ['app', 'email', 'both'] as const, 'user.notificationChannel');
  if (raw.email !== undefined && raw.email !== null && typeof raw.email !== 'string') schemaFailure('user.email');
  return {
    id: stringValue(raw.id, 'user.id'),
    name: stringValue(raw.name, 'user.name'),
    phone: stringValue(raw.phone, 'user.phone'),
    ...(raw.email === undefined ? {} : { email: raw.email as string | null }),
    photoAssetPath: nullableString(raw.photoAssetPath, 'user.photoAssetPath'),
    photoUrl: nullableString(raw.photoUrl, 'user.photoUrl'),
    weightKg: nullableNumber(raw.weightKg, 'user.weightKg'),
    membershipTier: tier,
    linePassCount: numberValue(raw.linePassCount, 'user.linePassCount'),
    referralCode: stringValue(raw.referralCode, 'user.referralCode'),
    homeAirports: stringArray(raw.homeAirports, 'user.homeAirports'),
    notificationChannel,
    createdAt: stringValue(raw.createdAt, 'user.createdAt'),
  };
}

function parseMembership(value: unknown): ProductionMembershipStatus {
  const raw = objectValue(value, 'membership');
  const tier = enumValue(raw.tier, ['none', 'base', 'plus', 'concierge'] as const, 'membership.tier');
  const pendingTier = raw.pendingTier === undefined
    ? undefined
    : enumValue(raw.pendingTier, ['base', 'plus', 'cancelled'] as const, 'membership.pendingTier');
  if (raw.family !== undefined) objectValue(raw.family, 'membership.family');
  if (raw.plans !== undefined && !Array.isArray(raw.plans)) schemaFailure('membership.plans');
  return {
    tier,
    ...(raw.plans === undefined ? {} : { plans: raw.plans as ProductionMembershipPlan[] }),
    ...(raw.family === undefined ? {} : { family: raw.family as Record<string, unknown> }),
    linePassCount: numberValue(raw.linePassCount, 'membership.linePassCount'),
    ...(raw.renewalDate === undefined ? {} : { renewalDate: stringValue(raw.renewalDate, 'membership.renewalDate') }),
    ...(pendingTier === undefined ? {} : { pendingTier }),
    features: stringArray(raw.features, 'membership.features'),
    totalSavedUsd: numberValue(raw.totalSavedUsd, 'membership.totalSavedUsd'),
    lifetimeCompletedFlights: numberValue(raw.lifetimeCompletedFlights, 'membership.lifetimeCompletedFlights'),
    annualFlightAllowance: numberValue(raw.annualFlightAllowance, 'membership.annualFlightAllowance'),
    flightsThisYear: numberValue(raw.flightsThisYear, 'membership.flightsThisYear'),
  };
}

function parseManifestProgress(value: unknown, field: string): ProductionManifestProgress {
  const raw = objectValue(value, field);
  const deliveryStatus = raw.deliveryStatus === undefined || raw.deliveryStatus === null
    ? raw.deliveryStatus as null | undefined
    : enumValue(raw.deliveryStatus, ['delivered', 'demo_recorded'] as const, `${field}.deliveryStatus`);
  if (raw.submittedAt !== undefined && raw.submittedAt !== null && typeof raw.submittedAt !== 'string') {
    schemaFailure(`${field}.submittedAt`);
  }
  return {
    requiredCount: numberValue(raw.requiredCount, `${field}.requiredCount`),
    completedCount: numberValue(raw.completedCount, `${field}.completedCount`),
    isComplete: booleanValue(raw.isComplete, `${field}.isComplete`),
    version: numberValue(raw.version, `${field}.version`),
    ...(raw.submittedAt === undefined ? {} : { submittedAt: raw.submittedAt as string | null }),
    ...(deliveryStatus === undefined ? {} : { deliveryStatus }),
  };
}

function parseTrip(value: unknown, field: string): ProductionTrip {
  const raw = objectValue(value, field);
  const status = enumValue(raw.status, ['upcoming', 'completed', 'cancelled'] as const, `${field}.status`);
  if (raw.flight !== undefined) objectValue(raw.flight, `${field}.flight`);
  return {
    id: stringValue(raw.id, `${field}.id`),
    flightId: stringValue(raw.flightId, `${field}.flightId`),
    ...(raw.flight === undefined ? {} : { flight: raw.flight as ProductionFlightSummary }),
    status,
    bookedAt: stringValue(raw.bookedAt, `${field}.bookedAt`),
    cleaningFeeUsd: numberValue(raw.cleaningFeeUsd, `${field}.cleaningFeeUsd`),
    ...(raw.manifest == null ? {} : { manifest: parseManifestProgress(raw.manifest, `${field}.manifest`) }),
  };
}

function parsePassenger(value: unknown, field: string): ProductionPassenger {
  const raw = objectValue(value, field);
  for (const key of ['phone', 'email', 'dateOfBirth'] as const) {
    if (raw[key] !== undefined && raw[key] !== null && typeof raw[key] !== 'string') schemaFailure(`${field}.${key}`);
  }
  if (raw.weightKg !== undefined && raw.weightKg !== null) numberValue(raw.weightKg, `${field}.weightKg`);
  return {
    passengerOrder: numberValue(raw.passengerOrder, `${field}.passengerOrder`),
    firstName: stringValue(raw.firstName, `${field}.firstName`),
    lastName: stringValue(raw.lastName, `${field}.lastName`),
    ...(raw.phone === undefined ? {} : { phone: raw.phone as string | null }),
    ...(raw.email === undefined ? {} : { email: raw.email as string | null }),
    ...(raw.dateOfBirth === undefined ? {} : { dateOfBirth: raw.dateOfBirth as string | null }),
    ...(raw.weightKg === undefined ? {} : { weightKg: raw.weightKg as number | null }),
  };
}

function parsePet(value: unknown, field: string): ProductionPetManifest {
  const raw = objectValue(value, field);
  return {
    weightLb: nullableNumber(raw.weightLb, `${field}.weightLb`),
    crateLengthIn: nullableNumber(raw.crateLengthIn, `${field}.crateLengthIn`),
    crateWidthIn: nullableNumber(raw.crateWidthIn, `${field}.crateWidthIn`),
    crateHeightIn: nullableNumber(raw.crateHeightIn, `${field}.crateHeightIn`),
  };
}

function parseManifest(value: unknown): ProductionPassengerManifest {
  const raw = objectValue(value, 'manifest');
  if (!Array.isArray(raw.passengers)) schemaFailure('manifest.passengers');
  if (raw.pet !== undefined && raw.pet !== null) objectValue(raw.pet, 'manifest.pet');
  if (raw.submittedAt !== undefined && raw.submittedAt !== null && typeof raw.submittedAt !== 'string') {
    schemaFailure('manifest.submittedAt');
  }
  const deliveryStatus = raw.deliveryStatus === undefined || raw.deliveryStatus === null
    ? raw.deliveryStatus as null | undefined
    : enumValue(raw.deliveryStatus, ['delivered', 'demo_recorded'] as const, 'manifest.deliveryStatus');
  if (raw.operationsNotified !== undefined && typeof raw.operationsNotified !== 'boolean') {
    schemaFailure('manifest.operationsNotified');
  }
  return {
    tripId: stringValue(raw.tripId, 'manifest.tripId'),
    requiredCount: numberValue(raw.requiredCount, 'manifest.requiredCount'),
    completedCount: numberValue(raw.completedCount, 'manifest.completedCount'),
    isComplete: booleanValue(raw.isComplete, 'manifest.isComplete'),
    international: booleanValue(raw.international, 'manifest.international'),
    bringingPet: booleanValue(raw.bringingPet, 'manifest.bringingPet'),
    ...(raw.pet === undefined ? {} : { pet: raw.pet === null ? null : parsePet(raw.pet, 'manifest.pet') }),
    passengers: raw.passengers.map((passenger, index) => parsePassenger(passenger, `manifest.passengers[${index}]`)),
    version: numberValue(raw.version, 'manifest.version'),
    ...(raw.submittedAt === undefined ? {} : { submittedAt: raw.submittedAt as string | null }),
    ...(deliveryStatus === undefined ? {} : { deliveryStatus }),
    ...(raw.operationsNotified === undefined ? {} : { operationsNotified: raw.operationsNotified as boolean }),
  };
}

function parseSavedPassenger(value: unknown, field: string): ProductionSavedPassenger {
  const raw = objectValue(value, field);
  for (const key of ['phone', 'email'] as const) {
    if (raw[key] !== undefined && raw[key] !== null && typeof raw[key] !== 'string') schemaFailure(`${field}.${key}`);
  }
  return {
    id: stringValue(raw.id, `${field}.id`),
    firstName: stringValue(raw.firstName, `${field}.firstName`),
    lastName: stringValue(raw.lastName, `${field}.lastName`),
    ...(raw.phone === undefined ? {} : { phone: raw.phone as string | null }),
    ...(raw.email === undefined ? {} : { email: raw.email as string | null }),
    weightKg: numberValue(raw.weightKg, `${field}.weightKg`),
    createdAt: stringValue(raw.createdAt, `${field}.createdAt`),
    updatedAt: stringValue(raw.updatedAt, `${field}.updatedAt`),
  };
}

function parseQueueEntry(value: unknown, field: string): ProductionQueueEntry {
  const raw = objectValue(value, field);
  const status = enumValue(raw.status, ['waiting', 'confirmed', 'cancelled', 'expired'] as const, `${field}.status`);
  if (raw.flight !== undefined && raw.flight !== null) objectValue(raw.flight, `${field}.flight`);
  if (raw.queueMembers !== undefined) {
    if (!Array.isArray(raw.queueMembers)) schemaFailure(`${field}.queueMembers`);
    raw.queueMembers.forEach((member, index) => {
      const item = objectValue(member, `${field}.queueMembers[${index}]`);
      stringValue(item.initials, `${field}.queueMembers[${index}].initials`);
      numberValue(item.position, `${field}.queueMembers[${index}].position`);
    });
  }
  if (raw.movementHistory !== undefined && !Array.isArray(raw.movementHistory)) schemaFailure(`${field}.movementHistory`);
  return {
    id: stringValue(raw.id, `${field}.id`),
    flightId: stringValue(raw.flightId, `${field}.flightId`),
    ...(raw.flight === undefined || raw.flight === null ? {} : { flight: raw.flight as ProductionFlightSummary }),
    position: numberValue(raw.position, `${field}.position`),
    totalInQueue: numberValue(raw.totalInQueue, `${field}.totalInQueue`),
    status,
    ...(raw.usedLinePass === undefined ? {} : { usedLinePass: booleanValue(raw.usedLinePass, `${field}.usedLinePass`) }),
    ...(raw.usedFamilyPass === undefined ? {} : { usedFamilyPass: booleanValue(raw.usedFamilyPass, `${field}.usedFamilyPass`) }),
    ...(raw.familyPassCycle === undefined ? {} : { familyPassCycle: nullableString(raw.familyPassCycle, `${field}.familyPassCycle`) }),
    createdAt: stringValue(raw.createdAt, `${field}.createdAt`),
    ...(raw.movementHistory === undefined ? {} : { movementHistory: raw.movementHistory as Array<Record<string, unknown>> }),
    ...(raw.queueMembers === undefined ? {} : { queueMembers: raw.queueMembers as ProductionQueueMember[] }),
    ...(raw.bringingPet === undefined ? {} : { bringingPet: booleanValue(raw.bringingPet, `${field}.bringingPet`) }),
    ...(raw.petFeeAcknowledged === undefined ? {} : { petFeeAcknowledged: booleanValue(raw.petFeeAcknowledged, `${field}.petFeeAcknowledged`) }),
    ...(['petWeightLbs', 'petCrateLengthIn', 'petCrateWidthIn', 'petCrateHeightIn'] as const).reduce(
      (result, key) => raw[key] === undefined ? result : { ...result, [key]: nullableNumber(raw[key], `${field}.${key}`) },
      {} as Pick<ProductionQueueEntry, 'petWeightLbs' | 'petCrateLengthIn' | 'petCrateWidthIn' | 'petCrateHeightIn'>,
    ),
  };
}

function parseArray<T>(value: unknown, field: string, parse: (item: unknown, path: string) => T): T[] {
  if (!Array.isArray(value)) return schemaFailure(field);
  return value.map((item, index) => parse(item, `${field}[${index}]`));
}

function parseBooleanResponse(value: unknown, field: string): { success: boolean } {
  const raw = objectValue(value, field);
  return { success: booleanValue(raw.success, `${field}.success`) };
}

function parseCancelBooking(value: unknown): ProductionCancelBookingResponse {
  const raw = objectValue(value, 'cancelBooking');
  return {
    success: booleanValue(raw.success, 'cancelBooking.success'),
    passRefunded: booleanValue(raw.passRefunded, 'cancelBooking.passRefunded'),
    linePassCount: numberValue(raw.linePassCount, 'cancelBooking.linePassCount'),
    ...(raw.trip === undefined ? {} : { trip: parseTrip(raw.trip, 'cancelBooking.trip') }),
  };
}

/**
 * Creates a dormant-by-default production authenticated API. Construction
 * neither reads a token nor sends a request; every method must be called
 * explicitly. No React Query hook or screen constructs or invokes this client.
 */
export function createAuthenticatedProductionApiClient(options: ProductionAuthApiOptions) {
  if (!options.tokenProvider || typeof options.tokenProvider.getVerifiedAccessToken !== 'function') {
    throw new TypeError('A verified production token provider is required.');
  }
  const timeoutMs = options.timeoutMs ?? PRODUCTION_AUTH_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('Production auth timeout must be a positive finite number.');
  }
  const baseUrl = resolveFlightReadConfiguration({
    isDev: false,
    mode: 'production',
    baseUrl: options.baseUrl ??
      process.env.EXPO_PUBLIC_BLUEBIRD_FLIGHT_API_BASE_URL ??
      PRODUCTION_API_BASE_URL,
  }).baseUrl;
  const fetcher = options.fetcher ?? fetch;

  async function request<T>(
    path: string,
    method: ProductionHttpMethod,
    validator: Validator<T>,
    requestOptions: ProductionRequestOptions = {},
    body?: unknown,
  ): Promise<T> {
    if (requestOptions.signal?.aborted) throw new ProductionAuthCancelledError();
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let removeExternalAbort = () => {};
    const races: Array<Promise<never>> = [];
    races.push(new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new ProductionAuthTimeoutError(timeoutMs));
      }, timeoutMs);
    }));
    if (requestOptions.signal) {
      races.push(new Promise<never>((_, reject) => {
        const onAbort = () => {
          controller.abort();
          reject(new ProductionAuthCancelledError());
        };
        requestOptions.signal?.addEventListener('abort', onAbort, { once: true });
        removeExternalAbort = () => requestOptions.signal?.removeEventListener('abort', onAbort);
      }));
    }

    const operation = (async () => {
      let token: string | null;
      try {
        token = await options.tokenProvider.getVerifiedAccessToken();
      } catch {
        throw new ProductionAuthRequestError('Production access token is unavailable.', 'token');
      }
      if (controller.signal.aborted) throw new ProductionAuthCancelledError();
      if (token === null || token.trim() === '') {
        throw new ProductionAuthRequestError('Production access token is unavailable.', 'token');
      }
      if (/\s/.test(token)) {
        throw new ProductionAuthRequestError('Production access token is invalid.', 'token');
      }

      let response: Response;
      try {
        response = await fetcher(`${baseUrl}${path}`, {
          method,
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          credentials: 'omit',
          signal: controller.signal,
        });
      } catch {
        if (controller.signal.aborted) throw new ProductionAuthCancelledError();
        throw new ProductionAuthNetworkError();
      }

      if (!response.ok) throw new ProductionAuthHttpError(response.status);
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        throw new ProductionAuthInvalidJsonError();
      }
      try {
        return validator(json);
      } catch (error) {
        if (error instanceof ProductionAuthRequestError) throw error;
        throw new ProductionAuthSchemaError(error instanceof Error ? error.message : 'response');
      }
    })();

    try {
      return await Promise.race([operation, ...races]);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      removeExternalAbort();
    }
  }

  const tripPath = (tripId: string) => `/trips/${encodeURIComponent(tripId)}`;
  const passengerPath = (passengerId: string) => `/passengers/${encodeURIComponent(passengerId)}`;
  const queuePath = (entryId: string) => `/queue/${encodeURIComponent(entryId)}`;

  return {
    getMe: (requestOptions?: ProductionRequestOptions) =>
      request(PRODUCTION_AUTH_PATHS.me, 'GET', parseUser, requestOptions),
    updateMe: (data: UpdateProductionUserRequest, requestOptions?: ProductionRequestOptions) =>
      request(PRODUCTION_AUTH_PATHS.me, 'PATCH', parseUser, requestOptions, data),
    getMembership: (requestOptions?: ProductionRequestOptions) =>
      request(PRODUCTION_AUTH_PATHS.membership, 'GET', parseMembership, requestOptions),
    listTrips: (requestOptions?: ProductionRequestOptions) =>
      request(PRODUCTION_AUTH_PATHS.trips, 'GET', (value) => parseArray(value, 'trips', parseTrip), requestOptions),
    cancelTrip: (tripId: string, requestOptions?: ProductionRequestOptions) =>
      request(`${tripPath(tripId)}/cancel`, 'POST', parseCancelBooking, requestOptions),
    getTripManifest: (tripId: string, requestOptions?: ProductionRequestOptions) =>
      request(`${tripPath(tripId)}/manifest`, 'GET', parseManifest, requestOptions),
    saveTripManifest: (tripId: string, data: SaveProductionManifestRequest, requestOptions?: ProductionRequestOptions) =>
      request(`${tripPath(tripId)}/manifest`, 'PUT', parseManifest, requestOptions, data),
    submitTripManifest: (tripId: string, requestOptions?: ProductionRequestOptions) =>
      request(`${tripPath(tripId)}/manifest/submit`, 'POST', parseManifest, requestOptions),
    listSavedPassengers: (requestOptions?: ProductionRequestOptions) =>
      request(PRODUCTION_AUTH_PATHS.passengers, 'GET', (value) => parseArray(value, 'passengers', parseSavedPassenger), requestOptions),
    createSavedPassenger: (data: ProductionSavedPassengerInput, requestOptions?: ProductionRequestOptions) =>
      request(PRODUCTION_AUTH_PATHS.passengers, 'POST', (value) => parseSavedPassenger(value, 'passenger'), requestOptions, data),
    updateSavedPassenger: (passengerId: string, data: ProductionSavedPassengerInput, requestOptions?: ProductionRequestOptions) =>
      request(passengerPath(passengerId), 'PUT', (value) => parseSavedPassenger(value, 'passenger'), requestOptions, data),
    deleteSavedPassenger: (passengerId: string, requestOptions?: ProductionRequestOptions) =>
      request(passengerPath(passengerId), 'DELETE', (value) => parseBooleanResponse(value, 'deletePassenger'), requestOptions),
    getQueueStatus: (requestOptions?: ProductionRequestOptions) =>
      request(PRODUCTION_AUTH_PATHS.queueStatus, 'GET', (value) => parseArray(value, 'queue', parseQueueEntry), requestOptions),
    joinQueue: (data: ProductionJoinQueueRequest, requestOptions?: ProductionRequestOptions) =>
      request('/queue/join', 'POST', (value) => parseQueueEntry(value, 'queueEntry'), requestOptions, data),
    leaveQueue: (entryId: string, requestOptions?: ProductionRequestOptions) =>
      request(queuePath(entryId), 'DELETE', (value) => parseBooleanResponse(value, 'cancelQueue'), requestOptions),
    useLinePass: (entryId: string, requestOptions?: ProductionRequestOptions) =>
      request(`${queuePath(entryId)}/use-pass`, 'POST', (value) => {
        const raw = objectValue(value, 'usePass');
        const entry = parseQueueEntry(raw, 'usePass');
        if (raw.alreadyConfirmed !== undefined) booleanValue(raw.alreadyConfirmed, 'usePass.alreadyConfirmed');
        if (raw.usedFamilyPass !== undefined) booleanValue(raw.usedFamilyPass, 'usePass.usedFamilyPass');
        if (raw.trip !== undefined) parseTrip(raw.trip, 'usePass.trip');
        return {
          ...entry,
          linePassCount: numberValue(raw.linePassCount, 'usePass.linePassCount'),
          ...(raw.usedFamilyPass === undefined ? {} : { usedFamilyPass: raw.usedFamilyPass as boolean }),
          ...(raw.alreadyConfirmed === undefined ? {} : { alreadyConfirmed: raw.alreadyConfirmed as boolean }),
          ...(raw.trip === undefined ? {} : { trip: parseTrip(raw.trip, 'usePass.trip') }),
        };
      }, requestOptions),
  };
}

/** Member identifiers are part of each opt-in cache key to prevent cross-account reuse. */
export function productionAuthenticatedQueryKey(
  memberId: string,
  ...segments: readonly (string | number)[]
): readonly ['production-auth', string, ...(string | number)[]] {
  const subject = memberId.trim();
  if (!subject) throw new TypeError('A member ID is required for authenticated cache isolation.');
  return ['production-auth', subject, ...segments] as const;
}
