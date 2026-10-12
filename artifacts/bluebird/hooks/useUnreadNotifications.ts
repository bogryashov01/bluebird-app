import { useListNotifications } from '@workspace/api-client-react';
import type { Notification } from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import { isLocalFlightReadMode } from '@/lib/productionFlights';

/**
 * Number of unread notifications for the signed-in member.
 * Polls the shared listNotifications query so the badge updates
 * as notifications arrive and clears as items are marked read.
 */
export function useUnreadNotificationsCount(): number {
  const { user } = useAuth();
  const localDemoFlow = isLocalFlightReadMode();
  const { data } = useListNotifications({
    query: {
      enabled: localDemoFlow && !!user,
      refetchInterval: 15000,
      refetchIntervalInBackground: false,
    },
  });
  return localDemoFlow
    ? ((data as Notification[]) ?? []).filter((n) => !n.read).length
    : 0;
}
