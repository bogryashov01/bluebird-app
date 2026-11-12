/**
 * Clerk-authenticated member messages for the production website API.
 *
 * Live calls stay off unless EXPO_PUBLIC_BLUEBIRD_MEMBER_MESSAGES is the
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

export const MEMBER_MESSAGES_FLAG = 'EXPO_PUBLIC_BLUEBIRD_MEMBER_MESSAGES';
export const MEMBER_MESSAGE_MAX_LENGTH = 4000;
export const MEMBER_MESSAGE_PAGE_SIZE = 50;
/** Foreground HTTP poll interval for messages, connections, and related screens. */
export const MEMBER_MESSAGE_POLL_MS = 10_000;
/** Show the composer length hint once this many characters remain. */
export const MEMBER_MESSAGE_COMPOSER_WARN_REMAINING = 100;

export const MEMBER_MESSAGE_PATHS = {
  conversations: '/me/messages/conversations',
  unreadCount: '/me/messages/unread-count',
  history: '/me/messages/history',
  messages: (conversationId: number) => `/me/messages/conversations/${conversationId}/messages`,
  read: (conversationId: number) => `/me/messages/conversations/${conversationId}/read`,
} as const;

const USER_ID = /^\S{1,255}$/;
const CURSOR = /^[1-9]\d*$/;
const SERVER_CODE = /^[a-z0-9_]{1,80}$/;

export interface MemberMessage {
  id: number;
  conversationId: number;
  senderUserId: string;
  body: string;
  createdAt: string;
}

export interface MessageConversation {
  id: number;
  participantUserId: string;
  createdAt: string;
  updatedAt: string;
  latestMessage: MemberMessage | null;
  unreadCount: number;
}

export interface MessageHistoryPage {
  messages: MemberMessage[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface MessageReadState {
  conversationId: number;
  lastReadMessageId: number | null;
  unreadCount: number;
}

export type MemberMessageBodyIssue = 'empty' | 'too_long' | 'invalid';

export type MemberMessagesFailure =
  | 'configuration'
  | 'token'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'schema'
  | 'invalid_body'
  | 'invalid_message'
  | 'invalid_participant'
  | 'invalid_conversation'
  | 'invalid_cursor'
  | 'invalid_page_size'
  | 'unauthorized'
  | 'membership_required'
  | 'connection_required'
  | 'not_found'
  | 'conflict'
  | 'unavailable';

export type MemberMessagesResult<T> =
  | { kind: 'disabled' }
  | { kind: 'loaded'; data: T }
  | { kind: 'error'; code: MemberMessagesFailure };

export interface MemberMessagesClientOptions {
  enabled: boolean;
  nativeAuthTest?: boolean;
  environment: MainBluebirdApiEnvironment;
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  fetcher?: typeof fetch;
}

interface MemberMessagesSnapshot {
  clerkUserId: string;
  environment: string;
  apiBaseUrl: string;
  conversations: MessageConversation[];
  unreadCount: number;
}

const snapshots = new Map<string, MemberMessagesSnapshot>();

export function isMemberMessagesIntegrationEnabled(input?: {
  flag?: string;
  nativeAuthTest?: boolean;
}): boolean {
  const flag = input?.flag ?? process.env.EXPO_PUBLIC_BLUEBIRD_MEMBER_MESSAGES;
  const nativeAuthTest = input?.nativeAuthTest ?? isNativeProductionAuthTestEnabled();
  return flag === 'true' && nativeAuthTest !== true;
}

export function memberMessageBodyIssue(body: string): MemberMessageBodyIssue | null {
  if (typeof body !== 'string' || body.includes('\u0000')) return 'invalid';
  if (!body.trim()) return 'empty';
  if (Array.from(body).length > MEMBER_MESSAGE_MAX_LENGTH) return 'too_long';
  return null;
}

export function limitMemberMessageBody(body: string): string {
  const characters = Array.from(body);
  return characters.length <= MEMBER_MESSAGE_MAX_LENGTH ? body : characters.slice(0, MEMBER_MESSAGE_MAX_LENGTH).join('');
}

export function nextMemberMessageSend(input: { inFlight: boolean; body: string }): boolean {
  return input.inFlight !== true && memberMessageBodyIssue(input.body) === null;
}

export function conversationTitle(
  participantUserId: string,
  names: ReadonlyMap<string, string>,
): string {
  const name = names.get(participantUserId)?.trim();
  return name || 'Bluebird member';
}

/** Tab / list unread badge label. Hides at zero; caps display at 9+. */
export function formatMemberMessagesUnreadBadge(count: number): string | null {
  if (!Number.isSafeInteger(count) || count <= 0) return null;
  return count > 9 ? '9+' : String(count);
}

/** Subtle composer warning once the draft is near the 4,000-character limit. */
export function memberMessageComposerLengthWarning(body: string): string | null {
  const length = Array.from(body).length;
  if (length < MEMBER_MESSAGE_MAX_LENGTH - MEMBER_MESSAGE_COMPOSER_WARN_REMAINING) return null;
  return `${length}/${MEMBER_MESSAGE_MAX_LENGTH}`;
}

/** Local calendar day key for optional thread date separators. */
export function memberMessageDayKey(createdAt: string): string | null {
  const ms = Date.parse(createdAt);
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatMemberMessageDaySeparator(createdAt: string, nowMs = Date.now()): string | null {
  const key = memberMessageDayKey(createdAt);
  if (!key) return null;
  const ms = Date.parse(createdAt);
  if (!Number.isFinite(ms)) return null;
  const message = new Date(ms);
  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfMessage = new Date(message.getFullYear(), message.getMonth(), message.getDate()).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  if (startOfMessage === startOfToday) return 'Today';
  if (startOfMessage === startOfToday - dayMs) return 'Yesterday';
  return message.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function memberMessagesCacheKey(input: {
  environment: string;
  apiBaseUrl: string;
  clerkUserId: string;
}): string {
  return `${input.environment}\0${input.apiBaseUrl}\0${input.clerkUserId}`;
}

export function rememberMemberMessagesSnapshot(snapshot: MemberMessagesSnapshot): void {
  if (!snapshot.clerkUserId.trim()) return;
  snapshots.set(memberMessagesCacheKey(snapshot), snapshot);
}

export function readMemberMessagesSnapshot(input: {
  environment: string;
  apiBaseUrl: string;
  clerkUserId: string;
}): MemberMessagesSnapshot | null {
  if (!input.clerkUserId.trim()) return null;
  return snapshots.get(memberMessagesCacheKey(input)) ?? null;
}

export function retainMemberMessagesForAccount(clerkUserId: string): void {
  for (const [key, snapshot] of snapshots) {
    if (snapshot.clerkUserId !== clerkUserId) snapshots.delete(key);
  }
}

export function clearMemberMessagesCache(): void {
  snapshots.clear();
}

export function messageHistoryPath(input: {
  conversationId: number;
  before?: string | null;
  limit?: number;
}): { ok: true; path: string } | { ok: false; code: 'invalid_conversation' | 'invalid_cursor' | 'invalid_page_size' } {
  if (!Number.isSafeInteger(input.conversationId) || input.conversationId <= 0) {
    return { ok: false, code: 'invalid_conversation' };
  }
  const limit = input.limit ?? MEMBER_MESSAGE_PAGE_SIZE;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return { ok: false, code: 'invalid_page_size' };
  }
  const params = new URLSearchParams({
    conversationId: String(input.conversationId),
    limit: String(limit),
  });
  if (input.before != null && input.before !== '') {
    if (!CURSOR.test(input.before) || !Number.isSafeInteger(Number(input.before))) {
      return { ok: false, code: 'invalid_cursor' };
    }
    params.set('before', input.before);
  }
  return { ok: true, path: `${MEMBER_MESSAGE_PATHS.history}?${params.toString()}` };
}

export function parseMemberMessage(
  value: unknown,
  field: string,
  fallbackConversationId?: number,
): MemberMessage {
  const raw = objectValue(value, field);
  const senderUserId = stringValue(raw.senderUserId, `${field}.senderUserId`).trim();
  if (!USER_ID.test(senderUserId)) schemaFailure(`${field}.senderUserId`);
  const body = stringValue(raw.body, `${field}.body`);
  if (memberMessageBodyIssue(body) !== null) schemaFailure(`${field}.body`);
  const conversationId = Object.prototype.hasOwnProperty.call(raw, 'conversationId')
    ? positiveId(raw.conversationId, `${field}.conversationId`)
    : fallbackConversationId;
  if (conversationId === undefined) schemaFailure(`${field}.conversationId`);
  return {
    id: positiveId(raw.id, `${field}.id`),
    conversationId,
    senderUserId,
    body,
    createdAt: dateTime(raw.createdAt, `${field}.createdAt`),
  };
}

export function parseMessageConversation(value: unknown, field: string): MessageConversation {
  const raw = objectValue(value, field);
  const participantUserId = stringValue(raw.participantUserId, `${field}.participantUserId`).trim();
  if (!USER_ID.test(participantUserId)) schemaFailure(`${field}.participantUserId`);
  if (!Object.prototype.hasOwnProperty.call(raw, 'latestMessage')) schemaFailure(`${field}.latestMessage`);
  const id = positiveId(raw.id, `${field}.id`);
  return {
    id,
    participantUserId,
    createdAt: dateTime(raw.createdAt, `${field}.createdAt`),
    updatedAt: dateTime(raw.updatedAt, `${field}.updatedAt`),
    latestMessage: raw.latestMessage === null
      ? null
      : parseMemberMessage(raw.latestMessage, `${field}.latestMessage`, id),
    unreadCount: nonNegativeInteger(raw.unreadCount, `${field}.unreadCount`),
  };
}

export function parseMessageConversationResponse(value: unknown): { conversation: MessageConversation } {
  const raw = objectValue(value, 'conversation');
  return { conversation: parseMessageConversation(raw.conversation, 'conversation.conversation') };
}

export function parseMessageConversationList(value: unknown): { conversations: MessageConversation[] } {
  const raw = objectValue(value, 'conversations');
  if (!Array.isArray(raw.conversations)) schemaFailure('conversations.conversations');
  return {
    conversations: raw.conversations.map((item, index) => parseMessageConversation(item, `conversations.conversations.${index}`)),
  };
}

export function parseMessageUnreadCount(value: unknown): { unreadCount: number } {
  const raw = objectValue(value, 'unreadCount');
  return { unreadCount: nonNegativeInteger(raw.unreadCount, 'unreadCount.unreadCount') };
}

export function parseMessageHistory(value: unknown, conversationId?: number): MessageHistoryPage {
  const raw = objectValue(value, 'history');
  if (!Array.isArray(raw.messages)) schemaFailure('history.messages');
  if (typeof raw.hasMore !== 'boolean') schemaFailure('history.hasMore');
  if (!Object.prototype.hasOwnProperty.call(raw, 'nextCursor')) schemaFailure('history.nextCursor');
  return {
    messages: raw.messages.map((item, index) => parseMemberMessage(item, `history.messages.${index}`, conversationId)),
    nextCursor: parseCursor(raw.nextCursor, 'history.nextCursor'),
    hasMore: raw.hasMore,
  };
}

export function parseMemberMessageResponse(value: unknown, conversationId?: number): { message: MemberMessage } {
  const raw = objectValue(value, 'message');
  return { message: parseMemberMessage(raw.message, 'message.message', conversationId) };
}

export function parseMessageReadState(value: unknown): MessageReadState {
  const raw = objectValue(value, 'readState');
  return {
    conversationId: positiveId(raw.conversationId, 'readState.conversationId'),
    lastReadMessageId: raw.lastReadMessageId === null
      ? null
      : positiveId(raw.lastReadMessageId, 'readState.lastReadMessageId'),
    unreadCount: nonNegativeInteger(raw.unreadCount, 'readState.unreadCount'),
  };
}

export function createMemberMessagesClient(options: MemberMessagesClientOptions) {
  const nativeAuthTest = options.nativeAuthTest ?? isNativeProductionAuthTestEnabled();
  const live = options.enabled === true && nativeAuthTest !== true;

  async function request<T>(
    path: string,
    method: 'GET' | 'POST' | 'PUT',
    parse: (value: unknown) => T,
    body?: Record<string, string>,
  ): Promise<MemberMessagesResult<T>> {
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
          http: async (response) => new ProductionAuthHttpError(response.status, await readMessageError(response)),
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
    createConversation: (participantUserId: string) => {
      if (!live) return Promise.resolve({ kind: 'disabled' } as const);
      const id = participantUserId.trim();
      if (!USER_ID.test(id)) return Promise.resolve({ kind: 'error', code: 'invalid_participant' } as const);
      return request(MEMBER_MESSAGE_PATHS.conversations, 'POST', parseMessageConversationResponse, { participantUserId: id });
    },
    listConversations: () => request(MEMBER_MESSAGE_PATHS.conversations, 'GET', parseMessageConversationList),
    unreadCount: () => request(MEMBER_MESSAGE_PATHS.unreadCount, 'GET', parseMessageUnreadCount),
    history: (input: { conversationId: number; before?: string | null; limit?: number }) => {
      if (!live) return Promise.resolve({ kind: 'disabled' } as const);
      const path = messageHistoryPath(input);
      if (!path.ok) return Promise.resolve({ kind: 'error', code: path.code } as const);
      return request(path.path, 'GET', (value) => parseMessageHistory(value, input.conversationId));
    },
    send: (conversationId: number, body: string) => {
      if (!live) return Promise.resolve({ kind: 'disabled' } as const);
      if (!Number.isSafeInteger(conversationId) || conversationId <= 0) {
        return Promise.resolve({ kind: 'error', code: 'invalid_conversation' } as const);
      }
      const issue = memberMessageBodyIssue(body);
      if (issue) return Promise.resolve({ kind: 'error', code: 'invalid_message' } as const);
      return request(
        MEMBER_MESSAGE_PATHS.messages(conversationId),
        'POST',
        (value) => parseMemberMessageResponse(value, conversationId),
        { body },
      );
    },
    markRead: (conversationId: number) => {
      if (!live) return Promise.resolve({ kind: 'disabled' } as const);
      if (!Number.isSafeInteger(conversationId) || conversationId <= 0) {
        return Promise.resolve({ kind: 'error', code: 'invalid_conversation' } as const);
      }
      return request(MEMBER_MESSAGE_PATHS.read(conversationId), 'PUT', parseMessageReadState);
    },
  };
}

/**
 * One foreground thread history refresh. The history gate releases before
 * markRead starts, so a slow or failed read receipt cannot block the next poll.
 * Concurrent history calls share one gate; concurrent markRead calls share another.
 * Lock generations ignore finally handlers from a superseded conversation/account.
 */
export async function refreshMemberMessageThreadLatest(input: {
  historyInFlight: { current: boolean };
  markReadInFlight: { current: boolean };
  historyLockGeneration: { current: number };
  markReadLockGeneration: { current: number };
  markedId: { current: number | null };
  isCurrent: () => boolean;
  isActive: () => boolean;
  fetchHistory: () => Promise<MemberMessagesResult<MessageHistoryPage>>;
  applyDisabled: () => void;
  applyError: (code: MemberMessagesFailure) => void;
  applyLoaded: (page: MessageHistoryPage) => number | null;
  markRead: () => Promise<MemberMessagesResult<MessageReadState>>;
  onReadState?: (state: MessageReadState) => void;
}): Promise<'skipped' | 'ran'> {
  if (input.historyInFlight.current) return 'skipped';
  input.historyInFlight.current = true;
  const historyLock = input.historyLockGeneration.current;
  let newestId: number | null = null;
  try {
    const result = await input.fetchHistory();
    if (!input.isCurrent()) return 'ran';
    if (result.kind === 'disabled') {
      input.applyDisabled();
      return 'ran';
    }
    if (result.kind === 'error') {
      if (result.code !== 'cancelled') input.applyError(result.code);
      return 'ran';
    }
    newestId = input.applyLoaded(result.data);
  } finally {
    if (input.historyLockGeneration.current === historyLock) {
      input.historyInFlight.current = false;
    }
  }

  if (
    newestId === null ||
    input.markedId.current === newestId ||
    !input.isCurrent() ||
    !input.isActive() ||
    input.markReadInFlight.current
  ) {
    return 'ran';
  }

  input.markReadInFlight.current = true;
  const markReadLock = input.markReadLockGeneration.current;
  try {
    const read = await input.markRead();
    if (!input.isCurrent()) return 'ran';
    if (read.kind === 'loaded') {
      input.markedId.current = read.data.lastReadMessageId;
      input.onReadState?.(read.data);
    }
  } finally {
    if (input.markReadLockGeneration.current === markReadLock) {
      input.markReadInFlight.current = false;
    }
  }
  return 'ran';
}

function failureCode(error: unknown): MemberMessagesFailure {
  if (error instanceof ProductionAuthHttpError) {
    const code = error.serverCode;
    if (error.status === 401) return 'unauthorized';
    if (error.status === 403) {
      if (code === 'active_membership_required') return 'membership_required';
      if (code === 'connection_required') return 'connection_required';
      return 'unavailable';
    }
    if (error.status === 404) return 'not_found';
    if (error.status === 409) return 'conflict';
    if (error.status === 400) {
      if (code === 'invalid_message') return 'invalid_message';
      if (code === 'invalid_participant') return 'invalid_participant';
      if (code === 'invalid_cursor' || code === 'invalid_pagination') return 'invalid_cursor';
      if (code === 'invalid_page_size') return 'invalid_page_size';
      if (code === 'invalid_conversation_id') return 'invalid_conversation';
      return 'invalid_body';
    }
    return 'unavailable';
  }
  if (error instanceof ProductionAuthCancelledError) return 'cancelled';
  if (error instanceof ProductionAuthTimeoutError) return 'timeout';
  if (error instanceof ProductionAuthNetworkError) return 'network';
  if (error instanceof ProductionAuthSchemaError || error instanceof ProductionAuthInvalidJsonError) return 'schema';
  if (error instanceof ProductionAuthRequestError && error.code === 'token') return 'token';
  return 'unavailable';
}

async function readMessageError(response: Response): Promise<{ code: string | null; body: null }> {
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

function positiveId(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) schemaFailure(field);
  return value;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) schemaFailure(field);
  return value;
}

function dateTime(value: unknown, field: string): string {
  const text = stringValue(value, field);
  if (!Number.isFinite(Date.parse(text))) schemaFailure(field);
  return text;
}

function parseCursor(value: unknown, field: string): string | null {
  if (value === null) return null;
  const text = stringValue(value, field);
  if (!CURSOR.test(text) || !Number.isSafeInteger(Number(text))) schemaFailure(field);
  return text;
}
