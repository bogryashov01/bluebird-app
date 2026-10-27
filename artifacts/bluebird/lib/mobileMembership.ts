import { requestProductionJson } from './productionRequestTransport';
import {
  isNativeProductionAuthTestEnabled,
  isNativeProductionAuthTestRequestAllowed,
} from './nativeAuthTestPolicy';

/**
 * Future read-only mobile routes. They are not deployed and are not on the
 * Native Auth Test allowlist. The screen must not request them until
 * MOBILE_MEMBERSHIP_READS_ENABLED is explicitly set true.
 *
 * These are not GET /api/membership or GET /api/plans. Those routes can mutate
 * subscriptions, call a payment provider, or initialize application settings.
 */
export const MOBILE_MEMBERSHIP_PATH = '/mobile/membership';
export const MOBILE_PLANS_PATH = '/mobile/plans';

export const MOBILE_MEMBERSHIP_READS_ENABLED = false;

const MEMBERSHIP_TIERS = ['base', 'plus'] as const;
const MEMBERSHIP_STATUSES = ['active', 'canceled', 'expired', 'pending_payment'] as const;
const PAYMENT_STATUSES = ['none', 'pending', 'succeeded', 'failed'] as const;
const MEMBERSHIP_EVENT_TYPES = [
  'activated',
  'tier_changed',
  'scheduled_cancel',
  'resumed',
  'expired',
  'canceled',
  'scheduled_tier_change',
  'scheduled_tier_change_canceled',
] as const;

const MEMBERSHIP_KEYS = new Set([
  'isMember',
  'tier',
  'status',
  'startedAt',
  'currentPeriodEnd',
  'paymentStatus',
  'cancelAtPeriodEnd',
  'scheduledTierChange',
  'recentEvents',
  'skipTheLinePasses',
]);
const EVENT_KEYS = new Set(['id', 'eventType', 'occurredAt']);
const PLAN_KEYS = new Set([
  'tier',
  'name',
  'priceUsd',
  'cadence',
  'priceLabel',
  'cadenceLabel',
  'tagline',
  'highlight',
]);
const CATALOG_KEYS = new Set(['plans', 'features', 'cardFeatures']);
const TIER_CHANGE_KEYS = new Set(['to', 'at']);

export type MobileMembershipTier = (typeof MEMBERSHIP_TIERS)[number];
export type MobileMembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];
export type MobilePaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type MobileMembershipEventType = (typeof MEMBERSHIP_EVENT_TYPES)[number];

export interface MobileMembershipEvent {
  id: number;
  eventType: MobileMembershipEventType;
  occurredAt: string;
}

export interface MobileScheduledTierChange {
  to: MobileMembershipTier;
  at: string;
}

/**
 * Stored membership projection for the signed-in member.
 * No card, billing address, charge, or payment-provider identifier is accepted.
 */
export interface MobileMembershipSnapshot {
  isMember: boolean;
  tier: MobileMembershipTier | null;
  status: MobileMembershipStatus | null;
  startedAt: string | null;
  currentPeriodEnd: string | null;
  paymentStatus: MobilePaymentStatus | null;
  cancelAtPeriodEnd: boolean;
  scheduledTierChange: MobileScheduledTierChange | null;
  recentEvents: MobileMembershipEvent[];
  skipTheLinePasses: number | null;
}

export interface MobilePlan {
  tier: string;
  name: string;
  priceUsd: number;
  cadence: string;
  priceLabel: string;
  cadenceLabel: string;
  tagline: string;
  highlight: boolean;
}

export interface MobilePlanFeature {
  label: string;
  values: Record<string, boolean | string>;
}

/**
 * Public display catalog. Availability and signup settings are not part of
 * this contract, so reading it cannot initialize application settings.
 */
export interface MobilePlanCatalog {
  plans: MobilePlan[];
  features: MobilePlanFeature[];
  cardFeatures: Record<string, string[]>;
}

export type MobileMembershipErrorCode =
  | 'network'
  | 'timeout'
  | 'session_expired'
  | 'unavailable'
  | 'schema';

export type MobileMembershipLoadResult =
  | { kind: 'unavailable' }
  | { kind: 'not_authenticated' }
  | { kind: 'cancelled' }
  | { kind: 'error'; code: MobileMembershipErrorCode }
  | {
      kind: 'loaded';
      membership: MobileMembershipSnapshot;
      plans: MobilePlanCatalog | null;
    };

export class MobileMembershipSchemaError extends Error {
  constructor(readonly field: string) {
    super(`Mobile membership field "${field}" is invalid.`);
    this.name = 'MobileMembershipSchemaError';
  }
}

class MobileMembershipHttpError extends Error {
  constructor(readonly status: number) {
    super(`Mobile membership read failed (HTTP ${status}).`);
    this.name = 'MobileMembershipHttpError';
  }
}

class MobileMembershipTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super('Mobile membership read timed out.');
    this.name = 'MobileMembershipTimeoutError';
  }
}

class MobileMembershipNetworkError extends Error {
  constructor() {
    super('Mobile membership read could not reach Bluebird.');
    this.name = 'MobileMembershipNetworkError';
  }
}

class MobileMembershipCancelledError extends Error {
  constructor() {
    super('Mobile membership read was cancelled.');
    this.name = 'MobileMembershipCancelledError';
  }
}

export function areMobileMembershipReadsEnabled(): boolean {
  return MOBILE_MEMBERSHIP_READS_ENABLED;
}

export function mobileMembershipUrl(apiBaseUrl: string, path: string): string {
  if (path !== MOBILE_MEMBERSHIP_PATH && path !== MOBILE_PLANS_PATH) {
    throw new MobileMembershipSchemaError('path');
  }
  let base: URL;
  try {
    base = new URL(apiBaseUrl);
  } catch {
    throw new MobileMembershipSchemaError('apiBaseUrl');
  }
  const pathname = base.pathname.replace(/\/+$/, '');
  if (
    base.protocol !== 'https:' ||
    pathname !== '/api' ||
    base.username ||
    base.password ||
    base.search !== '' ||
    base.hash !== ''
  ) {
    throw new MobileMembershipSchemaError('apiBaseUrl');
  }
  const url = new URL(`${base.origin}/api${path}`);
  if (
    url.search !== '' ||
    url.hash !== '' ||
    (url.pathname !== '/api/mobile/membership' && url.pathname !== '/api/mobile/plans')
  ) {
    throw new MobileMembershipSchemaError('path');
  }
  return url.toString();
}

export function parseMobileMembership(value: unknown): MobileMembershipSnapshot {
  const raw = record(value, 'membership');
  rejectUnknownKeys(raw, MEMBERSHIP_KEYS, 'membership');
  const isMember = booleanValue(raw.isMember, 'membership.isMember');
  const tier = nullableEnum(raw.tier, MEMBERSHIP_TIERS, 'membership.tier');
  if (isMember) {
    if (tier === null) fail('membership.tier');
  } else if (tier !== null) {
    fail('membership.tier');
  }
  const status = nullableEnum(raw.status, MEMBERSHIP_STATUSES, 'membership.status');
  const startedAt = nullableText(raw.startedAt, 'membership.startedAt');
  const currentPeriodEnd = nullableText(raw.currentPeriodEnd, 'membership.currentPeriodEnd');
  const paymentStatus = nullableEnum(raw.paymentStatus, PAYMENT_STATUSES, 'membership.paymentStatus');
  const cancelAtPeriodEnd = booleanValue(raw.cancelAtPeriodEnd, 'membership.cancelAtPeriodEnd');
  const scheduledTierChange = parseScheduledTierChange(raw.scheduledTierChange);
  const recentEvents = parseEvents(raw.recentEvents);
  const skipTheLinePasses = parsePassBalance(raw.skipTheLinePasses);
  if (!isMember) {
    if (
      status !== null ||
      startedAt !== null ||
      currentPeriodEnd !== null ||
      paymentStatus !== null ||
      cancelAtPeriodEnd ||
      scheduledTierChange !== null ||
      recentEvents.length > 0 ||
      skipTheLinePasses !== null
    ) {
      fail('membership.nonMember');
    }
  }
  return {
    isMember,
    tier,
    status,
    startedAt,
    currentPeriodEnd,
    paymentStatus,
    cancelAtPeriodEnd,
    scheduledTierChange,
    recentEvents,
    skipTheLinePasses,
  };
}

export function parseMobileMembershipPlans(value: unknown): MobilePlanCatalog {
  const raw = record(value, 'plans');
  rejectUnknownKeys(raw, CATALOG_KEYS, 'plans');
  if (!Array.isArray(raw.plans)) fail('plans.plans');
  const plans = raw.plans.map((entry, index) => parsePlan(entry, index));
  const tiers = plans.map((plan) => plan.tier);
  if (new Set(tiers).size !== tiers.length) fail('plans.plans');
  return {
    plans,
    features: parseFeatures(raw.features, tiers),
    cardFeatures: parseCardFeatures(raw.cardFeatures, tiers),
  };
}

export interface MobileMembershipReadInput {
  apiBaseUrl: string | null;
  getAccessToken: () => Promise<string | null>;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  readsEnabled: boolean;
}

/**
 * Reads the future mobile endpoints only when explicitly enabled and the
 * Native Auth Test policy allows both exact GETs. Otherwise it returns
 * unavailable without calling the token provider or fetch.
 */
export async function readMobileMembership(
  input: MobileMembershipReadInput,
): Promise<MobileMembershipLoadResult> {
  if (input.readsEnabled !== true) return { kind: 'unavailable' };
  if (!input.apiBaseUrl) return { kind: 'unavailable' };

  let membershipUrl: string;
  let plansUrl: string;
  try {
    membershipUrl = mobileMembershipUrl(input.apiBaseUrl, MOBILE_MEMBERSHIP_PATH);
    plansUrl = mobileMembershipUrl(input.apiBaseUrl, MOBILE_PLANS_PATH);
  } catch {
    return { kind: 'unavailable' };
  }

  if (isNativeProductionAuthTestEnabled()) {
    const membershipAllowed = isNativeProductionAuthTestRequestAllowed(membershipUrl, 'GET');
    const plansAllowed = isNativeProductionAuthTestRequestAllowed(plansUrl, 'GET');
    if (!membershipAllowed || !plansAllowed) return { kind: 'unavailable' };
  }

  let token: string | null;
  try {
    token = await input.getAccessToken();
  } catch {
    return { kind: 'error', code: 'session_expired' };
  }
  if (typeof token !== 'string' || token.trim() === '' || /\s/.test(token)) {
    return { kind: 'not_authenticated' };
  }

  const fetcher = input.fetcher ?? fetch;
  let membership: MobileMembershipSnapshot;
  try {
    membership = await requestProductionJson({
      url: membershipUrl,
      fetcher,
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      timeoutMs: 10_000,
      signal: input.signal,
      prepareHeaders: async () => ({ Authorization: `Bearer ${token}` }),
      parse: parseMobileMembership,
      errors: transportErrors(),
    });
  } catch (error) {
    return membershipFailure(error);
  }

  try {
    const plans = await requestProductionJson({
      url: plansUrl,
      fetcher,
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      timeoutMs: 10_000,
      signal: input.signal,
      parse: parseMobileMembershipPlans,
      errors: transportErrors(),
    });
    return { kind: 'loaded', membership, plans };
  } catch (error) {
    if (error instanceof MobileMembershipCancelledError || input.signal?.aborted) {
      return { kind: 'cancelled' };
    }
    return { kind: 'loaded', membership, plans: null };
  }
}

export function loadPreparedMobileMembership(
  input: Omit<MobileMembershipReadInput, 'readsEnabled'>,
): Promise<MobileMembershipLoadResult> {
  return readMobileMembership({
    ...input,
    readsEnabled: areMobileMembershipReadsEnabled(),
  });
}

function transportErrors() {
  return {
    timeout: (timeoutMs: number) => new MobileMembershipTimeoutError(timeoutMs),
    cancelled: () => new MobileMembershipCancelledError(),
    network: () => new MobileMembershipNetworkError(),
    http: (response: Response) => new MobileMembershipHttpError(response.status),
    invalidJson: () => new MobileMembershipSchemaError('json'),
    schema: (error: unknown) => error instanceof MobileMembershipSchemaError
      ? error
      : new MobileMembershipSchemaError('response'),
  };
}

function membershipFailure(error: unknown): MobileMembershipLoadResult {
  if (error instanceof MobileMembershipCancelledError) return { kind: 'cancelled' };
  if (error instanceof MobileMembershipHttpError) {
    if (error.status === 401) return { kind: 'not_authenticated' };
    if (error.status === 403 || error.status === 404) return { kind: 'unavailable' };
    return { kind: 'error', code: 'unavailable' };
  }
  if (error instanceof MobileMembershipTimeoutError) return { kind: 'error', code: 'timeout' };
  if (error instanceof MobileMembershipNetworkError) return { kind: 'error', code: 'network' };
  if (error instanceof MobileMembershipSchemaError) return { kind: 'error', code: 'schema' };
  return { kind: 'unavailable' };
}

function parseScheduledTierChange(value: unknown): MobileScheduledTierChange | null {
  if (value === null) return null;
  const raw = record(value, 'membership.scheduledTierChange');
  rejectUnknownKeys(raw, TIER_CHANGE_KEYS, 'membership.scheduledTierChange');
  return {
    to: enumValue(raw.to, MEMBERSHIP_TIERS, 'membership.scheduledTierChange.to'),
    at: text(raw.at, 'membership.scheduledTierChange.at'),
  };
}

function parseEvents(value: unknown): MobileMembershipEvent[] {
  if (!Array.isArray(value)) fail('membership.recentEvents');
  return value.map((entry, index) => {
    const field = `membership.recentEvents[${index}]`;
    const raw = record(entry, field);
    rejectUnknownKeys(raw, EVENT_KEYS, field);
    const id = raw.id;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) fail(`${field}.id`);
    return {
      id,
      eventType: enumValue(raw.eventType, MEMBERSHIP_EVENT_TYPES, `${field}.eventType`),
      occurredAt: text(raw.occurredAt, `${field}.occurredAt`),
    };
  });
}

function parsePassBalance(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    fail('membership.skipTheLinePasses');
  }
  return value;
}

function parsePlan(value: unknown, index: number): MobilePlan {
  const field = `plans.plans[${index}]`;
  const raw = record(value, field);
  rejectUnknownKeys(raw, PLAN_KEYS, field);
  const tier = text(raw.tier, `${field}.tier`);
  if (!/^[a-z][a-z0-9_-]*$/i.test(tier)) fail(`${field}.tier`);
  const priceUsd = raw.priceUsd;
  if (typeof priceUsd !== 'number' || !Number.isFinite(priceUsd) || priceUsd < 0) {
    fail(`${field}.priceUsd`);
  }
  return {
    tier,
    name: text(raw.name, `${field}.name`),
    priceUsd,
    cadence: text(raw.cadence, `${field}.cadence`),
    priceLabel: text(raw.priceLabel, `${field}.priceLabel`),
    cadenceLabel: text(raw.cadenceLabel, `${field}.cadenceLabel`),
    tagline: text(raw.tagline, `${field}.tagline`),
    highlight: booleanValue(raw.highlight, `${field}.highlight`),
  };
}

function parseFeatures(value: unknown, tiers: readonly string[]): MobilePlanFeature[] {
  if (!Array.isArray(value)) fail('plans.features');
  return value.map((entry, index) => {
    const field = `plans.features[${index}]`;
    const raw = record(entry, field);
    if (typeof raw.label !== 'string' || raw.label.trim() === '') fail(`${field}.label`);
    const values: Record<string, boolean | string> = {};
    for (const [key, featureValue] of Object.entries(raw)) {
      if (key === 'label') continue;
      if (typeof featureValue !== 'boolean' && typeof featureValue !== 'string') {
        fail(`${field}.${key}`);
      }
      values[key] = featureValue;
    }
    for (const tier of tiers) {
      if (!Object.prototype.hasOwnProperty.call(values, tier)) fail(`${field}.${tier}`);
    }
    return { label: raw.label.trim(), values };
  });
}

function parseCardFeatures(value: unknown, tiers: readonly string[]): Record<string, string[]> {
  const raw = record(value, 'plans.cardFeatures');
  rejectUnknownKeys(raw, new Set(tiers), 'plans.cardFeatures');
  const mapped: Record<string, string[]> = {};
  for (const tier of tiers) {
    const entries = raw[tier];
    if (!Array.isArray(entries)) fail(`plans.cardFeatures.${tier}`);
    mapped[tier] = entries.map((entry, index) => text(entry, `plans.cardFeatures.${tier}[${index}]`));
  }
  return mapped;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(field);
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  field: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${field}.${key}`);
  }
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') fail(field);
  return value;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') fail(field);
  return value.trim();
}

function nullableText(value: unknown, field: string): string | null {
  if (value === null) return null;
  return text(value, field);
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail(field);
  return value as T;
}

function nullableEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T | null {
  if (value === null) return null;
  return enumValue(value, allowed, field);
}

function fail(field: string): never {
  throw new MobileMembershipSchemaError(field);
}
