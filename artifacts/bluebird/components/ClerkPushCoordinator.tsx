import { useEffect, useRef } from 'react';
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useAuth } from '@/context/AuthContext';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { isClerkHomeAvailable } from '@/lib/clerkMemberResolution';
import { CLERK_MEMBER_NAVIGATION_READINESS } from '@/lib/productionAuthState';
import {
  considerPushResponse,
  type PushNavigationDecision,
  type QueuedPushResponse,
} from '@/lib/clerkPushNotifications';
import {
  configureClerkForegroundNotifications,
  requestClerkPushPermission,
  setClerkPushSession,
  syncClerkPushToken,
} from '@/lib/clerkPushRuntime';

function notificationPayload(response: Notifications.NotificationResponse): unknown {
  return response.notification.request.content.data ?? null;
}

function remember(decision: PushNavigationDecision, consumedIds: string[], queued: QueuedPushResponse | null) {
  if (decision.outcome === 'navigated' && decision.href) {
    router.push(decision.href);
    Notifications.clearLastNotificationResponse();
  }
  return { consumedIds: decision.consumedIds, queued: decision.queued ?? queued };
}

export function ClerkPushCoordinator() {
  const { authMode, clerkMemberResolution } = useAuth();
  const session = useClerkAuthSnapshot();
  const consumedIds = useRef<string[]>([]);
  const queued = useRef<QueuedPushResponse | null>(null);
  const previousUserId = useRef<string | null>(null);
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
    const previous = previousUserId.current;
    const accountChanged = previous !== null && previous !== activeUserId;
    if (accountChanged || (previous !== null && !signedIn)) {
      queued.current = null;
      Notifications.clearLastNotificationResponse();
    }
    previousUserId.current = activeUserId;
    setClerkPushSession({
      ready: sessionLoaded,
      signedIn,
      clerkUserId: activeUserId,
    });
  }, [activeUserId, sessionLoaded, signedIn]);

  useEffect(() => {
    if (!navigationReady) return;
    void (async () => {
      await requestClerkPushPermission();
      await syncClerkPushToken();
    })();
  }, [activeUserId, navigationReady]);

  useEffect(() => {
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
      const next = remember(decision, consumedIds.current, queued.current);
      consumedIds.current = next.consumedIds;
      queued.current = decision.queued;
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
        queued: null,
      });
      consumedIds.current = decision.consumedIds;
      queued.current = decision.queued;
      if (decision.href) {
        router.push(decision.href);
        Notifications.clearLastNotificationResponse();
      }
    }

    take(Notifications.getLastNotificationResponse());
    const subscription = Notifications.addNotificationResponseReceivedListener(take);
    return () => subscription.remove();
  }, [activeUserId, navigationReady, sessionLoaded, signedIn]);

  return null;
}
