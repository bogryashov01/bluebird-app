/**
 * Connection-request push preference (Notification Settings).
 *
 * Main API `notificationPrefs` on GET/PUT `/api/me/profile` is a closed set of
 * email/SMS flight and queue channels. It does not include a push toggle for
 * `connection.requested` events. Client code must not invent profile fields or
 * claim to suppress server-side push until that contract exists.
 *
 * Related but different: `allowIncomingConnectionRequests` controls whether
 * others may *send* requests (privacy). It does not control push delivery.
 *
 * Client already routes/refreshes on `connection.requested` push payloads when
 * the OS delivers them (`clerkPushNotifications` / `ClerkPushCoordinator`).
 */

/** Strict Main API profile parser has no connection-request push preference. */
export const MAIN_API_CONNECTION_REQUEST_PUSH_PREFERENCE_SUPPORTED = false;

export const CONNECTION_REQUEST_NOTIFICATION_TITLE = 'Connection Requests';

export const CONNECTION_REQUEST_NOTIFICATION_DESCRIPTION =
  'Get notified when someone sends you a connection request.';

/**
 * Shown while the Main API lacks a preference field. Connections HTTP lists
 * remain available regardless of push delivery.
 */
export const CONNECTION_REQUEST_NOTIFICATION_UNAVAILABLE_HINT = 'Coming soon';

/**
 * Backend work required before this toggle can control native push:
 * 1. Add a profile (or dedicated) preference, e.g. `notifyConnectionRequests: boolean`
 *    (or channel enum) to GET/PUT `/api/me/profile` (or an explicit push-prefs route).
 * 2. Persist per member across sessions.
 * 3. Gate Expo/APNs send for `connection.requested` on that preference server-side.
 * 4. Keep Connections inbox / incoming-request HTTP APIs independent of the flag.
 * 5. Do not change message push (`message.*`) delivery when this flag is off.
 * 6. Document the field in the Main API contract so the mobile strict parser can adopt it.
 */
export const CONNECTION_REQUEST_PUSH_PREFERENCE_BACKEND_REQUIREMENTS = [
  'Expose a documented preference on the Main API profile (or push-prefs) contract',
  'Persist the preference per member across devices and sessions',
  'Suppress server delivery of connection.requested push when disabled',
  'Leave Connections/incoming-request HTTP lists unaffected when disabled',
  'Leave message push events unaffected when disabled',
] as const;

/** Known Main API notificationPrefs keys — none control connection push. */
export const MAIN_API_NOTIFICATION_PREFS_KEYS = [
  'mode',
  'allChannels',
  'emptyLegHomeAirport',
  'departingFavorite',
  'arrivingFavorite',
  'queueUpdates',
  'winningNotifications',
] as const;

export function mainApiNotificationPrefsControlConnectionRequestPush(): boolean {
  return MAIN_API_CONNECTION_REQUEST_PUSH_PREFERENCE_SUPPORTED;
}

/**
 * Whether the Notification Settings UI may show an interactive toggle that
 * claims to control connection-request push. False until the Main API supports it.
 */
export function canControlConnectionRequestPushPreference(): boolean {
  return MAIN_API_CONNECTION_REQUEST_PUSH_PREFERENCE_SUPPORTED;
}

/**
 * Main API has no message push preference either. Message push (`message.created`)
 * is delivered when the device is registered and iOS permission allows it.
 * Do not invent a Messages toggle in Notification Settings until a contract exists.
 */
export const MAIN_API_MESSAGE_PUSH_PREFERENCE_SUPPORTED = false;

export function canControlMessagePushPreference(): boolean {
  return MAIN_API_MESSAGE_PUSH_PREFERENCE_SUPPORTED;
}
