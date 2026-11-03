import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
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
  isClerkPushRegistrationEnabled,
  planClerkPushRegistration,
  pushRepeatsOpenConversation,
  shouldRegisterPushToken,
  shouldRevokeHeldPushToken,
} from "../scripts/.clerk-push-notifications.test.mjs";
import {
  registerClerkPushToken,
  revokeClerkPushToken,
} from "../scripts/.clerk-push-registration.test.mjs";
import { confirmClerkPushDestination } from "../scripts/.clerk-push-destination.test.mjs";

const { iosApnsModeForProfile } = createRequire(import.meta.url)("../app.config.js");

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
  }, "user_a").reason, "missing-identifier");
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
  assert.deepEqual(resolveClerkPushHref({ type: "flight_update", flightId: 42 }, "user_a").href, {
    pathname: "/flight/[id]",
    params: { id: "42" },
  });
  assert.deepEqual(resolveClerkPushHref({
    type: "queue_status",
    flightId: 9,
    clerkUserId: "user_a",
  }, "user_a").href, {
    pathname: "/flight/queue-status",
    params: { flightId: "9" },
  });
  assert.equal(resolveClerkPushHref({ type: "queue_status", flightId: 9 }, "user_a").reason, "account-mismatch");
  assert.equal(resolveClerkPushHref({
    type: "messages",
    conversationId: "demo-conversation-ellis",
    clerkUserId: "user_a",
  }, "user_a").reason, "missing-identifier");
  assert.deepEqual(resolveClerkPushHref({
    type: "messages",
    conversationId: 7,
    clerkUserId: "user_a",
  }, "user_a").href, {
    pathname: "/messages/[conversationId]",
    params: { conversationId: "7" },
  });
  assert.equal(resolveClerkPushHref({ type: "messages", conversationId: 7 }, "user_a").reason, "account-mismatch");
  assert.equal(resolveClerkPushHref({
    type: "messages",
    conversationId: 7,
    clerkUserId: "user_b",
  }, "user_a").reason, "account-mismatch");
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
  assert.match(runtime, /planClerkPushRegistration/);
  assert.match(runtime, /if \(tokenRetrieval\) return tokenRetrieval;/);
  assert.equal(runtime.match(/addNotificationResponseReceivedListener/g), null);
  const coordinatorListeners = coordinator.match(/addNotificationResponseReceivedListener/g);
  assert.equal(coordinatorListeners?.length, 1);
  const eas = readFileSync(resolve(projectRoot, "eas.json"), "utf8");
  assert.equal(eas.includes("EXPO_PUBLIC_BLUEBIRD_PUSH_REGISTRATION"), false);
  const builds = JSON.parse(eas).build;
  const app = JSON.parse(readFileSync(resolve(projectRoot, "app.json"), "utf8")).expo;
  assert.equal(app.ios.bundleIdentifier, "com.bluebirdjets.app");
  assert.deepEqual(
    app.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === "expo-notifications"),
    ["expo-notifications", { mode: "production" }],
  );
  assert.equal(iosApnsModeForProfile(undefined, builds), "production");
  assert.equal(iosApnsModeForProfile("production", builds), "production");
  assert.equal(iosApnsModeForProfile("production-auth-test", builds), "production");
  assert.equal(iosApnsModeForProfile("production-live-internal", builds), "production");
  assert.equal(iosApnsModeForProfile("development", builds), "development");
  assert.equal(iosApnsModeForProfile("development-simulator", builds), "development");
  assert.equal(iosApnsModeForProfile("production-clerk-debug", builds), "development");
  assert.equal(isClerkPushRegistrationEnabled({ flag: "false" }), false);
  assert.equal(isClerkPushRegistrationEnabled({ flag: "true", nativeAuthTest: true }), false);
  assert.equal(isClerkPushRegistrationEnabled({ flag: "true" }), true);
  assert.deepEqual(planClerkPushRegistration({ enabled: false }), { status: "disabled" });
  assert.deepEqual(planClerkPushRegistration({ enabled: true }), {
    status: "ready",
    method: "POST",
    path: "/me/push-tokens",
  });
  assert.deepEqual(planClerkPushRegistration({ enabled: true, action: "revoke" }), {
    status: "ready",
    method: "DELETE",
    path: "/me/push-tokens",
  });
  assert.match(PUSH_DELIVERY_UNAVAILABLE, /does not send the device token/);
  const registration = readFileSync(resolve(projectRoot, "lib/clerkPushRegistration.ts"), "utf8");
  const destination = readFileSync(resolve(projectRoot, "lib/clerkPushDestination.ts"), "utf8");
  for (const source of [registration, destination, runtime, coordinator]) {
    assert.equal(source.includes("/api/networking/push-tokens"), false);
    assert.equal(source.includes("console."), false);
  }
  assert.equal(registration.includes("platform"), false);
  assert.equal(registration.includes("userId"), false);
  assert.match(registration, /JSON\.stringify\(\{ token: accepted \}\)/);
  assert.match(runtime, /registerClerkPushToken/);
  assert.match(runtime, /revokeHeldClerkPushToken/);
  assert.match(coordinator, /confirmClerkPushDestination/);
  assert.match(coordinator, /boundUserId: queued\.current\.boundUserId/);
  assert.match(readFileSync(resolve(projectRoot, "components/ClerkPushPermissionStatus.tsx"), "utf8"), /state\.deliveryLabel/);
  const clerkSignOut = auth.slice(auth.indexOf("const signOut"), auth.indexOf("await clerkSession?.signOut()"));
  assert.match(clerkSignOut, /await revokeHeldClerkPushToken\(\)/);
  assert.equal(shouldRegisterPushToken({
    enabled: false,
    clerkUserId: "user_a",
    token: TOKEN,
    registeredUserId: null,
    registeredToken: null,
  }), false);
  assert.equal(shouldRegisterPushToken({
    enabled: true,
    clerkUserId: "user_a",
    token: TOKEN,
    registeredUserId: "user_a",
    registeredToken: TOKEN,
  }), false);
  assert.equal(shouldRegisterPushToken({
    enabled: true,
    clerkUserId: "user_b",
    token: TOKEN,
    registeredUserId: "user_a",
    registeredToken: TOKEN,
  }), true);
  assert.equal(shouldRevokeHeldPushToken({
    previousUserId: "user_a",
    nextUserId: null,
    nextSignedIn: false,
    heldUserId: "user_a",
  }), true);
  assert.equal(shouldRevokeHeldPushToken({
    previousUserId: "user_a",
    nextUserId: "user_b",
    nextSignedIn: true,
    heldUserId: "user_a",
  }), true);
  assert.equal(shouldRevokeHeldPushToken({
    previousUserId: "user_a",
    nextUserId: "user_a",
    nextSignedIn: true,
    heldUserId: "user_a",
  }), false);
});

const API = "https://bluebirdjets.com/api";
const SESSION = "session-jwt";

function versioned(type, screen, ids) {
  return { v: 1, type, navigation: { screen, ...ids } };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("token registration and revocation use only the verified route", async () => {
  const calls = [];
  const registered = await registerClerkPushToken({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl: API,
    token: TOKEN,
    getAccessToken: async () => SESSION,
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ registered: true });
    },
  });
  assert.deepEqual(registered, { kind: "registered" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${API}/me/push-tokens`);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.credentials, "omit");
  assert.deepEqual(JSON.parse(calls[0].init.body), { token: TOKEN });
  assert.deepEqual(Object.keys(JSON.parse(calls[0].init.body)), ["token"]);
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${SESSION}`);
  const revoked = await revokeClerkPushToken({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl: API,
    token: TOKEN,
    getAccessToken: async () => SESSION,
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ revoked: true });
    },
  });
  assert.deepEqual(revoked, { kind: "revoked" });
  assert.equal(calls[1].init.method, "DELETE");
  assert.deepEqual(JSON.parse(calls[1].init.body), { token: TOKEN });
});

test("a disabled registration flag and an unavailable backend send nothing that blocks the app", async () => {
  let called = false;
  const disabled = await registerClerkPushToken({
    enabled: false,
    nativeAuthTest: false,
    environment: "production",
    baseUrl: API,
    token: TOKEN,
    getAccessToken: async () => SESSION,
    fetcher: async () => {
      called = true;
      return jsonResponse({ registered: true });
    },
  });
  assert.deepEqual(disabled, { kind: "disabled" });
  assert.equal(called, false);
  const unavailable = await registerClerkPushToken({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl: API,
    token: TOKEN,
    getAccessToken: async () => SESSION,
    fetcher: async () => jsonResponse({ message: "missing" }, 404),
  });
  assert.deepEqual(unavailable, { kind: "unavailable" });
  const offline = await revokeClerkPushToken({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl: API,
    token: TOKEN,
    getAccessToken: async () => SESSION,
    fetcher: async () => {
      throw new Error("offline");
    },
  });
  assert.deepEqual(offline, { kind: "unavailable" });
  const authTest = await registerClerkPushToken({
    enabled: true,
    nativeAuthTest: true,
    environment: "production",
    baseUrl: API,
    token: TOKEN,
    getAccessToken: async () => SESSION,
    fetcher: async () => jsonResponse({ registered: true }),
  });
  assert.deepEqual(authTest, { kind: "disabled" });
});

test("versioned payloads reject malformed events and keep legacy account isolation", () => {
  const message = versioned("message.created", "messages", { conversationId: 123 });
  assert.deepEqual(resolveClerkPushHref(message, "user_a").href, {
    pathname: "/messages/[conversationId]",
    params: { conversationId: "123" },
  });
  assert.deepEqual(resolveClerkPushHref({ data: message }, "user_a").href, {
    pathname: "/messages/[conversationId]",
    params: { conversationId: "123" },
  });
  assert.equal(resolveClerkPushHref({ v: 2, type: "message.created", navigation: message.navigation }, "user_a").reason, "invalid-route");
  assert.equal(resolveClerkPushHref({ v: 1, type: "membership.updated", navigation: { screen: "membership" } }, "user_a").reason, "unknown-type");
  assert.equal(resolveClerkPushHref({ v: 1, type: "message.created" }, "user_a").reason, "invalid-route");
  assert.equal(resolveClerkPushHref(versioned("message.created", "flight", { flightId: 4 }), "user_a").reason, "invalid-route");
  assert.equal(resolveClerkPushHref(versioned("message.created", "messages", { conversationId: "abc" }), "user_a").reason, "missing-identifier");
  assert.equal(resolveClerkPushHref({ type: "messages", conversationId: 7 }, "user_a").reason, "account-mismatch");
  assert.equal(resolveClerkPushHref(message, null).reason, "account-mismatch");
  assert.equal(pushRepeatsOpenConversation(message, "/messages/123"), true);
  assert.equal(pushRepeatsOpenConversation(message, "/messages/8"), false);
  const hidden = foregroundPresentation({
    notificationId: "message-open",
    alreadyPresented: [],
    permission: "granted",
    payload: message,
    pathname: "/messages/123",
  });
  assert.equal(hidden.show, false);
  assert.equal(foregroundPresentation({
    notificationId: "message-open",
    alreadyPresented: hidden.presentedIds,
    permission: "granted",
    payload: message,
    pathname: "/messages",
  }).show, false);
});

test("versioned message, connection, flight, and queue taps resolve to existing screens", () => {
  assert.deepEqual(resolveClerkPushHref(versioned("connection.requested", "connections", { connectionId: 15 }), "user_a").href, {
    pathname: "/(tabs)/connections",
  });
  assert.deepEqual(resolveClerkPushHref(versioned("connection.accepted", "connections", { connectionId: 16 }), "user_a").accountCheck, {
    kind: "connection",
    connectionId: 16,
  });
  assert.equal(resolveClerkPushHref(versioned("connection.requested", "connections", {}), "user_a").reason, "missing-identifier");
  assert.deepEqual(resolveClerkPushHref(versioned("flight.published", "flight", { flightId: 42 }), "user_a").href, {
    pathname: "/flight/[id]",
    params: { id: "42" },
  });
  assert.deepEqual(resolveClerkPushHref(versioned("flight.cancelled", "flight", { flightId: 42 }), "user_a").href, {
    pathname: "/flight/[id]",
    params: { id: "42" },
  });
  assert.deepEqual(resolveClerkPushHref(versioned("flight.back_on", "flight", { flightId: 42 }), "user_a").href, {
    pathname: "/flight/[id]",
    params: { id: "42" },
  });
  assert.deepEqual(resolveClerkPushHref(versioned("queue.updated", "flight", { flightId: 9 }), "user_a").href, {
    pathname: "/flight/queue-status",
    params: { flightId: "9" },
  });
  assert.deepEqual(resolveClerkPushHref(versioned("winner.selected", "flight", { flightId: 9 }), "user_a").href, {
    pathname: "/flight/checklist",
    params: { legId: "9" },
  });
  assert.deepEqual(resolveClerkPushHref(versioned("winner.confirmed", "flight", { flightId: 9 }), "user_a").accountCheck, {
    kind: "winner",
    flightId: 9,
  });
});

test("cold-start versioned navigation waits for auth and a different account cannot reuse it", () => {
  const waiting = considerPushResponse({
    responseId: "cold-message",
    payload: versioned("message.created", "messages", { conversationId: 123 }),
    activeUserId: null,
    navigationReady: false,
    consumedIds: [],
    queued: null,
  });
  assert.equal(waiting.outcome, "pending");
  assert.equal(waiting.queued.boundUserId, null);
  const ready = flushQueuedPushResponse({
    queued: waiting.queued,
    activeUserId: "user_a",
    navigationReady: true,
    consumedIds: waiting.consumedIds,
  });
  assert.equal(ready.outcome, "navigated");
  assert.deepEqual(ready.href, {
    pathname: "/messages/[conversationId]",
    params: { conversationId: "123" },
  });
  assert.deepEqual(ready.accountCheck, { kind: "conversation", conversationId: 123 });
  const duplicate = considerPushResponse({
    responseId: "cold-message",
    payload: versioned("message.created", "messages", { conversationId: 123 }),
    activeUserId: "user_a",
    navigationReady: true,
    consumedIds: ready.consumedIds,
    queued: null,
  });
  assert.equal(duplicate.outcome, "duplicate");
  assert.equal(duplicate.href, null);
  const heldForA = considerPushResponse({
    responseId: "account-message",
    payload: versioned("message.created", "messages", { conversationId: 123 }),
    activeUserId: "user_a",
    navigationReady: false,
    consumedIds: [],
    queued: null,
  });
  assert.equal(heldForA.queued.boundUserId, "user_a");
  const switched = flushQueuedPushResponse({
    queued: heldForA.queued,
    activeUserId: "user_b",
    navigationReady: true,
    consumedIds: [],
  });
  assert.equal(switched.outcome, "account-mismatch");
  assert.equal(switched.href, null);
  const dropped = dropQueuedPushNavigation(switched.consumedIds);
  assert.equal(dropped.queued, null);
});

test("destination confirmation uses the signed-in account and rejects another account", async () => {
  const history = { messages: [], hasMore: false, nextCursor: null };
  const member = { userId: "user_peer", firstName: null, lastName: null };
  const incoming = {
    requests: [{
      id: 15,
      requester: member,
      recipient: { userId: "user_a", firstName: null, lastName: null },
      status: "pending",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      respondedAt: null,
      removedAt: null,
    }],
  };
  const accepted = {
    connections: [{
      id: 16,
      member,
      connectedAt: "2026-01-01T00:00:00.000Z",
    }],
  };
  const allowed = await confirmClerkPushDestination({
    check: { kind: "conversation", conversationId: 123 },
    environment: "production",
    baseUrl: API,
    messagesEnabled: true,
    connectionsEnabled: true,
    nativeAuthTest: false,
    getAccessToken: async () => SESSION,
    fetcher: async (url) => {
      assert.match(String(url), /\/me\/messages\/history\?/);
      return jsonResponse(history);
    },
  });
  assert.equal(allowed, true);
  const denied = await confirmClerkPushDestination({
    check: { kind: "conversation", conversationId: 123 },
    environment: "production",
    baseUrl: API,
    messagesEnabled: true,
    nativeAuthTest: false,
    getAccessToken: async () => SESSION,
    fetcher: async () => jsonResponse({ code: "not_found" }, 404),
  });
  assert.equal(denied, false);
  const connection = await confirmClerkPushDestination({
    check: { kind: "connection", connectionId: 15 },
    environment: "production",
    baseUrl: API,
    connectionsEnabled: true,
    nativeAuthTest: false,
    getAccessToken: async () => SESSION,
    fetcher: async (url) => jsonResponse(String(url).includes("/incoming") ? incoming : accepted),
  });
  assert.equal(connection, true);
  const foreignConnection = await confirmClerkPushDestination({
    check: { kind: "connection", connectionId: 99 },
    environment: "production",
    baseUrl: API,
    connectionsEnabled: true,
    nativeAuthTest: false,
    getAccessToken: async () => SESSION,
    fetcher: async (url) => jsonResponse(String(url).includes("/incoming") ? incoming : accepted),
  });
  assert.equal(foreignConnection, false);
  let flightAuthorization = "";
  const flight = await confirmClerkPushDestination({
    check: { kind: "flight", flightId: 42 },
    environment: "production",
    baseUrl: API,
    nativeAuthTest: false,
    getAccessToken: async () => SESSION,
    fetcher: async (url, init) => {
      flightAuthorization = init.headers.Authorization;
      assert.equal(String(url), `${API}/empty-legs/42`);
      return jsonResponse({ id: 42 });
    },
  });
  assert.equal(flight, true);
  assert.equal(flightAuthorization, `Bearer ${SESSION}`);
  const otherFlight = await confirmClerkPushDestination({
    check: { kind: "flight", flightId: 42 },
    environment: "production",
    baseUrl: API,
    nativeAuthTest: false,
    getAccessToken: async () => SESSION,
    fetcher: async () => jsonResponse({ id: 7 }),
  });
  assert.equal(otherFlight, false);
  const winner = await confirmClerkPushDestination({
    check: { kind: "winner", flightId: 9 },
    environment: "production",
    baseUrl: API,
    nativeAuthTest: false,
    getAccessToken: async () => SESSION,
    fetcher: async (url) => {
      assert.equal(String(url), `${API}/trips/9`);
      return jsonResponse({ leg: { id: 9 }, checklist: { emptyLegId: 9 } });
    },
  });
  assert.equal(winner, true);
  const noToken = await confirmClerkPushDestination({
    check: { kind: "flight", flightId: 42 },
    environment: "production",
    baseUrl: API,
    nativeAuthTest: false,
    getAccessToken: async () => null,
    fetcher: async () => jsonResponse({ id: 42 }),
  });
  assert.equal(noToken, false);
});
