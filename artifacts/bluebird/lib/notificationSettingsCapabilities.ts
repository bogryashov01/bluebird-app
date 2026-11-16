/**
 * Notification Settings capability map for Main API–backed Clerk Profile.
 *
 * `notificationPrefs` on GET/PUT `/api/me/profile` persists email/SMS delivery
 * preferences. Those fields do not control iOS APNs / Expo push delivery.
 * Message push (`message.created`) uses device registration + OS permission only.
 */

import {
  MAIN_API_CONNECTION_REQUEST_PUSH_PREFERENCE_SUPPORTED,
  MAIN_API_MESSAGE_PUSH_PREFERENCE_SUPPORTED,
} from './connectionRequestNotificationPreference';

export type NotificationSettingCapability =
  | {
      id:
        | 'flights-home-airport'
        | 'all-flights'
        | 'queue-updates'
        | 'flight-confirmations';
      title: string;
      status: 'functional';
      persistence: 'main-api-notificationPrefs';
      delivery: 'email-sms';
      notes: string;
    }
  | {
      id:
        | 'international-flights'
        | 'membership-updates'
        | 'messages-push';
      title: string;
      status: 'unsupported';
      persistence: 'none';
      delivery: 'none';
      notes: string;
    };

export const NOTIFICATION_SETTINGS_CAPABILITIES: readonly NotificationSettingCapability[] = [
  {
    id: 'flights-home-airport',
    title: 'Flights from my Home Airport',
    status: 'functional',
    persistence: 'main-api-notificationPrefs',
    delivery: 'email-sms',
    notes:
      'mode=specific with emptyLegHomeAirport (+ optional favorite airport channels). Mutually exclusive with All Flights via mode.',
  },
  {
    id: 'all-flights',
    title: 'All Flights',
    status: 'functional',
    persistence: 'main-api-notificationPrefs',
    delivery: 'email-sms',
    notes: 'mode=all with allChannels. Mutually exclusive with Home Airport via mode.',
  },
  {
    id: 'international-flights',
    title: 'International Flights',
    status: 'unsupported',
    persistence: 'none',
    delivery: 'none',
    notes: 'No Main API preference field. UI is Coming soon.',
  },
  {
    id: 'queue-updates',
    title: 'Queue Updates',
    status: 'functional',
    persistence: 'main-api-notificationPrefs',
    delivery: 'email-sms',
    notes:
      'queueUpdates channel (email|sms|both). Main API requires a channel; there is no off flag. Not native push.',
  },
  {
    id: 'flight-confirmations',
    title: 'Flight Confirmations',
    status: 'functional',
    persistence: 'main-api-notificationPrefs',
    delivery: 'email-sms',
    notes:
      'winningNotifications channel (email|sms|both). Maps to winner/confirmation email/SMS prefs. Not native push.',
  },
  {
    id: 'membership-updates',
    title: 'Membership Updates',
    status: 'unsupported',
    persistence: 'none',
    delivery: 'none',
    notes: 'No Main API preference field. UI is Coming soon.',
  },
  {
    id: 'messages-push',
    title: 'Messages',
    status: 'unsupported',
    persistence: 'none',
    delivery: 'none',
    notes:
      MAIN_API_MESSAGE_PUSH_PREFERENCE_SUPPORTED
        ? 'Supported'
        : 'No Messages push preference. message.created push continues via registration + iOS permission when delivered.',
  },
] as const;

/** Not shown in Notification Settings UI; documented for backend gap tracking only. */
export const CONNECTION_REQUEST_PUSH_PREFERENCE_UI_SHOWN = false;
export const CONNECTION_REQUEST_PUSH_PREFERENCE_SUPPORTED =
  MAIN_API_CONNECTION_REQUEST_PUSH_PREFERENCE_SUPPORTED;

export function functionalNotificationSettingIds(): string[] {
  return NOTIFICATION_SETTINGS_CAPABILITIES.filter((item) => item.status === 'functional').map((item) => item.id);
}

export function unsupportedNotificationSettingIds(): string[] {
  return NOTIFICATION_SETTINGS_CAPABILITIES.filter((item) => item.status === 'unsupported').map((item) => item.id);
}
