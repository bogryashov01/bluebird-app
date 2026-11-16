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
  outgoing: '/me/connections/requests/outgoing',
  accept: (connectionId: number) => `/me/connections/requests/${connectionId}/accept`,
  decline: (connectionId: number) => `/me/connections/requests/${connectionId}/decline`,
  list: '/me/connections',
  queueStatus: '/me/connections/queue-status',
  queueTargetPreview: (queueTargetReference: string) =>
    `/me/connections/queue-targets/${encodeURIComponent(queueTargetReference)}/preview`,
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

/**
 * Discover projection. `outgoingRequestPending` is present only when the
 * deployed Main API includes it; omit/undefined means the old contract.
 */
export interface DiscoveredConnectionMember extends ConnectionMemberIdentity {
  outgoingRequestPending?: boolean;
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

/**
 * Privacy-redacted GET /me/connections/requests/outgoing row.
 * Recipient Clerk user IDs and private contact fields are intentionally absent.
 */
export interface OutgoingConnectionRecipient {
  firstName: string | null;
  lastName: string | null;
}

export interface OutgoingConnectionRequest {
  id: number;
  status: ConnectionStatus;
  createdAt: string;
  recipient: OutgoingConnectionRecipient;
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
  | 'incoming_requests_disabled'
  | 'not_found'
  | 'conflict'
  | 'unavailable'
  /** GET /me/connections/requests/outgoing is not deployed yet (HTTP 404). */
  | 'outgoing_unsupported';

export type QueueConnectionRequestFailure =
  | 'configuration'
  | 'token'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'schema'
  | 'invalid_body'
  | 'self_request'
  | 'unauthorized'
  | 'active_membership_required'
  | 'first_in_queue_required'
  | 'queue_target_unavailable'
  | 'relationship_exists'
  | 'unavailable';

export type QueueTargetPreviewFailure =
  | 'configuration'
  | 'token'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'schema'
  | 'invalid_body'
  | 'unauthorized'
  | 'active_membership_required'
  | 'queue_target_unavailable'
  | 'unavailable';

/** Names for the position-1 preview. The queue list never includes these. */
export interface QueueTargetPreview {
  firstName: string;
  lastName: string;
  position: number;
}

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
  outgoing: OutgoingConnectionRequest[];
  /** Recipient user IDs from confirmed creates only — never from redacted GET outgoing. */
  pendingOutgoingRecipientUserIds: string[];
  /** Create receipts that let a later outgoing list release a declined/cancelled pending mark. */
  pendingOutgoingRequestReceipts?: PendingOutgoingRequestReceipt[];
  accepted: AcceptedConnection[];
  outgoingSupported: boolean;
}

/** Links a create-confirmed recipient user ID to its server request ID. */
export interface PendingOutgoingRequestReceipt {
  recipientUserId: string;
  requestId: number;
  /** Client clock (ms) when the create response was confirmed. */
  confirmedAt: number;
}

/**
 * The redacted outgoing list has no recipient user IDs, but it does carry
 * request IDs. A create-confirmed recipient is released only when an outgoing
 * list requested strictly after that create no longer reports the request as
 * pending (declined, cancelled, or accepted). Recipient IDs without a receipt
 * (e.g. from discover) keep their existing stale protection.
 */
export function reconcilePendingOutgoingRecipients(input: {
  recipientUserIds: readonly string[];
  receipts: readonly PendingOutgoingRequestReceipt[];
  outgoing: readonly OutgoingConnectionRequest[];
  listRequestedAt: number;
}): { recipientUserIds: string[]; receipts: PendingOutgoingRequestReceipt[] } {
  const stillPending = new Set(
    input.outgoing.filter((request) => request.status === 'pending').map((request) => request.id),
  );
  const released = new Set<string>();
  const receipts: PendingOutgoingRequestReceipt[] = [];
  for (const receipt of input.receipts) {
    if (receipt.confirmedAt < input.listRequestedAt && !stillPending.has(receipt.requestId)) {
      released.add(receipt.recipientUserId);
    } else {
      receipts.push(receipt);
    }
  }
  if (released.size === 0) {
    return { recipientUserIds: [...input.recipientUserIds], receipts };
  }
  // A newer receipt for the same recipient keeps the mark.
  for (const receipt of receipts) released.delete(receipt.recipientUserId);
  return {
    recipientUserIds: input.recipientUserIds.filter((userId) => !released.has(userId)),
    receipts,
  };
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
  return memberDisplayName(member.firstName, member.lastName);
}

export function outgoingRecipientLabel(recipient: OutgoingConnectionRecipient): string {
  return memberDisplayName(recipient.firstName, recipient.lastName);
}

function memberDisplayName(firstName: string | null, lastName: string | null): string {
  const name = [firstName, lastName]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map((part) => part.trim())
    .join(' ');
  return name || 'Bluebird member';
}

/** Project a confirmed create response into the redacted outgoing display DTO. */
export function projectOutgoingConnectionRequest(
  connection: ConnectionRelationship,
): OutgoingConnectionRequest {
  return {
    id: connection.id,
    status: connection.status,
    createdAt: connection.createdAt,
    recipient: {
      firstName: connection.recipient.firstName,
      lastName: connection.recipient.lastName,
    },
  };
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

export function parseDiscoveredConnectionMember(value: unknown, field: string): DiscoveredConnectionMember {
  const identity = parseConnectionMemberIdentity(value, field);
  const raw = objectValue(value, field);
  if (!Object.prototype.hasOwnProperty.call(raw, 'outgoingRequestPending')) {
    return identity;
  }
  if (typeof raw.outgoingRequestPending !== 'boolean') {
    schemaFailure(`${field}.outgoingRequestPending`);
  }
  return {
    ...identity,
    outgoingRequestPending: raw.outgoingRequestPending,
  };
}

export function parseConnectionDiscovery(value: unknown): { member: DiscoveredConnectionMember | null } {
  const raw = objectValue(value, 'discovery');
  if (!Object.prototype.hasOwnProperty.call(raw, 'member')) schemaFailure('discovery.member');
  return {
    member: raw.member === null
      ? null
      : parseDiscoveredConnectionMember(raw.member, 'discovery.member'),
  };
}

export function parseConnectionRequestResponse(value: unknown): { connection: ConnectionRelationship } {
  const raw = objectValue(value, 'connectionRequest');
  return { connection: parseConnectionRelationship(raw.connection, 'connectionRequest.connection') };
}

export interface QueueConnectionAcknowledgement {
  id: number;
  status: 'pending';
  createdAt: string;
  updatedAt: string;
  respondedAt: string | null;
  removedAt: string | null;
}

const QUEUE_TARGET_REFERENCE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeQueueTargetReference(value: string): string | null {
  const reference = value.trim().toLowerCase();
  return QUEUE_TARGET_REFERENCE.test(reference) ? reference : null;
}

const PREVIEW_NAME = /^[\p{L}][\p{L}\p{M}'’.\- ]{0,79}$/u;

/**
 * GET queue-target preview. Only first name, last name, and position are kept.
 * Extra identity fields from the server are dropped.
 */
export function parseQueueTargetPreview(value: unknown): QueueTargetPreview {
  const raw = objectValue(value, 'queueTargetPreview');
  const firstName = previewName(raw.firstName, 'queueTargetPreview.firstName');
  const lastName = previewName(raw.lastName, 'queueTargetPreview.lastName');
  const position = positiveId(raw.position, 'queueTargetPreview.position');
  return { firstName, lastName, position };
}

/** Queue requests return an id and status. They do not include member identities. */
export function parseQueueConnectionAcknowledgement(value: unknown): { connection: QueueConnectionAcknowledgement } {
  const raw = objectValue(value, 'queueConnectionRequest');
  const connection = objectValue(raw.connection, 'queueConnectionRequest.connection');
  const status = stringValue(connection.status, 'queueConnectionRequest.connection.status');
  if (status !== 'pending') schemaFailure('queueConnectionRequest.connection.status');
  return {
    connection: {
      id: positiveId(connection.id, 'queueConnectionRequest.connection.id'),
      status: 'pending',
      createdAt: dateTime(connection.createdAt, 'queueConnectionRequest.connection.createdAt'),
      updatedAt: dateTime(connection.updatedAt, 'queueConnectionRequest.connection.updatedAt'),
      respondedAt: nullableDateTime(connection.respondedAt, 'queueConnectionRequest.connection.respondedAt'),
      removedAt: nullableDateTime(connection.removedAt, 'queueConnectionRequest.connection.removedAt'),
    },
  };
}

export interface QueueConnectionRelationship {
  connectionId: number;
  emptyLegId: number;
  status: 'pending' | 'accepted';
  direction: 'outgoing' | 'incoming';
  updatedAt: string;
}

/**
 * Restores queue connection state after restart. Rows keep their own ids and
 * directions. Member identities are not part of this response.
 */
export function parseQueueConnectionStatus(value: unknown): { relationships: QueueConnectionRelationship[] } {
  const raw = objectValue(value, 'queueConnectionStatus');
  if (!Array.isArray(raw.relationships)) schemaFailure('queueConnectionStatus.relationships');
  return {
    relationships: raw.relationships.map((item, index) => {
      const field = `queueConnectionStatus.relationships.${index}`;
      const row = objectValue(item, field);
      const status = stringValue(row.status, `${field}.status`);
      const direction = stringValue(row.direction, `${field}.direction`);
      if (status !== 'pending' && status !== 'accepted') schemaFailure(`${field}.status`);
      if (direction !== 'outgoing' && direction !== 'incoming') schemaFailure(`${field}.direction`);
      return {
        connectionId: positiveId(row.connectionId, `${field}.connectionId`),
        emptyLegId: positiveId(row.emptyLegId, `${field}.emptyLegId`),
        status,
        direction,
        updatedAt: dateTime(row.updatedAt, `${field}.updatedAt`),
      };
    }),
  };
}

export function parseIncomingConnectionRequests(value: unknown): { requests: ConnectionRelationship[] } {
  const raw = objectValue(value, 'incomingRequests');
  if (!Array.isArray(raw.requests)) schemaFailure('incomingRequests.requests');
  return {
    requests: raw.requests.map((item, index) => parseConnectionRelationship(item, `incomingRequests.requests.${index}`)),
  };
}

/**
 * Privacy-redacted outgoing list. Parses only id, status, createdAt, and
 * recipient first/last name. Extra identity fields are ignored, never stored.
 */
export function parseOutgoingConnectionRequests(value: unknown): { requests: OutgoingConnectionRequest[] } {
  const raw = objectValue(value, 'outgoingRequests');
  if (!Array.isArray(raw.requests)) schemaFailure('outgoingRequests.requests');
  return {
    requests: raw.requests.map((item, index) =>
      parseOutgoingConnectionRequest(item, `outgoingRequests.requests.${index}`)),
  };
}

export function parseOutgoingConnectionRequest(value: unknown, field: string): OutgoingConnectionRequest {
  const raw = objectValue(value, field);
  const status = stringValue(raw.status, `${field}.status`);
  if (!STATUSES.includes(status as ConnectionStatus)) schemaFailure(`${field}.status`);
  const recipient = objectValue(raw.recipient, `${field}.recipient`);
  return {
    id: positiveId(raw.id, `${field}.id`),
    status: status as ConnectionStatus,
    createdAt: dateTime(raw.createdAt, `${field}.createdAt`),
    recipient: {
      firstName: nullableString(recipient.firstName, `${field}.recipient.firstName`),
      lastName: nullableString(recipient.lastName, `${field}.recipient.lastName`),
    },
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

  async function request<T, Code extends string = MemberConnectionsFailure>(
    path: string,
    method: 'GET' | 'POST' | 'DELETE',
    parse: (value: unknown) => T,
    body?: Record<string, string>,
    mapFailure: (error: unknown) => Code = failureCode as (error: unknown) => Code,
  ): Promise<{ kind: 'disabled' } | { kind: 'loaded'; data: T } | { kind: 'error'; code: Code }> {
    if (!live) return { kind: 'disabled' };
    let baseUrl: string;
    try {
      baseUrl = validateMainBluebirdApiBaseUrl(options.baseUrl, options.environment);
    } catch {
      return { kind: 'error', code: 'configuration' as Code };
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
      return { kind: 'error', code: mapFailure(error) };
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
    createQueueRequest: (queueTargetReference: string) => {
      if (!live) return Promise.resolve({ kind: 'disabled' } as const);
      const reference = normalizeQueueTargetReference(queueTargetReference);
      if (!reference) return Promise.resolve({ kind: 'error', code: 'invalid_body' } as const);
      return request(
        MEMBER_CONNECTION_PATHS.requests,
        'POST',
        parseQueueConnectionAcknowledgement,
        { queueTargetReference: reference },
        queueConnectionFailureCode,
      );
    },
    previewQueueTarget: (queueTargetReference: string) => {
      if (!live) return Promise.resolve({ kind: 'disabled' } as const);
      const reference = normalizeQueueTargetReference(queueTargetReference);
      if (!reference) return Promise.resolve({ kind: 'error', code: 'invalid_body' } as const);
      return request(
        MEMBER_CONNECTION_PATHS.queueTargetPreview(reference),
        'GET',
        parseQueueTargetPreview,
        undefined,
        queueTargetPreviewFailureCode,
      );
    },
    listIncoming: () => request(MEMBER_CONNECTION_PATHS.incoming, 'GET', parseIncomingConnectionRequests),
    listOutgoing: () => request(
      MEMBER_CONNECTION_PATHS.outgoing,
      'GET',
      parseOutgoingConnectionRequests,
      undefined,
      outgoingListFailureCode,
    ),
    listQueueStatus: () => request(MEMBER_CONNECTION_PATHS.queueStatus, 'GET', parseQueueConnectionStatus),
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

function outgoingListFailureCode(error: unknown): MemberConnectionsFailure {
  if (error instanceof ProductionAuthHttpError && error.status === 404) {
    return 'outgoing_unsupported';
  }
  return failureCode(error);
}

function queueConnectionFailureCode(error: unknown): QueueConnectionRequestFailure {
  if (error instanceof ProductionAuthHttpError) {
    const code = error.serverCode;
    if (error.status === 400 && code === 'self_request') return 'self_request';
    if (error.status === 400) return 'invalid_body';
    if (error.status === 401) return 'unauthorized';
    if (error.status === 403 && code === 'active_membership_required') return 'active_membership_required';
    if (error.status === 403 && code === 'first_in_queue_required') return 'first_in_queue_required';
    // Opted-out recipients are 404 queue_target_unavailable — never surface privacy here.
    if (error.status === 403 && code === 'incoming_requests_disabled') return 'unavailable';
    if (error.status === 404 && code === 'queue_target_unavailable') return 'queue_target_unavailable';
    if (error.status === 409 && code === 'relationship_exists') return 'relationship_exists';
    return 'unavailable';
  }
  if (error instanceof ProductionAuthCancelledError) return 'cancelled';
  if (error instanceof ProductionAuthTimeoutError) return 'timeout';
  if (error instanceof ProductionAuthNetworkError) return 'network';
  if (error instanceof ProductionAuthSchemaError || error instanceof ProductionAuthInvalidJsonError) return 'schema';
  if (error instanceof ProductionAuthRequestError && error.code === 'token') return 'token';
  return 'unavailable';
}

function queueTargetPreviewFailureCode(error: unknown): QueueTargetPreviewFailure {
  if (error instanceof ProductionAuthHttpError) {
    const code = error.serverCode;
    if (error.status === 400) return 'invalid_body';
    if (error.status === 401) return 'unauthorized';
    if (error.status === 403 && code === 'active_membership_required') return 'active_membership_required';
    if (error.status === 404) return 'queue_target_unavailable';
    return 'unavailable';
  }
  if (error instanceof ProductionAuthCancelledError) return 'cancelled';
  if (error instanceof ProductionAuthTimeoutError) return 'timeout';
  if (error instanceof ProductionAuthNetworkError) return 'network';
  if (error instanceof ProductionAuthSchemaError || error instanceof ProductionAuthInvalidJsonError) return 'schema';
  if (error instanceof ProductionAuthRequestError && error.code === 'token') return 'token';
  return 'unavailable';
}

function previewName(value: unknown, field: string): string {
  const text = stringValue(value, field).trim().replace(/\s+/g, ' ');
  if (!PREVIEW_NAME.test(text)) schemaFailure(field);
  return text;
}

function failureCode(error: unknown): MemberConnectionsFailure {
  if (error instanceof ProductionAuthHttpError) {
    if (error.status === 401) return 'unauthorized';
    if (error.status === 403 && error.serverCode === 'active_membership_required') return 'membership_required';
    if (error.status === 403 && error.serverCode === 'incoming_requests_disabled') {
      return 'incoming_requests_disabled';
    }
    if (error.status === 403) return 'unavailable';
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
