/**
 * Clerk-scoped push preparation.
 *
 * The production registration endpoint is not confirmed. This module never
 * chooses a URL, never calls fetch, and never writes the Expo token to
 * persistent storage. The token stays in memory for the Clerk user who was
 * signed in when it was retrieved.
 *
 * Before registration is enabled, the production service must delete that
 * user's token on sign-out and when the account on this device changes.
 * This client cannot perform that deletion until the endpoint exists.
 */

export const PUSH_DELIVERY_UNAVAILABLE =
  'Push delivery is unavailable until the production registration endpoint is confirmed. This app does not send the device token.';

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
  | 'messages';

export type ClerkPushHref =
  | { pathname: '/flight/[id]'; params: { id: string } }
  | { pathname: '/(tabs)/trips'; params: { list: 'queues' } }
  | { pathname: '/(tabs)/trips' }
  | { pathname: '/flight/checklist'; params: { legId: string } }
  | { pathname: '/flight/passengers'; params: { legId: string } }
  | { pathname: '/flight/policy-review'; params: { legId: string } }
  | { pathname: '/(tabs)/membership' }
  | { pathname: '/(tabs)/connections' };

const PUSH_TYPES: Record<string, ClerkPushScreen> = {
  flight_details: 'flight-details',
  my_queues: 'my-queues',
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

export function resolveClerkPushHref(
  payload: unknown,
  activeUserId: string | null,
): { href: ClerkPushHref } | { reason: 'unknown-type' | 'missing-identifier' | 'invalid-route' | 'account-mismatch' | 'unsupported-message' } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { reason: 'invalid-route' };
  }
  const data = payload as Record<string, unknown>;
  if (typeof data.path === 'string' || typeof data.url === 'string' || typeof data.route === 'string') {
    if (typeof data.type !== 'string' || !PUSH_TYPES[data.type]) return { reason: 'invalid-route' };
  }
  const screen = typeof data.type === 'string' ? PUSH_TYPES[data.type] : undefined;
  if (!screen) return { reason: 'unknown-type' };
  const accountId = payloadAccountId(data);
  if (accountId && accountId !== activeUserId) return { reason: 'account-mismatch' };
  if (!activeUserId) return { reason: 'account-mismatch' };

  switch (screen) {
    case 'flight-details': {
      const id = recordId(data.flightId ?? data.id);
      return id ? { href: { pathname: '/flight/[id]', params: { id } } } : { reason: 'missing-identifier' };
    }
    case 'my-queues':
      return { href: { pathname: '/(tabs)/trips', params: { list: 'queues' } } };
    case 'trips':
      return { href: { pathname: '/(tabs)/trips' } };
    case 'winner-checklist': {
      const legId = recordId(data.legId);
      return legId
        ? { href: { pathname: '/flight/checklist', params: { legId } } }
        : { reason: 'missing-identifier' };
    }
    case 'passenger-information': {
      const legId = recordId(data.legId);
      return legId
        ? { href: { pathname: '/flight/passengers', params: { legId } } }
        : { reason: 'missing-identifier' };
    }
    case 'flight-policy': {
      const legId = recordId(data.legId);
      return legId
        ? { href: { pathname: '/flight/policy-review', params: { legId } } }
        : { reason: 'missing-identifier' };
    }
    case 'membership':
      return { href: { pathname: '/(tabs)/membership' } };
    case 'connections':
      return { href: { pathname: '/(tabs)/connections' } };
    case 'messages':
      // The production message notification contract is not available.
      // Demo conversation ids and guessed message ids are not opened.
      return { reason: 'unsupported-message' };
    default:
      return { reason: 'unknown-type' };
  }
}

export function clerkPushReadsCurrentAccount(href: ClerkPushHref): boolean {
  return href.pathname === '/flight/[id]' ||
    href.pathname === '/flight/checklist' ||
    href.pathname === '/flight/passengers' ||
    href.pathname === '/(tabs)/trips';
}

export type QueuedPushResponse = {
  responseId: string;
  payload: unknown;
};

export type PushNavigationDecision = {
  consumedIds: string[];
  queued: QueuedPushResponse | null;
  href: ClerkPushHref | null;
  outcome: 'navigated' | 'pending' | 'duplicate' | 'ignored' | 'account-mismatch';
};

function responseId(value: unknown): string | null {
  return typeof value === 'string' && RESPONSE_ID.test(value) ? value : null;
}

export function considerPushResponse(input: {
  responseId: unknown;
  payload: unknown;
  activeUserId: string | null;
  navigationReady: boolean;
  consumedIds: readonly string[];
  queued: QueuedPushResponse | null;
}): PushNavigationDecision {
  const id = responseId(input.responseId);
  const consumed = new Set(input.consumedIds);
  if (!id) {
    return { consumedIds: [...consumed], queued: input.queued, href: null, outcome: 'ignored' };
  }
  if (consumed.has(id) || input.queued?.responseId === id) {
    return {
      consumedIds: [...consumed],
      queued: input.queued,
      href: null,
      outcome: 'duplicate',
    };
  }
  const resolved = resolveClerkPushHref(input.payload, input.activeUserId);
  if ('reason' in resolved) {
    if (!input.navigationReady && resolved.reason === 'account-mismatch' && !input.activeUserId) {
      return {
        consumedIds: [...consumed],
        queued: { responseId: id, payload: input.payload },
        href: null,
        outcome: 'pending',
      };
    }
    consumed.add(id);
    return {
      consumedIds: [...consumed],
      queued: input.queued?.responseId === id ? null : input.queued,
      href: null,
      outcome: resolved.reason === 'account-mismatch' ? 'account-mismatch' : 'ignored',
    };
  }
  if (!input.navigationReady) {
    return {
      consumedIds: [...consumed],
      queued: { responseId: id, payload: input.payload },
      href: null,
      outcome: 'pending',
    };
  }
  consumed.add(id);
  return {
    consumedIds: [...consumed],
    queued: input.queued?.responseId === id ? null : input.queued,
    href: resolved.href,
    outcome: 'navigated',
  };
}

export function flushQueuedPushResponse(input: {
  queued: QueuedPushResponse | null;
  activeUserId: string | null;
  navigationReady: boolean;
  consumedIds: readonly string[];
}): PushNavigationDecision {
  if (!input.queued) {
    return { consumedIds: [...input.consumedIds], queued: null, href: null, outcome: 'ignored' };
  }
  return considerPushResponse({
    responseId: input.queued.responseId,
    payload: input.queued.payload,
    activeUserId: input.activeUserId,
    navigationReady: input.navigationReady,
    consumedIds: input.consumedIds,
    queued: null,
  });
}

export function dropQueuedPushNavigation(consumedIds: readonly string[]): PushNavigationDecision {
  return { consumedIds: [...consumedIds], queued: null, href: null, outcome: 'ignored' };
}

export function foregroundPresentation(input: {
  notificationId: string;
  alreadyPresented: readonly string[];
  permission: PushPermissionState;
}): { show: boolean; presentedIds: string[] } {
  const presented = new Set(input.alreadyPresented);
  if (!input.notificationId || presented.has(input.notificationId) || !canRetrievePushToken(input.permission)) {
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
