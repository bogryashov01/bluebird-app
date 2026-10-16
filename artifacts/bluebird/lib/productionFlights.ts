import type { Flight } from '@workspace/api-client-react';
import { requestProductionJson } from './productionRequestTransport';
import {
  getMainBluebirdApiConfiguration,
  validateMainBluebirdApiBaseUrl,
  type MainBluebirdApiEnvironment,
} from './mainBluebirdApiConfig';

export const PRODUCTION_API_BASE_URL = 'https://bluebirdjets.com/api';
export const PRODUCTION_API_ORIGIN = 'https://bluebirdjets.com';

export type FlightReadMode = 'production' | 'local';

export const PRODUCTION_FLIGHTS_QUERY_KEY = ['production-empty-legs'] as const;

export interface FlightReadConfiguration {
  mode: FlightReadMode;
  baseUrl: string;
}

export interface FlightReadConfigInput {
  isDev: boolean;
  mode?: string;
  baseUrl?: string | null;
}

export interface ProductionFlightResponse {
  id: number;
  tripId?: number | string | null;
  status?: string | null;
  originAirport?: string | null;
  originCity?: string | null;
  originTz?: string | null;
  destinationAirport?: string | null;
  destinationCity?: string | null;
  destinationTz?: string | null;
  departureTime?: string | null;
  arrivalTime?: string | null;
  queueClosesAt?: string | null;
  durationHours?: number | null;
  aircraftType?: string | null;
  aircraftTypeName?: string | null;
  aircraftTypeCode?: string | null;
  aircraftGalleryUrls?: Array<string | null> | null;
  aircraftGalleryAlts?: Array<string | null> | null;
  aircraftTailPhotoSlot?: number | null;
  photoKey?: string | null;
  queueCount?: number | null;
  memberQueueCount?: number | null;
  userInQueue?: boolean | null;
  viewerQueuePosition?: number | null;
  lockedForFreeUsers?: boolean | null;
  lineSkipPriceUsd?: number | null;
  lineSkipSold?: boolean | null;
  viewerHasLineSkip?: boolean | null;
  internationalPassPriceUsd?: number | null;
  internationalPassRequired?: boolean | null;
  viewerHasInternationalPass?: boolean | null;
  viewerIsBookedPassenger?: boolean | null;
  viewerIsEffectiveWinner?: boolean | null;
  viewerConfirmationStatus?: string | null;
  awardedAt?: string | null;
  originFboName?: string | null;
  originFboAddress?: string | null;
  destinationFboName?: string | null;
  destinationFboAddress?: string | null;
  isInternational?: boolean | null;
  pricePerHour?: number | null;
  totalPrice?: number | null;
  msrpUsd?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface ProductionAirportResponse {
  code: string;
  name: string;
  city: string | null;
  state: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  tz: string | null;
  longestRunwayFt: number | null;
}

export interface ProductionAirportCityGroupResponse {
  key: string;
  displayName: string;
  country: string;
  tier: number;
  airportCodes: string[];
  airportLabels: string[];
}

export interface FlightView {
  id: string;
  source: FlightReadMode;
  status: string | null;
  queueClosesAt: string | null;
  queueCount: number | null;
  memberQueueCount: number | null;
  userInQueue: boolean | null;
  viewerQueuePosition: number | null;
  lockedForFreeUsers: boolean | null;
  lineSkipPriceUsd: number | null;
  lineSkipSold: boolean | null;
  viewerHasLineSkip: boolean | null;
  internationalPassPriceUsd: number | null;
  internationalPassRequired: boolean | null;
  viewerHasInternationalPass: boolean | null;
  viewerIsBookedPassenger: boolean | null;
  viewerIsEffectiveWinner: boolean | null;
  viewerConfirmationStatus: string | null;
  awardedAt: string | null;
  fromAirport: string | null;
  fromCity: string | null;
  toAirport: string | null;
  toCity: string | null;
  originTz: string | null;
  destinationTz: string | null;
  departureDate: string | null;
  departureTime: string | null;
  departureTimeZone: string | null;
  arrivalDate: string | null;
  arrivalTime: string | null;
  arrivalTimeZone: string | null;
  duration: string | null;
  aircraftType: string | null;
  aircraftTypeName: string | null;
  aircraftTypeCode: string | null;
  imageUrl: string | null;
  featured: boolean | null;
  international: boolean | null;
  internationalFeeUsd: number | null;
  rangeNm: number | null;
  seatsAvailable: number | null;
  totalPrice: number | null;
  msrpUsd: number | null;
  pricePerHour: number | null;
}

export type FlightImagePresentation = 'provided' | 'local-fallback' | 'unavailable';

export function getFlightImagePresentation(
  flight: Pick<FlightView, 'source' | 'imageUrl'>,
): FlightImagePresentation {
  if (flight.imageUrl) return 'provided';
  return flight.source === 'local' ? 'local-fallback' : 'unavailable';
}

export interface AirportRecord extends ProductionAirportResponse {}

export interface ReadRequestOptions {
  signal?: AbortSignal;
  baseUrl?: string;
  environment?: MainBluebirdApiEnvironment;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

export const PRODUCTION_READ_TIMEOUT_MS = 10_000;
const MAX_RETRY_AFTER_MS = 30_000;

export class ProductionReadTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Production read request timed out after ${timeoutMs} ms.`);
    this.name = 'ProductionReadTimeoutError';
  }
}

export class ProductionReadHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs: number | null,
  ) {
    super(`Production read request failed (HTTP ${status}).`);
    this.name = 'ProductionReadHttpError';
  }
}

export class ProductionReadNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductionReadNetworkError';
  }
}

export class ProductionReadInvalidJsonError extends Error {
  constructor() {
    super('Production read response was not valid JSON.');
    this.name = 'ProductionReadInvalidJsonError';
  }
}

export class ProductionReadCancelledError extends Error {
  constructor() {
    super('Production read request was cancelled.');
    this.name = 'AbortError';
  }
}

export class ProductionReadSchemaError extends Error {
  constructor(message: string) {
    super(`Production read response did not match the API contract (${message}).`);
    this.name = 'ProductionReadSchemaError';
  }
}

export class ProductionReadUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductionReadUnsupportedError';
  }
}

export type ProductionReadFailureKind =
  | 'network'
  | 'timeout'
  | 'authentication'
  | 'invalid-response'
  | 'temporarily-unavailable'
  | 'unsupported-empty-query'
  | 'request-failed';

export interface ProductionReadFailurePresentation {
  kind: ProductionReadFailureKind;
  message: string;
  retryable: boolean;
}

export function describeProductionReadFailure(
  error: unknown,
  subject: string,
): ProductionReadFailurePresentation {
  if (error instanceof ProductionReadUnsupportedError) {
    return {
      kind: 'unsupported-empty-query',
      message: `Search for ${subject} by name, city, or code. Browsing the full list isn’t available.`,
      retryable: false,
    };
  }
  if (error instanceof ProductionReadNetworkError) {
    return {
      kind: 'network',
      message: `Bluebird couldn’t reach ${subject}. Check your connection and try again.`,
      retryable: true,
    };
  }
  if (error instanceof ProductionReadTimeoutError) {
    return {
      kind: 'timeout',
      message: `The request for ${subject} timed out. Check your connection and try again.`,
      retryable: true,
    };
  }
  if (error instanceof ProductionReadHttpError) {
    if (error.status === 401 || error.status === 403) {
      return {
        kind: 'authentication',
        message: `Bluebird denied access to ${subject}. Check your sign-in and try again.`,
        retryable: false,
      };
    }
    if (error.status === 429 || error.status >= 500) {
      return {
        kind: 'temporarily-unavailable',
        message: `${subject} is temporarily unavailable. Please try again.`,
        retryable: true,
      };
    }
    return {
      kind: 'request-failed',
      message: `Bluebird couldn’t complete the request for ${subject}. Check your search and try again.`,
      retryable: false,
    };
  }
  if (
    error instanceof ProductionReadInvalidJsonError ||
    error instanceof ProductionReadSchemaError
  ) {
    return {
      kind: 'invalid-response',
      message: `Bluebird returned unreadable data for ${subject}. Please try again later.`,
      retryable: false,
    };
  }
  return {
    kind: 'request-failed',
    message: `Bluebird couldn’t load ${subject}. Please try again later.`,
    retryable: false,
  };
}

export type ProductionAirportSearchViewState =
  | { kind: 'configuration-unavailable' }
  | { kind: 'unsupported-empty-query' }
  | { kind: 'loading' }
  | { kind: 'error'; failure: ProductionReadFailurePresentation }
  | { kind: 'no-match' }
  | { kind: 'results' };

export function getProductionAirportSearchViewState(input: {
  configurationAvailable: boolean;
  query: string;
  isLoading: boolean;
  error?: unknown;
  resultCount: number;
}): ProductionAirportSearchViewState {
  if (!input.configurationAvailable) return { kind: 'configuration-unavailable' };
  if (!input.query.trim()) return { kind: 'unsupported-empty-query' };
  if (input.isLoading) return { kind: 'loading' };
  if (input.error) {
    return {
      kind: 'error',
      failure: describeProductionReadFailure(input.error, 'airport search'),
    };
  }
  return input.resultCount > 0 ? { kind: 'results' } : { kind: 'no-match' };
}

function abortError(): Error {
  return new ProductionReadCancelledError();
}

function retryAfterMilliseconds(response: Response): number | null {
  const value = response.headers.get('Retry-After')?.trim();
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

export function shouldRetryProductionRead(
  failureCount: number,
  error: unknown,
): boolean {
  if (failureCount >= 1) return false;
  if (
    error instanceof ProductionReadTimeoutError ||
    error instanceof ProductionReadNetworkError
  ) {
    return true;
  }
  if (error instanceof ProductionReadHttpError) {
    return error.status === 429 || error.status >= 500;
  }
  return false;
}

export function productionReadRetryDelay(
  attemptIndex: number,
  error: unknown,
): number {
  if (error instanceof ProductionReadHttpError && error.status === 429) {
    return Math.min(
      error.retryAfterMs ?? 1000 * 2 ** attemptIndex,
      MAX_RETRY_AFTER_MS,
    );
  }
  return Math.min(1000 * 2 ** attemptIndex, 5000);
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

export function resolveFlightReadConfiguration(
  input: FlightReadConfigInput,
): FlightReadConfiguration {
  const mode = input.mode ?? 'production';
  if (mode !== 'production' && mode !== 'local') {
    throw new Error('Flight read mode must be "production" or "local".');
  }

  // A development-only local selection can never retarget a production build.
  if (mode === 'local' && input.isDev) {
    return { mode: 'local', baseUrl: '' };
  }

  const rawBaseUrl = input.baseUrl?.trim() || PRODUCTION_API_BASE_URL;
  let parsed: URL;
  try {
    parsed = new URL(rawBaseUrl);
  } catch {
    throw new Error('The production flight API base URL is invalid.');
  }

  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'bluebirdjets.com' ||
    parsed.pathname.replace(/\/+$/, '') !== '/api' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('The production flight API must use https://bluebirdjets.com/api.');
  }

  return { mode: 'production', baseUrl: 'https://bluebirdjets.com/api' };
}

export function isLocalFlightReadMode(
  mode = process.env.EXPO_PUBLIC_BLUEBIRD_FLIGHT_READ_MODE,
  isDev = typeof __DEV__ !== 'undefined' && __DEV__,
): boolean {
  return isDev && mode === 'local';
}

function getString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new Error(`Production flight field "${field}" must be a string or null.`);
  }
  return value;
}

function getNumber(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Production flight field "${field}" must be a number or null.`);
  }
  return value;
}

function getBoolean(value: unknown, field: string): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'boolean') {
    throw new Error(`Production flight field "${field}" must be a boolean or null.`);
  }
  return value;
}

function getAirportCode(value: unknown, field: string): string | null {
  const code = getString(value, field)?.trim().toUpperCase();
  return code || null;
}

function dateTimeParts(
  timestamp: string | null | undefined,
  timeZone: string | null | undefined,
): { date: string; time: string; zone: string } | null {
  if (!timestamp) return null;
  const instant = new Date(timestamp);
  if (Number.isNaN(instant.valueOf())) return null;

  // When a timezone is missing or invalid, the ISO instant is still safely
  // displayable in UTC; never substitute the device's unrelated local zone.
  let effectiveZone = timeZone || 'UTC';
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: effectiveZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'short',
    });
  } catch {
    effectiveZone = 'UTC';
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: effectiveZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'short',
    });
  }

  const parts = Object.fromEntries(
    formatter.formatToParts(instant).map(({ type, value }) => [type, value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    zone: parts.timeZoneName || effectiveZone,
  };
}

function durationLabel(value: number | null): string | null {
  if (value === null || value < 0) return null;
  const totalMinutes = Math.round(value * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}

export function resolveAircraftImageUrl(
  imageUrl: string | null | undefined,
  origin = PRODUCTION_API_ORIGIN,
): string | null {
  if (typeof imageUrl !== 'string' || imageUrl.trim() === '') return null;
  const value = imageUrl.trim();
  // Keep absolute URLs byte-for-byte unchanged.
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return value;
  try {
    return new URL(value, `${trimTrailingSlashes(origin)}/`).toString();
  } catch {
    return null;
  }
}

function nullableStringArray(
  value: unknown,
  field: string,
): Array<string | null> | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    throw new Error(`Production flight field "${field}" must be an array or null.`);
  }
  return value.map((entry) => getString(entry, field));
}

export function mapProductionFlight(value: unknown): FlightView {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Production flight response must be an object.');
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'number' || !Number.isSafeInteger(raw.id) || raw.id <= 0) {
    throw new Error('Production flight id must be a positive numeric ID.');
  }

  const fromAirport = getAirportCode(raw.originAirport, 'originAirport');
  const toAirport = getAirportCode(raw.destinationAirport, 'destinationAirport');
  const fromCity = getString(raw.originCity, 'originCity');
  const toCity = getString(raw.destinationCity, 'destinationCity');
  const originTz = getString(raw.originTz, 'originTz');
  const destinationTz = getString(raw.destinationTz, 'destinationTz');
  const departureAt = getString(raw.departureTime, 'departureTime');
  const arrivalAt = getString(raw.arrivalTime, 'arrivalTime');
  const departure = dateTimeParts(departureAt, originTz);
  const arrival = dateTimeParts(arrivalAt, destinationTz);
  const gallery = nullableStringArray(raw.aircraftGalleryUrls, 'aircraftGalleryUrls');
  const imageUrl = gallery?.find((url) => !!url);
  const durationHours = getNumber(raw.durationHours, 'durationHours');

  return {
    id: String(raw.id),
    source: 'production',
    status: getString(raw.status, 'status'),
    queueClosesAt: getString(raw.queueClosesAt, 'queueClosesAt'),
    queueCount: getNumber(raw.queueCount, 'queueCount'),
    memberQueueCount: getNumber(raw.memberQueueCount, 'memberQueueCount'),
    userInQueue: getBoolean(raw.userInQueue, 'userInQueue'),
    viewerQueuePosition: getNumber(raw.viewerQueuePosition, 'viewerQueuePosition'),
    lockedForFreeUsers: getBoolean(raw.lockedForFreeUsers, 'lockedForFreeUsers'),
    lineSkipPriceUsd: getNumber(raw.lineSkipPriceUsd, 'lineSkipPriceUsd'),
    lineSkipSold: getBoolean(raw.lineSkipSold, 'lineSkipSold'),
    viewerHasLineSkip: getBoolean(raw.viewerHasLineSkip, 'viewerHasLineSkip'),
    internationalPassPriceUsd: getNumber(raw.internationalPassPriceUsd, 'internationalPassPriceUsd'),
    internationalPassRequired: getBoolean(raw.internationalPassRequired, 'internationalPassRequired'),
    viewerHasInternationalPass: getBoolean(raw.viewerHasInternationalPass, 'viewerHasInternationalPass'),
    viewerIsBookedPassenger: getBoolean(raw.viewerIsBookedPassenger, 'viewerIsBookedPassenger'),
    viewerIsEffectiveWinner: getBoolean(raw.viewerIsEffectiveWinner, 'viewerIsEffectiveWinner'),
    viewerConfirmationStatus: getString(raw.viewerConfirmationStatus, 'viewerConfirmationStatus'),
    awardedAt: getString(raw.awardedAt, 'awardedAt'),
    fromAirport,
    fromCity,
    toAirport,
    toCity,
    originTz,
    destinationTz,
    departureDate: departure?.date ?? null,
    departureTime: departure?.time ?? null,
    departureTimeZone: departure?.zone ?? null,
    arrivalDate: arrival?.date ?? null,
    arrivalTime: arrival?.time ?? null,
    arrivalTimeZone: arrival?.zone ?? null,
    duration: durationLabel(durationHours),
    aircraftType: getString(raw.aircraftType, 'aircraftType'),
    aircraftTypeName: getString(raw.aircraftTypeName, 'aircraftTypeName'),
    aircraftTypeCode: getString(raw.aircraftTypeCode, 'aircraftTypeCode'),
    imageUrl: resolveAircraftImageUrl(imageUrl),
    featured: null,
    international: getBoolean(raw.isInternational, 'isInternational'),
    internationalFeeUsd: null,
    rangeNm: null,
    seatsAvailable: null,
    totalPrice: getNumber(raw.totalPrice, 'totalPrice'),
    msrpUsd: getNumber(raw.msrpUsd, 'msrpUsd'),
    pricePerHour: getNumber(raw.pricePerHour, 'pricePerHour'),
  };
}

export function mapProductionFlights(value: unknown): FlightView[] {
  if (!Array.isArray(value)) {
    throw new Error('Production empty-leg response must be a flight array.');
  }
  return value.map(mapProductionFlight);
}

export function mapProductionAirport(value: unknown): AirportRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Production airport response must be an object.');
  }
  const airport = value as Record<string, unknown>;
  const code = typeof airport.code === 'string' ? airport.code.trim().toUpperCase() : '';
  const name = typeof airport.name === 'string' ? airport.name.trim() : '';
  const latitude = getNumber(airport.latitude, 'airport.latitude');
  const longitude = getNumber(airport.longitude, 'airport.longitude');
  if (
    !code ||
    !name ||
    latitude === null ||
    longitude === null ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error('Production airport response is missing valid coordinates or identity.');
  }
  return {
    code,
    name,
    city: getString(airport.city, 'airport.city'),
    state: getString(airport.state, 'airport.state'),
    country: getString(airport.country, 'airport.country'),
    latitude,
    longitude,
    tz: getString(airport.tz, 'airport.tz'),
    longestRunwayFt: getNumber(airport.longestRunwayFt, 'airport.longestRunwayFt'),
  };
}

export function mapProductionAirports(value: unknown): AirportRecord[] {
  if (!Array.isArray(value)) {
    throw new Error('Production airport lookup response must be an array.');
  }
  return value.map(mapProductionAirport);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Production airport field "${field}" must be a non-empty string.`);
  }
  return value.trim();
}

function mapAirportCodeArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Production airport field "${field}" must be an array.`);
  }
  return value.map((entry, index) => {
    const code = nonEmptyString(entry, `${field}[${index}]`).toUpperCase();
    if (!/^[A-Z0-9-]{2,12}$/.test(code)) {
      throw new Error(`Production airport field "${field}[${index}]" is not a valid airport code.`);
    }
    return code;
  });
}

function mapNonEmptyStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Production airport field "${field}" must be an array.`);
  }
  return value.map((entry, index) =>
    nonEmptyString(entry, `${field}[${index}]`),
  );
}

export function mapProductionAirportCityGroup(
  value: unknown,
): ProductionAirportCityGroupResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Production airport city group must be an object.');
  }
  const raw = value as Record<string, unknown>;
  const tier = getNumber(raw.tier, 'airportCityGroup.tier');
  if (tier === null || !Number.isSafeInteger(tier) || tier < 0) {
    throw new Error('Production airport city group tier must be a non-negative integer.');
  }
  return {
    key: nonEmptyString(raw.key, 'airportCityGroup.key'),
    displayName: nonEmptyString(raw.displayName, 'airportCityGroup.displayName'),
    country: nonEmptyString(raw.country, 'airportCityGroup.country'),
    tier,
    airportCodes: mapAirportCodeArray(raw.airportCodes, 'airportCityGroup.airportCodes'),
    airportLabels: mapNonEmptyStringArray(
      raw.airportLabels,
      'airportCityGroup.airportLabels',
    ),
  };
}

export function mapProductionAirportCityGroups(
  value: unknown,
): ProductionAirportCityGroupResponse[] {
  if (!Array.isArray(value)) {
    throw new Error('Production airport cities response must be an array.');
  }
  return value.map(mapProductionAirportCityGroup);
}

export function getFlightAirportCodes(flights: readonly FlightView[]): string[] {
  return [...new Set(
    flights.flatMap((flight) => [flight.fromAirport, flight.toAirport])
      .filter((code): code is string => typeof code === 'string' && code.trim() !== '')
      .map((code) => code.trim().toUpperCase()),
  )];
}

export function mapLocalFlight(flight: Flight): FlightView {
  const localApiOrigin = process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
    : PRODUCTION_API_ORIGIN;
  return {
    id: String(flight.id),
    source: 'local',
    status: flight.status,
    queueClosesAt: null,
    queueCount: null,
    memberQueueCount: null,
    userInQueue: null,
    viewerQueuePosition: null,
    lockedForFreeUsers: null,
    lineSkipPriceUsd: null,
    lineSkipSold: null,
    viewerHasLineSkip: null,
    internationalPassPriceUsd: null,
    internationalPassRequired: null,
    viewerHasInternationalPass: null,
    viewerIsBookedPassenger: null,
    viewerIsEffectiveWinner: null,
    viewerConfirmationStatus: null,
    awardedAt: null,
    fromAirport: getAirportCode(flight.fromAirport, 'fromAirport'),
    fromCity: flight.fromCity ?? null,
    toAirport: getAirportCode(flight.toAirport, 'toAirport'),
    toCity: flight.toCity ?? null,
    originTz: null,
    destinationTz: null,
    departureDate: flight.departureDate ?? null,
    departureTime: flight.departureTime ?? null,
    departureTimeZone: null,
    arrivalDate: null,
    arrivalTime: null,
    arrivalTimeZone: null,
    duration: flight.duration ?? null,
    aircraftType: flight.aircraftType ?? null,
    aircraftTypeName: null,
    aircraftTypeCode: null,
    imageUrl: resolveAircraftImageUrl(flight.imageUrl, localApiOrigin),
    featured: !!flight.featured,
    international: flight.international ?? null,
    internationalFeeUsd: flight.internationalFeeUsd ?? null,
    rangeNm: flight.rangeNm ?? null,
    seatsAvailable: flight.seatsAvailable ?? null,
    totalPrice: flight.priceUsd ?? null,
    msrpUsd: null,
    pricePerHour: null,
  };
}

function getConfiguredBaseUrl(options: ReadRequestOptions): string {
  const selected = getMainBluebirdApiConfiguration();
  if (options.environment && options.environment !== selected.environment) {
    throw new Error('Selected Main Bluebird API environment does not match the configured reader.');
  }
  const requestedBaseUrl = options.baseUrl
    ? validateMainBluebirdApiBaseUrl(options.baseUrl, selected.environment)
    : selected.apiBaseUrl;
  if (requestedBaseUrl !== selected.apiBaseUrl) {
    throw new Error('Public reader URL does not match the selected Main Bluebird API.');
  }
  return selected.apiBaseUrl;
}

export async function fetchProductionJson(
  path: string,
  options: ReadRequestOptions,
): Promise<unknown> {
  const baseUrl = getConfiguredBaseUrl(options);
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? PRODUCTION_READ_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('Production read timeout must be a positive finite number.');
  }
  return requestProductionJson({
    url: `${baseUrl}${path}`,
    fetcher,
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'omit',
    timeoutMs,
    signal: options.signal,
    parse: (value) => value,
    errors: {
      timeout: (duration) => new ProductionReadTimeoutError(duration),
      cancelled: abortError,
      network: () => new ProductionReadNetworkError('Production read request could not reach the service.'),
      http: (response) => new ProductionReadHttpError(
        response.status,
        retryAfterMilliseconds(response),
      ),
      invalidJson: () => new ProductionReadInvalidJsonError(),
      schema: (error) => new ProductionReadSchemaError(
        error instanceof Error ? error.message : 'response',
      ),
    },
  });
}

export async function fetchProductionFlights(
  options: ReadRequestOptions = {},
): Promise<FlightView[]> {
  return mapReadSchema(
    await fetchProductionJson('/empty-legs', options),
    mapProductionFlights,
  );
}

function mapReadSchema<T>(value: unknown, parse: (input: unknown) => T): T {
  try {
    return parse(value);
  } catch (error) {
    throw new ProductionReadSchemaError(
      error instanceof Error ? error.message : 'response',
    );
  }
}

export function parseProductionFlightId(id: string | number | null | undefined): number | null {
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  const text = String(id);
  if (!/^[1-9]\d*$/.test(text)) return null;
  const numericId = Number(text);
  return Number.isSafeInteger(numericId) ? numericId : null;
}

export function findProductionFlightById(
  flights: readonly FlightView[] | undefined,
  id: number | null,
): FlightView | undefined {
  if (id === null) return undefined;
  const stableId = String(id);
  return flights?.find((flight) => flight.source === 'production' && flight.id === stableId);
}

export async function fetchProductionFlight(
  id: number,
  options: ReadRequestOptions = {},
): Promise<FlightView> {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error('A positive numeric production flight ID is required.');
  }
  return mapReadSchema(
    await fetchProductionJson(`/empty-legs/${id}`, options),
    mapProductionFlight,
  );
}

export function normalizeAirportCodes(codes: readonly string[]): string[] {
  const unique = [...new Set(
    codes.map((code) => code.trim().toUpperCase()).filter(Boolean),
  )];
  if (unique.length > 200) {
    throw new Error('Airport lookup accepts no more than 200 unique codes.');
  }
  return unique;
}

export async function fetchProductionAirports(
  codes: readonly string[],
  options: ReadRequestOptions = {},
): Promise<AirportRecord[]> {
  const unique = normalizeAirportCodes(codes);
  if (unique.length === 0) {
    throw new ProductionReadUnsupportedError(
      'Airport browsing without a code filter is not supported.',
    );
  }
  const query = `?${new URLSearchParams({ codes: unique.join(',') }).toString()}`;
  return mapReadSchema(
    await fetchProductionJson(`/airports${query}`, options),
    mapProductionAirports,
  );
}

export async function fetchProductionAirportSearch(
  query: string,
  options: ReadRequestOptions = {},
): Promise<AirportRecord[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [];
  const params = new URLSearchParams({ q: normalizedQuery });
  return mapReadSchema(
    await fetchProductionJson(`/airports/search?${params.toString()}`, options),
    mapProductionAirports,
  );
}

export async function fetchProductionAirportCities(
  options: ReadRequestOptions = {},
): Promise<ProductionAirportCityGroupResponse[]> {
  return mapReadSchema(
    await fetchProductionJson('/airports/cities', options),
    mapProductionAirportCityGroups,
  );
}
