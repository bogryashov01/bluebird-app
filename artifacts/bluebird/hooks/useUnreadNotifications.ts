import { useListNotifications } from '@workspace/api-client-react';
import type { Notification } from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';

/**
 * Number of unread notifications for the signed-in member.
 * Polls the shared listNotifications query so the badge updates
 * as notifications arrive and clears as items are marked read.
 */
export function useUnreadNotificationsCount(): number {
  const { user } = useAuth();
  const { data } = useListNotifications({
    query: {
      enabled: !!user,
      refetchInterval: 15000,
      refetchIntervalInBackground: false,
    },
  });
  return ((data as Notification[]) ?? []).filter((n) => !n.read).length;
}
