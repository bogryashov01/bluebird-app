/**
 * Clerk-authenticated member connections for the production website API.
 *
 * Live calls stay off unless EXPO_PUBLIC_BLUEBIRD_MEMBER_CONNECTIONS is the
 * string "true". The native auth-test build never enables them. A disabled
 * client returns before a token is read and before fetch.
 */

import { isNativeProductionAuthTestEnabled } from './nativeAuthTestPolicy';
import {
  validateMainBluebirdApiBaseUrl,
  type MainBluebirdApiEnvironment,
} from './mainBluebirdApiConfig';
import {
  ProductionAuthCancelledError,
  ProductionAuthHttpError,
  ProductionAuthInvalidJsonError,
  ProductionAuthNetworkError,
  ProductionAuthRequestError,
  ProductionAuthSchemaError,
  ProductionAuthTimeoutError,
  PRODUCTION_AUTH_TIMEOUT_MS,
} from './productionAuthApi';
import { requestProductionJson } from './productionRequestTransport';

export const MEMBER_CONNECTIONS_FLAG = 'EXPO_PUBLIC_BLUEBIRD_MEMBER_CONNECTIONS';

export const MEMBER_CONNECTION_PATHS = {
  discover: '/me/connections/discover',
  requests: '/me/connections/requests',
  incoming: '/me/connections/requests/incoming',
  accept: (connectionId: number) => `/me/connections/requests/${connectionId}/accept`,
  decline: (connectionId: number) => `/me/connections/requests/${connectionId}/decline`,
  list: '/me/connections',
  remove: (connectionId: number) => `/me/connections/${connectionId}`,
} as const;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_E164 = /^\+[1-9][0-9]{7,14}$/;
const USER_ID = /^\S{1,255}$/;
const SERVER_CODE = /^[a-z0-9_]{1,80}$/;
const STATUSES = ['pending', 'accepted', 'declined', 'removed'] as const;

export type ConnectionStatus = (typeof STATUSES)[number];

export interface ConnectionMemberIdentity {
  userId: string;
  firstName: string | null;
  lastName: string | null;
}

export interface ConnectionRelationship {
  id: number;
  requester: ConnectionMemberIdentity;
  recipient: ConnectionMemberIdentity;
  status: ConnectionStatus;
  createdAt: string;
  updatedAt: string;
  respondedAt: string | null;
  removedAt: string | null;
}

export interface AcceptedConnection {
  id: number;
  member: ConnectionMemberIdentity;
  connectedAt: string;
}

export type MemberConnectionsFailure =
  | 'configuration'
  | 'token'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'schema'
  | 'invalid_contact'
  | 'invalid_body'
  | 'unauthorized'
  | 'membership_required'
  | 'not_found'
  | 'conflict'
  | 'unavailable';

export type MemberConnectionsResult<T> =
  | { kind: 'disabled' }
  | { kind: 'loaded'; data: T }
  | { kind: 'error'; code: MemberConnectionsFailure };

export interface MemberConnectionsClientOptions {
  enabled: boolean;
  nativeAuthTest?: boolean;
  environment: MainBluebirdApiEnvironment;
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  fetcher?: typeof fetch;
}

interface MemberConnectionsSnapshot {
  clerkUserId: string;
  environment: string;
  apiBaseUrl: string;
  incoming: ConnectionRelationship[];
  accepted: AcceptedConnection[];
}

const snapshots = new Map<string, MemberConnectionsSnapshot>();

export function isMemberConnectionsIntegrationEnabled(input?: {
  flag?: string;
  nativeAuthTest?: boolean;
}): boolean {
  const flag = input?.flag ?? process.env.EXPO_PUBLIC_BLUEBIRD_MEMBER_CONNECTIONS;
  const nativeAuthTest = input?.nativeAuthTest ?? isNativeProductionAuthTestEnabled();
  return flag === 'true' && nativeAuthTest !== true;
}

export function connectionMemberLabel(member: ConnectionMemberIdentity): string {
  const name = [member.firstName, member.lastName]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map((part) => part.trim())
    .join(' ');
  return name || 'Bluebird member';
}

export function memberConnectionsCacheKey(input: {
  environment: string;
  apiBaseUrl: string;
  clerkUserId: string;
}): string {
  return `${input.environment}\0${input.apiBaseUrl}\0${input.clerkUserId}`;
}

export function rememberMemberConnectionsSnapshot(snapshot: MemberConnectionsSnapshot): void {
  if (!snapshot.clerkUserId.trim()) return;
  snapshots.set(memberConnectionsCacheKey(snapshot), snapshot);
}

export function readMemberConnectionsSnapshot(input: {
  environment: string;
  apiBaseUrl: string;
  clerkUserId: string;
}): MemberConnectionsSnapshot | null {
  if (!input.clerkUserId.trim()) return null;
  return snapshots.get(memberConnectionsCacheKey(input)) ?? null;
}

export function retainMemberConnectionsForAccount(clerkUserId: string): void {
  for (const [key, snapshot] of snapshots) {
    if (snapshot.clerkUserId !== clerkUserId) snapshots.delete(key);
  }
}

export function clearMemberConnectionsCache(): void {
  snapshots.clear();
}

export function parseConnectionMemberIdentity(value: unknown, field: string): ConnectionMemberIdentity {
  const raw = objectValue(value, field);
  const userId = stringValue(raw.userId, `${field}.userId`).trim();
  if (!USER_ID.test(userId)) schemaFailure(`${field}.userId`);
  return {
    userId,
    firstName: nullableString(raw.firstName, `${field}.firstName`),
    lastName: nullableString(raw.lastName, `${field}.lastName`),
  };
}

export function parseConnectionRelationship(value: unknown, field: string): ConnectionRelationship {
  const raw = objectValue(value, field);
  const status = stringValue(raw.status, `${field}.status`);
  if (!STATUSES.includes(status as ConnectionStatus)) schemaFailure(`${field}.status`);
  return {
    id: positiveId(raw.id, `${field}.id`),
    requester: parseConnectionMemberIdentity(raw.requester, `${field}.requester`),
    recipient: parseConnectionMemberIdentity(raw.recipient, `${field}.recipient`),
    status: status as ConnectionStatus,
    createdAt: dateTime(raw.createdAt, `${field}.createdAt`),
    updatedAt: dateTime(raw.updatedAt, `${field}.updatedAt`),
    respondedAt: nullableDateTime(raw.respondedAt, `${field}.respondedAt`),
    removedAt: nullableDateTime(raw.removedAt, `${field}.removedAt`),
  };
}

export function parseConnectionDiscovery(value: unknown): { member: ConnectionMemberIdentity | null } {
  const raw = objectValue(value, 'discovery');
  if (!Object.prototype.hasOwnProperty.call(raw, 'member')) schemaFailure('discovery.member');
  return {
    member: raw.member === null
      ? null
      : parseConnectionMemberIdentity(raw.member, 'discovery.member'),
  };
}

export function parseConnectionRequestResponse(value: unknown): { connection: ConnectionRelationship } {
  const raw = objectValue(value, 'connectionRequest');
  return { connection: parseConnectionRelationship(raw.connection, 'connectionRequest.connection') };
}

export function parseIncomingConnectionRequests(value: unknown): { requests: ConnectionRelationship[] } {
  const raw = objectValue(value, 'incomingRequests');
  if (!Array.isArray(raw.requests)) schemaFailure('incomingRequests.requests');
  return {
    requests: raw.requests.map((item, index) => parseConnectionRelationship(item, `incomingRequests.requests.${index}`)),
  };
}

export function parseAcceptedConnections(value: unknown): { connections: AcceptedConnection[] } {
  const raw = objectValue(value, 'acceptedConnections');
  if (!Array.isArray(raw.connections)) schemaFailure('acceptedConnections.connections');
  return {
    connections: raw.connections.map((item, index) => {
      const connection = objectValue(item, `acceptedConnections.connections.${index}`);
      return {
        id: positiveId(connection.id, `acceptedConnections.connections.${index}.id`),
        member: parseConnectionMemberIdentity(connection.member, `acceptedConnections.connections.${index}.member`),
        connectedAt: dateTime(connection.connectedAt, `acceptedConnections.connections.${index}.connectedAt`),
      };
    }),
  };
}

export function discoverConnectionQuery(input: {
  email?: string;
  phoneE164?: string;
}): { ok: true; path: string } | { ok: false; code: 'invalid_contact' } {
  const email = input.email?.trim() ?? '';
  const phone = input.phoneE164?.trim() ?? '';
  const hasEmail = email.length > 0;
  const hasPhone = phone.length > 0;
  if (hasEmail === hasPhone) return { ok: false, code: 'invalid_contact' };
  if (hasEmail) {
    const normalized = email.toLowerCase();
    if (normalized.length > 320 || !EMAIL.test(normalized)) return { ok: false, code: 'invalid_contact' };
    return { ok: true, path: `${MEMBER_CONNECTION_PATHS.discover}?email=${encodeURIComponent(normalized)}` };
  }
  if (!PHONE_E164.test(phone)) return { ok: false, code: 'invalid_contact' };
  return { ok: true, path: `${MEMBER_CONNECTION_PATHS.discover}?phoneE164=${encodeURIComponent(phone)}` };
}

export function createMemberConnectionsClient(options: MemberConnectionsClientOptions) {
  const live = options.enabled === true && options.nativeAuthTest !== true;

  async function request<T>(
    path: string,
    method: 'GET' | 'POST' | 'DELETE',
    parse: (value: unknown) => T,
    body?: Record<string, string>,
  ): Promise<MemberConnectionsResult<T>> {
    if (!live) return { kind: 'disabled' };
    let baseUrl: string;
    try {
      baseUrl = validateMainBluebirdApiBaseUrl(options.baseUrl, options.environment);
    } catch {
      return { kind: 'error', code: 'configuration' };
    }
    try {
      const data = await requestProductionJson({
        url: `${baseUrl}${path}`,
        fetcher: options.fetcher ?? fetch,
        method,
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        credentials: 'omit',
        timeoutMs: PRODUCTION_AUTH_TIMEOUT_MS,
        prepareHeaders: async () => {
          let token: string | null;
          try {
            token = await options.getAccessToken();
          } catch {
            throw new ProductionAuthRequestError('Main API access token is unavailable.', 'token');
          }
          if (typeof token !== 'string' || token.trim() === '' || /\s/.test(token)) {
            throw new ProductionAuthRequestError('Main API access token is unavailable.', 'token');
          }
          return { Authorization: `Bearer ${token}` };
        },
        parse,
        errors: {
          timeout: (duration) => new ProductionAuthTimeoutError(duration),
          cancelled: () => new ProductionAuthCancelledError(),
          network: () => new ProductionAuthNetworkError(),
          http: async (response) => new ProductionAuthHttpError(response.status, await readConnectionError(response)),
          invalidJson: () => new ProductionAuthInvalidJsonError(),
          schema: (error) => new ProductionAuthSchemaError(error instanceof Error ? error.message : 'response'),
        },
      });
      return { kind: 'loaded', data };
    } catch (error) {
      return { kind: 'error', code: failureCode(error) };
    }
  }

  return {
    discover: (input: { email?: string; phoneE164?: string }) => {
      if (!live) return Promise.resolve({ kind: 'disabled' } as const);
      const query = discoverConnectionQuery(input);
      if (!query.ok) return Promise.resolve({ kind: 'error', code: query.code } as const);
      return request(query.path, 'GET', parseConnectionDiscovery);
    },
    createRequest: (targetUserId: string) => {
      if (!live) return Promise.resolve({ kind: 'disabled' } as const);
      const id = targetUserId.trim();
      if (!USER_ID.test(id)) return Promise.resolve({ kind: 'error', code: 'invalid_body' } as const);
      return request(MEMBER_CONNECTION_PATHS.requests, 'POST', parseConnectionRequestResponse, { targetUserId: id });
    },
    listIncoming: () => request(MEMBER_CONNECTION_PATHS.incoming, 'GET', parseIncomingConnectionRequests),
    accept: (connectionId: number) => decision(connectionId, 'accept'),
    decline: (connectionId: number) => decision(connectionId, 'decline'),
    listAccepted: () => request(MEMBER_CONNECTION_PATHS.list, 'GET', parseAcceptedConnections),
    remove: (connectionId: number) => {
      if (!live) return Promise.resolve({ kind: 'disabled' } as const);
      if (!Number.isSafeInteger(connectionId) || connectionId <= 0) {
        return Promise.resolve({ kind: 'error', code: 'invalid_body' } as const);
      }
      return request(MEMBER_CONNECTION_PATHS.remove(connectionId), 'DELETE', parseConnectionRequestResponse);
    },
  };

  function decision(connectionId: number, action: 'accept' | 'decline') {
    if (!live) return Promise.resolve({ kind: 'disabled' } as const);
    if (!Number.isSafeInteger(connectionId) || connectionId <= 0) {
      return Promise.resolve({ kind: 'error', code: 'invalid_body' } as const);
    }
    const path = action === 'accept'
      ? MEMBER_CONNECTION_PATHS.accept(connectionId)
      : MEMBER_CONNECTION_PATHS.decline(connectionId);
    return request(path, 'POST', parseConnectionRequestResponse);
  }
}

function failureCode(error: unknown): MemberConnectionsFailure {
  if (error instanceof ProductionAuthHttpError) {
    if (error.status === 401) return 'unauthorized';
    if (error.status === 403) return error.serverCode === 'active_membership_required' ? 'membership_required' : 'unavailable';
    if (error.status === 404) return 'not_found';
    if (error.status === 409) return 'conflict';
    if (error.status === 400) return 'invalid_body';
    return 'unavailable';
  }
  if (error instanceof ProductionAuthCancelledError) return 'cancelled';
  if (error instanceof ProductionAuthTimeoutError) return 'timeout';
  if (error instanceof ProductionAuthNetworkError) return 'network';
  if (error instanceof ProductionAuthSchemaError || error instanceof ProductionAuthInvalidJsonError) return 'schema';
  if (error instanceof ProductionAuthRequestError && error.code === 'token') return 'token';
  return 'unavailable';
}

async function readConnectionError(response: Response): Promise<{ code: string | null; body: null }> {
  try {
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { code: null, body: null };
    const code = (payload as { code?: unknown }).code;
    return { code: typeof code === 'string' && SERVER_CODE.test(code) ? code : null, body: null };
  } catch {
    return { code: null, body: null };
  }
}

function schemaFailure(field: string): never {
  throw new TypeError(field);
}

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) schemaFailure(field);
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== 'string') schemaFailure(field);
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return stringValue(value, field);
}

function positiveId(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) schemaFailure(field);
  return value;
}

function dateTime(value: unknown, field: string): string {
  const text = stringValue(value, field);
  if (!Number.isFinite(Date.parse(text))) schemaFailure(field);
  return text;
}

function nullableDateTime(value: unknown, field: string): string | null {
  if (value === null) return null;
  return dateTime(value, field);
}
