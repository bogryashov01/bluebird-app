/**
 * Hint socket for member messages.
 *
 * The Member Messaging Gateway authenticates the first text frame and then
 * sends JSON hints. Message bodies stay on the authenticated HTTP client.
 * Connection hints carry only a connection id and refresh the REST lists.
 * These hints are not operating-system push notifications.
 * The Clerk JWT is sent only in that first frame and is never written to a log.
 * The client does not send a conversation subscription. The gateway decides
 * which account-owned events to deliver after authentication.
 *
 * Heartbeat: React Native 0.86.3 connects through SocketRocket 0.7.1.
 * A control-frame ping is answered with a control-frame pong inside
 * SocketRocket's _handlePingWithData, including when RCTWebSocketModule does
 * not implement didReceivePing. Those frames are not delivered to JavaScript,
 * so this client does not send an application-level pong.
 *
 * Origin: SocketRocket first sets Origin to the https form of the gateway
 * host, then replaces it with any Origin on the connection request. This
 * client sets that header only from EXPO_PUBLIC_BLUEBIRD_MESSAGING_GATEWAY_ORIGIN.
 */

import { isNativeProductionAuthTestEnabled } from './nativeAuthTestPolicy';
import {
  isMemberMessagesIntegrationEnabled,
  MEMBER_MESSAGE_POLL_MS,
} from './memberMessages';

export const MEMBER_MESSAGE_REALTIME_FLAG = 'EXPO_PUBLIC_BLUEBIRD_MESSAGING_REALTIME';
export const MEMBER_MESSAGE_GATEWAY_URL = 'EXPO_PUBLIC_BLUEBIRD_MESSAGING_GATEWAY_URL';
export const MEMBER_MESSAGE_GATEWAY_ORIGIN = 'EXPO_PUBLIC_BLUEBIRD_MESSAGING_GATEWAY_ORIGIN';
export const MEMBER_MESSAGE_REALTIME_AUTH_TIMEOUT_MS = 5_000;
export const MEMBER_MESSAGE_AUTH_CLOSE_CODE = 1008;

const RECORD_ID = /^[1-9]\d*$/;
const ISO_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const MAX_FRAME_CHARS = 8_192;
const SEEN_MESSAGE_LIMIT = 200;
const AUTH_CLOSE_REASONS = new Set(['Authentication failed', 'Authentication required']);

export function isMemberMessageRealtimeEnabled(input?: {
  flag?: string;
  messagesEnabled?: boolean;
  nativeAuthTest?: boolean;
}): boolean {
  const flag = input?.flag ?? process.env[MEMBER_MESSAGE_REALTIME_FLAG];
  const messagesEnabled = input?.messagesEnabled ?? isMemberMessagesIntegrationEnabled();
  const nativeAuthTest = input?.nativeAuthTest ?? isNativeProductionAuthTestEnabled();
  return flag === 'true' && messagesEnabled === true && nativeAuthTest !== true;
}

export interface MemberMessageGatewayConfiguration {
  gatewayUrl: string;
  gatewayOrigin: string | null;
}

/**
 * Reads only EXPO_PUBLIC_BLUEBIRD_MESSAGING_* vars. Never reuses web Vite env
 * names and never invents a production hostname. Returns null until the
 * gateway URL is valid.
 */
export function resolveMemberMessageGatewayConfiguration(input?: {
  gatewayUrl?: unknown;
  gatewayOrigin?: unknown;
}): MemberMessageGatewayConfiguration | null {
  const gatewayUrl = acceptMessagingGatewayUrl(
    input?.gatewayUrl !== undefined
      ? input.gatewayUrl
      : process.env[MEMBER_MESSAGE_GATEWAY_URL],
  );
  if (!gatewayUrl) return null;
  const origin = resolveMessagingGatewayOrigin(
    input?.gatewayOrigin !== undefined
      ? input.gatewayOrigin
      : process.env[MEMBER_MESSAGE_GATEWAY_ORIGIN],
  );
  if (origin.status === 'invalid') return null;
  return {
    gatewayUrl,
    gatewayOrigin: origin.status === 'configured' ? origin.origin : null,
  };
}

export function acceptMessagingGatewayUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value !== value.trim() || /\s/.test(value)) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  if (
    parsed.protocol !== 'wss:' ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !pathname.endsWith('/ws')
  ) return null;
  return `${parsed.origin}${pathname}`;
}

export function memberMessagePollIntervalMs(input: {
  realtimeEnabled: boolean;
  socketLive: boolean;
}): number | null {
  // This release uses HTTP polling as the authoritative foreground update path.
  // Skip only while a live gateway socket is already delivering hints.
  if (input.realtimeEnabled === true && input.socketLive === true) return null;
  return MEMBER_MESSAGE_POLL_MS;
}

/**
 * Connections poll over HTTP while the app is focused in the foreground.
 * Skip only while a live gateway socket is already delivering connection hints.
 */
export function connectionRefreshIntervalMs(input: {
  realtimeEnabled: boolean;
  socketLive: boolean;
}): number | null {
  if (input.realtimeEnabled === true && input.socketLive === true) return null;
  return MEMBER_MESSAGE_POLL_MS;
}

export function realtimeReconnectDelayMs(attempt: number, random: number): number {
  const step = Number.isSafeInteger(attempt) && attempt > 0 ? attempt : 1;
  const exponential = Math.min(30_000, 1_000 * 2 ** (step - 1));
  const unit = random >= 0 && random < 1 ? random : 0;
  const jitter = Math.round(exponential * 0.2 * unit);
  return Math.min(30_000, exponential + jitter);
}

export function memberMessageAuthFrame(token: string): string | null {
  if (typeof token !== 'string' || token.trim() === '' || /\s/.test(token)) return null;
  return JSON.stringify({ type: 'authenticate', token });
}

export function memberMessageAuthCloseHalts(code: unknown, reason: unknown): boolean {
  return code === MEMBER_MESSAGE_AUTH_CLOSE_CODE && typeof reason === 'string' && AUTH_CLOSE_REASONS.has(reason);
}

export function acceptMessagingGatewayOrigin(value: string): string | null {
  if (!value || value !== value.trim() || /\s/.test(value)) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== 'https:' ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== '/' && parsed.pathname !== '')
  ) return null;
  const port = parsed.port ? `:${parsed.port}` : '';
  return `https://${parsed.hostname}${port}`;
}

export function resolveMessagingGatewayOrigin(value: unknown):
  | { status: 'platform-default' }
  | { status: 'configured'; origin: string }
  | { status: 'invalid' } {
  if (value === undefined || value === null || value === '') return { status: 'platform-default' };
  if (typeof value !== 'string') return { status: 'invalid' };
  const origin = acceptMessagingGatewayOrigin(value);
  return origin ? { status: 'configured', origin } : { status: 'invalid' };
}

/** Origin SocketRocket 0.7.1 sends when the connection request has no Origin header. */
export function defaultMessagingGatewayOrigin(gatewayUrl: string): string | null {
  const accepted = acceptMessagingGatewayUrl(gatewayUrl);
  if (!accepted) return null;
  const parsed = new URL(accepted);
  const port = parsed.port && parsed.port !== '443' ? `:${parsed.port}` : '';
  return `https://${parsed.hostname}${port}`;
}

export type MemberMessageRealtimeFrame =
  | { type: 'authenticated' }
  | { type: 'message.created'; conversationId: number; messageId: number }
  | { type: 'conversation.updated'; conversationId: number }
  | { type: 'unread.changed'; conversationId: number }
  | { type: 'connection.requested'; connectionId: number }
  | { type: 'connection.accepted'; connectionId: number };

function recordId(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const text = String(value).trim();
  if (!RECORD_ID.test(text)) return null;
  const numeric = Number(text);
  return Number.isSafeInteger(numeric) ? numeric : null;
}

function eventData(value: Record<string, unknown>): Record<string, unknown> | null {
  if (!value.data || typeof value.data !== 'object' || Array.isArray(value.data)) return null;
  return value.data as Record<string, unknown>;
}

function optionalStamp(fields: Record<string, unknown>, key: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(fields, key)) return true;
  return typeof fields[key] === 'string' && ISO_STAMP.test(fields[key]);
}

function optionalUnreadCount(fields: Record<string, unknown>): boolean {
  if (!Object.prototype.hasOwnProperty.call(fields, 'unreadCount')) return true;
  return typeof fields.unreadCount === 'number' && Number.isSafeInteger(fields.unreadCount) && fields.unreadCount >= 0;
}

export function parseMemberMessageRealtimeFrame(raw: unknown): MemberMessageRealtimeFrame | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_FRAME_CHARS) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const root = parsed as Record<string, unknown>;
  if (typeof root.type !== 'string') return null;
  if (root.type === 'authenticated') return { type: 'authenticated' };
  const fields = eventData(root);
  if (!fields) return null;
  if (root.type === 'connection.requested' || root.type === 'connection.accepted') {
    const connectionId = recordId(fields.connectionId);
    if (!connectionId) return null;
    return { type: root.type, connectionId };
  }
  const conversationId = recordId(fields.conversationId);
  if (!conversationId) return null;
  if (root.type === 'conversation.updated') {
    if (!optionalStamp(fields, 'updatedAt')) return null;
    return { type: 'conversation.updated', conversationId };
  }
  if (root.type === 'unread.changed') {
    if (!optionalUnreadCount(fields)) return null;
    return { type: 'unread.changed', conversationId };
  }
  if (root.type === 'message.created') {
    const messageId = recordId(fields.messageId);
    if (!messageId || !optionalStamp(fields, 'createdAt')) return null;
    return { type: 'message.created', conversationId, messageId };
  }
  return null;
}

export type MemberMessageRealtimeHint =
  | { kind: 'auth'; clerkUserId: string }
  | { kind: 'message'; clerkUserId: string; conversationId: number; messageId: number }
  | { kind: 'conversation'; clerkUserId: string; conversationId: number }
  | { kind: 'unread'; clerkUserId: string; conversationId: number }
  | { kind: 'connection-request'; clerkUserId: string; connectionId: number }
  | { kind: 'connection-accepted'; clerkUserId: string; connectionId: number };

export function realtimeHintRequestsHistory(
  hint: MemberMessageRealtimeHint,
  conversationId: number,
): boolean {
  if (hint.kind === 'auth') return true;
  if (hint.kind === 'unread' || hint.kind === 'connection-request' || hint.kind === 'connection-accepted') return false;
  return hint.conversationId === conversationId;
}

export function realtimeHintRequestsInbox(hint: MemberMessageRealtimeHint): boolean {
  return hint.kind === 'auth' ||
    hint.kind === 'message' ||
    hint.kind === 'conversation' ||
    hint.kind === 'unread' ||
    hint.kind === 'connection-accepted';
}

/** Connection hints reload the REST connection lists. They do not open a message. */
export function realtimeHintRequestsConnections(hint: MemberMessageRealtimeHint): boolean {
  return hint.kind === 'auth' || hint.kind === 'connection-request' || hint.kind === 'connection-accepted';
}

export interface MemberMessageRealtimeClose {
  code?: number;
  reason?: string;
}

export interface MemberMessageRealtimeSocket {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: ((event?: MemberMessageRealtimeClose) => void) | null;
}

export interface MemberMessageRealtimeSession {
  stop(): void;
}

interface Timer {
  cancel(): void;
}

export function createMemberMessageRealtimeSession(input: {
  gatewayUrl: string;
  clerkUserId: string;
  getAccessToken: () => Promise<string | null>;
  createSocket: (url: string, origin: string | null) => MemberMessageRealtimeSocket;
  onHint: (hint: MemberMessageRealtimeHint) => void;
  onLive?: (live: boolean) => void;
  schedule: (callback: () => void, delayMs: number) => Timer;
  random?: () => number;
  authTimeoutMs?: number;
  origin?: string | null;
}): MemberMessageRealtimeSession {
  const url = acceptMessagingGatewayUrl(input.gatewayUrl);
  const origin = input.origin ?? null;
  const random = input.random ?? Math.random;
  const authTimeoutMs = input.authTimeoutMs ?? MEMBER_MESSAGE_REALTIME_AUTH_TIMEOUT_MS;
  let stopped = false;
  let attempt = 0;
  let authenticated = false;
  let opening = false;
  let waitingForToken = false;
  let holdAuth = false;
  let socket: MemberMessageRealtimeSocket | null = null;
  let reconnectTimer: Timer | null = null;
  let authTimer: Timer | null = null;
  let sentToken: string | null = null;
  let rejectedToken: string | null = null;
  let rejectObservedToken = false;
  const seenMessageIds = new Set<string>();

  const clearAuthTimer = () => {
    authTimer?.cancel();
    authTimer = null;
  };

  const publishLive = (live: boolean) => {
    try {
      input.onLive?.(live);
    } catch {
      // A screen cannot change the socket by observing it.
    }
  };

  const detach = (current: MemberMessageRealtimeSocket) => {
    current.onopen = null;
    current.onmessage = null;
    current.onerror = null;
    current.onclose = null;
  };

  const scheduleReconnect = (callback: () => void) => {
    if (stopped || reconnectTimer) return;
    const delay = realtimeReconnectDelayMs(attempt + 1, random());
    attempt += 1;
    reconnectTimer = input.schedule(() => {
      reconnectTimer = null;
      callback();
    }, delay);
  };

  const fail = () => {
    if (stopped || opening || waitingForToken) return;
    opening = true;
    authenticated = false;
    clearAuthTimer();
    const current = socket;
    socket = null;
    if (current) {
      detach(current);
      try {
        current.close();
      } catch {
        // The close handler must not keep a failed socket alive.
      }
    }
    opening = false;
    publishLive(false);
    scheduleReconnect(open);
  };

  const recoverFromRejectedToken = () => {
    void (async () => {
      if (stopped || socket) return;
      let token: string | null = null;
      try {
        token = await input.getAccessToken();
      } catch {
        token = null;
      }
      if (stopped || socket || !holdAuth) return;
      const frame = token ? memberMessageAuthFrame(token) : null;
      if (!token || !frame || token === rejectedToken || rejectObservedToken) {
        if (token && rejectObservedToken) {
          rejectedToken = token;
          rejectObservedToken = false;
        }
        scheduleReconnect(recoverFromRejectedToken);
        return;
      }
      holdAuth = false;
      waitingForToken = false;
      rejectObservedToken = false;
      attempt = 0;
      open();
    })();
  };

  const haltForAuthentication = (token: string | null, rejectObserved: boolean) => {
    waitingForToken = true;
    holdAuth = true;
    rejectObservedToken = rejectObserved && token === null;
    authenticated = false;
    clearAuthTimer();
    rejectedToken = token;
    publishLive(false);
    scheduleReconnect(recoverFromRejectedToken);
  };

  const deliver = (hint: MemberMessageRealtimeHint) => {
    if (stopped || !authenticated) return;
    try {
      input.onHint(hint);
    } catch {
      // A screen refresh must not close the socket.
    }
  };

  const open = () => {
    if (stopped || socket || !url || waitingForToken) return;
    sentToken = null;
    let next: MemberMessageRealtimeSocket;
    try {
      next = input.createSocket(url, origin);
    } catch {
      fail();
      return;
    }
    socket = next;
    next.onerror = () => {
      if (stopped || socket !== next || waitingForToken) return;
      fail();
    };
    next.onclose = (event) => {
      if (socket !== next || stopped || waitingForToken) return;
      socket = null;
      if (memberMessageAuthCloseHalts(event?.code, event?.reason)) {
        detach(next);
        haltForAuthentication(sentToken, true);
        return;
      }
      fail();
    };
    next.onopen = () => {
      void (async () => {
        if (stopped || socket !== next || waitingForToken) return;
        let token: string | null;
        try {
          token = await input.getAccessToken();
        } catch {
          token = null;
        }
        const frame = token ? memberMessageAuthFrame(token) : null;
        if (stopped || socket !== next) return;
        if (!frame || !token) {
          detach(next);
          socket = null;
          try {
            next.close();
          } catch {
            // An unusable token must not remain connected.
          }
          haltForAuthentication(token, false);
          return;
        }
        try {
          next.send(frame);
        } catch {
          fail();
          return;
        }
        sentToken = token;
        clearAuthTimer();
        authTimer = input.schedule(() => {
          if (!authenticated && socket === next) fail();
        }, authTimeoutMs);
      })();
    };
    next.onmessage = (event) => {
      if (stopped || socket !== next) return;
      const frame = parseMemberMessageRealtimeFrame(event.data);
      if (!frame) return;
      if (frame.type === 'authenticated') {
        authenticated = true;
        attempt = 0;
        rejectedToken = null;
        holdAuth = false;
        seenMessageIds.clear();
        clearAuthTimer();
        publishLive(true);
        deliver({ kind: 'auth', clerkUserId: input.clerkUserId });
        return;
      }
      if (!authenticated) return;
      if (frame.type === 'message.created') {
        const key = `${frame.conversationId}:${frame.messageId}`;
        if (seenMessageIds.has(key)) return;
        if (seenMessageIds.size >= SEEN_MESSAGE_LIMIT) seenMessageIds.clear();
        seenMessageIds.add(key);
        deliver({
          kind: 'message',
          clerkUserId: input.clerkUserId,
          conversationId: frame.conversationId,
          messageId: frame.messageId,
        });
        return;
      }
      if (frame.type === 'conversation.updated') {
        deliver({
          kind: 'conversation',
          clerkUserId: input.clerkUserId,
          conversationId: frame.conversationId,
        });
        return;
      }
      if (frame.type === 'connection.requested' || frame.type === 'connection.accepted') {
        const key = `${frame.type}:${frame.connectionId}`;
        if (seenMessageIds.has(key)) return;
        if (seenMessageIds.size >= SEEN_MESSAGE_LIMIT) seenMessageIds.clear();
        seenMessageIds.add(key);
        deliver({
          kind: frame.type === 'connection.requested' ? 'connection-request' : 'connection-accepted',
          clerkUserId: input.clerkUserId,
          connectionId: frame.connectionId,
        });
        return;
      }
      deliver({
        kind: 'unread',
        clerkUserId: input.clerkUserId,
        conversationId: frame.conversationId,
      });
    };
  };

  if (!url) {
    return { stop() { stopped = true; } };
  }
  open();

  return {
    stop() {
      stopped = true;
      authenticated = false;
      waitingForToken = false;
      holdAuth = false;
      rejectObservedToken = false;
      clearAuthTimer();
      reconnectTimer?.cancel();
      reconnectTimer = null;
      const current = socket;
      socket = null;
      if (current) {
        detach(current);
        try {
          current.close();
        } catch {
          // Sign-out still completes when the socket is already closed.
        }
      }
      publishLive(false);
    },
  };
}

const hintListeners = new Set<(hint: MemberMessageRealtimeHint) => void>();
const liveListeners = new Set<(live: boolean) => void>();
let socketLive = false;
let activeSession: { clerkUserId: string; stop: () => void } | null = null;

function setSocketLive(live: boolean) {
  if (socketLive === live) return;
  socketLive = live;
  liveListeners.forEach((listener) => {
    try {
      listener(live);
    } catch {
      // Status listeners cannot change the socket.
    }
  });
}

export function subscribeMemberMessageHints(
  listener: (hint: MemberMessageRealtimeHint) => void,
): () => void {
  hintListeners.add(listener);
  return () => hintListeners.delete(listener);
}

/**
 * Publishes an HTTP refresh hint without the WebSocket gateway.
 * Used when a native push arrives so Connections/Messages reload over REST.
 */
export function publishMemberMessageHint(hint: MemberMessageRealtimeHint): void {
  hintListeners.forEach((listener) => {
    try {
      listener(hint);
    } catch {
      // One screen cannot block the others.
    }
  });
}

export function subscribeMemberMessageSocketLive(listener: (live: boolean) => void): () => void {
  liveListeners.add(listener);
  listener(socketLive);
  return () => liveListeners.delete(listener);
}

export function isMemberMessageSocketLive(): boolean {
  return socketLive;
}

type GatewaySocketConstructor = new (
  url: string,
  protocols?: string | string[] | null,
  options?: { headers?: { Origin: string } },
) => WebSocket;

function browserSocket(url: string, origin: string | null): MemberMessageRealtimeSocket {
  const SocketCtor = globalThis.WebSocket as GatewaySocketConstructor | undefined;
  if (typeof SocketCtor !== 'function') throw new Error('realtime-unavailable');
  const native = origin
    ? new SocketCtor(url, null, { headers: { Origin: origin } })
    : new SocketCtor(url);
  const adapter: MemberMessageRealtimeSocket = {
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    send(data) {
      native.send(data);
    },
    close() {
      native.close();
    },
  };
  native.onopen = () => adapter.onopen?.();
  native.onmessage = (event) => adapter.onmessage?.({ data: event.data });
  native.onerror = () => adapter.onerror?.();
  native.onclose = (event) => adapter.onclose?.({
    code: typeof event.code === 'number' ? event.code : undefined,
    reason: typeof event.reason === 'string' ? event.reason : '',
  });
  return adapter;
}

export function startMemberMessageRealtime(input: {
  clerkUserId: string;
  gatewayUrl: unknown;
  gatewayOrigin?: unknown;
  getAccessToken: () => Promise<string | null>;
  createSocket?: (url: string, origin: string | null) => MemberMessageRealtimeSocket;
  schedule?: (callback: () => void, delayMs: number) => Timer;
  random?: () => number;
}): void {
  const origin = resolveMessagingGatewayOrigin(
    input.gatewayOrigin !== undefined ? input.gatewayOrigin : process.env[MEMBER_MESSAGE_GATEWAY_ORIGIN],
  );
  if (!input.clerkUserId || !acceptMessagingGatewayUrl(input.gatewayUrl) || origin.status === 'invalid') {
    stopMemberMessageRealtime();
    return;
  }
  if (activeSession?.clerkUserId === input.clerkUserId) return;
  stopMemberMessageRealtime();
  const configuredOrigin = origin.status === 'configured' ? origin.origin : null;
  const session = createMemberMessageRealtimeSession({
    gatewayUrl: String(input.gatewayUrl),
    clerkUserId: input.clerkUserId,
    origin: configuredOrigin,
    getAccessToken: input.getAccessToken,
    createSocket: input.createSocket ?? browserSocket,
    schedule: input.schedule ?? ((callback, delayMs) => {
      const timer = setTimeout(callback, delayMs);
      return { cancel: () => clearTimeout(timer) };
    }),
    random: input.random,
    onLive: setSocketLive,
    onHint: (hint) => {
      hintListeners.forEach((listener) => {
        try {
          listener(hint);
        } catch {
          // One screen cannot block the others.
        }
      });
    },
  });
  activeSession = {
    clerkUserId: input.clerkUserId,
    stop: () => {
      session.stop();
      setSocketLive(false);
    },
  };
}

export function stopMemberMessageRealtime(): void {
  activeSession?.stop();
  activeSession = null;
  setSocketLive(false);
}
