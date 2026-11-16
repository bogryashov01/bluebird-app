/**
 * Clerk-authenticated AI Concierge for the production Main API.
 *
 * Live calls stay off unless EXPO_PUBLIC_BLUEBIRD_AI_CONCIERGE is the string
 * "true". The native auth-test build never enables them. A disabled client
 * returns before a token is read and before fetch. No AI provider credentials
 * are stored or sent from the mobile app.
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
import { isSafeExternalDestination } from './supportResources';

export const AI_CONCIERGE_FLAG = 'EXPO_PUBLIC_BLUEBIRD_AI_CONCIERGE';
export const AI_CONCIERGE_PAGE_SIZE = 50;
export const AI_CONCIERGE_MAX_BODY_LENGTH = 4000;
/** Synchronous AI replies can exceed the default Main API timeout. */
export const AI_CONCIERGE_SEND_TIMEOUT_MS = 60_000;
export const AI_CONCIERGE_HISTORY_TIMEOUT_MS = PRODUCTION_AUTH_TIMEOUT_MS;

export const AI_CONCIERGE_PATHS = {
  messages: '/me/ai-concierge/messages',
} as const;

const SERVER_CODE = /^[a-z0-9_]{1,80}$/;
const MESSAGE_CURSOR = /^[1-9]\d*$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AiConciergeRole = 'user' | 'assistant';
export type AiConciergeAssistantStatus = 'answered' | 'needs_support';

export interface AiConciergeMessage {
  id: number;
  conversationId: number;
  clientMessageId: string | null;
  role: AiConciergeRole;
  body: string;
  status: string;
  createdAt: string;
}

export interface AiConciergeHistoryPage {
  messages: AiConciergeMessage[];
  nextBefore: string | null;
}

export interface AiConciergeSendResult {
  conversationId: number;
  userMessage: AiConciergeMessage;
  assistantMessage: AiConciergeMessage;
  replayed: boolean;
  supportUrl: string | null;
}

export type AiConciergeFailure =
  | 'configuration'
  | 'token'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'schema'
  | 'invalid_body'
  | 'invalid_message'
  | 'invalid_cursor'
  | 'invalid_page_size'
  | 'unauthorized'
  | 'membership_required'
  | 'rate_limited'
  | 'conflict'
  | 'unavailable';

export type AiConciergeResult<T> =
  | { kind: 'disabled' }
  | { kind: 'loaded'; data: T }
  | { kind: 'error'; code: AiConciergeFailure };

export interface AiConciergeClientOptions {
  enabled: boolean;
  nativeAuthTest?: boolean;
  environment: MainBluebirdApiEnvironment;
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  fetcher?: typeof fetch;
  sendTimeoutMs?: number;
  historyTimeoutMs?: number;
}

interface AiConciergeSnapshot {
  clerkUserId: string;
  environment: string;
  apiBaseUrl: string;
  messages: AiConciergeMessage[];
  nextBefore: string | null;
}

const snapshots = new Map<string, AiConciergeSnapshot>();

export function isAiConciergeIntegrationEnabled(input?: {
  flag?: string;
  nativeAuthTest?: boolean;
}): boolean {
  const flag = input?.flag ?? process.env[AI_CONCIERGE_FLAG];
  const nativeAuthTest = input?.nativeAuthTest ?? isNativeProductionAuthTestEnabled();
  return flag === 'true' && nativeAuthTest !== true;
}

export function createAiConciergeClientMessageId(
  randomUuid: () => string = () => globalThis.crypto?.randomUUID?.() ?? '',
): string {
  const generated = randomUuid().trim();
  if (UUID.test(generated)) return generated.toLowerCase();
  // Fallback UUID shape when crypto.randomUUID is unavailable in the runtime.
  const stamp = `${Date.now().toString(16)}${'0'.repeat(12)}`.slice(-12);
  return `00000000-0000-4000-8000-${stamp}`.toLowerCase();
}

export function aiConciergeBodyIssue(body: string): 'empty' | 'too_long' | 'invalid' | null {
  if (typeof body !== 'string' || body.includes('\u0000')) return 'invalid';
  if (!body.trim()) return 'empty';
  if (Array.from(body).length > AI_CONCIERGE_MAX_BODY_LENGTH) return 'too_long';
  return null;
}

export function canSubmitAiConciergeSend(input: {
  inFlight: boolean;
  body: string;
}): boolean {
  return input.inFlight !== true && aiConciergeBodyIssue(input.body) === null;
}

export function aiConciergeHistoryPath(input: {
  before?: string | null;
  limit?: number;
}): { ok: true; path: string } | { ok: false; code: 'invalid_cursor' | 'invalid_page_size' } {
  const limit = input.limit ?? AI_CONCIERGE_PAGE_SIZE;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return { ok: false, code: 'invalid_page_size' };
  }
  const params = new URLSearchParams({ limit: String(limit) });
  if (input.before != null && input.before !== '') {
    if (!MESSAGE_CURSOR.test(input.before) || !Number.isSafeInteger(Number(input.before))) {
      return { ok: false, code: 'invalid_cursor' };
    }
    params.set('before', input.before);
  }
  return { ok: true, path: `${AI_CONCIERGE_PATHS.messages}?${params.toString()}` };
}

export function parseAiConciergeMessage(value: unknown, field: string): AiConciergeMessage {
  const raw = objectValue(value, field);
  const role = stringValue(raw.role, `${field}.role`);
  if (role !== 'user' && role !== 'assistant') schemaFailure(`${field}.role`);
  const status = stringValue(raw.status, `${field}.status`).trim();
  if (!status) schemaFailure(`${field}.status`);
  if (role === 'assistant' && status !== 'answered' && status !== 'needs_support') {
    schemaFailure(`${field}.status`);
  }
  const body = stringValue(raw.body, `${field}.body`);
  if (typeof body !== 'string') schemaFailure(`${field}.body`);
  let clientMessageId: string | null = null;
  if (Object.prototype.hasOwnProperty.call(raw, 'clientMessageId') && raw.clientMessageId !== null) {
    const id = stringValue(raw.clientMessageId, `${field}.clientMessageId`).trim();
    if (!UUID.test(id)) schemaFailure(`${field}.clientMessageId`);
    clientMessageId = id.toLowerCase();
  }
  return {
    id: positiveId(raw.id, `${field}.id`),
    conversationId: positiveId(raw.conversationId, `${field}.conversationId`),
    clientMessageId,
    role,
    body,
    status,
    createdAt: dateTime(raw.createdAt, `${field}.createdAt`),
  };
}

export function parseAiConciergeHistoryPage(value: unknown): AiConciergeHistoryPage {
  const raw = objectValue(value, 'history');
  if (!Array.isArray(raw.messages)) schemaFailure('history.messages');
  if (!Object.prototype.hasOwnProperty.call(raw, 'nextBefore')) schemaFailure('history.nextBefore');
  return {
    messages: raw.messages.map((item, index) => parseAiConciergeMessage(item, `history.messages.${index}`)),
    nextBefore: parseCursor(raw.nextBefore, 'history.nextBefore'),
  };
}

export function parseAiConciergeSendResult(value: unknown): AiConciergeSendResult {
  const raw = objectValue(value, 'send');
  if (typeof raw.replayed !== 'boolean') schemaFailure('send.replayed');
  const supportUrl = parseSupportUrl(raw.supportUrl, 'send.supportUrl');
  const userMessage = parseAiConciergeMessage(raw.userMessage, 'send.userMessage');
  const assistantMessage = parseAiConciergeMessage(raw.assistantMessage, 'send.assistantMessage');
  if (userMessage.role !== 'user') schemaFailure('send.userMessage.role');
  if (assistantMessage.role !== 'assistant') schemaFailure('send.assistantMessage.role');
  const conversationId = positiveId(raw.conversationId, 'send.conversationId');
  if (
    userMessage.conversationId !== conversationId ||
    assistantMessage.conversationId !== conversationId
  ) {
    schemaFailure('send.conversationId');
  }
  return {
    conversationId,
    userMessage,
    assistantMessage,
    replayed: raw.replayed,
    supportUrl,
  };
}

export function acceptAiConciergeSupportUrl(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const url = value.trim();
  return isSafeExternalDestination(url) ? url : null;
}

export function aiConciergeFailureCopy(code: AiConciergeFailure): string {
  switch (code) {
    case 'configuration':
      return 'AI Concierge is not available yet.';
    case 'token':
    case 'unauthorized':
      return 'Sign in again to use AI Concierge.';
    case 'membership_required':
      return 'An active Bluebird membership is required to use AI Concierge.';
    case 'rate_limited':
      return 'Too many Concierge requests. Please wait a moment and try again.';
    case 'timeout':
      return 'The Concierge is taking longer than expected. You can retry the same message.';
    case 'network':
      return 'The Concierge request couldn’t reach Bluebird. Check your connection and try again.';
    case 'conflict':
      return 'That message may already have been sent. Refreshing your conversation.';
    case 'invalid_message':
    case 'invalid_body':
      return 'That message couldn’t be sent.';
    case 'cancelled':
      return '';
    case 'schema':
      return 'The Concierge response couldn’t be read.';
    case 'invalid_cursor':
    case 'invalid_page_size':
      return 'Earlier messages couldn’t be loaded.';
    default:
      return 'AI Concierge couldn’t complete that request. Please try again.';
  }
}

export function mergeAiConciergeMessages(
  older: readonly AiConciergeMessage[],
  newer: readonly AiConciergeMessage[],
): AiConciergeMessage[] {
  const byId = new Map<number, AiConciergeMessage>();
  for (const message of [...older, ...newer]) byId.set(message.id, message);
  return [...byId.values()].sort((left, right) => {
    if (left.id !== right.id) return left.id - right.id;
    return Date.parse(left.createdAt) - Date.parse(right.createdAt);
  });
}

export function aiConciergeCacheKey(input: {
  environment: string;
  apiBaseUrl: string;
  clerkUserId: string;
}): string {
  return `${input.environment}\0${input.apiBaseUrl}\0${input.clerkUserId}`;
}

export function rememberAiConciergeSnapshot(snapshot: AiConciergeSnapshot): void {
  if (!snapshot.clerkUserId.trim()) return;
  snapshots.set(aiConciergeCacheKey(snapshot), snapshot);
}

export function readAiConciergeSnapshot(input: {
  environment: string;
  apiBaseUrl: string;
  clerkUserId: string;
}): AiConciergeSnapshot | null {
  if (!input.clerkUserId.trim()) return null;
  return snapshots.get(aiConciergeCacheKey(input)) ?? null;
}

export function retainAiConciergeForAccount(clerkUserId: string): void {
  for (const [key, snapshot] of snapshots) {
    if (snapshot.clerkUserId !== clerkUserId) snapshots.delete(key);
  }
}

export function clearAiConciergeCache(): void {
  snapshots.clear();
}

export function createAiConciergeClient(options: AiConciergeClientOptions) {
  const nativeAuthTest = options.nativeAuthTest ?? isNativeProductionAuthTestEnabled();
  const live = options.enabled === true && nativeAuthTest !== true;
  const sendTimeoutMs = options.sendTimeoutMs ?? AI_CONCIERGE_SEND_TIMEOUT_MS;
  const historyTimeoutMs = options.historyTimeoutMs ?? AI_CONCIERGE_HISTORY_TIMEOUT_MS;

  async function request<T>(
    path: string,
    method: 'GET' | 'POST',
    parse: (value: unknown) => T,
    body: Record<string, unknown> | undefined,
    timeoutMs: number,
  ): Promise<AiConciergeResult<T>> {
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
        timeoutMs,
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
          http: async (response) => new ProductionAuthHttpError(response.status, await readConciergeError(response)),
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
    history: (input?: { before?: string | null; limit?: number }) => {
      if (!live) return Promise.resolve({ kind: 'disabled' } as const);
      const path = aiConciergeHistoryPath(input ?? {});
      if (!path.ok) return Promise.resolve({ kind: 'error', code: path.code } as const);
      return request(path.path, 'GET', parseAiConciergeHistoryPage, undefined, historyTimeoutMs);
    },
    send: (input: { clientMessageId: string; body: string }) => {
      if (!live) return Promise.resolve({ kind: 'disabled' } as const);
      const clientMessageId = input.clientMessageId.trim().toLowerCase();
      if (!UUID.test(clientMessageId)) {
        return Promise.resolve({ kind: 'error', code: 'invalid_body' } as const);
      }
      const issue = aiConciergeBodyIssue(input.body);
      if (issue) return Promise.resolve({ kind: 'error', code: 'invalid_message' } as const);
      return request(
        AI_CONCIERGE_PATHS.messages,
        'POST',
        parseAiConciergeSendResult,
        { clientMessageId, body: input.body },
        sendTimeoutMs,
      );
    },
  };
}

function failureCode(error: unknown): AiConciergeFailure {
  if (error instanceof ProductionAuthHttpError) {
    const code = error.serverCode;
    if (error.status === 401) return 'unauthorized';
    if (error.status === 403) {
      if (code === 'active_membership_required' || code === 'membership_required') {
        return 'membership_required';
      }
      return 'unavailable';
    }
    if (error.status === 409) return 'conflict';
    if (error.status === 429) return 'rate_limited';
    if (error.status === 400) {
      if (code === 'invalid_message' || code === 'invalid_body') return 'invalid_message';
      if (code === 'invalid_cursor' || code === 'invalid_pagination') return 'invalid_cursor';
      if (code === 'invalid_page_size') return 'invalid_page_size';
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

async function readConciergeError(response: Response): Promise<{ code: string | null; body: null }> {
  try {
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { code: null, body: null };
    const code = (payload as { code?: unknown }).code;
    return { code: typeof code === 'string' && SERVER_CODE.test(code) ? code : null, body: null };
  } catch {
    return { code: null, body: null };
  }
}

function parseSupportUrl(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  const url = acceptAiConciergeSupportUrl(value);
  if (url === null) schemaFailure(field);
  return url;
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

function dateTime(value: unknown, field: string): string {
  const text = stringValue(value, field);
  if (!Number.isFinite(Date.parse(text))) schemaFailure(field);
  return text;
}

function parseCursor(value: unknown, field: string): string | null {
  if (value === null) return null;
  const text = stringValue(value, field);
  if (!MESSAGE_CURSOR.test(text) || !Number.isSafeInteger(Number(text))) schemaFailure(field);
  return text;
}
