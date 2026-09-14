import type { Notification } from '@workspace/api-client-react';

/**
 * Maps a notification's type to the screen it should open.
 * Returns null for system/unknown types that have no destination.
 */
export function notificationRoute(item: Notification): string | null {
  switch (item.type) {
    case 'queue_update':     return '/queue/status';
    case 'flight_confirmed': return '/(tabs)/trips';
    case 'membership':       return '/(tabs)/membership';
    case 'referral':         return '/referral';
    default:                 return null;
  }
}
