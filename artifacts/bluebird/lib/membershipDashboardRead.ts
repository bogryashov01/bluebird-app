import type { MembershipDashboardMembership } from './clerkMembershipDesign';
import type { MainBluebirdApiConfiguration } from './mainBluebirdApiConfig';
import { getMembershipDataModeConfiguration } from './membershipDataMode';
import { isNativeProductionAuthTestEnabled } from './nativeAuthTestPolicy';
import {
  createAuthenticatedProductionApiClient,
  ProductionAuthCancelledError,
  ProductionAuthHttpError,
  ProductionAuthInvalidJsonError,
  ProductionAuthNetworkError,
  ProductionAuthRequestError,
  ProductionAuthSchemaError,
  ProductionAuthTimeoutError,
} from './productionAuthApi';

export {
  ProductionAuthHttpError,
  ProductionAuthNetworkError,
  ProductionAuthSchemaError,
};

/**
 * The Membership dashboard reads the existing GET /api/membership contract.
 * The production handler may apply already scheduled membership changes.
 * This module does not add a mutation, and it does not call the undeployed
 * mobile routes. Native Auth Test allows this exact GET and blocks every
 * other membership path and method.
 */
export const DASHBOARD_MEMBERSHIP_FRESH_MS = 5 * 60 * 1000;

const TIERS = ['base', 'plus'] as const;
const STATUSES = ['active', 'canceled', 'expired', 'pending_payment'] as const;
const PAYMENT_STATUSES = ['none', 'pending', 'succeeded', 'failed'] as const;

export type DashboardMembershipProjection = MembershipDashboardMembership;

export type DashboardMembershipErrorCode =
  | 'network'
  | 'timeout'
  | 'session_expired'
  | 'unavailable'
  | 'schema';

export type DashboardMembershipLoadResult =
  | { kind: 'unavailable' }
  | { kind: 'not_authenticated' }
  | { kind: 'cancelled' }
  | { kind: 'invalid' }
  | { kind: 'error'; code: DashboardMembershipErrorCode }
  | { kind: 'loaded'; membership: DashboardMembershipProjection };

export function areProductionMembershipDashboardReadsEnabled(): boolean {
  return true;
}

/**
 * Copy only the dashboard fields from a parsed GET /api/membership body.
 * Card data, charges, and event history are dropped. Skip-the-Line credits
 * belong to the profile contract, so this response does not supply them.
 * Returns null when the body cannot support a tier decision.
 */
export function adaptProductionMembershipForDashboard(
  value: unknown,
): DashboardMembershipProjection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.isMember !== 'boolean') return null;
  if (raw.tier !== null && !isListed(raw.tier, TIERS)) return null;
  if (!raw.isMember && raw.tier !== null) return null;
  if (typeof raw.cancelAtPeriodEnd !== 'boolean') return null;
  const status = raw.status === undefined ? null : raw.status;
  if (status !== null && !isListed(status, STATUSES)) return null;
  const paymentStatus = raw.paymentStatus === undefined ? null : raw.paymentStatus;
  if (paymentStatus !== null && !isListed(paymentStatus, PAYMENT_STATUSES)) return null;
  const currentPeriodEnd = nullableTimestamp(raw.currentPeriodEnd);
  if (currentPeriodEnd === undefined) return null;
  return {
    isMember: raw.isMember,
    tier: raw.tier,
    status,
    paymentStatus,
    currentPeriodEnd,
    skipTheLinePasses: null,
  };
}

export function shouldDisplayDashboardMembership(input: {
  signedIn: boolean;
  membershipClerkUserId: string | null;
  activeClerkUserId: string | null;
}): boolean {
  return input.signedIn === true &&
    typeof input.membershipClerkUserId === 'string' &&
    input.membershipClerkUserId.length > 0 &&
    input.membershipClerkUserId === input.activeClerkUserId;
}

export interface DashboardMembershipReadInput {
  signal?: AbortSignal;
  configuration: MainBluebirdApiConfiguration | null;
  getAccessToken: () => Promise<string | null>;
}

/**
 * Reads GET /api/membership for the current Clerk session.
 * Native Auth Test permits this exact GET through the production transport.
 */
export async function loadDashboardProductionMembership(
  input: DashboardMembershipReadInput,
): Promise<DashboardMembershipLoadResult> {
  const environment = input.configuration?.environment ?? 'unconfigured';
  if (!input.configuration) {
    logMembershipDashboardDiagnostic(membershipDiagnostic({
      requestAttempted: false,
      environment,
      failure: 'no-configuration',
    }));
    return { kind: 'unavailable' };
  }
  let tokenAvailable: boolean | null = null;
  let httpStatus: number | null = null;
  let requestAttempted = false;
  try {
    const raw = await readProductionMembership(input.configuration, input.getAccessToken, input.signal, {
      onTokenAvailable: (available) => { tokenAvailable = available; },
      onHttpStatus: (status) => { httpStatus = status; },
      onRequestAttempted: () => { requestAttempted = true; },
    });
    if (input.signal?.aborted) {
      logMembershipDashboardDiagnostic(membershipDiagnostic({
        requestAttempted,
        environment,
        tokenAvailable,
        httpStatus,
        failure: 'cancelled',
      }));
      return { kind: 'cancelled' };
    }
    const membership = adaptProductionMembershipForDashboard(raw);
    if (!membership) {
      logMembershipDashboardDiagnostic(membershipDiagnostic({
        requestAttempted,
        environment,
        tokenAvailable,
        httpStatus,
        parseSucceeded: true,
        failure: 'invalid-shape',
      }));
      return { kind: 'invalid' };
    }
    logMembershipDashboardDiagnostic(membershipDiagnostic({
      requestAttempted,
      environment,
      tokenAvailable,
      httpStatus,
      parseSucceeded: true,
      hasIsMember: true,
      hasTier: membership.tier !== null,
      hasStatus: membership.status !== null,
      hasPaymentStatus: membership.paymentStatus !== null,
      failure: null,
    }));
    return { kind: 'loaded', membership };
  } catch (error) {
    const failure = classifyMembershipReadError(error);
    logMembershipDashboardDiagnostic(membershipDiagnostic({
      requestAttempted,
      environment,
      tokenAvailable,
      httpStatus: failure.httpStatus ?? httpStatus,
      parseSucceeded: failure.failure === 'schema' ? false : null,
      failure: failure.failure,
      schemaField: failure.schemaField,
    }));
    return failure.result;
  }
}

/**
 * Adapter and error mapping for an already approved membership read.
 * The Membership screen does not call this directly.
 */
export async function readApprovedDashboardMembership(input: {
  signal?: AbortSignal;
  readMembership: (signal?: AbortSignal) => Promise<unknown>;
}): Promise<DashboardMembershipLoadResult> {
  try {
    const raw = await input.readMembership(input.signal);
    if (input.signal?.aborted) return { kind: 'cancelled' };
    const membership = adaptProductionMembershipForDashboard(raw);
    if (!membership) return { kind: 'invalid' };
    return { kind: 'loaded', membership };
  } catch (error) {
    return membershipReadFailure(error, input.signal);
  }
}

async function readProductionMembership(
  configuration: MainBluebirdApiConfiguration,
  getAccessToken: () => Promise<string | null>,
  signal: AbortSignal | undefined,
  observers: {
    onTokenAvailable: (available: boolean) => void;
    onHttpStatus: (status: number) => void;
    onRequestAttempted: () => void;
  },
): Promise<unknown> {
  const api = createAuthenticatedProductionApiClient({
    environment: configuration.environment,
    baseUrl: configuration.apiBaseUrl,
    tokenProvider: {
      environment: configuration.environment,
      getVerifiedAccessToken: async () => {
        const token = await getAccessToken();
        const available = typeof token === 'string' && token.trim() !== '' && !/\s/.test(token);
        observers.onTokenAvailable(available);
        return available ? token : null;
      },
    },
  });
  return api.getMembership({
    ...(signal ? { signal } : {}),
    onFetchInitiated: observers.onRequestAttempted,
    onResponseStatus: observers.onHttpStatus,
  });
}

async function readProductionProfile(
  configuration: MainBluebirdApiConfiguration,
  getAccessToken: () => Promise<string | null>,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const api = createAuthenticatedProductionApiClient({
    environment: configuration.environment,
    baseUrl: configuration.apiBaseUrl,
    tokenProvider: {
      environment: configuration.environment,
      getVerifiedAccessToken: async () => {
        const token = await getAccessToken();
        if (typeof token !== 'string' || token.trim() === '' || /\s/.test(token)) return null;
        return token;
      },
    },
  });
  return api.getProfile(signal ? { signal } : undefined);
}

interface DashboardMembershipCacheEntry {
  clerkUserId: string;
  membership: DashboardMembershipProjection;
  loadedAt: number;
}

interface DashboardSkipTheLineCacheEntry {
  clerkUserId: string;
  count: number;
  loadedAt: number;
}

const dashboardMembershipCache = new Map<string, DashboardMembershipCacheEntry>();
const dashboardSkipTheLineCache = new Map<string, DashboardSkipTheLineCacheEntry>();
let membershipDiagnosticSnapshot: MembershipDashboardDiagnostic | null = null;
let membershipDiagnosticLine = '';
let membershipFieldDiagnosticLine = '';
let membershipDiagnosticAccountKey: string | null = null;

function resetMembershipDashboardDiagnostic(): void {
  membershipDiagnosticSnapshot = null;
  membershipDiagnosticLine = '';
  membershipFieldDiagnosticLine = '';
}

function dashboardMembershipCacheKey(
  environment: string,
  apiBaseUrl: string,
  clerkUserId: string,
): string {
  return `${environment}\0${apiBaseUrl}\0${clerkUserId}`;
}

export function readFreshDashboardMembership(input: {
  environment: string;
  apiBaseUrl: string;
  clerkUserId: string;
  now?: number;
}): DashboardMembershipProjection | null {
  if (!input.clerkUserId) return null;
  const entry = dashboardMembershipCache.get(dashboardMembershipCacheKey(
    input.environment,
    input.apiBaseUrl,
    input.clerkUserId,
  ));
  if (!entry || entry.clerkUserId !== input.clerkUserId) return null;
  const now = input.now ?? Date.now();
  if (now - entry.loadedAt > DASHBOARD_MEMBERSHIP_FRESH_MS) return null;
  return entry.membership;
}

export function rememberDashboardMembership(input: {
  environment: string;
  apiBaseUrl: string;
  clerkUserId: string;
  membership: DashboardMembershipProjection;
  loadedAt?: number;
}): void {
  if (!input.clerkUserId) return;
  dashboardMembershipCache.set(dashboardMembershipCacheKey(
    input.environment,
    input.apiBaseUrl,
    input.clerkUserId,
  ), {
    clerkUserId: input.clerkUserId,
    membership: input.membership,
    loadedAt: input.loadedAt ?? Date.now(),
  });
}

export function clearDashboardMembershipCache(): void {
  dashboardMembershipCache.clear();
  dashboardSkipTheLineCache.clear();
  membershipDiagnosticAccountKey = null;
  resetMembershipDashboardDiagnostic();
}

export function retainDashboardMembershipForAccount(clerkUserId: string): void {
  if (membershipDiagnosticAccountKey !== clerkUserId) {
    membershipDiagnosticAccountKey = clerkUserId;
    resetMembershipDashboardDiagnostic();
  }
  for (const [key, entry] of dashboardMembershipCache) {
    if (entry.clerkUserId !== clerkUserId) dashboardMembershipCache.delete(key);
  }
  for (const [key, entry] of dashboardSkipTheLineCache) {
    if (entry.clerkUserId !== clerkUserId) dashboardSkipTheLineCache.delete(key);
  }
}

export function readSkipTheLineBalance(profile: unknown): { known: true; count: number } | { known: false } {
  if (!profile || typeof profile !== 'object') return { known: false };
  const balances = (profile as { upgradeCreditBalances?: unknown }).upgradeCreditBalances;
  if (!balances || typeof balances !== 'object') return { known: false };
  const count = (balances as { skipTheLine?: unknown }).skipTheLine;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return { known: false };
  return { known: true, count };
}

export function readFreshSkipTheLinePasses(input: {
  environment: string;
  apiBaseUrl: string;
  clerkUserId: string;
  now?: number;
}): { count: number } | null {
  if (!input.clerkUserId) return null;
  const entry = dashboardSkipTheLineCache.get(dashboardMembershipCacheKey(
    input.environment,
    input.apiBaseUrl,
    input.clerkUserId,
  ));
  if (!entry || entry.clerkUserId !== input.clerkUserId) return null;
  const now = input.now ?? Date.now();
  if (now - entry.loadedAt > DASHBOARD_MEMBERSHIP_FRESH_MS) return null;
  return { count: entry.count };
}

export function rememberSkipTheLinePasses(input: {
  environment: string;
  apiBaseUrl: string;
  clerkUserId: string;
  count: number;
  loadedAt?: number;
}): void {
  if (!input.clerkUserId || !Number.isSafeInteger(input.count) || input.count < 0) return;
  dashboardSkipTheLineCache.set(dashboardMembershipCacheKey(
    input.environment,
    input.apiBaseUrl,
    input.clerkUserId,
  ), {
    clerkUserId: input.clerkUserId,
    count: input.count,
    loadedAt: input.loadedAt ?? Date.now(),
  });
}

/**
 * Remaining Skip-the-Line credits are upgradeCreditBalances.skipTheLine on
 * GET /api/me/profile. That GET can copy a verified phone number onto the
 * profile. This function does not purchase, redeem, or change credits.
 * Native Auth Test does not reach the token provider or the network here.
 * GET /api/me/profile remains allowlisted for other screens.
 */
export async function loadDashboardSkipTheLinePasses(input: {
  signal?: AbortSignal;
  configuration: MainBluebirdApiConfiguration | null;
  getAccessToken: () => Promise<string | null>;
  cachedProfiles?: readonly unknown[];
}): Promise<{ kind: 'loaded'; count: number } | { kind: 'unavailable' }> {
  if (isNativeProductionAuthTestEnabled() || !input.configuration) {
    return { kind: 'unavailable' };
  }
  for (const profile of input.cachedProfiles ?? []) {
    const balance = readSkipTheLineBalance(profile);
    if (balance.known) return { kind: 'loaded', count: balance.count };
  }
  if (input.signal?.aborted) return { kind: 'unavailable' };
  try {
    const profile = await readProductionProfile(input.configuration, input.getAccessToken, input.signal);
    if (input.signal?.aborted) return { kind: 'unavailable' };
    const balance = readSkipTheLineBalance(profile);
    return balance.known ? { kind: 'loaded', count: balance.count } : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}

function nullableTimestamp(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  return value.trim();
}

export type MembershipDashboardFailure =
  | 'native-auth-test'
  | 'no-configuration'
  | 'client-configuration'
  | 'token'
  | 'http'
  | 'schema'
  | 'invalid-shape'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'unavailable';

export interface MembershipDashboardDiagnostic {
  requestAttempted: boolean;
  environment: 'production' | 'development' | 'unconfigured';
  nativeAuthTest: boolean;
  membershipDataMode: 'production' | 'mock';
  tokenAvailable: boolean | null;
  httpStatus: number | null;
  parseSucceeded: boolean | null;
  hasIsMember: boolean | null;
  hasTier: boolean | null;
  hasStatus: boolean | null;
  hasPaymentStatus: boolean | null;
  failure: MembershipDashboardFailure | null;
  schemaField: string | null;
  cacheHit: boolean;
  loadKind: string | null;
  presentation: string | null;
}

export function membershipDiagnostic(
  input: Partial<MembershipDashboardDiagnostic> & Pick<MembershipDashboardDiagnostic, 'requestAttempted' | 'environment' | 'failure'>,
): MembershipDashboardDiagnostic {
  const mode = getMembershipDataModeConfiguration().mode;
  return {
    requestAttempted: input.requestAttempted,
    environment: input.environment,
    nativeAuthTest: isNativeProductionAuthTestEnabled(),
    membershipDataMode: mode === 'mock' ? 'mock' : 'production',
    tokenAvailable: input.tokenAvailable ?? null,
    httpStatus: input.httpStatus ?? null,
    parseSucceeded: input.parseSucceeded ?? null,
    hasIsMember: input.hasIsMember ?? null,
    hasTier: input.hasTier ?? null,
    hasStatus: input.hasStatus ?? null,
    hasPaymentStatus: input.hasPaymentStatus ?? null,
    failure: input.failure,
    schemaField: safeSchemaField(input.schemaField),
    cacheHit: input.cacheHit === true,
    loadKind: safeLabel(input.loadKind),
    presentation: safeLabel(input.presentation),
  };
}

export function logMembershipDashboardDiagnostic(diagnostic: MembershipDashboardDiagnostic): void {
  if (typeof __DEV__ === 'undefined' || __DEV__ !== true) return;
  membershipDiagnosticSnapshot = diagnostic;
  const line = formatMembershipDashboardDiagnostic(diagnostic);
  if (line === membershipDiagnosticLine) return;
  membershipDiagnosticLine = line;
  console.info(line);
}

const MEMBERSHIP_FIELD_LOG_VALUES = {
  isMember: ['true', 'false'] as const,
  tier: ['base', 'plus', 'null'] as const,
  status: ['active', 'canceled', 'expired', 'pending_payment', 'null'] as const,
  paymentStatus: ['none', 'pending', 'succeeded', 'failed', 'null'] as const,
};

export function membershipNormalizedFieldRecord(membership: {
  isMember: boolean;
  tier: string | null;
  status: string | null;
  paymentStatus: string | null;
}): {
  isMember: (typeof MEMBERSHIP_FIELD_LOG_VALUES.isMember)[number] | 'rejected';
  tier: (typeof MEMBERSHIP_FIELD_LOG_VALUES.tier)[number] | 'rejected';
  status: (typeof MEMBERSHIP_FIELD_LOG_VALUES.status)[number] | 'rejected';
  paymentStatus: (typeof MEMBERSHIP_FIELD_LOG_VALUES.paymentStatus)[number] | 'rejected';
} {
  const isMember = membership.isMember === true ? 'true' : membership.isMember === false ? 'false' : 'rejected';
  const tier = membership.tier === null ? 'null' : isListed(membership.tier, TIERS) ? membership.tier : 'rejected';
  const status = membership.status === null ? 'null' : isListed(membership.status, STATUSES) ? membership.status : 'rejected';
  const paymentStatus = membership.paymentStatus === null
    ? 'null'
    : isListed(membership.paymentStatus, PAYMENT_STATUSES) ? membership.paymentStatus : 'rejected';
  return { isMember, tier, status, paymentStatus };
}

export function logMembershipNormalizedFields(membership: {
  isMember: boolean;
  tier: string | null;
  status: string | null;
  paymentStatus: string | null;
}): void {
  if (typeof __DEV__ === 'undefined' || __DEV__ !== true) return;
  const fields = membershipNormalizedFieldRecord(membership);
  const line = [
    '[bluebird-membership-fields]',
    `isMember=${fields.isMember}`,
    `tier=${fields.tier}`,
    `status=${fields.status}`,
    `paymentStatus=${fields.paymentStatus}`,
  ].join(' ');
  if (line === membershipFieldDiagnosticLine) return;
  membershipFieldDiagnosticLine = line;
  console.info(line);
}

export function logMembershipDashboardPresentation(loadKind: string, presentation: string): void {
  if (typeof __DEV__ === 'undefined' || __DEV__ !== true) return;
  const base = membershipDiagnosticSnapshot;
  logMembershipDashboardDiagnostic(membershipDiagnostic({
    requestAttempted: base?.requestAttempted ?? false,
    environment: base?.environment ?? 'unconfigured',
    tokenAvailable: base?.tokenAvailable,
    httpStatus: base?.httpStatus,
    parseSucceeded: base?.parseSucceeded,
    hasIsMember: base?.hasIsMember,
    hasTier: base?.hasTier,
    hasStatus: base?.hasStatus,
    hasPaymentStatus: base?.hasPaymentStatus,
    failure: base?.failure ?? null,
    schemaField: base?.schemaField,
    cacheHit: base?.cacheHit,
    loadKind,
    presentation,
  }));
}

function formatMembershipDashboardDiagnostic(diagnostic: MembershipDashboardDiagnostic): string {
  return [
    '[bluebird-membership]',
    `requestAttempted=${diagnostic.requestAttempted}`,
    `environment=${diagnostic.environment}`,
    `nativeAuthTest=${diagnostic.nativeAuthTest}`,
    `membershipDataMode=${diagnostic.membershipDataMode}`,
    `cacheHit=${diagnostic.cacheHit}`,
    `tokenAvailable=${diagnostic.tokenAvailable}`,
    `httpStatus=${diagnostic.httpStatus ?? 'none'}`,
    `parseSucceeded=${diagnostic.parseSucceeded}`,
    `hasIsMember=${diagnostic.hasIsMember}`,
    `hasTier=${diagnostic.hasTier}`,
    `hasStatus=${diagnostic.hasStatus}`,
    `hasPaymentStatus=${diagnostic.hasPaymentStatus}`,
    `failure=${diagnostic.failure ?? 'none'}`,
    `schemaField=${diagnostic.schemaField ?? 'none'}`,
    `loadKind=${diagnostic.loadKind ?? 'none'}`,
    `presentation=${diagnostic.presentation ?? 'none'}`,
  ].join(' ');
}

export function classifyMembershipReadError(error: unknown): {
  result: DashboardMembershipLoadResult;
  failure: MembershipDashboardFailure;
  httpStatus: number | null;
  schemaField: string | null;
} {
  if (error instanceof ProductionAuthCancelledError) {
    return { result: { kind: 'cancelled' }, failure: 'cancelled', httpStatus: null, schemaField: null };
  }
  if (error instanceof ProductionAuthHttpError && error.status === 401) {
    return { result: { kind: 'not_authenticated' }, failure: 'token', httpStatus: 401, schemaField: null };
  }
  if (error instanceof ProductionAuthSchemaError || error instanceof ProductionAuthInvalidJsonError) {
    return {
      result: { kind: 'invalid' },
      failure: 'schema',
      httpStatus: null,
      schemaField: error instanceof ProductionAuthSchemaError ? error.field : 'json',
    };
  }
  if (error instanceof ProductionAuthTimeoutError) {
    return { result: { kind: 'error', code: 'timeout' }, failure: 'timeout', httpStatus: null, schemaField: null };
  }
  if (error instanceof ProductionAuthNetworkError) {
    return { result: { kind: 'error', code: 'network' }, failure: 'network', httpStatus: null, schemaField: null };
  }
  if (error instanceof ProductionAuthRequestError && error.code === 'token') {
    return { result: { kind: 'not_authenticated' }, failure: 'token', httpStatus: null, schemaField: null };
  }
  if (error instanceof ProductionAuthHttpError && (error.status === 403 || error.status === 404)) {
    return { result: { kind: 'unavailable' }, failure: 'http', httpStatus: error.status, schemaField: null };
  }
  if (error instanceof ProductionAuthHttpError) {
    return { result: { kind: 'error', code: 'unavailable' }, failure: 'http', httpStatus: error.status, schemaField: null };
  }
  if (error instanceof Error && error.message === 'Main Bluebird API configuration is invalid.') {
    return { result: { kind: 'error', code: 'unavailable' }, failure: 'client-configuration', httpStatus: null, schemaField: null };
  }
  return { result: { kind: 'error', code: 'unavailable' }, failure: 'unavailable', httpStatus: null, schemaField: null };
}

function safeLabel(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text.length > 80 || /eyJ|pk_|sk_|Bearer|token|authorization/i.test(text)) return null;
  if (!/^[A-Za-z][A-Za-z0-9 .·'’_-]{0,79}$/.test(text)) return null;
  return text;
}

function safeSchemaField(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  return /^membership(?:\.[A-Za-z0-9_[\]]+){0,8}$/.test(value) || value === 'json'
    ? value
    : null;
}

function membershipReadFailure(
  error: unknown,
  signal: AbortSignal | undefined,
): DashboardMembershipLoadResult {
  if (signal?.aborted || error instanceof ProductionAuthCancelledError) return { kind: 'cancelled' };
  if (error instanceof ProductionAuthHttpError && error.status === 401) return { kind: 'not_authenticated' };
  if (error instanceof ProductionAuthSchemaError || error instanceof ProductionAuthInvalidJsonError) {
    return { kind: 'invalid' };
  }
  if (error instanceof ProductionAuthTimeoutError) return { kind: 'error', code: 'timeout' };
  if (error instanceof ProductionAuthNetworkError) return { kind: 'error', code: 'network' };
  if (error instanceof ProductionAuthRequestError && error.code === 'token') {
    return { kind: 'not_authenticated' };
  }
  if (error instanceof ProductionAuthHttpError && (error.status === 403 || error.status === 404)) {
    return { kind: 'unavailable' };
  }
  return { kind: 'error', code: 'unavailable' };
}

function isListed<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && allowed.includes(value as T);
}
