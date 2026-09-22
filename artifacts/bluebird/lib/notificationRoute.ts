import type { Notification } from '@workspace/api-client-react';

export const NETWORKING_INBOX_ROUTE = '/networking/connections';

/**
 * Maps a notification's type to the screen it should open.
 * Returns null for non-networking system/unknown types so callers can choose
 * the appropriate general fallback.
 */
export function notificationRoute(item: Notification): string | null {
  switch (item.type) {
    case 'queue_update':     return '/queue/status';
    case 'flight_confirmed': return '/(tabs)/trips';
    case 'membership':       return '/(tabs)/membership';
    case 'referral':         return '/referral';
    case 'networking_request': return '/networking/requests';
    case 'networking_declined': return '/networking/requests';
    case 'networking_accepted':
    case 'networking_message':
      return item.data?.connectionId
        ? `/networking/connections/${item.data.connectionId}`
        : NETWORKING_INBOX_ROUTE;
    default:                 return null;
  }
}
