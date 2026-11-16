import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CONNECTION_REQUEST_PUSH_PREFERENCE_UI_SHOWN,
  NOTIFICATION_SETTINGS_CAPABILITIES,
  functionalNotificationSettingIds,
  unsupportedNotificationSettingIds,
} from "../scripts/.notification-settings-capabilities.test.mjs";

const projectRoot = resolve(import.meta.dirname, "..");

assert.equal(CONNECTION_REQUEST_PUSH_PREFERENCE_UI_SHOWN, false);

assert.deepEqual(functionalNotificationSettingIds().sort(), [
  "all-flights",
  "flight-confirmations",
  "flights-home-airport",
  "queue-updates",
].sort());

assert.deepEqual(unsupportedNotificationSettingIds().sort(), [
  "international-flights",
  "membership-updates",
  "messages-push",
].sort());

for (const item of NOTIFICATION_SETTINGS_CAPABILITIES) {
  if (item.status === "functional") {
    assert.equal(item.persistence, "main-api-notificationPrefs");
    assert.equal(item.delivery, "email-sms");
  } else {
    assert.equal(item.persistence, "none");
    assert.equal(item.delivery, "none");
  }
}

const editor = readFileSync(resolve(projectRoot, "components/NotificationPreferenceEditor.tsx"), "utf8");
assert.match(editor, /Flights from my Home Airport/);
assert.match(editor, /All Flights/);
assert.match(editor, /International Flights/);
assert.match(editor, /Coming soon/);
assert.match(editor, /Queue Updates/);
assert.match(editor, /Flight Confirmations/);
assert.match(editor, /control="channels"/);
assert.match(editor, /emptyLegHomeAirport/);
assert.match(editor, /allChannels/);
assert.match(editor, /queueUpdates/);
assert.match(editor, /winningNotifications/);
// Home vs All must stay mutually exclusive via mode.
assert.match(editor, /turningOff \? 'off'/);
assert.match(editor, /withFlightMode/);

const notifications = readFileSync(resolve(projectRoot, "app/notifications.tsx"), "utf8");
assert.doesNotMatch(notifications, /clerk-connection-request-notifications|title="Connections"|Connection Requests/);
assert.match(notifications, /Membership Updates/);
assert.match(notifications, /Coming soon/);
assert.match(notifications, /PUSH_ACCOUNT_PREFERENCES|ClerkPushPermissionStatus/);
assert.doesNotMatch(notifications, /notifyConnectionRequests/);

const push = readFileSync(resolve(projectRoot, "lib/clerkPushNotifications.ts"), "utf8");
assert.match(push, /Email and SMS preferences below don’t control alerts on this iPhone/);
assert.match(push, /message\.created/);
assert.match(push, /connection\.requested/);

const prefs = readFileSync(resolve(projectRoot, "lib/clerkNotificationPreferences.ts"), "utf8");
assert.match(prefs, /deviceNotificationPreferenceKey\(clerkUserId/);
assert.match(prefs, /getClerkNotificationPreferencesQueryKey\(/);
assert.match(prefs, /clerkUserId \?\? 'signed-out'/);

console.log("Notification settings capabilities tests passed.");
