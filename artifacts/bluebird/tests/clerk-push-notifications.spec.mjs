import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";
import {
  PUSH_DELIVERY_UNAVAILABLE,
  classifyPushTokenError,
  clerkPushReadsCurrentAccount,
  considerPushResponse,
  describePushPermission,
  dropQueuedPushNavigation,
  flushQueuedPushResponse,
  foregroundPresentation,
  interpretPushPermission,
  planExpoPushTokenRetrieval,
  resolveClerkPushHref,
  resolveExpoProjectId,
  shouldOfferNotificationSettings,
  shouldPromptForPushPermission,
  syncHeldPushRegistration,
} from "../scripts/.clerk-push-notifications.test.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const PROJECT_ID = "83e7e28f-bdf2-4b83-9e9d-0727ba066b2c";
const TOKEN = "ExponentPushToken[secret-value]";

test("permission granted, provisional, and denied stay distinct", () => {
  assert.equal(interpretPushPermission({
    platform: "ios",
    granted: true,
    canAskAgain: false,
    iosStatus: 2,
  }), "granted");
  assert.equal(interpretPushPermission({
    platform: "ios",
    granted: false,
    canAskAgain: false,
    iosStatus: 3,
  }), "provisional");
  assert.equal(interpretPushPermission({
    platform: "ios",
    granted: false,
    canAskAgain: false,
    iosStatus: 1,
  }), "denied");
  assert.equal(shouldPromptForPushPermission({
    sessionLoaded: false,
    signedIn: true,
    permission: "undetermined",
    promptAttempted: false,
  }), false);
  assert.equal(shouldPromptForPushPermission({
    sessionLoaded: true,
    signedIn: true,
    permission: "undetermined",
    promptAttempted: false,
  }), true);
  assert.equal(shouldPromptForPushPermission({
    sessionLoaded: true,
    signedIn: true,
    permission: "denied",
    promptAttempted: false,
  }), false);
  assert.equal(shouldPromptForPushPermission({
    sessionLoaded: true,
    signedIn: true,
    permission: "undetermined",
    promptAttempted: true,
  }), false);
  assert.equal(shouldOfferNotificationSettings("denied"), true);
  assert.equal(shouldOfferNotificationSettings("provisional"), false);
  assert.match(describePushPermission("denied"), /will not show the permission prompt again/);
});

test("a missing project id, simulator, and token failure never invent a token", () => {
  assert.equal(resolveExpoProjectId(""), null);
  assert.equal(resolveExpoProjectId(PROJECT_ID), PROJECT_ID);
  assert.deepEqual(planExpoPushTokenRetrieval({
    permission: "granted",
    isPhysicalDevice: true,
    projectId: null,
  }), { status: "unavailable", reason: "missing-project" });
  assert.deepEqual(planExpoPushTokenRetrieval({
    permission: "denied",
    isPhysicalDevice: true,
    projectId: PROJECT_ID,
  }), { status: "unavailable", reason: "permission" });
  assert.deepEqual(planExpoPushTokenRetrieval({
    permission: "granted",
    isPhysicalDevice: false,
    projectId: PROJECT_ID,
  }), { status: "unavailable", reason: "simulator" });
  assert.equal(classifyPushTokenError(new Error("aps-environment entitlement missing")), "native-capability");
  assert.equal(classifyPushTokenError(new Error("network failed")), "error");
  assert.equal(JSON.stringify(classifyPushTokenError(new Error(TOKEN))).includes(TOKEN), false);
});

test("an account switch and sign-out drop the other account's token", () => {
  const held = syncHeldPushRegistration({
    held: null,
    sessionReady: true,
    signedIn: true,
    clerkUserId: "user_a",
    tokenOwnerId: "user_a",
    token: TOKEN,
  });
  assert.equal(held.status, "not-configured");
  assert.equal(held.held?.clerkUserId, "user_a");
  const switched = syncHeldPushRegistration({
    held: held.held,
    sessionReady: true,
    signedIn: true,
    clerkUserId: "user_b",
    tokenOwnerId: "user_a",
    token: TOKEN,
  });
  assert.equal(switched.status, "cleared");
  assert.equal(switched.held, null);
  assert.equal(switched.serverRemoval, "required");
  const signedOut = syncHeldPushRegistration({
    held: held.held,
    sessionReady: true,
    signedIn: false,
    clerkUserId: null,
    tokenOwnerId: null,
    token: null,
  });
  assert.equal(signedOut.status, "cleared");
  assert.equal(signedOut.serverRemoval, "required");
});

test("foreground presentation shows one banner and hides a duplicate", () => {
  const first = foregroundPresentation({
    notificationId: "note-1",
    alreadyPresented: [],
    permission: "granted",
  });
  assert.equal(first.show, true);
  const duplicate = foregroundPresentation({
    notificationId: "note-1",
    alreadyPresented: first.presentedIds,
    permission: "granted",
  });
  assert.equal(duplicate.show, false);
  assert.equal(foregroundPresentation({
    notificationId: "note-2",
    alreadyPresented: [],
    permission: "denied",
  }).show, false);
});

test("background and cold-start responses wait for auth and ignore duplicates", () => {
  const waiting = considerPushResponse({
    responseId: "response-1",
    payload: { type: "flight_details", flightId: 42 },
    activeUserId: null,
    navigationReady: false,
    consumedIds: [],
    queued: null,
  });
  assert.equal(waiting.outcome, "pending");
  assert.equal(waiting.href, null);
  const ready = flushQueuedPushResponse({
    queued: waiting.queued,
    activeUserId: "user_a",
    navigationReady: true,
    consumedIds: waiting.consumedIds,
  });
  assert.equal(ready.outcome, "navigated");
  assert.deepEqual(ready.href, { pathname: "/flight/[id]", params: { id: "42" } });
  const duplicate = considerPushResponse({
    responseId: "response-1",
    payload: { type: "flight_details", flightId: 42 },
    activeUserId: "user_a",
    navigationReady: true,
    consumedIds: ready.consumedIds,
    queued: null,
  });
  assert.equal(duplicate.outcome, "duplicate");
  assert.equal(duplicate.href, null);
});

test("missing identifiers, invalid routes, and unknown types do not navigate", () => {
  assert.equal(resolveClerkPushHref({ type: "flight_details" }, "user_a").reason, "missing-identifier");
  assert.equal(resolveClerkPushHref({
    type: "flight_details",
    path: "/admin",
    flightId: "../42",
  }, "user_a").reason, "missing-identifier");
  assert.equal(resolveClerkPushHref({ path: "/flight/42" }, "user_a").reason, "invalid-route");
  assert.equal(resolveClerkPushHref({ type: "boarding_pass", flightId: 42 }, "user_a").reason, "unknown-type");
  assert.equal(resolveClerkPushHref({
    type: "messages",
    conversationId: "https://example.test/chat",
  }, "user_a").reason, "unsupported-message");
  const flight = resolveClerkPushHref({
    type: "flight_details",
    url: "https://example.test/secret",
    flightId: "42",
  }, "user_a");
  assert.deepEqual(flight.href, { pathname: "/flight/[id]", params: { id: "42" } });
  assert.equal(JSON.stringify(flight).includes("example.test"), false);
});

test("known screens use fixed routes and a different account is dropped", () => {
  assert.deepEqual(resolveClerkPushHref({ type: "my_queues" }, "user_a").href, {
    pathname: "/(tabs)/trips",
    params: { list: "queues" },
  });
  assert.deepEqual(resolveClerkPushHref({ type: "trips" }, "user_a").href, { pathname: "/(tabs)/trips" });
  assert.deepEqual(resolveClerkPushHref({ type: "winner_checklist", legId: 7 }, "user_a").href, {
    pathname: "/flight/checklist",
    params: { legId: "7" },
  });
  assert.deepEqual(resolveClerkPushHref({ type: "passenger_information", legId: 7 }, "user_a").href, {
    pathname: "/flight/passengers",
    params: { legId: "7" },
  });
  assert.deepEqual(resolveClerkPushHref({ type: "flight_policy", legId: 7 }, "user_a").href, {
    pathname: "/flight/policy-review",
    params: { legId: "7" },
  });
  assert.deepEqual(resolveClerkPushHref({ type: "membership" }, "user_a").href, { pathname: "/(tabs)/membership" });
  assert.deepEqual(resolveClerkPushHref({ type: "connections" }, "user_a").href, { pathname: "/(tabs)/connections" });
  for (const conversationId of ["demo-conversation-ellis", "42", "1"]) {
    const messages = resolveClerkPushHref({ type: "messages", conversationId }, "user_a");
    assert.equal(messages.reason, "unsupported-message");
    assert.equal("href" in messages, false);
  }
  const ignoredMessages = considerPushResponse({
    responseId: "response-messages",
    payload: { type: "messages", conversationId: "demo-conversation-ellis", path: "/connections-preview/chat/demo-conversation-ellis" },
    activeUserId: "user_a",
    navigationReady: true,
    consumedIds: [],
    queued: null,
  });
  assert.equal(ignoredMessages.outcome, "ignored");
  assert.equal(ignoredMessages.href, null);
  assert.equal(resolveClerkPushHref({
    type: "networking_message",
    connectionId: "9",
  }, "user_a").reason, "unknown-type");
  assert.equal(clerkPushReadsCurrentAccount({ pathname: "/flight/[id]", params: { id: "42" } }), true);
  assert.equal(clerkPushReadsCurrentAccount({ pathname: "/(tabs)/connections" }), false);
  const mismatch = considerPushResponse({
    responseId: "response-2",
    payload: { type: "trips", clerkUserId: "user_a" },
    activeUserId: "user_b",
    navigationReady: true,
    consumedIds: [],
    queued: null,
  });
  assert.equal(mismatch.outcome, "account-mismatch");
  assert.equal(mismatch.href, null);
  const dropped = dropQueuedPushNavigation(mismatch.consumedIds);
  assert.equal(dropped.queued, null);
  assert.equal(dropped.href, null);
});

test("Clerk push registration does not call the legacy JWT endpoint or persist the token", () => {
  const library = readFileSync(resolve(projectRoot, "lib/clerkPushNotifications.ts"), "utf8");
  const runtime = readFileSync(resolve(projectRoot, "lib/clerkPushRuntime.ts"), "utf8");
  const coordinator = readFileSync(resolve(projectRoot, "components/ClerkPushCoordinator.tsx"), "utf8");
  const auth = readFileSync(resolve(projectRoot, "context/AuthContext.tsx"), "utf8");
  const preferences = readFileSync(resolve(projectRoot, "lib/clerkNotificationPreferences.ts"), "utf8");
  for (const source of [library, runtime, coordinator]) {
    assert.equal(source.includes("/api/networking/push-tokens"), false);
    assert.equal(source.includes("AsyncStorage"), false);
    assert.equal(source.includes("fetch("), false);
  }
  assert.match(library, /serverRemoval: 'required'/);
  assert.match(runtime, /getExpoPushTokenAsync\(\{ projectId: plan\.projectId \}\)/);
  assert.match(runtime, /if \(isNativeProductionAuthTestEnabled\(\)\)/);
  const tokenCall = runtime.indexOf("getExpoPushTokenAsync");
  const authTestGuard = runtime.indexOf("if (isNativeProductionAuthTestEnabled())");
  assert.ok(authTestGuard >= 0 && authTestGuard < tokenCall);
  const permissionRequest = runtime.indexOf("requestPermissionsAsync");
  const promptRecorded = runtime.indexOf("promptAttempted = true");
  assert.ok(permissionRequest >= 0 && promptRecorded > permissionRequest);
  assert.equal(runtime.includes("console.log"), false);
  const legacyEffect = auth.slice(auth.indexOf("Legacy local JWT sessions only"));
  assert.match(legacyEffect.slice(0, legacyEffect.indexOf("getExpoPushTokenAsync")), /if \(clerkMode\) return;/);
  assert.match(legacyEffect, /registerPushToken\.mutate/);
  assert.match(preferences, /'email', 'sms', 'both'/);
  assert.equal(preferences.toLowerCase().includes("push"), false);
  const screen = readFileSync(resolve(projectRoot, "app/notifications.tsx"), "utf8");
  assert.match(screen, /ClerkPushPermissionStatus/);
  assert.match(readFileSync(resolve(projectRoot, "components/ClerkTrips.tsx"), "utf8"), /params\.list === 'queues'/);
  assert.match(PUSH_DELIVERY_UNAVAILABLE, /does not send the device token/);
});
