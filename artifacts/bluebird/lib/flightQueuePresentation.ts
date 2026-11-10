export interface FlightQueueMemberView {
  initials: string;
  position: number;
  memberRef: string | null;
}

export type FlightQueueConnectionState = 'request' | 'pending' | 'accepted' | 'declined';

const INITIALS = /^[A-Z]{1,2}$/;

/**
 * Ordered waiting-queue members from a roster payload.
 * Incomplete rows are omitted. Full names are never returned.
 * A missing or non-array value means the roster was not supplied.
 */
export function readFlightQueue(value: unknown): FlightQueueMemberView[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) return null;
  const members: FlightQueueMemberView[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    const initials = typeof raw.initials === 'string' ? raw.initials.trim().toUpperCase() : '';
    const position = raw.position;
    const memberRef = typeof raw.memberRef === 'string' && raw.memberRef.trim() !== '' ? raw.memberRef.trim() : null;
    if (!INITIALS.test(initials) || typeof position !== 'number' || !Number.isSafeInteger(position) || position < 1) {
      continue;
    }
    members.push({ initials, position, memberRef });
  }
  return members.sort((left, right) => left.position - right.position || left.initials.localeCompare(right.initials));
}

export interface ProductionQueueMemberView {
  initials: string;
  position: number;
  isViewer: boolean;
  connectionTargetReference: string | null;
  /** Present only when the backend reveals the eligible leader display name. */
  displayName: string | null;
}

const CONNECTION_TARGET_REFERENCE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeConnectionTargetReference(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const reference = value.trim().toLowerCase();
  return CONNECTION_TARGET_REFERENCE.test(reference) ? reference : null;
}

/**
 * Production GET /empty-legs/:id/queue rows. A row that is not initials plus
 * a position, or that does not say whether it is the viewer, fails the whole
 * roster. A missing or non-UUID reference stays off the row. The reference is
 * retained for the server payload and is not a permission to contact that row.
 */
export function normalizeQueueDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > 80) return null;
  if (name.includes('@') || /user_/i.test(name) || /clerk/i.test(name)) return null;
  if (/\d{3,}/.test(name) || /[+]?\d[\d\s().-]{6,}\d/.test(name)) return null;
  return name;
}

export function presentProductionQueueRoster(
  rows: readonly {
    position: number;
    initials: string;
    isViewer: boolean;
    connectionTargetReference?: string | null;
    displayName?: string | null;
  }[],
): ProductionQueueMemberView[] | null {
  const members: ProductionQueueMemberView[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') return null;
    const initials = typeof row.initials === 'string' ? row.initials.trim().toUpperCase() : '';
    const position = row.position;
    if (
      !INITIALS.test(initials) ||
      typeof position !== 'number' ||
      !Number.isSafeInteger(position) ||
      position < 1 ||
      typeof row.isViewer !== 'boolean'
    ) {
      return null;
    }
    members.push({
      initials,
      position,
      isViewer: row.isViewer,
      connectionTargetReference: normalizeConnectionTargetReference(row.connectionTargetReference),
      displayName: normalizeQueueDisplayName(row.displayName),
    });
  }
  if (members.filter((member) => member.isViewer).length > 1) return null;
  return members.sort((left, right) => left.position - right.position || left.initials.localeCompare(right.initials));
}

export type FrontQueueConnectionKind = 'hidden' | 'unavailable' | 'request' | 'pending' | 'accepted' | 'declined';

/**
 * Local demo networking for the front-of-queue member.
 * Production queue requests use presentLeaderQueueConnection with
 * connectionTargetReference from the position-1 row.
 */
export function presentFrontQueueConnection(input: {
  viewerInQueue: boolean;
  viewerIsFirst: boolean;
  channel: 'production' | 'local';
  localEligible?: boolean;
  localStatus?: 'pending' | 'accepted' | 'declined' | null;
}): FrontQueueConnectionKind {
  if (!input.viewerInQueue || input.viewerIsFirst) return 'hidden';
  if (input.channel === 'production') return 'unavailable';
  if (input.localStatus === 'accepted' || input.localStatus === 'pending' || input.localStatus === 'declined') {
    return input.localStatus;
  }
  if (input.localEligible === true) return 'request';
  if (input.localEligible == null) return 'hidden';
  return 'unavailable';
}

export const FRONT_QUEUE_REQUEST_UNAVAILABLE = 'A connection request to the first member is not available from this queue yet.';
export const FRONT_QUEUE_MEMBER_UNAVAILABLE = 'This member is not available for a connection request.';
export const FRONT_QUEUE_PENDING = 'Request Sent';
export const FRONT_QUEUE_DECLINED = 'The previous request was declined.';
export const FRONT_QUEUE_AMBIGUOUS = 'Review this flight in Connections before sending another request.';
export const FRONT_QUEUE_STATUS_UNAVAILABLE = 'Connection status could not be loaded.';
export const JOIN_TO_CONNECT_COPY = "Join this flight's queue to connect with this member.";
export const JOIN_TO_CONNECT_CTA = 'Join the Flight to Connect';
export const SELF_QUEUE_MEMBER_COPY = 'This is you. You cannot send a connection request to yourself.';

export interface LeaderQueueRelationship {
  connectionId: number;
  emptyLegId: number;
  status: 'pending' | 'accepted';
  direction: 'outgoing' | 'incoming';
}

export type LeaderQueueConnection =
  | { kind: 'hidden' }
  | { kind: 'join-to-connect' }
  | { kind: 'self' }
  | { kind: 'loading' }
  | { kind: 'unavailable'; reason: 'reference' | 'status' }
  | { kind: 'request'; reference: string }
  | { kind: 'pending'; connectionId: number }
  | { kind: 'accepted'; connectionId: number }
  | { kind: 'ambiguous' };

/**
 * A member below first may request the position-1 row when that row carries
 * a connectionTargetReference. Pending and Accepted come from
 * GET /me/connections/queue-status for this flight. Incoming pending stays in
 * Connections. More than one outgoing pending or accepted row is kept as
 * ambiguous so the client does not choose one.
 */
export function presentLeaderQueueConnection(input: {
  viewerBelowFirst: boolean;
  reference: string | null;
  requestsEnabled: boolean;
  status: 'ready' | 'loading' | 'error';
  relationships: readonly LeaderQueueRelationship[];
  flightId: number;
  sendBlocked?: boolean;
}): LeaderQueueConnection {
  const forFlight = input.relationships.filter((row) => row.emptyLegId === input.flightId);
  const outgoingPending = forFlight.filter((row) => row.direction === 'outgoing' && row.status === 'pending');
  const accepted = forFlight.filter((row) => row.status === 'accepted');
  if (outgoingPending.length + accepted.length > 1) return { kind: 'ambiguous' };
  if (outgoingPending.length === 1) return { kind: 'pending', connectionId: outgoingPending[0].connectionId };
  if (accepted.length === 1) return { kind: 'accepted', connectionId: accepted[0].connectionId };
  if (!input.viewerBelowFirst) return { kind: 'hidden' };
  if (input.status === 'loading') return { kind: 'loading' };
  if (input.status === 'error') return { kind: 'unavailable', reason: 'status' };
  if (input.sendBlocked === true) return { kind: 'unavailable', reason: 'reference' };
  const reference = normalizeConnectionTargetReference(input.reference);
  if (reference && input.requestsEnabled && input.status === 'ready') return { kind: 'request', reference };
  return { kind: 'unavailable', reason: 'reference' };
}

/** Position comes from the queue row marked as the viewer, then the flight's own position. */
export function leaderQueueViewerIsBelowFirst(position: number | null): boolean {
  return position != null && Number.isSafeInteger(position) && position > 1;
}

/**
 * Position-1 is the only queue connection target. Never take a reference from
 * the viewer's own row. Self-request is blocked when the viewer is first.
 */
export function resolveProductionLeaderQueueTarget(input: {
  roster: readonly ProductionQueueMemberView[] | null | undefined;
  viewerPosition: number | null;
}): {
  target: ProductionQueueMemberView | null;
  reference: string | null;
  viewerBelowFirst: boolean;
  viewerIsLeader: boolean;
} {
  const roster = input.roster ?? null;
  const target = roster?.find((member) => member.position === 1) ?? null;
  const viewerIsLeader = input.viewerPosition === 1 || target?.isViewer === true;
  const viewerBelowFirst = leaderQueueViewerIsBelowFirst(input.viewerPosition) && !viewerIsLeader;
  const reference = viewerBelowFirst
    ? normalizeConnectionTargetReference(target?.connectionTargetReference)
    : null;
  return { target, reference, viewerBelowFirst, viewerIsLeader };
}

/**
 * Flight Details modal state for the first queue member.
 * Before join → join-to-connect. Viewer first → self. Otherwise the joined
 * Send / pending / accepted path.
 */
export function presentLeaderQueuePreviewState(input: {
  viewerInQueue: boolean;
  viewerIsLeader: boolean;
  viewerBelowFirst: boolean;
  reference: string | null;
  requestsEnabled: boolean;
  status: 'ready' | 'loading' | 'error';
  relationships: readonly LeaderQueueRelationship[];
  flightId: number;
  sendBlocked?: boolean;
}): LeaderQueueConnection {
  if (input.viewerIsLeader) return { kind: 'self' };
  if (!input.viewerInQueue) return { kind: 'join-to-connect' };
  return presentLeaderQueueConnection({
    viewerBelowFirst: input.viewerBelowFirst,
    reference: input.reference,
    requestsEnabled: input.requestsEnabled,
    status: input.status,
    relationships: input.relationships,
    flightId: input.flightId,
    sendBlocked: input.sendBlocked,
  });
}

/**
 * Prefer the queue displayName when the backend reveals it for an eligible
 * leader. Otherwise use secured first/last from the target-preview API, then
 * a clean initials fallback. Never invent a name from the viewer's profile.
 */
export function presentLeaderPreviewTitle(input: {
  displayName?: string | null;
  firstName: string | null;
  lastName: string | null;
  initials?: string | null;
}): string {
  const displayName = normalizeQueueDisplayName(input.displayName);
  if (displayName) return displayName;
  const firstName = typeof input.firstName === 'string' ? input.firstName.trim() : '';
  const lastName = typeof input.lastName === 'string' ? input.lastName.trim() : '';
  if (firstName && lastName) return `${firstName} ${lastName}`;
  if (firstName) return firstName;
  const initials = presentLeaderPreviewInitials(input.initials);
  return initials ? `Queue Member · ${initials}` : 'Queue Member';
}

export function presentLeaderPreviewInitials(initials: string | null | undefined): string | null {
  if (typeof initials !== 'string') return null;
  const value = initials.trim().toUpperCase();
  return INITIALS.test(value) ? value : null;
}

/**
 * Opening the position-1 preview is separate from whether Send is enabled.
 * Viewers may open it before joining. The member who is first cannot open a
 * self-request. Pending, Accepted, and ambiguous stay open.
 */
export function canOpenLeaderQueuePreview(input: {
  viewerIsLeader: boolean;
  connection: LeaderQueueConnection['kind'];
}): boolean {
  if (input.connection === 'pending' || input.connection === 'accepted' || input.connection === 'ambiguous') {
    return true;
  }
  if (input.connection === 'self') return false;
  return input.viewerIsLeader !== true;
}

/**
 * Sanitized Send eligibility for development diagnostics.
 * Never includes names, tokens, user ids, or reference values.
 */
export function explainLeaderQueueSendDisabled(input: {
  connection: LeaderQueueConnection;
  viewerPosition: number | null;
  hasReference: boolean;
  requestsEnabled: boolean;
  queueStatus: 'ready' | 'loading' | 'error' | 'disabled';
  relationshipCountForFlight: number;
  queueKind: string;
  participantCount: number | null;
  viewerRowCount: number;
  flightUserInQueue: boolean | null;
  hasFlightViewerQueuePosition: boolean;
}): {
  sendEnabled: boolean;
  reason: string;
  connection: LeaderQueueConnection['kind'];
  viewerPosition: number | null;
  hasReference: boolean;
  requestsEnabled: boolean;
  queueStatus: string;
  relationshipCountForFlight: number;
  queueKind: string;
  participantCount: number | null;
  viewerRowCount: number;
  flightUserInQueue: boolean | null;
  hasFlightViewerQueuePosition: boolean;
} {
  const connection = input.connection.kind;
  const base = {
    connection,
    viewerPosition: input.viewerPosition,
    hasReference: input.hasReference,
    requestsEnabled: input.requestsEnabled,
    queueStatus: input.queueStatus,
    relationshipCountForFlight: input.relationshipCountForFlight,
    queueKind: input.queueKind,
    participantCount: input.participantCount,
    viewerRowCount: input.viewerRowCount,
    flightUserInQueue: input.flightUserInQueue,
    hasFlightViewerQueuePosition: input.hasFlightViewerQueuePosition,
  };
  if (connection === 'request') {
    return { ...base, sendEnabled: true, reason: 'eligible' };
  }
  if (connection === 'pending') {
    return { ...base, sendEnabled: false, reason: 'outgoing_pending' };
  }
  if (connection === 'accepted') {
    return { ...base, sendEnabled: false, reason: 'accepted' };
  }
  if (connection === 'ambiguous') {
    return { ...base, sendEnabled: false, reason: 'ambiguous_relationships' };
  }
  if (connection === 'join-to-connect') {
    return { ...base, sendEnabled: false, reason: 'join_required' };
  }
  if (connection === 'self') {
    return { ...base, sendEnabled: false, reason: 'viewer_is_first' };
  }
  if (connection === 'loading') {
    return { ...base, sendEnabled: false, reason: 'queue_status_loading' };
  }
  if (connection === 'unavailable' && input.connection.kind === 'unavailable' && input.connection.reason === 'status') {
    return { ...base, sendEnabled: false, reason: 'queue_status_error' };
  }
  if (!input.requestsEnabled) {
    return { ...base, sendEnabled: false, reason: 'connections_flag_off' };
  }
  if (input.viewerPosition == null) {
    return { ...base, sendEnabled: false, reason: 'viewer_position_unknown' };
  }
  if (input.viewerPosition <= 1) {
    return { ...base, sendEnabled: false, reason: 'viewer_is_first' };
  }
  if (!input.hasReference) {
    return { ...base, sendEnabled: false, reason: 'missing_connection_target_reference' };
  }
  return { ...base, sendEnabled: false, reason: 'unavailable' };
}

export function mergeLeaderQueueRelationships<T extends { connectionId: number; direction: 'outgoing' | 'incoming' }>(
  server: readonly T[],
  confirmed: readonly T[],
): T[] {
  const seen = new Set(server.map((row) => `${row.connectionId}\0${row.direction}`));
  return [...server, ...confirmed.filter((row) => !seen.has(`${row.connectionId}\0${row.direction}`))];
}

const MEMBER_USER_ID = /^\S{1,255}$/;

/** The chat recipient is the accepted connection's member id, never a queue initial. */
export function acceptedConnectionMemberUserId(
  connectionId: number,
  connections: readonly { id: number; member: { userId: string } }[],
): string | null {
  if (!Number.isSafeInteger(connectionId) || connectionId <= 0) return null;
  const matches = connections.filter((connection) => connection.id === connectionId);
  if (matches.length !== 1) return null;
  const userId = matches[0].member.userId.trim();
  return MEMBER_USER_ID.test(userId) ? userId : null;
}

export type ProductionQueueConnectionState = 'request' | 'pending' | 'accepted' | 'existing';

/**
 * Request is offered only when the server included an opaque reference.
 * Pending and Accepted require a connection id saved from the 201 response.
 * Accepted is that id appearing in GET /me/connections. There is no outgoing
 * pending list, so a lost id cannot be reconstructed.
 */
export function presentProductionQueueConnection(input: {
  connectionTargetReference: string | null;
  connectionId: number | null;
  acceptedConnectionIds: readonly number[];
  relationshipKnown: boolean;
  requestsEnabled: boolean;
}): ProductionQueueConnectionState | null {
  if (input.connectionId != null && Number.isSafeInteger(input.connectionId) && input.acceptedConnectionIds.includes(input.connectionId)) {
    return 'accepted';
  }
  if (input.connectionId != null && Number.isSafeInteger(input.connectionId)) return 'pending';
  if (input.relationshipKnown) return 'existing';
  if (input.connectionTargetReference && input.requestsEnabled) return 'request';
  return null;
}

const queueConnectionRequests = new Map<string, number>();
const queueRelationships = new Set<string>();

function queueConnectionKey(input: { accountId: string; flightId: number; reference: string }): string | null {
  const reference = normalizeConnectionTargetReference(input.reference);
  const accountId = input.accountId.trim();
  if (!reference || !accountId || !Number.isSafeInteger(input.flightId) || input.flightId < 1) return null;
  return `${accountId}\0${input.flightId}\0${reference}`;
}

export function rememberQueueConnectionRequest(input: {
  accountId: string;
  flightId: number;
  reference: string;
  connectionId: number;
}): void {
  const key = queueConnectionKey(input);
  if (!key || !Number.isSafeInteger(input.connectionId) || input.connectionId <= 0) return;
  queueConnectionRequests.set(key, input.connectionId);
  queueRelationships.delete(key);
}

export function readQueueConnectionRequest(input: { accountId: string; flightId: number; reference: string }): number | null {
  const key = queueConnectionKey(input);
  if (!key) return null;
  return queueConnectionRequests.get(key) ?? null;
}

export function rememberQueueRelationship(input: { accountId: string; flightId: number; reference: string }): void {
  const key = queueConnectionKey(input);
  if (!key || queueConnectionRequests.has(key)) return;
  queueRelationships.add(key);
}

export function readQueueRelationship(input: { accountId: string; flightId: number; reference: string }): boolean {
  const key = queueConnectionKey(input);
  return key != null && queueRelationships.has(key);
}

export function retainQueueConnectionRequests(accountId: string): void {
  const prefix = `${accountId.trim()}\0`;
  if (prefix === '\0') return;
  for (const key of queueConnectionRequests.keys()) {
    if (!key.startsWith(prefix)) queueConnectionRequests.delete(key);
  }
  for (const key of queueRelationships) {
    if (!key.startsWith(prefix)) queueRelationships.delete(key);
  }
}

export function clearQueueConnectionRequests(): void {
  queueConnectionRequests.clear();
  queueRelationships.clear();
}

export function queueConnectionRequestFailureCopy(code: string): string {
  if (code === 'self_request') return 'You cannot send a connection request to yourself.';
  if (code === 'unauthorized') return 'Sign in again to send a connection request.';
  if (code === 'active_membership_required') return 'An active membership is required.';
  if (code === 'first_in_queue_required' || code === 'queue_target_unavailable') {
    return 'A connection request to the first member is not available from this queue yet.';
  }
  if (code === 'relationship_exists') return 'A connection with this member already exists.';
  if (code === 'invalid_body') return 'The connection request could not be sent.';
  return 'The connection request could not be sent.';
}

export function queueConnectionRequestShouldRefresh(code: string): boolean {
  return (
    code === 'self_request' || code === 'first_in_queue_required' || code === 'queue_target_unavailable' || code === 'relationship_exists'
  );
}

/**
 * Connection actions are only offered for someone else at the front of the queue.
 * Messaging stays closed until the connection is accepted.
 */
export function presentQueueConnectionAction(input: {
  viewerIsFirst: boolean;
  eligible: boolean;
  status: 'pending' | 'accepted' | 'declined' | null;
}): FlightQueueConnectionState | null {
  if (input.viewerIsFirst) return null;
  if (input.status === 'accepted') return 'accepted';
  if (input.status === 'pending') return 'pending';
  if (input.status === 'declined') return 'declined';
  if (input.eligible) return 'request';
  return null;
}

export const QUEUE_CONNECTION_LABEL: Record<FlightQueueConnectionState, string> = {
  request: 'Request',
  pending: 'Pending',
  accepted: 'Accepted',
  declined: 'Declined',
};

export function queueRequestFailureCopy(code: string | null): string {
  if (code === 'INCOMING_REQUESTS_DISABLED') return 'This member is not accepting connection requests.';
  if (code === 'NO_ELIGIBLE_FRONT_MEMBER' || code === 'NOT_FRONT_MEMBER') {
    return 'A request can only be sent to the first member in the queue.';
  }
  if (code === 'FLIGHT_UNAVAILABLE') return 'This flight is not open for connection requests.';
  if (code === 'NETWORKING_PROFILE_INCOMPLETE') return 'Complete your profile before sending a request.';
  if (code === 'MEMBER_UNAVAILABLE') return 'This member is not available.';
  if (code === 'MEMBERSHIP_REQUIRED') return 'An active membership is required.';
  return 'The connection request could not be sent.';
}
