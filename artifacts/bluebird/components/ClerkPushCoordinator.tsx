import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { router, usePathname } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useAuth } from '@/context/AuthContext';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { isClerkHomeAvailable } from '@/lib/clerkMemberResolution';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import { CLERK_MEMBER_NAVIGATION_READINESS } from '@/lib/productionAuthState';
import { confirmClerkPushDestination } from '@/lib/clerkPushDestination';
import {
  considerPushResponse,
  type PushNavigationDecision,
  type QueuedPushResponse,
} from '@/lib/clerkPushNotifications';
import {
  configureClerkForegroundNotifications,
  refreshClerkPushPermission,
  requestClerkPushPermission,
  setClerkPushFocusPath,
  setClerkPushSession,
  syncClerkPushToken,
} from '@/lib/clerkPushRuntime';

function notificationPayload(response: Notifications.NotificationResponse): unknown {
  return response.notification.request.content.data ?? null;
}

function remember(decision: PushNavigationDecision) {
  return decision.consumedIds;
}

export function ClerkPushCoordinator() {
  const { authMode, clerkMemberResolution } = useAuth();
  const session = useClerkAuthSnapshot();
  const pathname = usePathname();
  const consumedIds = useRef<string[]>([]);
  const queued = useRef<QueuedPushResponse | null>(null);
  const previousUserId = useRef<string | null>(null);
  const navigationGeneration = useRef(0);
  const readToken = useRef<() => Promise<string | null>>(async () => null);
  const previousTokenReader = useRef<() => Promise<string | null>>(async () => null);
  const sessionGetToken = session?.getToken;
  const sessionLoaded = authMode === 'clerk' && session?.isLoaded === true;
  const signedIn = sessionLoaded && session?.isSignedIn === true && !!session.userId;
  const activeUserId = signedIn ? session?.userId ?? null : null;
  const navigationReady = signedIn && isClerkHomeAvailable(
    clerkMemberResolution,
    CLERK_MEMBER_NAVIGATION_READINESS,
  );

  useEffect(() => {
    configureClerkForegroundNotifications();
  }, []);

  useEffect(() => {
    setClerkPushFocusPath(pathname);
  }, [pathname]);

  useEffect(() => {
    const previous = previousUserId.current;
    const accountChanged = previous !== null && previous !== activeUserId;
    if (accountChanged || (previous !== null && !signedIn)) {
      navigationGeneration.current += 1;
      queued.current = null;
      Notifications.clearLastNotificationResponse();
    }
    previousUserId.current = activeUserId;
    const revokeAccessToken = previousTokenReader.current;
    const currentTokenReader = () => sessionGetToken?.() ?? Promise.resolve(null);
    previousTokenReader.current = currentTokenReader;
    readToken.current = currentTokenReader;
    setClerkPushSession({
      ready: sessionLoaded,
      signedIn,
      clerkUserId: activeUserId,
      getAccessToken: currentTokenReader,
      revokeAccessToken,
    });
  }, [activeUserId, sessionGetToken, sessionLoaded, signedIn]);

  useEffect(() => {
    if (!navigationReady) return;
    void (async () => {
      await requestClerkPushPermission();
      await syncClerkPushToken();
    })();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      void refreshClerkPushPermission().then(() => syncClerkPushToken());
    });
    return () => subscription.remove();
  }, [activeUserId, navigationReady]);

  useEffect(() => {
    const openIfAuthorized = (decision: PushNavigationDecision) => {
      if (decision.outcome !== 'navigated' || !decision.href) return;
      const href = decision.href;
      const check = decision.accountCheck;
      if (!check || check.kind === 'session') {
        router.push(href);
        Notifications.clearLastNotificationResponse();
        return;
      }
      const configuration = getMainBluebirdApiConfigurationOrNull();
      if (!configuration) return;
      const generation = navigationGeneration.current;
      void confirmClerkPushDestination({
        check,
        environment: configuration.environment,
        baseUrl: configuration.apiBaseUrl,
        getAccessToken: () => readToken.current(),
      }).then((allowed) => {
        if (!allowed || navigationGeneration.current !== generation) return;
        router.push(href);
        Notifications.clearLastNotificationResponse();
      }).catch(() => undefined);
    };

    const take = (response: Notifications.NotificationResponse | null) => {
      if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const decision = considerPushResponse({
        responseId: response.notification.request.identifier,
        payload: notificationPayload(response),
        activeUserId,
        navigationReady,
        consumedIds: consumedIds.current,
        queued: queued.current,
      });
      consumedIds.current = remember(decision);
      queued.current = decision.queued;
      openIfAuthorized(decision);
    };

    if (!sessionLoaded) {
      take(Notifications.getLastNotificationResponse());
      return;
    }
    if (!signedIn) return;

    if (navigationReady && queued.current) {
      const decision = considerPushResponse({
        responseId: queued.current.responseId,
        payload: queued.current.payload,
        activeUserId,
        navigationReady,
        consumedIds: consumedIds.current,
        boundUserId: queued.current.boundUserId,
        queued: null,
      });
      consumedIds.current = decision.consumedIds;
      queued.current = decision.queued;
      openIfAuthorized(decision);
    }

    take(Notifications.getLastNotificationResponse());
    const subscription = Notifications.addNotificationResponseReceivedListener(take);
    return () => subscription.remove();
  }, [activeUserId, navigationReady, sessionLoaded, signedIn]);

  return null;
}
