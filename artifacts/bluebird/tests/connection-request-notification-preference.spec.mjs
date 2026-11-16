import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CONNECTION_REQUEST_NOTIFICATION_DESCRIPTION,
  CONNECTION_REQUEST_NOTIFICATION_TITLE,
  CONNECTION_REQUEST_NOTIFICATION_UNAVAILABLE_HINT,
  CONNECTION_REQUEST_PUSH_PREFERENCE_BACKEND_REQUIREMENTS,
  MAIN_API_CONNECTION_REQUEST_PUSH_PREFERENCE_SUPPORTED,
  MAIN_API_MESSAGE_PUSH_PREFERENCE_SUPPORTED,
  MAIN_API_NOTIFICATION_PREFS_KEYS,
  canControlConnectionRequestPushPreference,
  canControlMessagePushPreference,
  mainApiNotificationPrefsControlConnectionRequestPush,
} from "../scripts/.connection-request-notification-preference.test.mjs";

const projectRoot = resolve(import.meta.dirname, "..");

assert.equal(MAIN_API_CONNECTION_REQUEST_PUSH_PREFERENCE_SUPPORTED, false);
assert.equal(MAIN_API_MESSAGE_PUSH_PREFERENCE_SUPPORTED, false);
assert.equal(canControlConnectionRequestPushPreference(), false);
assert.equal(canControlMessagePushPreference(), false);
assert.equal(mainApiNotificationPrefsControlConnectionRequestPush(), false);
assert.equal(CONNECTION_REQUEST_NOTIFICATION_TITLE, "Connection Requests");
assert.match(CONNECTION_REQUEST_NOTIFICATION_DESCRIPTION, /connection request/i);
assert.match(CONNECTION_REQUEST_NOTIFICATION_UNAVAILABLE_HINT, /Coming soon/i);
assert.ok(CONNECTION_REQUEST_PUSH_PREFERENCE_BACKEND_REQUIREMENTS.length >= 4);
assert.ok(
  CONNECTION_REQUEST_PUSH_PREFERENCE_BACKEND_REQUIREMENTS.some((item) =>
    /connection\.requested/i.test(item)
  ),
);

assert.deepEqual([...MAIN_API_NOTIFICATION_PREFS_KEYS].sort(), [
  "allChannels",
  "arrivingFavorite",
  "departingFavorite",
  "emptyLegHomeAirport",
  "mode",
  "queueUpdates",
  "winningNotifications",
].sort());
assert.equal(MAIN_API_NOTIFICATION_PREFS_KEYS.includes("connectionRequests"), false);
assert.equal(MAIN_API_NOTIFICATION_PREFS_KEYS.includes("notifyConnectionRequests"), false);

const productionAuth = readFileSync(resolve(projectRoot, "lib/productionAuthApi.ts"), "utf8");
const prefsInterface = productionAuth.slice(
  productionAuth.indexOf("export interface ProductionNotificationPrefs"),
  productionAuth.indexOf("export interface ProductionUpgradeCreditBalances"),
);
assert.match(prefsInterface, /queueUpdates/);
assert.match(prefsInterface, /winningNotifications/);
assert.doesNotMatch(prefsInterface, /connectionRequest|notifyConnection|pushConnection/i);

const parsePrefs = productionAuth.slice(
  productionAuth.indexOf("function parseNotificationPrefs"),
  productionAuth.indexOf("function parseCreditBalances"),
);
assert.doesNotMatch(parsePrefs, /connectionRequest|notifyConnection/i);

const notifications = readFileSync(resolve(projectRoot, "app/notifications.tsx"), "utf8");
// Connection request push preference UI was removed from Notification Settings for build 20.
assert.doesNotMatch(notifications, /clerk-connection-request-notifications/);
assert.doesNotMatch(notifications, /CONNECTION_REQUEST_NOTIFICATION/);
assert.doesNotMatch(notifications, /canControlConnectionRequestPushPreference/);
assert.doesNotMatch(notifications, /title="Connections"/);
assert.doesNotMatch(notifications, /notifyConnectionRequests|connectionRequestPush/);
assert.doesNotMatch(
  notifications,
  /suppress.*connection\.requested|saveConnectionRequestNotification/i,
);

const pushLib = readFileSync(resolve(projectRoot, "lib/clerkPushNotifications.ts"), "utf8");
assert.match(pushLib, /connection\.requested/);
assert.match(pushLib, /'message\./);

const privacy = readFileSync(resolve(projectRoot, "lib/clerkConnectionPrivacy.ts"), "utf8");
assert.match(privacy, /allowIncomingConnectionRequests/);
assert.doesNotMatch(privacy, /notifyConnectionRequests|connectionRequestPush/);

const profileSource = readFileSync(resolve(projectRoot, "app/(tabs)/profile/index.tsx"), "utf8");
const clerkProfile = profileSource
  .split("testID=\"clerk-profile\"")[1]
  ?.split("AppearanceSheet")[0] ?? profileSource;
assert.match(clerkProfile, /label: 'Notification Settings'/);
assert.match(clerkProfile, /router\.push\('\/notifications'/);
assert.doesNotMatch(clerkProfile, /label: 'Connection Requests'|Get notified when someone sends you a connection request/);
const preferencesBlock = clerkProfile
  .split('title="Preferences"')[1]
  ?.split('title="Connections"')[0] ?? "";
assert.match(preferencesBlock, /clerk-incoming-connection-requests|Allow incoming requests/);
assert.match(clerkProfile, /label: 'Allow incoming requests'/);
assert.match(clerkProfile, /clerk-incoming-connection-requests-switch/);

const notificationPrefsLib = readFileSync(resolve(projectRoot, "lib/clerkNotificationPreferences.ts"), "utf8");
assert.match(notificationPrefsLib, /deviceNotificationPreferenceKey/);
assert.match(notificationPrefsLib, /getClerkNotificationPreferencesQueryKey/);
assert.match(notificationPrefsLib, /saveClerkNotificationPreferences/);
assert.match(notificationPrefsLib, /areNotificationPreferencesEqual/);
// Account-scoped query keys keep prefs isolated across account switches.
assert.match(notificationPrefsLib, /clerkUserId/);

console.log("Connection request notification preference contract tests passed.");
