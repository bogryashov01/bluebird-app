import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { isNativeProductionAuthTestEnabled } from '@/lib/nativeAuthTestPolicy';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import {
  registerClerkPushToken,
  revokeClerkPushToken,
} from '@/lib/clerkPushRegistration';
import {
  acceptRetrievedPushToken,
  canRetrievePushToken,
  classifyPushTokenError,
  describePushPermission,
  foregroundPresentation,
  interpretPushPermission,
  isClerkPushRegistrationEnabled,
  planClerkPushRegistration,
  planExpoPushTokenRetrieval,
  PUSH_DELIVERY_UNAVAILABLE,
  PUSH_REGISTRATION_FAILED,
  PUSH_REGISTRATION_REGISTERED,
  resolveExpoProjectId,
  shouldOfferNotificationSettings,
  shouldPromptForPushPermission,
  shouldRegisterPushToken,
  shouldRevokeHeldPushToken,
  syncHeldPushRegistration,
  type HeldPushRegistration,
  type PushPermissionState,
} from '@/lib/clerkPushNotifications';

export type ClerkPushUiState = {
  permission: PushPermissionState | 'checking';
  permissionLabel: string;
  deliveryLabel: string;
  accountPreferencesLabel: string;
  promptAvailable: boolean;
  settingsAvailable: boolean;
  registration: 'not-configured' | 'waiting' | 'cleared';
};

type Listener = () => void;

const listeners = new Set<Listener>();
let presentedIds: string[] = [];
let promptAttempted = false;
let promptInFlight = false;
let tokenRetrieval: Promise<void> | null = null;
let foregroundConfigured = false;
let held: HeldPushRegistration | null = null;
let registeredToken: { clerkUserId: string; token: string } | null = null;
let deliveryStatus: 'disabled' | 'registered' | 'unavailable' = 'disabled';
let focusPath: string | null = null;
let accessTokenReader: () => Promise<string | null> = async () => null;
let session: {
  ready: boolean;
  signedIn: boolean;
  clerkUserId: string | null;
} = { ready: false, signedIn: false, clerkUserId: null };

let uiState: ClerkPushUiState = {
  permission: 'checking',
  permissionLabel: describePushPermission('checking'),
  deliveryLabel: 'Push delivery is unavailable until the production registration endpoint is confirmed. This app does not send the device token.',
  accountPreferencesLabel: 'Email and SMS preferences belong to the Bluebird account. They do not control iOS notification permission or push delivery.',
  promptAvailable: false,
  settingsAvailable: false,
  registration: 'waiting',
};

function emit(next: ClerkPushUiState) {
  uiState = next;
  listeners.forEach((listener) => listener());
}

export function getClerkPushUiState(): ClerkPushUiState {
  return uiState;
}

export function subscribeClerkPushUi(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function registrationEnabled(): boolean {
  return isClerkPushRegistrationEnabled({
    nativeAuthTest: isNativeProductionAuthTestEnabled(),
  });
}

function currentDeliveryLabel(): string {
  if (!registrationEnabled()) return PUSH_DELIVERY_UNAVAILABLE;
  if (deliveryStatus === 'registered') return PUSH_REGISTRATION_REGISTERED;
  if (deliveryStatus === 'unavailable') return PUSH_REGISTRATION_FAILED;
  return PUSH_DELIVERY_UNAVAILABLE;
}

function publish(permission: PushPermissionState | 'checking') {
  const registration = syncHeldPushRegistration({
    held,
    sessionReady: session.ready,
    signedIn: session.signedIn,
    clerkUserId: session.clerkUserId,
    tokenOwnerId: null,
    token: null,
  });
  held = registration.held;
  emit({
    permission,
    permissionLabel: describePushPermission(permission),
    deliveryLabel: currentDeliveryLabel(),
    accountPreferencesLabel: uiState.accountPreferencesLabel,
    promptAvailable: permission !== 'checking' && shouldPromptForPushPermission({
      sessionLoaded: session.ready,
      signedIn: session.signedIn,
      permission,
      promptAttempted,
    }),
    settingsAvailable: permission !== 'checking' && shouldOfferNotificationSettings(permission),
    registration: registration.status === 'not-configured' ? 'not-configured' : registration.status,
  });
}

export function configureClerkForegroundNotifications(): void {
  if (Platform.OS === 'web' || foregroundConfigured) return;
  foregroundConfigured = true;
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const current = await readPushPermission();
      const decision = foregroundPresentation({
        notificationId: notification.request.identifier,
        alreadyPresented: presentedIds,
        permission: current,
        payload: notification.request.content.data,
        pathname: focusPath,
      });
      presentedIds = decision.presentedIds;
      return {
        shouldShowBanner: decision.show,
        shouldShowList: decision.show,
        shouldPlaySound: decision.show,
        shouldSetBadge: false,
      };
    },
  });
}

function readProjectId(): string | null {
  const extra = Constants.expoConfig?.extra;
  const eas = extra && typeof extra === 'object' ? (extra as { eas?: { projectId?: unknown } }).eas : undefined;
  return resolveExpoProjectId(eas?.projectId ?? Constants.easConfig?.projectId);
}

function readPhysicalDevice(): boolean | null {
  if (Platform.OS === 'web') return false;
  return null;
}

export async function readPushPermission(): Promise<PushPermissionState> {
  if (Platform.OS === 'web') return 'unavailable';
  try {
    const settings = await Notifications.getPermissionsAsync();
    return interpretPushPermission({
      platform: Platform.OS,
      granted: settings.granted === true,
      canAskAgain: settings.canAskAgain !== false,
      iosStatus: settings.ios?.status ?? null,
    });
  } catch {
    return 'unavailable';
  }
}

async function retrieveTokenForCurrentAccount(): Promise<void> {
  const permission = uiState.permission === 'checking' ? await readPushPermission() : uiState.permission;
  if (isNativeProductionAuthTestEnabled()) {
    publish(permission);
    return;
  }
  const registrationPlan = planClerkPushRegistration({
    enabled: registrationEnabled(),
  });
  const plan = planExpoPushTokenRetrieval({
    permission,
    isPhysicalDevice: readPhysicalDevice(),
    projectId: readProjectId(),
  });
  let token: string | null = null;
  let ownerId: string | null = null;
  if (plan.status === 'retrieve' && session.clerkUserId) {
    const requestedUserId = session.clerkUserId;
    try {
      const push = await Notifications.getExpoPushTokenAsync({ projectId: plan.projectId });
      if (session.clerkUserId === requestedUserId) {
        token = acceptRetrievedPushToken(push.data);
        ownerId = requestedUserId;
      }
    } catch (error) {
      classifyPushTokenError(error);
      token = null;
    }
  }
  const registration = syncHeldPushRegistration({
    held,
    sessionReady: session.ready,
    signedIn: session.signedIn,
    clerkUserId: session.clerkUserId,
    tokenOwnerId: ownerId,
    token,
  });
  held = registration.held;
  if (
    registrationPlan.status === 'ready' &&
    held &&
    shouldRegisterPushToken({
      enabled: true,
      clerkUserId: held.clerkUserId,
      token: held.token,
      registeredUserId: registeredToken?.clerkUserId ?? null,
      registeredToken: registeredToken?.token ?? null,
    }) &&
    session.clerkUserId === held.clerkUserId
  ) {
    const requestedUserId = held.clerkUserId;
    const requestedToken = held.token;
    const configuration = getMainBluebirdApiConfigurationOrNull();
    if (!configuration) {
      deliveryStatus = 'unavailable';
    } else {
      try {
        const result = await registerClerkPushToken({
          enabled: true,
          nativeAuthTest: false,
          environment: configuration.environment,
          baseUrl: configuration.apiBaseUrl,
          token: requestedToken,
          getAccessToken: accessTokenReader,
        });
        if (session.clerkUserId === requestedUserId && held?.token === requestedToken) {
          if (result.kind === 'registered') {
            registeredToken = { clerkUserId: requestedUserId, token: requestedToken };
            deliveryStatus = 'registered';
          } else if (result.kind !== 'disabled') {
            deliveryStatus = 'unavailable';
          }
        }
      } catch {
        if (session.clerkUserId === requestedUserId) deliveryStatus = 'unavailable';
      }
    }
  }
  publish(permission);
}

export async function refreshClerkPushPermission(): Promise<void> {
  publish(await readPushPermission());
}

export async function requestClerkPushPermission(): Promise<void> {
  const current = await readPushPermission();
  if (promptInFlight || !shouldPromptForPushPermission({
    sessionLoaded: session.ready,
    signedIn: session.signedIn,
    permission: current,
    promptAttempted,
  })) {
    publish(current);
    return;
  }
  promptInFlight = true;
  try {
    const settings = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: false, allowSound: true },
    });
    promptAttempted = true;
    const permission = interpretPushPermission({
      platform: Platform.OS,
      granted: settings.granted === true,
      canAskAgain: settings.canAskAgain !== false,
      iosStatus: settings.ios?.status ?? null,
    });
    publish(permission);
    if (canRetrievePushToken(permission)) await syncClerkPushToken();
  } catch {
    publish(await readPushPermission());
  } finally {
    promptInFlight = false;
  }
}

export function setClerkPushFocusPath(pathname: string | null): void {
  focusPath = pathname;
}

export async function revokeHeldClerkPushToken(
  reader: () => Promise<string | null> = accessTokenReader,
): Promise<void> {
  const current = held;
  held = null;
  registeredToken = null;
  deliveryStatus = 'disabled';
  if (!current || !registrationEnabled()) return;
  const configuration = getMainBluebirdApiConfigurationOrNull();
  if (!configuration) return;
  try {
    await revokeClerkPushToken({
      enabled: true,
      nativeAuthTest: false,
      environment: configuration.environment,
      baseUrl: configuration.apiBaseUrl,
      token: current.token,
      getAccessToken: reader,
    });
  } catch {
    // Sign-out and account changes continue when revocation cannot finish.
  }
}

export function setClerkPushSession(input: {
  ready: boolean;
  signedIn: boolean;
  clerkUserId: string | null;
  getAccessToken?: () => Promise<string | null>;
  revokeAccessToken?: () => Promise<string | null>;
}): void {
  const previousUserId = session.clerkUserId;
  const accountChanged = previousUserId !== input.clerkUserId;
  if (shouldRevokeHeldPushToken({
    previousUserId,
    nextUserId: input.clerkUserId,
    nextSignedIn: input.signedIn,
    heldUserId: held?.clerkUserId ?? null,
  })) {
    void revokeHeldClerkPushToken(input.revokeAccessToken ?? accessTokenReader);
  }
  if (input.getAccessToken) accessTokenReader = input.getAccessToken;
  session = {
    ready: input.ready,
    signedIn: input.signedIn,
    clerkUserId: input.clerkUserId,
  };
  if (!input.ready || !input.signedIn || accountChanged) {
    held = syncHeldPushRegistration({
      held: accountChanged ? null : held,
      sessionReady: input.ready,
      signedIn: input.signedIn,
      clerkUserId: input.clerkUserId,
      tokenOwnerId: null,
      token: null,
    }).held;
    presentedIds = [];
  }
  if (!input.ready) {
    publish('checking');
    return;
  }
  void refreshClerkPushPermission();
}

export async function syncClerkPushToken(): Promise<void> {
  if (!session.ready || !session.signedIn) return;
  if (tokenRetrieval) return tokenRetrieval;
  tokenRetrieval = retrieveTokenForCurrentAccount().finally(() => {
    tokenRetrieval = null;
  });
  return tokenRetrieval;
}

export function clearClerkPushSession(): void {
  setClerkPushSession({ ready: false, signedIn: false, clerkUserId: null });
}
