/**
 * Clerk-scoped push routing and registration policy.
 *
 * This module never calls fetch and never writes the Expo token to persistent
 * storage. The token stays in memory for the Clerk user who was signed in
 * when it was retrieved. Network registration lives in clerkPushRegistration
 * and runs only when EXPO_PUBLIC_BLUEBIRD_PUSH_REGISTRATION is exactly "true".
 */

export const PUSH_DELIVERY_UNAVAILABLE =
  'Push delivery is unavailable until the production registration endpoint is confirmed. This app does not send the device token.';

export const PUSH_REGISTRATION_REGISTERED =
  'This iPhone is registered for Bluebird notifications.';

export const PUSH_REGISTRATION_FAILED =
  'Bluebird could not register this iPhone for notifications. Sign-in and messages continue without it.';

/**
 * Registration stays off unless this is exactly "true".
 * production-live-internal sets it. That selects POST and DELETE
 * /me/push-tokens and does not enable backend push delivery.
 */
export const CLERK_PUSH_REGISTRATION_FLAG = 'EXPO_PUBLIC_BLUEBIRD_PUSH_REGISTRATION';
export const CLERK_PUSH_TOKEN_PATH = '/me/push-tokens';

export function isClerkPushRegistrationEnabled(input?: {
  flag?: string;
  nativeAuthTest?: boolean;
}): boolean {
  const flag = input?.flag ?? process.env[CLERK_PUSH_REGISTRATION_FLAG];
  return flag === 'true' && input?.nativeAuthTest !== true;
}

export type ClerkPushRegistrationPlan =
  | { status: 'disabled' }
  | { status: 'ready'; method: 'POST' | 'DELETE'; path: typeof CLERK_PUSH_TOKEN_PATH };

/** A disabled flag sends nothing. A ready plan names the verified token route. */
export function planClerkPushRegistration(input: {
  enabled: boolean;
  action?: 'register' | 'revoke';
}): ClerkPushRegistrationPlan {
  if (input.enabled !== true) return { status: 'disabled' };
  return {
    status: 'ready',
    method: input.action === 'revoke' ? 'DELETE' : 'POST',
    path: CLERK_PUSH_TOKEN_PATH,
  };
}

export function shouldRegisterPushToken(input: {
  enabled: boolean;
  clerkUserId: string | null;
  token: string | null;
  registeredUserId: string | null;
  registeredToken: string | null;
}): boolean {
  if (input.enabled !== true || !input.clerkUserId || !input.token) return false;
  return input.registeredUserId !== input.clerkUserId || input.registeredToken !== input.token;
}

export function shouldRevokeHeldPushToken(input: {
  previousUserId: string | null;
  nextUserId: string | null;
  nextSignedIn: boolean;
  heldUserId: string | null;
}): boolean {
  if (!input.heldUserId || !input.previousUserId) return false;
  if (!input.nextSignedIn) return true;
  return input.previousUserId !== input.nextUserId;
}

export const PUSH_ACCOUNT_PREFERENCES =
  'Email and SMS preferences belong to the Bluebird account. They do not control iOS notification permission or push delivery.';

export type PushPermissionState =
  | 'undetermined'
  | 'granted'
  | 'provisional'
  | 'denied'
  | 'unavailable';

export type PushTokenBlockReason =
  | 'permission'
  | 'simulator'
  | 'missing-project'
  | 'native-capability'
  | 'error';

const IOS_DENIED = 1;
const IOS_AUTHORIZED = 2;
const IOS_PROVISIONAL = 3;
const IOS_EPHEMERAL = 4;
const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECORD_ID = /^[1-9]\d*$/;
const RESPONSE_ID = /^[A-Za-z0-9._:-]{1,200}$/;

export function interpretPushPermission(input: {
  platform: 'ios' | 'android' | 'web' | string;
  granted: boolean;
  canAskAgain: boolean;
  iosStatus: number | null;
}): PushPermissionState {
  if (input.platform === 'web') return 'unavailable';
  if (input.iosStatus === IOS_PROVISIONAL) return 'provisional';
  if (input.iosStatus === IOS_AUTHORIZED || input.iosStatus === IOS_EPHEMERAL || input.granted) {
    return 'granted';
  }
  if (input.iosStatus === IOS_DENIED || input.canAskAgain === false) return 'denied';
  return 'undetermined';
}

export function shouldPromptForPushPermission(input: {
  sessionLoaded: boolean;
  signedIn: boolean;
  permission: PushPermissionState;
  promptAttempted: boolean;
}): boolean {
  return input.sessionLoaded === true &&
    input.signedIn === true &&
    input.permission === 'undetermined' &&
    input.promptAttempted !== true;
}

export function canRetrievePushToken(permission: PushPermissionState): boolean {
  return permission === 'granted' || permission === 'provisional';
}

export function shouldOfferNotificationSettings(permission: PushPermissionState): boolean {
  return permission === 'denied';
}

export function resolveExpoProjectId(value: unknown): string | null {
  return typeof value === 'string' && PROJECT_ID.test(value) ? value : null;
}

export function planExpoPushTokenRetrieval(input: {
  permission: PushPermissionState;
  isPhysicalDevice: boolean | null;
  projectId: string | null;
}): { status: 'retrieve'; projectId: string } | { status: 'unavailable'; reason: PushTokenBlockReason } {
  if (!canRetrievePushToken(input.permission)) return { status: 'unavailable', reason: 'permission' };
  if (input.isPhysicalDevice === false) return { status: 'unavailable', reason: 'simulator' };
  const projectId = resolveExpoProjectId(input.projectId);
  if (!projectId) return { status: 'unavailable', reason: 'missing-project' };
  return { status: 'retrieve', projectId };
}

export function classifyPushTokenError(error: unknown): Exclude<PushTokenBlockReason, 'permission'> {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('projectid') || message.includes('project id')) return 'missing-project';
  if (message.includes('simulator') || message.includes('physical device')) return 'simulator';
  if (
    message.includes('aps-environment') ||
    message.includes('entitlement') ||
    message.includes('native module') ||
    message.includes('unavailability')
  ) return 'native-capability';
  return 'error';
}

export function acceptRetrievedPushToken(token: unknown): string | null {
  if (typeof token !== 'string') return null;
  const trimmed = token.trim();
  if (!trimmed || trimmed !== token || /\s/.test(token) || token.length > 4096) return null;
  return token;
}

export type HeldPushRegistration = {
  clerkUserId: string;
  token: string;
};

export type PushRegistrationResult =
  | { status: 'waiting'; held: null }
  | { status: 'cleared'; held: null; serverRemoval: 'required' }
  | { status: 'not-configured'; held: HeldPushRegistration; serverRemoval: 'required' };

/**
 * Holds a token only for the Clerk user it was retrieved for.
 * `not-configured` means the token is local and was not sent anywhere.
 */
export function syncHeldPushRegistration(input: {
  held: HeldPushRegistration | null;
  sessionReady: boolean;
  signedIn: boolean;
  clerkUserId: string | null;
  tokenOwnerId: string | null;
  token: string | null;
}): PushRegistrationResult {
  if (!input.sessionReady) return { status: 'waiting', held: null };
  if (!input.signedIn || !input.clerkUserId) {
    return { status: 'cleared', held: null, serverRemoval: 'required' };
  }
  const sameAccount = input.held?.clerkUserId === input.clerkUserId;
  const token = input.tokenOwnerId === input.clerkUserId
    ? acceptRetrievedPushToken(input.token)
    : null;
  const nextToken = token ?? (sameAccount ? input.held?.token ?? null : null);
  if (!nextToken) return { status: 'cleared', held: null, serverRemoval: 'required' };
  return {
    status: 'not-configured',
    held: { clerkUserId: input.clerkUserId, token: nextToken },
    serverRemoval: 'required',
  };
}

export type ClerkPushScreen =
  | 'flight-details'
  | 'my-queues'
  | 'trips'
  | 'winner-checklist'
  | 'passenger-information'
  | 'flight-policy'
  | 'membership'
  | 'connections'
  | 'queue-status'
  | 'messages';

export type ClerkPushHref =
  | { pathname: '/flight/[id]'; params: { id: string } }
  | { pathname: '/(tabs)/trips'; params: { list: 'queues' } }
  | { pathname: '/(tabs)/trips' }
  | { pathname: '/flight/checklist'; params: { legId: string } }
  | { pathname: '/flight/passengers'; params: { legId: string } }
  | { pathname: '/flight/policy-review'; params: { legId: string } }
  | { pathname: '/(tabs)/membership' }
  | { pathname: '/(tabs)/connections' }
  | { pathname: '/flight/queue-status'; params: { flightId: string } }
  | { pathname: '/flight/winner'; params: { flightId: string } }
  | { pathname: '/messages/[conversationId]'; params: { conversationId: string } };

const PUSH_TYPES: Record<string, ClerkPushScreen> = {
  flight_details: 'flight-details',
  flight_update: 'flight-details',
  my_queues: 'my-queues',
  queue_status: 'queue-status',
  trips: 'trips',
  winner_checklist: 'winner-checklist',
  passenger_information: 'passenger-information',
  flight_policy: 'flight-policy',
  membership: 'membership',
  connections: 'connections',
  messages: 'messages',
};

function recordId(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (!RECORD_ID.test(text)) return null;
  const numericId = Number(text);
  return Number.isSafeInteger(numericId) ? text : null;
}

function payloadAccountId(data: Record<string, unknown>): string | null {
  const value = data.clerkUserId ?? data.accountId;
  return typeof value === 'string' && value.trim() && !/\s/.test(value) ? value : null;
}

export type ClerkPushAccountCheck =
  | { kind: 'session' }
  | { kind: 'conversation'; conversationId: number }
  | { kind: 'connection'; connectionId: number }
  | { kind: 'flight'; flightId: number }
  | { kind: 'winner'; flightId: number };

export type ClerkPushResolution =
  | { href: ClerkPushHref; accountCheck: ClerkPushAccountCheck }
  | { reason: 'unknown-type' | 'missing-identifier' | 'invalid-route' | 'account-mismatch' | 'unsupported-message' };

const VERSIONED_EVENTS = {
  'message.created': 'messages',
  'connection.requested': 'connections',
  'connection.accepted': 'connections',
  'flight.published': 'flight',
  'queue.updated': 'flight',
  'flight.back_on': 'flight',
  'winner.selected': 'flight',
  'winner.confirmed': 'flight',
  'flight.cancelled': 'flight',
} as const;

type VersionedEvent = keyof typeof VERSIONED_EVENTS;

function versionedRecord(payload: Record<string, unknown>): Record<string, unknown> | 'reject' | null {
  if (payload.v !== undefined) return payload.v === 1 ? payload : 'reject';
  const nested = payload.data;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const inner = nested as Record<string, unknown>;
    if (inner.v !== undefined) return inner.v === 1 ? inner : 'reject';
  }
  if (typeof payload.type === 'string' && payload.type.includes('.')) return 'reject';
  return null;
}

function versionedRoute(
  event: VersionedEvent,
  navigation: Record<string, unknown>,
): ClerkPushResolution {
  const screen = VERSIONED_EVENTS[event];
  if (navigation.screen !== screen) return { reason: 'invalid-route' };
  if (screen === 'messages') {
    const conversationId = recordId(navigation.conversationId);
    if (!conversationId) return { reason: 'missing-identifier' };
    return {
      href: { pathname: '/messages/[conversationId]', params: { conversationId } },
      accountCheck: { kind: 'conversation', conversationId: Number(conversationId) },
    };
  }
  if (screen === 'connections') {
    const connectionId = recordId(navigation.connectionId);
    if (!connectionId) return { reason: 'missing-identifier' };
    return {
      href: { pathname: '/(tabs)/connections' },
      accountCheck: { kind: 'connection', connectionId: Number(connectionId) },
    };
  }
  const flightId = recordId(navigation.flightId);
  if (!flightId) return { reason: 'missing-identifier' };
  const numericFlightId = Number(flightId);
  if (event === 'queue.updated') {
    return {
      href: { pathname: '/flight/queue-status', params: { flightId } },
      accountCheck: { kind: 'flight', flightId: numericFlightId },
    };
  }
  if (event === 'winner.selected') {
    return {
      href: { pathname: '/flight/winner', params: { flightId } },
      accountCheck: { kind: 'flight', flightId: numericFlightId },
    };
  }
  if (event === 'winner.confirmed') {
    return {
      href: { pathname: '/flight/[id]', params: { id: flightId } },
      accountCheck: { kind: 'flight', flightId: numericFlightId },
    };
  }
  return {
    href: { pathname: '/flight/[id]', params: { id: flightId } },
    accountCheck: { kind: 'flight', flightId: numericFlightId },
  };
}

function resolveVersionedPush(
  body: Record<string, unknown>,
  activeUserId: string | null,
): ClerkPushResolution {
  const event = body.type;
  if (typeof event !== 'string' || !Object.prototype.hasOwnProperty.call(VERSIONED_EVENTS, event)) {
    return { reason: 'unknown-type' };
  }
  const navigation = body.navigation;
  if (!navigation || typeof navigation !== 'object' || Array.isArray(navigation)) {
    return { reason: 'invalid-route' };
  }
  const accountId = payloadAccountId(body) ?? payloadAccountId(navigation as Record<string, unknown>);
  if (accountId && accountId !== activeUserId) return { reason: 'account-mismatch' };
  if (!activeUserId) return { reason: 'account-mismatch' };
  return versionedRoute(event as VersionedEvent, navigation as Record<string, unknown>);
}

function sessionRoute(href: ClerkPushHref): ClerkPushResolution {
  return { href, accountCheck: { kind: 'session' } };
}

export function resolveClerkPushHref(
  payload: unknown,
  activeUserId: string | null,
): ClerkPushResolution {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { reason: 'invalid-route' };
  }
  const data = payload as Record<string, unknown>;
  const versioned = versionedRecord(data);
  if (versioned === 'reject') return { reason: 'invalid-route' };
  if (versioned) return resolveVersionedPush(versioned, activeUserId);
  if (typeof data.path === 'string' || typeof data.url === 'string' || typeof data.route === 'string') {
    if (typeof data.type !== 'string' || !PUSH_TYPES[data.type]) return { reason: 'invalid-route' };
  }
  const screen: ClerkPushScreen | undefined = typeof data.type === 'string' ? PUSH_TYPES[data.type] : undefined;
  if (!screen) return { reason: 'unknown-type' };
  const accountId = payloadAccountId(data);
  if (accountId && accountId !== activeUserId) return { reason: 'account-mismatch' };
  if (!activeUserId) return { reason: 'account-mismatch' };

  switch (screen) {
    case 'flight-details': {
      const id = recordId(data.flightId ?? data.id);
      return id ? sessionRoute({ pathname: '/flight/[id]', params: { id } }) : { reason: 'missing-identifier' };
    }
    case 'my-queues':
      return sessionRoute({ pathname: '/(tabs)/trips', params: { list: 'queues' } });
    case 'trips':
      return sessionRoute({ pathname: '/(tabs)/trips' });
    case 'winner-checklist': {
      const legId = recordId(data.legId);
      return legId
        ? sessionRoute({ pathname: '/flight/checklist', params: { legId } })
        : { reason: 'missing-identifier' };
    }
    case 'passenger-information': {
      const legId = recordId(data.legId);
      return legId
        ? sessionRoute({ pathname: '/flight/passengers', params: { legId } })
        : { reason: 'missing-identifier' };
    }
    case 'flight-policy': {
      const legId = recordId(data.legId);
      return legId
        ? sessionRoute({ pathname: '/flight/policy-review', params: { legId } })
        : { reason: 'missing-identifier' };
    }
    case 'membership':
      return sessionRoute({ pathname: '/(tabs)/membership' });
    case 'connections':
      return sessionRoute({ pathname: '/(tabs)/connections' });
    case 'queue-status': {
      const flightId = recordId(data.flightId);
      if (!flightId) return { reason: 'missing-identifier' };
      if (!accountId) return { reason: 'account-mismatch' };
      return sessionRoute({ pathname: '/flight/queue-status', params: { flightId } });
    }
    case 'messages': {
      const conversationId = recordId(data.conversationId);
      if (!conversationId) return { reason: 'missing-identifier' };
      if (!accountId) return { reason: 'account-mismatch' };
      return sessionRoute({
        pathname: '/messages/[conversationId]',
        params: { conversationId },
      });
    }
    default:
      return { reason: 'unknown-type' };
  }
}

export function pushUsesExistingWinnerNotice(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const versioned = versionedRecord(payload as Record<string, unknown>);
  return !!versioned && versioned !== 'reject' && versioned.type === 'winner.selected';
}

export function pushRepeatsOpenConversation(payload: unknown, pathname: string | null): boolean {
  if (!pathname || !payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const versioned = versionedRecord(payload as Record<string, unknown>);
  if (!versioned || versioned === 'reject' || versioned.type !== 'message.created') return false;
  const navigation = versioned.navigation;
  if (!navigation || typeof navigation !== 'object' || Array.isArray(navigation)) return false;
  const conversationId = recordId((navigation as Record<string, unknown>).conversationId);
  if (!conversationId) return false;
  return pathname === `/messages/${conversationId}`;
}

export function clerkPushReadsCurrentAccount(href: ClerkPushHref): boolean {
  return href.pathname === '/flight/[id]' ||
    href.pathname === '/flight/queue-status' ||
    href.pathname === '/flight/winner' ||
    href.pathname === '/flight/checklist' ||
    href.pathname === '/flight/passengers' ||
    href.pathname === '/messages/[conversationId]' ||
    href.pathname === '/(tabs)/trips';
}

export type QueuedPushResponse = {
  responseId: string;
  payload: unknown;
  boundUserId: string | null;
};

export type PushNavigationDecision = {
  consumedIds: string[];
  queued: QueuedPushResponse | null;
  href: ClerkPushHref | null;
  accountCheck: ClerkPushAccountCheck | null;
  outcome: 'navigated' | 'pending' | 'duplicate' | 'ignored' | 'account-mismatch';
};

function responseId(value: unknown): string | null {
  return typeof value === 'string' && RESPONSE_ID.test(value) ? value : null;
}

function navigationDecision(
  consumed: Set<string>,
  queued: QueuedPushResponse | null,
  href: ClerkPushHref | null,
  accountCheck: ClerkPushAccountCheck | null,
  outcome: PushNavigationDecision['outcome'],
): PushNavigationDecision {
  return { consumedIds: [...consumed], queued, href, accountCheck, outcome };
}

export function considerPushResponse(input: {
  responseId: unknown;
  payload: unknown;
  activeUserId: string | null;
  navigationReady: boolean;
  consumedIds: readonly string[];
  queued: QueuedPushResponse | null;
  boundUserId?: string | null;
}): PushNavigationDecision {
  const id = responseId(input.responseId);
  const consumed = new Set(input.consumedIds);
  if (!id) return navigationDecision(consumed, input.queued, null, null, 'ignored');
  if (consumed.has(id) || input.queued?.responseId === id) {
    return navigationDecision(consumed, input.queued, null, null, 'duplicate');
  }
  const boundUserId = input.boundUserId !== undefined ? input.boundUserId : input.activeUserId;
  if (boundUserId && input.activeUserId && boundUserId !== input.activeUserId) {
    consumed.add(id);
    return navigationDecision(consumed, null, null, null, 'account-mismatch');
  }
  const queue = (): QueuedPushResponse => ({
    responseId: id,
    payload: input.payload,
    boundUserId,
  });
  const resolved = resolveClerkPushHref(input.payload, input.activeUserId);
  if ('reason' in resolved) {
    if (!input.navigationReady && resolved.reason === 'account-mismatch' && !input.activeUserId) {
      return navigationDecision(consumed, queue(), null, null, 'pending');
    }
    consumed.add(id);
    return navigationDecision(
      consumed,
      input.queued?.responseId === id ? null : input.queued,
      null,
      null,
      resolved.reason === 'account-mismatch' ? 'account-mismatch' : 'ignored',
    );
  }
  if (!input.navigationReady) {
    return navigationDecision(consumed, queue(), null, null, 'pending');
  }
  consumed.add(id);
  return navigationDecision(
    consumed,
    input.queued?.responseId === id ? null : input.queued,
    resolved.href,
    resolved.accountCheck,
    'navigated',
  );
}

export function flushQueuedPushResponse(input: {
  queued: QueuedPushResponse | null;
  activeUserId: string | null;
  navigationReady: boolean;
  consumedIds: readonly string[];
}): PushNavigationDecision {
  if (!input.queued) {
    return navigationDecision(new Set(input.consumedIds), null, null, null, 'ignored');
  }
  return considerPushResponse({
    responseId: input.queued.responseId,
    payload: input.queued.payload,
    activeUserId: input.activeUserId,
    navigationReady: input.navigationReady,
    consumedIds: input.consumedIds,
    boundUserId: input.queued.boundUserId,
    queued: null,
  });
}

export function dropQueuedPushNavigation(consumedIds: readonly string[]): PushNavigationDecision {
  return navigationDecision(new Set(consumedIds), null, null, null, 'ignored');
}

export function foregroundPresentation(input: {
  notificationId: string;
  alreadyPresented: readonly string[];
  permission: PushPermissionState;
  payload?: unknown;
  pathname?: string | null;
}): { show: boolean; presentedIds: string[] } {
  const presented = new Set(input.alreadyPresented);
  if (!input.notificationId || presented.has(input.notificationId) || !canRetrievePushToken(input.permission)) {
    return { show: false, presentedIds: [...presented] };
  }
  if (
    pushRepeatsOpenConversation(input.payload, input.pathname ?? null) ||
    pushUsesExistingWinnerNotice(input.payload)
  ) {
    presented.add(input.notificationId);
    return { show: false, presentedIds: [...presented] };
  }
  presented.add(input.notificationId);
  return { show: true, presentedIds: [...presented] };
}

export function describePushPermission(permission: PushPermissionState | 'checking'): string {
  switch (permission) {
    case 'checking':
      return 'Notification permission is checked after the Clerk session is ready.';
    case 'granted':
      return 'This iPhone allows Bluebird notifications.';
    case 'provisional':
      return 'This iPhone allows quiet provisional notifications.';
    case 'denied':
      return 'Notifications are off for Bluebird. iOS will not show the permission prompt again.';
    case 'undetermined':
      return 'Bluebird has not asked this iPhone for notification permission.';
    case 'unavailable':
      return 'Notification permission is not available on this device.';
    default:
      return 'Notification permission is unavailable.';
  }
}
