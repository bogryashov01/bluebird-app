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
  /** Present only when the response included imageUrl. Invalid values are null. */
  imageUrl?: string | null;
}

/**
 * Discover projection. `outgoingRequestPending` is present only when the
 * deployed Main API includes it; omit/undefined means the old contract.
 */
export interface DiscoveredConnectionMember extends ConnectionMemberIdentity {
  outgoingRequestPending?: boolean;
  /**
   * Present only when discover sent the key. `null` means the server confirmed
   * there is no relationship. Absent means the old contract omitted it.
   */
  relationshipStatus?: ConnectionStatus | null;
  relationshipDirection?: ConnectionRelationshipDirection | null;
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
  /** Present only when the response included imageUrl. Invalid values are null. */
  imageUrl?: string | null;
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

/** Direction on Task #1844 structured HTTP 409 relationship payloads. */
export type ConnectionRelationshipDirection = 'outgoing' | 'incoming';

/**
 * Structured relationship facts from HTTP 409 create-request conflicts.
 * Absent or unparsable fields mean the deployed API is older than Task #1844.
 */
export type ConnectionRelationshipConflict = {
  status: ConnectionStatus;
  direction: ConnectionRelationshipDirection | null;
};

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
  | {
      kind: 'error';
      code: MemberConnectionsFailure;
      /** Present when HTTP 409 includes Task #1844 relationship fields. */
      relationship?: ConnectionRelationshipConflict;
    };

function connectionStatusValue(value: unknown): ConnectionStatus | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return (STATUSES as readonly string[]).includes(normalized)
    ? (normalized as ConnectionStatus)
    : null;
}

function connectionDirectionValue(value: unknown): ConnectionRelationshipDirection | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized === 'outgoing' || normalized === 'incoming' ? normalized : null;
}

/**
 * Reads relationship status/direction from a sanitized 409 body.
 * Accepts Task #1844 camelCase fields plus common aliases/nesting so a
 * Production payload without the exact keys still resolves when possible.
 * Returns null when the payload is missing or schema-out-of-date.
 */
export function parseConnectionRelationshipConflict(
  value: unknown,
): ConnectionRelationshipConflict | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const nested =
    record.relationship
    && typeof record.relationship === 'object'
    && !Array.isArray(record.relationship)
      ? record.relationship as Record<string, unknown>
      : record.existingRelationship
        && typeof record.existingRelationship === 'object'
        && !Array.isArray(record.existingRelationship)
        ? record.existingRelationship as Record<string, unknown>
        : null;

  const status = connectionStatusValue(record.relationshipStatus)
    ?? connectionStatusValue(record.relationship_status)
    ?? connectionStatusValue(record.status)
    ?? (nested
      ? connectionStatusValue(nested.relationshipStatus)
        ?? connectionStatusValue(nested.relationship_status)
        ?? connectionStatusValue(nested.status)
      : null);
  if (!status) return null;

  const direction = connectionDirectionValue(record.relationshipDirection)
    ?? connectionDirectionValue(record.relationship_direction)
    ?? connectionDirectionValue(record.direction)
    ?? (nested
      ? connectionDirectionValue(nested.relationshipDirection)
        ?? connectionDirectionValue(nested.relationship_direction)
        ?? connectionDirectionValue(nested.direction)
      : null);

  return { status, direction };
}

/** User-facing copy for direct createRequest HTTP 409 conflicts. */
export function presentConnectionRequestConflict(
  relationship: ConnectionRelationshipConflict | null | undefined,
): string {
  if (!relationship) {
    return 'Connection status unavailable. Send request is disabled until Bluebird can confirm the relationship — check Connections, Incoming, or Sent Requests.';
  }
  switch (relationship.status) {
    case 'pending':
      return relationship.direction === 'incoming'
        ? 'This member already sent you a connection request. Open Requests to respond.'
        : 'A connection request to this member is already pending.';
    case 'accepted':
      return 'You’re already connected with this member.';
    case 'declined':
      return 'A previous connection request with this member was declined. It won’t appear under Sent Requests.';
    case 'removed':
      return 'This connection was removed and can’t be restored yet. Try again later.';
  }
}

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
 * pending (declined, cancelled, or accepted).
 *
 * Recipient IDs without a create receipt are dropped: Find Member pending must
 * come from a successful create receipt, discover.outgoingRequestPending === true,
 * or structured 409 facts — never from an invented conflict mark.
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
  const receipts: PendingOutgoingRequestReceipt[] = [];
  for (const receipt of input.receipts) {
    if (receipt.confirmedAt < input.listRequestedAt && !stillPending.has(receipt.requestId)) {
      continue;
    }
    receipts.push(receipt);
  }
  const confirmedRecipientIds = new Set(receipts.map((receipt) => receipt.recipientUserId));
  return {
    recipientUserIds: input.recipientUserIds.filter((userId) => confirmedRecipientIds.has(userId)),
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
      ...(connection.recipient.imageUrl !== undefined ? { imageUrl: connection.recipient.imageUrl } : {}),
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

function optionalMemberImageUrl(raw: Record<string, unknown>): string | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(raw, 'imageUrl')) return undefined;
  const value = raw.imageUrl;
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > 2000) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return text;
  } catch {
    return null;
  }
}

export function parseConnectionMemberIdentity(value: unknown, field: string): ConnectionMemberIdentity {
  const raw = objectValue(value, field);
  const userId = stringValue(raw.userId, `${field}.userId`).trim();
  if (!USER_ID.test(userId)) schemaFailure(`${field}.userId`);
  const imageUrl = optionalMemberImageUrl(raw);
  return {
    userId,
    firstName: nullableString(raw.firstName, `${field}.firstName`),
    lastName: nullableString(raw.lastName, `${field}.lastName`),
    ...(imageUrl !== undefined ? { imageUrl } : {}),
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

function optionalDiscoverStatus(
  raw: Record<string, unknown>,
  field: string,
): ConnectionStatus | null | undefined {
  const hasCamel = Object.prototype.hasOwnProperty.call(raw, 'relationshipStatus');
  const hasSnake = Object.prototype.hasOwnProperty.call(raw, 'relationship_status');
  if (!hasCamel && !hasSnake) return undefined;
  const value = hasCamel ? raw.relationshipStatus : raw.relationship_status;
  if (value === null) return null;
  const status = connectionStatusValue(value);
  if (!status) schemaFailure(`${field}.relationshipStatus`);
  return status;
}

function optionalDiscoverDirection(
  raw: Record<string, unknown>,
  field: string,
): ConnectionRelationshipDirection | null | undefined {
  const hasCamel = Object.prototype.hasOwnProperty.call(raw, 'relationshipDirection');
  const hasSnake = Object.prototype.hasOwnProperty.call(raw, 'relationship_direction');
  if (!hasCamel && !hasSnake) return undefined;
  const value = hasCamel ? raw.relationshipDirection : raw.relationship_direction;
  if (value === null) return null;
  const direction = connectionDirectionValue(value);
  if (!direction) schemaFailure(`${field}.relationshipDirection`);
  return direction;
}

export function parseDiscoveredConnectionMember(value: unknown, field: string): DiscoveredConnectionMember {
  const identity = parseConnectionMemberIdentity(value, field);
  const raw = objectValue(value, field);
  const relationshipStatus = optionalDiscoverStatus(raw, field);
  const relationshipDirection = optionalDiscoverDirection(raw, field);
  const hasPending = Object.prototype.hasOwnProperty.call(raw, 'outgoingRequestPending');
  if (!hasPending && relationshipStatus === undefined && relationshipDirection === undefined) {
    return identity;
  }
  if (hasPending && typeof raw.outgoingRequestPending !== 'boolean') {
    schemaFailure(`${field}.outgoingRequestPending`);
  }
  return {
    ...identity,
    ...(hasPending ? { outgoingRequestPending: raw.outgoingRequestPending as boolean } : {}),
    ...(relationshipStatus !== undefined ? { relationshipStatus } : {}),
    ...(relationshipDirection !== undefined ? { relationshipDirection } : {}),
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
  const imageUrl = optionalMemberImageUrl(recipient);
  return {
    id: positiveId(raw.id, `${field}.id`),
    status: status as ConnectionStatus,
    createdAt: dateTime(raw.createdAt, `${field}.createdAt`),
    recipient: {
      firstName: nullableString(recipient.firstName, `${field}.recipient.firstName`),
      lastName: nullableString(recipient.lastName, `${field}.recipient.lastName`),
      ...(imageUrl !== undefined ? { imageUrl } : {}),
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
  ): Promise<
    | { kind: 'disabled' }
    | { kind: 'loaded'; data: T }
    | { kind: 'error'; code: Code; relationship?: ConnectionRelationshipConflict }
  > {
    if (!live) return { kind: 'disabled' };
    let baseUrl: string;
    try {
      baseUrl = validateMainBluebirdApiBaseUrl(options.baseUrl, options.environment);
    } catch {
      return { kind: 'error', code: 'configuration' as Code };
    }
    const queueConnectionPost = method === 'POST'
      && path === MEMBER_CONNECTION_PATHS.requests
      && body != null
      && Object.prototype.hasOwnProperty.call(body, 'queueTargetReference');
    let queueHttpStatus: number | null = null;
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
        onResponseStatus: queueConnectionPost ? (status) => {
          queueHttpStatus = status;
        } : undefined,
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
          http: async (response) => new ProductionAuthHttpError(
            response.status,
            await readConnectionError(response, method === 'POST' && path === MEMBER_CONNECTION_PATHS.requests
              ? { targetUserId: body?.targetUserId }
              : undefined),
          ),
          invalidJson: () => new ProductionAuthInvalidJsonError(),
          schema: (error) => new ProductionAuthSchemaError(error instanceof Error ? error.message : 'response'),
        },
      });
      if (typeof __DEV__ !== 'undefined' && __DEV__ && queueConnectionPost) {
        console.info('[QUEUE-CONNECTION-DEBUG]', JSON.stringify({
          event: 'post-response',
          postSent: true,
          httpStatus: queueHttpStatus,
          code: null,
          outcome: 'loaded',
        }));
      }
      return { kind: 'loaded', data };
    } catch (error) {
      const code = mapFailure(error);
      if (typeof __DEV__ !== 'undefined' && __DEV__ && queueConnectionPost) {
        console.info('[QUEUE-CONNECTION-DEBUG]', JSON.stringify({
          event: 'post-response',
          postSent: true,
          httpStatus: error instanceof ProductionAuthHttpError ? error.status : queueHttpStatus,
          code,
          outcome: 'error',
        }));
      }
      if (error instanceof ProductionAuthHttpError && error.status === 409) {
        const relationship = parseConnectionRelationshipConflict(error.failureBody);
        if (relationship) return { kind: 'error', code, relationship };
      }
      return { kind: 'error', code };
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
      if (!live) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.info('[QUEUE-CONNECTION-DEBUG]', JSON.stringify({
            event: 'post-skipped',
            postSent: false,
            reason: 'disabled',
          }));
        }
        return Promise.resolve({ kind: 'disabled' } as const);
      }
      const reference = normalizeQueueTargetReference(queueTargetReference);
      if (!reference) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.info('[QUEUE-CONNECTION-DEBUG]', JSON.stringify({
            event: 'post-skipped',
            postSent: false,
            reason: 'invalid-reference',
          }));
        }
        return Promise.resolve({ kind: 'error', code: 'invalid_body' } as const);
      }
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.info('[QUEUE-CONNECTION-DEBUG]', JSON.stringify({
          event: 'post-sent',
          postSent: true,
        }));
      }
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

function targetUserIdShape(value: string | undefined): 'missing' | 'clerk_user' | 'numeric' | 'other' {
  if (!value) return 'missing';
  if (value.startsWith('user_')) return 'clerk_user';
  if (/^\d+$/.test(value)) return 'numeric';
  return 'other';
}

function redactDiagnosticValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (value.startsWith('eyJ') || value.includes('@') || /^\+?\d{8,}$/.test(value) || /^user_/i.test(value)) {
      return '[redacted]';
    }
    return value.replace(/user_[A-Za-z0-9]+/g, '[redacted-user]').slice(0, 240);
  }
  if (Array.isArray(value)) return depth > 3 ? { type: 'array', length: value.length } : value.slice(0, 8).map((item) => redactDiagnosticValue(item, depth + 1));
  if (typeof value !== 'object' || depth > 3) return { type: typeof value };
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    if (/authorization|token|phone|email|secret|cookie/i.test(key)) {
      out[key] = '[redacted]';
    } else {
      out[key] = redactDiagnosticValue(record[key], depth + 1);
    }
  }
  return out;
}

async function readConnectionError(
  response: Response,
  createDiagnostic?: { targetUserId?: string },
): Promise<{ code: string | null; body: unknown }> {
  try {
    const payload: unknown = await response.json();
    if (typeof __DEV__ !== 'undefined' && __DEV__ && createDiagnostic) {
      const record = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload as Record<string, unknown>
        : null;
      console.info('[connection-create]', JSON.stringify({
        status: response.status,
        request: {
          method: 'POST',
          path: MEMBER_CONNECTION_PATHS.requests,
          bodyKeys: ['targetUserId'],
          targetUserIdShape: targetUserIdShape(createDiagnostic.targetUserId),
          targetUserIdLength: createDiagnostic.targetUserId?.length ?? 0,
        },
        code: typeof record?.code === 'string' ? record.code : null,
        error: typeof record?.error === 'string' ? record.error : null,
        requestId: typeof record?.requestId === 'string' && !record.requestId.startsWith('user_')
          ? record.requestId.slice(0, 80)
          : typeof record?.request_id === 'string' && !record.request_id.startsWith('user_')
            ? record.request_id.slice(0, 80)
            : null,
        body: redactDiagnosticValue(payload),
      }));
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { code: null, body: null };
    }
    const record = payload as Record<string, unknown>;
    const rawCode = record.code ?? record.error;
    const code = typeof rawCode === 'string' && SERVER_CODE.test(rawCode) ? rawCode : null;
    const relationship = parseConnectionRelationshipConflict(record);
    if (!code && !relationship) return { code: null, body: null };
    return {
      code,
      body: {
        ...(code ? { code } : {}),
        ...(relationship
          ? {
            relationshipStatus: relationship.status,
            ...(relationship.direction ? { relationshipDirection: relationship.direction } : {}),
          }
          : {}),
        // Preserve nested relationship object for alias parsing on retry paths.
        ...(record.relationship && typeof record.relationship === 'object'
          ? { relationship: record.relationship }
          : {}),
        ...(record.existingRelationship && typeof record.existingRelationship === 'object'
          ? { existingRelationship: record.existingRelationship }
          : {}),
      },
    };
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
