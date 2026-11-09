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

function session() {
  return { isLoaded: true, isSignedIn: true, userId: "clerk-user-a" };
}

test("the preference update keeps editable profile fields and omits read-only fields", () => {
  const body = buildIncomingConnectionRequestsUpdate(profile(), false);
  assert.equal(body.allowIncomingConnectionRequests, false);
  assert.equal(body.firstName, "Preview");
  assert.equal(body.lastName, "Member");
  assert.equal(body.dob, "1990-01-02");
  assert.equal(body.gender, "male");
  assert.equal(body.homeAirportCode, "APF");
  assert.deepEqual(body.favoriteCityKeys, ["miami"]);
  assert.equal(body.phoneE164, "+15555550123");
  assert.equal(body.phoneCountry, "US");
  assert.equal(body.weightLbs, 170);
  assert.equal(body.smsConsent, false);
  assert.equal(body.notificationPrefs.mode, "all");
  assert.equal(Object.prototype.hasOwnProperty.call(body, "email"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(body, "homeAirportLabel"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(body, "phoneVerifiedAt"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(body, "upgradeCreditBalances"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(body, "emailLocked"), false);
  assert.equal(buildIncomingConnectionRequestsUpdate(profile({ firstName: "" }), true), null);
});

test("a missing preference field is not treated as a successful save", async () => {
  const writes = [];
  await assert.rejects(
    saveIncomingConnectionRequestsPreference({
      getCurrentSession: session,
      requestedClerkUserId: "clerk-user-a",
      readProfile: async () => profile({
        allowIncomingConnectionRequests: true,
        allowIncomingConnectionRequestsSupported: false,
      }),
      updateProfile: async (data) => {
        writes.push(data);
        return { isAuthenticated: true };
      },
      allowIncomingConnectionRequests: false,
    }),
    (error) => error instanceof IncomingConnectionPreferenceError &&
      /not available yet/i.test(error.message),
  );
  assert.equal(writes.length, 1);
  assert.equal(writes[0].allowIncomingConnectionRequests, false);
  assert.equal(writes[0].phoneE164, "+15555550123");
  assert.equal(writes[0].weightLbs, 170);
});

test("a confirmed preference keeps the returned profile value", async () => {
  let stored = true;
  const saved = await saveIncomingConnectionRequestsPreference({
    getCurrentSession: session,
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
  assert.equal(saved.allowIncomingConnectionRequests, false);
  assert.equal(saved.allowIncomingConnectionRequestsSupported, true);
  assert.equal(saved.phoneE164, "+15555550123");
  assert.equal(saved.weightLbs, 170);
});

test("a refreshed profile that drops phone or weight is not a successful save", async () => {
  let reads = 0;
  await assert.rejects(
    saveIncomingConnectionRequestsPreference({
      getCurrentSession: session,
      requestedClerkUserId: "clerk-user-a",
      readProfile: async () => {
        reads += 1;
        return profile({
          allowIncomingConnectionRequests: false,
          allowIncomingConnectionRequestsSupported: true,
          phoneE164: reads === 1 ? "+15555550123" : null,
        });
      },
      updateProfile: async () => ({ isAuthenticated: true }),
      allowIncomingConnectionRequests: false,
    }),
    /not available yet/i,
  );
});

test("the Clerk profile shows the toggle only from the supported preference field", () => {
  const source = readFileSync(resolve(projectRoot, "app/(tabs)/profile/index.tsx"), "utf8");
  assert.match(source, /allowIncomingConnectionRequestsSupported/);
  assert.match(source, /clerk-incoming-connection-requests-switch/);
  assert.match(source, /saveIncomingConnectionRequestsPreference/);
  assert.doesNotMatch(source, /homeAirportLabel|upgradeCreditBalances|phoneVerifiedAt/);
});
