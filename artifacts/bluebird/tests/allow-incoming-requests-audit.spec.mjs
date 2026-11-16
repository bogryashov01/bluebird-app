/**
 * Allow incoming requests — functional audit (build 20).
 *
 * Distinguishes:
 * - Clerk Profile ↔ Main API profile preference (mobile client in this repo)
 * - Local api-server networking privacy (legacy JWT stack in this monorepo)
 * - Main API POST /me/connections/requests enforcement (not source-available here)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  IncomingConnectionPreferenceError,
  buildIncomingConnectionRequestsUpdate,
  saveIncomingConnectionRequestsPreference,
} from "../scripts/.clerk-connection-privacy.test.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(projectRoot, "../..");

const notificationPrefs = {
  mode: "all",
  allChannels: "email",
  emptyLegHomeAirport: null,
  departingFavorite: null,
  arrivingFavorite: null,
  queueUpdates: "email",
  winningNotifications: "email",
};

function profile(overrides = {}) {
  return {
    firstName: "Preview",
    lastName: "Member",
    dob: "1990-01-02",
    gender: "male",
    homeAirportCode: "APF",
    homeAirportLabel: "Naples Municipal",
    favoriteAirportCodes: ["MIA"],
    favoriteAirportLabels: ["Miami International"],
    favoriteCityKeys: ["miami"],
    favoriteCityLabels: ["Miami"],
    phoneE164: "+15555550123",
    phoneCountry: "US",
    phoneVerifiedAt: "2026-01-01T00:00:00.000Z",
    phoneVerificationRequired: false,
    notificationPrefs,
    smsConsent: false,
    smsConsentAt: null,
    smsConsentRevokedAt: null,
    email: "member@example.test",
    emailLocked: true,
    signupChannel: "email",
    isComplete: true,
    upgradeCreditBalances: { skipTheLine: 1, internationalPass: 0 },
    weightLbs: 170,
    allowIncomingConnectionRequests: true,
    allowIncomingConnectionRequestsSupported: true,
    ...overrides,
  };
}

function session(userId = "clerk-user-a") {
  return { isLoaded: true, isSignedIn: true, userId };
}

test("Profile toggle is privacy under Preferences and rolls back optimistic UI on save failure", () => {
  const source = readFileSync(resolve(projectRoot, "app/(tabs)/profile/index.tsx"), "utf8");
  assert.match(source, /label: 'Allow incoming requests'/);
  assert.match(source, /setIncomingPreference\(next\)/);
  assert.match(source, /setIncomingPreference\(null\)/);
  assert.match(source, /IncomingConnectionPreferenceError/);
  assert.match(source, /Couldn’t save this preference/);
  assert.match(source, /incomingSupported = connectionsEnabled && profile\?\.allowIncomingConnectionRequestsSupported === true/);
  assert.match(source, /incomingPreferenceSaveGeneration/);
  assert.doesNotMatch(source, /Get notified when someone sends you a connection request/);
  const notifications = readFileSync(resolve(projectRoot, "app/notifications.tsx"), "utf8");
  assert.doesNotMatch(notifications, /Allow incoming requests|clerk-incoming-connection-requests/);
});

test("preference PUT confirms only the signed-in account and does not false-fail after write", async () => {
  let stored = true;
  const saved = await saveIncomingConnectionRequestsPreference({
    getCurrentSession: () => session("clerk-user-a"),
    requestedClerkUserId: "clerk-user-a",
    readProfile: async () => profile({
      allowIncomingConnectionRequests: stored,
      allowIncomingConnectionRequestsSupported: true,
    }),
    updateProfile: async (data) => {
      stored = data.allowIncomingConnectionRequests;
      return { isAuthenticated: true };
    },
    allowIncomingConnectionRequests: false,
  });
  assert.equal(saved.kind, "confirmed");
  assert.equal(saved.profile.allowIncomingConnectionRequests, false);

  await assert.rejects(
    saveIncomingConnectionRequestsPreference({
      getCurrentSession: () => session("clerk-user-b"),
      requestedClerkUserId: "clerk-user-a",
      readProfile: async () => profile(),
      updateProfile: async () => ({ isAuthenticated: true }),
      allowIncomingConnectionRequests: false,
    }),
    (error) => error instanceof IncomingConnectionPreferenceError &&
      /signed-in account changed/i.test(error.message),
  );

  assert.equal(
    buildIncomingConnectionRequestsUpdate(profile({ firstName: "" }), false),
    null,
  );

  const source = readFileSync(resolve(projectRoot, "app/(tabs)/profile/index.tsx"), "utf8");
  assert.match(source, /couldn’t confirm this preference yet/i);
  assert.match(source, /outcome\.kind === 'confirmed'/);
});

test("Main API createRequest does not apply a client-side privacy gate", () => {
  const connections = readFileSync(resolve(projectRoot, "lib/memberConnections.ts"), "utf8");
  const createRequest = connections.slice(
    connections.indexOf("createRequest:"),
    connections.indexOf("createQueueRequest:"),
  );
  assert.match(createRequest, /MEMBER_CONNECTION_PATHS\.requests/);
  assert.match(createRequest, /POST/);
  assert.doesNotMatch(createRequest, /allowIncoming/);
  assert.doesNotMatch(createRequest, /incomingAllowed|INCOMING_REQUESTS/);
});

test("Main API maps lowercase incoming_requests_disabled on direct create; queue path stays generic", () => {
  const productionAuth = readFileSync(resolve(projectRoot, "lib/productionAuthApi.ts"), "utf8");
  assert.match(productionAuth, /PRODUCTION_ERROR_CODE = \/\^\[a-z0-9_\]\{1,80\}\$/);
  const connections = readFileSync(resolve(projectRoot, "lib/memberConnections.ts"), "utf8");
  assert.match(connections, /SERVER_CODE = \/\^\[a-z0-9_\]\{1,80\}\$/);
  const failureCode = connections.slice(
    connections.indexOf("function failureCode"),
    connections.indexOf("async function readConnectionError"),
  );
  assert.match(failureCode, /incoming_requests_disabled/);
  const queueFailure = connections.slice(
    connections.indexOf("function queueConnectionFailureCode"),
    connections.indexOf("function queueTargetPreviewFailureCode"),
  );
  assert.match(queueFailure, /incoming_requests_disabled.*unavailable|queue_target_unavailable/);
  assert.match(queueFailure, /code === 'incoming_requests_disabled'\) return 'unavailable'/);
  const hook = readFileSync(resolve(projectRoot, "lib/useMemberConnections.ts"), "utf8");
  assert.match(hook, /incoming_requests_disabled: 'This member is not accepting connection requests\.'/);
  const presentation = readFileSync(resolve(projectRoot, "lib/flightQueuePresentation.ts"), "utf8");
  const mainQueueCopy = presentation.slice(
    presentation.indexOf("export function queueConnectionRequestFailureCopy"),
    presentation.indexOf("export function queueConnectionRequestShouldRefresh"),
  );
  assert.match(mainQueueCopy, /queue_target_unavailable/);
  assert.doesNotMatch(mainQueueCopy, /not accepting connection requests/);
});

test("local api-server networking enforces allowIncomingRequests before writing a request", () => {
  const visibility = readFileSync(
    resolve(repoRoot, "artifacts/api-server/src/lib/queueVisibility.ts"),
    "utf8",
  );
  assert.match(visibility, /incomingAllowed/);
  assert.match(visibility, /INCOMING_REQUESTS_DISABLED/);
  assert.match(visibility, /This member is not accepting connection requests/);
  const networking = readFileSync(
    resolve(repoRoot, "artifacts/api-server/src/routes/networking.ts"),
    "utf8",
  );
  assert.match(networking, /allowIncomingRequests/);
  assert.match(networking, /incomingAllowed: recipientProfile\?\.allowIncomingRequests !== false/);
  const schema = readFileSync(resolve(repoRoot, "lib/db/src/schema/index.ts"), "utf8");
  assert.match(schema, /allowIncomingRequests: boolean\("allow_incoming_requests"\)\.notNull\(\)\.default\(true\)/);
});

console.log("Allow incoming requests audit contract tests passed.");
