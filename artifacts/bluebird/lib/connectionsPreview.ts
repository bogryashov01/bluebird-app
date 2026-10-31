/**
 * Local Connections and Messaging preview.
 * This module never calls the network. The method names mirror a proposed
 * future API that is not deployed and must not be requested from this build.
 */

export const CONNECTIONS_PREVIEW_VERSION = 1;
export const MESSAGE_CHARACTER_LIMIT = 2000;
export const CONNECTIONS_PREVIEW_TITLE = 'Connections';
export const DEMO_CONVERSATION_NOTICE = 'Demo conversation — messages are stored on this device only.';
export const CONNECTIONS_MEMBERSHIP_UNVERIFIED = 'Membership is not confirmed for Connections. This preview stays on this device.';
export const CONNECTIONS_INVITE_WITHOUT_LINK = 'I\'d love to invite you to Bluebird Jets.';
export const SELF_MEMBER_ID = 'self';

const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,128}$/;
const RECORD_ID = /^demo-[a-z0-9-]{1,80}$/;

export interface DemoMemberProfile {
  id: string;
  displayName: string;
  headline: string;
  homeAirport: string;
}

export const DEMO_MEMBER_DIRECTORY: readonly DemoMemberProfile[] = [
  { id: 'demo-avery-lang', displayName: 'Avery Lang', headline: 'Demo profile · Austin', homeAirport: 'AUS' },
  { id: 'demo-blake-ortiz', displayName: 'Blake Ortiz', headline: 'Demo profile · Denver', homeAirport: 'DEN' },
  { id: 'demo-casey-nguyen', displayName: 'Casey Nguyen', headline: 'Demo profile · Miami', homeAirport: 'MIA' },
  { id: 'demo-drew-patel', displayName: 'Drew Patel', headline: 'Demo profile · Seattle', homeAirport: 'SEA' },
  { id: 'demo-ellis-morgan', displayName: 'Ellis Morgan', headline: 'Demo profile · Chicago', homeAirport: 'ORD' },
];

export type RequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';
export type MessageAuthor = 'you' | 'device-sample';
export type MemberRelationship = 'none' | 'incoming' | 'outgoing' | 'connected' | 'blocked' | 'removed';

export interface DemoConnectionRequest {
  id: string;
  fromMemberId: string;
  toMemberId: string;
  status: RequestStatus;
  createdAt: string;
}

export interface DemoConnection {
  id: string;
  memberId: string;
  createdAt: string;
  removedAt: string | null;
  blockedAt: string | null;
}

export interface DemoConversation {
  id: string;
  connectionId: string;
  memberId: string;
  createdAt: string;
}

export interface DemoMessage {
  id: string;
  conversationId: string;
  author: MessageAuthor;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export interface ConnectionsPreviewState {
  v: 1;
  requests: DemoConnectionRequest[];
  connections: DemoConnection[];
  conversations: DemoConversation[];
  messages: DemoMessage[];
}

export type ConnectionsPreviewFailure =
  | 'invalid-account'
  | 'unknown-member'
  | 'duplicate'
  | 'connected'
  | 'blocked'
  | 'not-incoming'
  | 'not-outgoing'
  | 'not-connected'
  | 'missing-conversation'
  | 'empty-message'
  | 'message-too-long'
  | 'corrupt'
  | 'unavailable';

export interface KeyValueStorage {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
}

export interface ConnectionsClock {
  now: () => string;
  nextId: (prefix: string) => string;
}

export interface MemberCard extends DemoMemberProfile {
  relationship: MemberRelationship;
}

export interface RequestCard {
  id: string;
  member: DemoMemberProfile;
  createdAt: string;
}

export interface ConnectionCard {
  id: string;
  member: DemoMemberProfile;
  createdAt: string;
}

export interface ConversationCard {
  id: string;
  connectionId: string;
  member: DemoMemberProfile;
  preview: string;
  activityAt: string;
  unreadCount: number;
  canSend: boolean;
  closedReason: 'removed' | 'blocked' | null;
}

export type ClientResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: ConnectionsPreviewFailure };

const directoryById = new Map(DEMO_MEMBER_DIRECTORY.map((member) => [member.id, member]));

export function connectionsPreviewStorageKey(accountId: string): string | null {
  const id = accountId.trim();
  if (!ACCOUNT_ID.test(id)) return null;
  return `bluebird.connections-preview.v${CONNECTIONS_PREVIEW_VERSION}.${id}`;
}

export function demoMember(memberId: string): DemoMemberProfile | null {
  return directoryById.get(memberId) ?? null;
}

export function createEmptyConnectionsPreviewState(): ConnectionsPreviewState {
  return { v: 1, requests: [], connections: [], conversations: [], messages: [] };
}

export function createSeedConnectionsPreviewState(): ConnectionsPreviewState {
  return {
    v: 1,
    requests: [{
      id: 'demo-request-avery',
      fromMemberId: 'demo-avery-lang',
      toMemberId: SELF_MEMBER_ID,
      status: 'pending',
      createdAt: '2026-10-28T15:00:00.000Z',
    }],
    connections: [{
      id: 'demo-connection-ellis',
      memberId: 'demo-ellis-morgan',
      createdAt: '2026-10-28T16:00:00.000Z',
      removedAt: null,
      blockedAt: null,
    }],
    conversations: [{
      id: 'demo-conversation-ellis',
      connectionId: 'demo-connection-ellis',
      memberId: 'demo-ellis-morgan',
      createdAt: '2026-10-28T16:00:00.000Z',
    }],
    messages: [{
      id: 'demo-message-ellis-sample',
      conversationId: 'demo-conversation-ellis',
      author: 'device-sample',
      body: 'Sample message stored on this device. It was not sent to or from a Bluebird member.',
      createdAt: '2026-10-28T16:05:00.000Z',
      readAt: null,
    }],
  };
}

export type ConnectionsPane = 'chats' | 'connections';

export function initialConnectionsPane(input: {
  ready: boolean;
  conversationCount: number;
}): ConnectionsPane | null {
  if (!input.ready) return null;
  return input.conversationCount > 0 ? 'chats' : 'connections';
}

export function rememberConnectionsPane(input: {
  accountId: string | null;
  selectedAccountId: string | null;
  selectedPane: ConnectionsPane | null;
  ready: boolean;
  conversationCount: number;
}): ConnectionsPane | null {
  if (
    input.accountId &&
    input.selectedAccountId === input.accountId &&
    input.selectedPane
  ) {
    return input.selectedPane;
  }
  return initialConnectionsPane({
    ready: input.ready,
    conversationCount: input.conversationCount,
  });
}

export function matchDemoMemberByName(displayName: string): DemoMemberProfile | null {
  const needle = displayName.trim().toLowerCase();
  if (!needle) return null;
  return DEMO_MEMBER_DIRECTORY.find((member) => member.displayName.toLowerCase() === needle) ?? null;
}

export function memberInitials(displayName: string): string {
  const letters = displayName.trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '');
  return letters.join('') || '•';
}

export type MemberProfileAction = 'connect' | 'pending' | 'incoming' | 'message' | 'unavailable';

export function memberProfileAction(relationship: MemberRelationship): MemberProfileAction {
  switch (relationship) {
    case 'none':
    case 'removed':
      return 'connect';
    case 'outgoing':
      return 'pending';
    case 'incoming':
      return 'incoming';
    case 'connected':
      return 'message';
    case 'blocked':
      return 'unavailable';
  }
}

export function formatPreviewTimestamp(iso: string, nowMs: number): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time) || !Number.isFinite(nowMs)) return '';
  const date = new Date(time);
  const now = new Date(nowMs);
  const dayKey = (value: Date) => `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`;
  if (dayKey(date) === dayKey(now)) return formatClock(date);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(date) === dayKey(yesterday)) return 'Yesterday';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

function formatClock(date: Date): string {
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const hour = date.getHours();
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const twelve = hour % 12 || 12;
  return `${twelve}:${minutes} ${suffix}`;
}

export function searchDemoMembers(query: string): DemoMemberProfile[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...DEMO_MEMBER_DIRECTORY];
  return DEMO_MEMBER_DIRECTORY.filter((member) => member.displayName.toLowerCase().includes(needle));
}

export function memberRelationship(state: ConnectionsPreviewState, memberId: string): MemberRelationship {
  const connection = state.connections.find((item) => item.memberId === memberId);
  if (connection?.blockedAt) return 'blocked';
  if (connection && !connection.removedAt) return 'connected';
  const pending = state.requests.find((request) => request.status === 'pending' && involves(request, memberId));
  if (pending) return pending.fromMemberId === SELF_MEMBER_ID ? 'outgoing' : 'incoming';
  return connection?.removedAt ? 'removed' : 'none';
}

export function presentMemberCards(state: ConnectionsPreviewState, query: string): MemberCard[] {
  return searchDemoMembers(query).map((member) => ({
    ...member,
    relationship: memberRelationship(state, member.id),
  }));
}

export function presentRequests(state: ConnectionsPreviewState): { incoming: RequestCard[]; outgoing: RequestCard[] } {
  const incoming: RequestCard[] = [];
  const outgoing: RequestCard[] = [];
  for (const request of state.requests) {
    if (request.status !== 'pending') continue;
    const memberId = request.fromMemberId === SELF_MEMBER_ID ? request.toMemberId : request.fromMemberId;
    const member = demoMember(memberId);
    if (!member) continue;
    const card = { id: request.id, member, createdAt: request.createdAt };
    if (request.toMemberId === SELF_MEMBER_ID) incoming.push(card);
    else outgoing.push(card);
  }
  const byNewest = (left: RequestCard, right: RequestCard) => right.createdAt.localeCompare(left.createdAt);
  incoming.sort(byNewest);
  outgoing.sort(byNewest);
  return { incoming, outgoing };
}

export function presentConnections(state: ConnectionsPreviewState): ConnectionCard[] {
  return state.connections
    .filter((connection) => !connection.removedAt && !connection.blockedAt)
    .map((connection) => {
      const member = demoMember(connection.memberId);
      return member ? { id: connection.id, member, createdAt: connection.createdAt } : null;
    })
    .filter((card): card is ConnectionCard => card !== null)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function presentConversations(state: ConnectionsPreviewState): ConversationCard[] {
  return state.conversations
    .map((conversation) => {
      const member = demoMember(conversation.memberId);
      if (!member) return null;
      const messages = state.messages.filter((message) => message.conversationId === conversation.id);
      const latest = messages.reduce<DemoMessage | null>((current, message) => {
        if (!current || message.createdAt > current.createdAt) return message;
        return current;
      }, null);
      const connection = state.connections.find((item) => item.id === conversation.connectionId);
      const closedReason = connection?.blockedAt ? 'blocked' : connection?.removedAt ? 'removed' : null;
      return {
        id: conversation.id,
        connectionId: conversation.connectionId,
        member,
        preview: latest?.body ?? 'No messages saved on this device yet.',
        activityAt: latest?.createdAt ?? conversation.createdAt,
        unreadCount: messages.filter((message) => message.author === 'device-sample' && message.readAt === null).length,
        canSend: closedReason === null && !!connection && !connection.removedAt && !connection.blockedAt,
        closedReason,
      };
    })
    .filter((card): card is ConversationCard => card !== null)
    .sort((left, right) => right.activityAt.localeCompare(left.activityAt));
}

export function unreadMessageCount(state: ConnectionsPreviewState): number {
  return state.messages.filter((message) => message.author === 'device-sample' && message.readAt === null).length;
}

export function shouldApplyConnectionsResult(input: {
  requestedAccountId: string;
  requestedGeneration: number;
  activeAccountId: string | null;
  activeGeneration: number;
}): boolean {
  return input.activeAccountId === input.requestedAccountId &&
    input.requestedGeneration === input.activeGeneration;
}

export function sendConnectionRequest(
  state: ConnectionsPreviewState,
  memberId: string,
  now: string,
  requestId: string,
): ClientResult<ConnectionsPreviewState> {
  if (!demoMember(memberId) || !RECORD_ID.test(requestId)) return { ok: false, reason: 'unknown-member' };
  const relationship = memberRelationship(state, memberId);
  if (relationship === 'blocked') return { ok: false, reason: 'blocked' };
  if (relationship === 'connected') return { ok: false, reason: 'connected' };
  if (relationship === 'incoming' || relationship === 'outgoing') return { ok: false, reason: 'duplicate' };
  return {
    ok: true,
    data: {
      ...state,
      requests: [...state.requests, {
        id: requestId,
        fromMemberId: SELF_MEMBER_ID,
        toMemberId: memberId,
        status: 'pending',
        createdAt: now,
      }],
    },
  };
}

export function acceptConnectionRequest(
  state: ConnectionsPreviewState,
  requestId: string,
  now: string,
  connectionId: string,
): ClientResult<ConnectionsPreviewState> {
  const request = state.requests.find((item) => item.id === requestId);
  if (!request || request.status !== 'pending' || request.toMemberId !== SELF_MEMBER_ID) {
    return { ok: false, reason: 'not-incoming' };
  }
  const member = demoMember(request.fromMemberId);
  if (!member || !RECORD_ID.test(connectionId)) return { ok: false, reason: 'unknown-member' };
  if (memberRelationship(state, member.id) === 'blocked') return { ok: false, reason: 'blocked' };
  const alreadyConnected = state.connections.some((item) => item.memberId === member.id && !item.removedAt && !item.blockedAt);
  return {
    ok: true,
    data: {
      ...state,
      requests: state.requests.map((item) => item.id === request.id ? { ...item, status: 'accepted' } : item),
      connections: alreadyConnected ? state.connections : [...state.connections, {
        id: connectionId,
        memberId: member.id,
        createdAt: now,
        removedAt: null,
        blockedAt: null,
      }],
    },
  };
}

export function declineConnectionRequest(
  state: ConnectionsPreviewState,
  requestId: string,
): ClientResult<ConnectionsPreviewState> {
  const request = state.requests.find((item) => item.id === requestId);
  if (!request || request.status !== 'pending' || request.toMemberId !== SELF_MEMBER_ID) {
    return { ok: false, reason: 'not-incoming' };
  }
  return {
    ok: true,
    data: {
      ...state,
      requests: state.requests.map((item) => item.id === request.id ? { ...item, status: 'declined' } : item),
    },
  };
}

export function cancelConnectionRequest(
  state: ConnectionsPreviewState,
  requestId: string,
): ClientResult<ConnectionsPreviewState> {
  const request = state.requests.find((item) => item.id === requestId);
  if (!request || request.status !== 'pending' || request.fromMemberId !== SELF_MEMBER_ID) {
    return { ok: false, reason: 'not-outgoing' };
  }
  return {
    ok: true,
    data: {
      ...state,
      requests: state.requests.map((item) => item.id === request.id ? { ...item, status: 'cancelled' } : item),
    },
  };
}

export function removeDemoConnection(
  state: ConnectionsPreviewState,
  connectionId: string,
  now: string,
): ClientResult<ConnectionsPreviewState> {
  const connection = state.connections.find((item) => item.id === connectionId && !item.removedAt && !item.blockedAt);
  if (!connection) return { ok: false, reason: 'not-connected' };
  return {
    ok: true,
    data: {
      ...state,
      connections: state.connections.map((item) => item.id === connection.id ? { ...item, removedAt: now } : item),
    },
  };
}

export function blockDemoMember(
  state: ConnectionsPreviewState,
  connectionId: string,
  now: string,
): ClientResult<ConnectionsPreviewState> {
  const connection = state.connections.find((item) => item.id === connectionId);
  if (!connection || connection.blockedAt) return { ok: false, reason: 'not-connected' };
  return {
    ok: true,
    data: {
      ...state,
      requests: state.requests.map((request) => (
        request.status === 'pending' && involves(request, connection.memberId)
          ? { ...request, status: request.fromMemberId === SELF_MEMBER_ID ? 'cancelled' : 'declined' }
          : request
      )),
      connections: state.connections.map((item) => item.id === connection.id
        ? { ...item, blockedAt: now, removedAt: item.removedAt ?? now }
        : item),
    },
  };
}

export function openDemoConversation(
  state: ConnectionsPreviewState,
  connectionId: string,
  now: string,
  conversationId: string,
): ClientResult<{ conversationId: string; state: ConnectionsPreviewState }> {
  const connection = state.connections.find((item) => item.id === connectionId && !item.removedAt && !item.blockedAt);
  if (!connection) return { ok: false, reason: 'not-connected' };
  const existing = state.conversations.find((item) => item.connectionId === connection.id);
  if (existing) return { ok: true, data: { conversationId: existing.id, state } };
  if (!RECORD_ID.test(conversationId)) return { ok: false, reason: 'unknown-member' };
  const conversation: DemoConversation = {
    id: conversationId,
    connectionId: connection.id,
    memberId: connection.memberId,
    createdAt: now,
  };
  return {
    ok: true,
    data: {
      conversationId: conversation.id,
      state: { ...state, conversations: [...state.conversations, conversation] },
    },
  };
}

export function sendDemoMessage(
  state: ConnectionsPreviewState,
  conversationId: string,
  body: string,
  now: string,
  messageId: string,
): ClientResult<{ message: DemoMessage; state: ConnectionsPreviewState }> {
  const conversation = state.conversations.find((item) => item.id === conversationId);
  if (!conversation) return { ok: false, reason: 'missing-conversation' };
  const connection = state.connections.find((item) => item.id === conversation.connectionId);
  if (!connection || connection.removedAt || connection.blockedAt) return { ok: false, reason: 'not-connected' };
  const text = body.trim();
  if (!text) return { ok: false, reason: 'empty-message' };
  if (text.length > MESSAGE_CHARACTER_LIMIT) return { ok: false, reason: 'message-too-long' };
  if (!RECORD_ID.test(messageId)) return { ok: false, reason: 'unavailable' };
  const message: DemoMessage = {
    id: messageId,
    conversationId: conversation.id,
    author: 'you',
    body: text,
    createdAt: now,
    readAt: null,
  };
  return { ok: true, data: { message, state: { ...state, messages: [...state.messages, message] } } };
}

export function markDemoConversationRead(
  state: ConnectionsPreviewState,
  conversationId: string,
  now: string,
): ClientResult<ConnectionsPreviewState> {
  const conversation = state.conversations.find((item) => item.id === conversationId);
  if (!conversation) return { ok: false, reason: 'missing-conversation' };
  return {
    ok: true,
    data: {
      ...state,
      messages: state.messages.map((message) => (
        message.conversationId === conversation.id && message.author === 'device-sample' && message.readAt === null
          ? { ...message, readAt: now }
          : message
      )),
    },
  };
}

export function parseConnectionsPreviewState(raw: string | null): ConnectionsPreviewState | null | 'corrupt' {
  if (raw === null || raw.trim() === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'corrupt';
  }
  if (!isState(parsed)) return 'corrupt';
  return parsed;
}

export interface ConnectionsClient {
  load(): Promise<ClientResult<ConnectionsPreviewState>>;
  listMembers(query: string): Promise<ClientResult<MemberCard[]>>;
  createRequest(memberId: string): Promise<ClientResult<ConnectionsPreviewState>>;
  listRequests(): Promise<ClientResult<{ incoming: RequestCard[]; outgoing: RequestCard[] }>>;
  acceptRequest(requestId: string): Promise<ClientResult<ConnectionsPreviewState>>;
  declineRequest(requestId: string): Promise<ClientResult<ConnectionsPreviewState>>;
  cancelRequest(requestId: string): Promise<ClientResult<ConnectionsPreviewState>>;
  listConnections(): Promise<ClientResult<ConnectionCard[]>>;
  removeConnection(connectionId: string): Promise<ClientResult<ConnectionsPreviewState>>;
  blockMember(connectionId: string): Promise<ClientResult<ConnectionsPreviewState>>;
  openConversation(connectionId: string): Promise<ClientResult<{ conversationId: string; state: ConnectionsPreviewState }>>;
  listConversations(): Promise<ClientResult<ConversationCard[]>>;
  listMessages(conversationId: string): Promise<ClientResult<DemoMessage[]>>;
  sendMessage(conversationId: string, body: string): Promise<ClientResult<{ message: DemoMessage; state: ConnectionsPreviewState }>>;
  markConversationRead(conversationId: string): Promise<ClientResult<ConnectionsPreviewState>>;
  unreadCount(): Promise<ClientResult<number>>;
}

export function createLocalConnectionsClient(
  storage: KeyValueStorage,
  accountId: string,
  clock: ConnectionsClock,
): ConnectionsClient {
  let queue: Promise<void> = Promise.resolve();
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work, work);
    queue = run.then(() => undefined, () => undefined);
    return run;
  };
  const key = connectionsPreviewStorageKey(accountId);

  const read = async (): Promise<ClientResult<ConnectionsPreviewState>> => {
    if (!key) return { ok: false, reason: 'invalid-account' };
    try {
      const parsed = parseConnectionsPreviewState(await storage.getItem(key));
      if (parsed === 'corrupt') return { ok: false, reason: 'corrupt' };
      if (parsed) return { ok: true, data: parsed };
      const seeded = createSeedConnectionsPreviewState();
      await storage.setItem(key, JSON.stringify(seeded));
      return { ok: true, data: seeded };
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
  };

  const write = async (
    next: ClientResult<ConnectionsPreviewState>,
  ): Promise<ClientResult<ConnectionsPreviewState>> => {
    if (!next.ok || !key) return next.ok ? { ok: false, reason: 'invalid-account' } : next;
    try {
      await storage.setItem(key, JSON.stringify(next.data));
      return next;
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
  };

  const update = (change: (state: ConnectionsPreviewState) => ClientResult<ConnectionsPreviewState>) => enqueue(async () => {
    const current = await read();
    if (!current.ok) return current;
    return write(change(current.data));
  });

  return {
    load: () => enqueue(read),
    listMembers: (query) => enqueue(async () => {
      const current = await read();
      return current.ok ? { ok: true, data: presentMemberCards(current.data, query) } : current;
    }),
    createRequest: (memberId) => update((state) => sendConnectionRequest(state, memberId, clock.now(), clock.nextId('request'))),
    listRequests: () => enqueue(async () => {
      const current = await read();
      return current.ok ? { ok: true, data: presentRequests(current.data) } : current;
    }),
    acceptRequest: (requestId) => update((state) => acceptConnectionRequest(state, requestId, clock.now(), clock.nextId('connection'))),
    declineRequest: (requestId) => update((state) => declineConnectionRequest(state, requestId)),
    cancelRequest: (requestId) => update((state) => cancelConnectionRequest(state, requestId)),
    listConnections: () => enqueue(async () => {
      const current = await read();
      return current.ok ? { ok: true, data: presentConnections(current.data) } : current;
    }),
    removeConnection: (connectionId) => update((state) => removeDemoConnection(state, connectionId, clock.now())),
    blockMember: (connectionId) => update((state) => blockDemoMember(state, connectionId, clock.now())),
    openConversation: (connectionId) => enqueue(async () => {
      const current = await read();
      if (!current.ok) return current;
      const opened = openDemoConversation(current.data, connectionId, clock.now(), clock.nextId('conversation'));
      if (!opened.ok) return opened;
      if (opened.data.state !== current.data) {
        const saved = await write({ ok: true, data: opened.data.state });
        if (!saved.ok) return saved;
      }
      return opened;
    }),
    listConversations: () => enqueue(async () => {
      const current = await read();
      return current.ok ? { ok: true, data: presentConversations(current.data) } : current;
    }),
    listMessages: (conversationId) => enqueue(async () => {
      const current = await read();
      if (!current.ok) return current;
      if (!current.data.conversations.some((item) => item.id === conversationId)) {
        return { ok: false, reason: 'missing-conversation' };
      }
      return {
        ok: true,
        data: current.data.messages.filter((message) => message.conversationId === conversationId),
      };
    }),
    sendMessage: (conversationId, body) => enqueue(async () => {
      const current = await read();
      if (!current.ok) return current;
      const sent = sendDemoMessage(current.data, conversationId, body, clock.now(), clock.nextId('message'));
      if (!sent.ok) return sent;
      const saved = await write({ ok: true, data: sent.data.state });
      return saved.ok ? sent : saved;
    }),
    markConversationRead: (conversationId) => update((state) => markDemoConversationRead(state, conversationId, clock.now())),
    unreadCount: () => enqueue(async () => {
      const current = await read();
      return current.ok ? { ok: true, data: unreadMessageCount(current.data) } : current;
    }),
  };
}

export function createMemoryKeyValueStorage(): KeyValueStorage & { records: Map<string, string> } {
  const records = new Map<string, string>();
  return {
    records,
    async getItem(key) {
      return records.has(key) ? records.get(key) ?? null : null;
    },
    async setItem(key, value) {
      records.set(key, value);
    },
  };
}

function involves(request: DemoConnectionRequest, memberId: string): boolean {
  return (request.fromMemberId === SELF_MEMBER_ID && request.toMemberId === memberId) ||
    (request.fromMemberId === memberId && request.toMemberId === SELF_MEMBER_ID);
}

function isIso(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isMemberId(value: unknown): value is string {
  return value === SELF_MEMBER_ID || (typeof value === 'string' && directoryById.has(value));
}

function isState(value: unknown): value is ConnectionsPreviewState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.v === CONNECTIONS_PREVIEW_VERSION &&
    Array.isArray(record.requests) && record.requests.every(isRequest) &&
    Array.isArray(record.connections) && record.connections.every(isConnection) &&
    Array.isArray(record.conversations) && record.conversations.every(isConversation) &&
    Array.isArray(record.messages) && record.messages.every(isMessage);
}

function isRequest(value: unknown): value is DemoConnectionRequest {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && RECORD_ID.test(record.id) &&
    isMemberId(record.fromMemberId) && isMemberId(record.toMemberId) &&
    record.fromMemberId !== record.toMemberId &&
    (record.status === 'pending' || record.status === 'accepted' || record.status === 'declined' || record.status === 'cancelled') &&
    isIso(record.createdAt);
}

function isConnection(value: unknown): value is DemoConnection {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && RECORD_ID.test(record.id) &&
    typeof record.memberId === 'string' && directoryById.has(record.memberId) &&
    isIso(record.createdAt) &&
    (record.removedAt === null || isIso(record.removedAt)) &&
    (record.blockedAt === null || isIso(record.blockedAt));
}

function isConversation(value: unknown): value is DemoConversation {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && RECORD_ID.test(record.id) &&
    typeof record.connectionId === 'string' && RECORD_ID.test(record.connectionId) &&
    typeof record.memberId === 'string' && directoryById.has(record.memberId) &&
    isIso(record.createdAt);
}

function isMessage(value: unknown): value is DemoMessage {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && RECORD_ID.test(record.id) &&
    typeof record.conversationId === 'string' && RECORD_ID.test(record.conversationId) &&
    (record.author === 'you' || record.author === 'device-sample') &&
    typeof record.body === 'string' && record.body.trim().length > 0 && record.body.length <= MESSAGE_CHARACTER_LIMIT &&
    isIso(record.createdAt) &&
    (record.readAt === null || isIso(record.readAt));
}
