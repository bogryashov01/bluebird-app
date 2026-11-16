import type { ReadRequestOptions } from './productionFlights';
import { fetchProductionJson } from './productionFlights';

/** Public active flight-policy document. It does not require a Clerk token. */
export const ACTIVE_FLIGHT_POLICY_PATH = '/tos/active/flight_policy';

/** The website treats the policy as read when no more than this many pixels remain. */
export const POLICY_SCROLL_END_PX = 4;

export interface ActiveFlightPolicy {
  kind: 'flight_policy';
  versionId: number;
  versionLabel: string;
  body: string;
  publishedAt: string;
}

export function parseActiveFlightPolicy(value: unknown): ActiveFlightPolicy {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('flightPolicy');
  }
  const raw = value as Record<string, unknown>;
  if (raw.kind !== 'flight_policy') throw new TypeError('flightPolicy.kind');
  if (!Number.isSafeInteger(raw.versionId) || (raw.versionId as number) < 1) {
    throw new TypeError('flightPolicy.versionId');
  }
  if (typeof raw.versionLabel !== 'string' || raw.versionLabel.trim().length === 0) {
    throw new TypeError('flightPolicy.versionLabel');
  }
  if (typeof raw.body !== 'string' || raw.body.trim().length === 0) {
    throw new TypeError('flightPolicy.body');
  }
  if (typeof raw.publishedAt !== 'string' || !Number.isFinite(Date.parse(raw.publishedAt))) {
    throw new TypeError('flightPolicy.publishedAt');
  }
  return {
    kind: 'flight_policy',
    versionId: raw.versionId as number,
    versionLabel: raw.versionLabel,
    body: raw.body,
    publishedAt: raw.publishedAt,
  };
}

export async function fetchActiveFlightPolicy(
  options: ReadRequestOptions = {},
): Promise<ActiveFlightPolicy> {
  return parseActiveFlightPolicy(await fetchProductionJson(ACTIVE_FLIGHT_POLICY_PATH, {
    signal: options.signal,
    baseUrl: options.baseUrl,
    environment: options.environment,
    fetcher: options.fetcher,
    timeoutMs: options.timeoutMs,
  }));
}

export function presentFlightPolicyFailure(kind: 'missing' | 'invalid' | 'network'): { title: string; body: string } {
  if (kind === 'missing') {
    return { title: 'Flight policy unavailable', body: 'The active flight policy is not available right now.' };
  }
  if (kind === 'invalid') {
    return { title: 'Flight policy unavailable', body: 'The active flight policy couldn’t be shown.' };
  }
  return { title: 'Connection problem', body: 'The flight policy couldn’t be loaded.' };
}

export function measurePolicyScroll(input: {
  viewportHeight: number | null;
  contentHeight: number | null;
  offsetY: number | null;
}): boolean {
  if (input.viewportHeight === null || input.contentHeight === null) return false;
  if (!(input.viewportHeight > 0) || !(input.contentHeight > 0)) return false;
  const offset = input.offsetY === null ? 0 : input.offsetY;
  if (!Number.isFinite(offset) || offset < 0) return false;
  const remaining = input.contentHeight - (input.viewportHeight + offset);
  return remaining <= POLICY_SCROLL_END_PX;
}

export function policyAgreementScopeKey(input: {
  clerkUserId: string | null;
  legId: number | null;
  versionId: number | null;
  body: string | null;
}): string | null {
  const userId = input.clerkUserId?.trim() ?? '';
  if (!userId || !Number.isSafeInteger(input.legId) || (input.legId ?? 0) < 1) return null;
  if (!Number.isSafeInteger(input.versionId) || (input.versionId ?? 0) < 1) return null;
  if (!input.body || input.body.trim().length === 0) return null;
  return `${userId}|${input.legId}|${input.versionId}|${input.body}`;
}

export interface PolicyReadState {
  scopeKey: string | null;
  checked: boolean;
}

export function createPolicyReadState(): PolicyReadState {
  return { scopeKey: null, checked: false };
}

export function syncPolicyReadState(
  state: PolicyReadState,
  scopeKey: string | null,
  scrollComplete: boolean,
): PolicyReadState {
  if (scopeKey === null || state.scopeKey !== scopeKey || !scrollComplete) {
    return { scopeKey, checked: false };
  }
  return state;
}

/** A scroll update never checks the box. Only an explicit tap can. */
export function togglePolicyAgreement(
  state: PolicyReadState,
  explicitTap: boolean,
  scrollComplete: boolean,
): PolicyReadState {
  if (explicitTap !== true || scrollComplete !== true || state.scopeKey === null) return state;
  return { ...state, checked: !state.checked };
}
