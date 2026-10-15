import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canEditClerkBluebirdProfile,
  isClerkBluebirdProfileResultCurrent,
  loadClerkBluebirdProfile,
  updateClerkBluebirdProfileExplicitly,
} from "../scripts/.clerk-bluebird-profile.test.mjs";

const profile = {
  firstName: null,
  lastName: null,
  dob: null,
  gender: null,
  homeAirportCode: null,
  homeAirportLabel: null,
  favoriteAirportCodes: [],
  favoriteAirportLabels: [],
  favoriteCityKeys: [],
  favoriteCityLabels: [],
  phoneE164: null,
  phoneCountry: null,
  phoneVerifiedAt: null,
  phoneVerificationRequired: true,
  notificationPrefs: {
    mode: "off",
    allChannels: null,
    emptyLegHomeAirport: null,
    departingFavorite: null,
    arrivingFavorite: null,
    queueUpdates: "email",
    winningNotifications: "email",
  },
  smsConsent: false,
  smsConsentAt: null,
  smsConsentRevokedAt: null,
  email: null,
  emailLocked: false,
  signupChannel: "phone",
  isComplete: false,
  upgradeCreditBalances: { skipTheLine: 0, internationalPass: 0 },
  weightLbs: null,
};

function currentUser(overrides = {}) {
  return {
    isAuthenticated: true,
    isAdmin: false,
    isConcierge: false,
    isMember: false,
    memberTier: null,
    email: null,
    firstName: null,
    lastName: null,
    isProfileComplete: false,
    needsPlanDecision: false,
    needsSignupPhone: true,
    impersonation: null,
    ...overrides,
  };
}

function fakeApi({ me = currentUser(), loadedProfile = profile, updateResult = profile } = {}) {
  const calls = [];
  return {
    calls,
    getMe: async (options) => {
      calls.push({ method: "GET", path: "/me", options });
      return me;
    },
    getProfile: async (options) => {
      calls.push({ method: "GET", path: "/me/profile", options });
      return loadedProfile;
    },
    updateProfile: async (data, options) => {
      calls.push({ method: "PUT", path: "/me/profile", data, options });
      return updateResult;
    },
  };
}

test("an API-authenticated nonmember can load their incomplete profile without member or write calls", async () => {
  const api = fakeApi();
  const result = await loadClerkBluebirdProfile(api);

  assert.equal(result.kind, "authenticated");
  assert.equal(result.currentUser.isAuthenticated, true);
  assert.equal(result.currentUser.isMember, false);
  assert.equal(result.currentUser.needsSignupPhone, true);
  assert.equal(result.completion, "completion_required");
  assert.equal(canEditClerkBluebirdProfile(result), true);
  assert.deepEqual(api.calls.map(({ method, path }) => `${method} ${path}`), [
    "GET /me",
    "GET /me/profile",
  ]);
});

test("an anonymous-shaped /api/me response does not fetch a profile or imply registration", async () => {
  const api = fakeApi({
    me: currentUser({
      isAuthenticated: false,
      isMember: false,
      isProfileComplete: false,
      needsSignupPhone: false,
    }),
  });
  const result = await loadClerkBluebirdProfile(api);

  assert.equal(result.kind, "api_not_authenticated");
  assert.equal(result.currentUser.isAuthenticated, false);
  assert.equal(result.currentUser.isMember, false);
  assert.equal(result.currentUser.needsSignupPhone, false);
  assert.deepEqual(api.calls.map(({ method, path }) => `${method} ${path}`), ["GET /me"]);
  assert.equal(canEditClerkBluebirdProfile(result), false);
});

test("profile and /api/me completion disagreement stays unverified and cannot be edited", async () => {
  const api = fakeApi({
    me: currentUser({ isProfileComplete: false, needsSignupPhone: false }),
    loadedProfile: { ...profile, isComplete: true },
  });
  const result = await loadClerkBluebirdProfile(api);

  assert.equal(result.kind, "authenticated");
  assert.equal(result.completion, "unverified");
  assert.equal(canEditClerkBluebirdProfile(result), false);
  await assert.rejects(
    updateClerkBluebirdProfileExplicitly(api, result, {}),
    /not verified/,
  );
  assert.deepEqual(api.calls.map(({ method }) => method), ["GET", "GET"]);
});

test("profile completion is based on matching API-owned state, not membership or missing fields", async () => {
  const api = fakeApi({
    me: currentUser({
      isMember: true,
      memberTier: "plus",
      isProfileComplete: true,
      needsSignupPhone: false,
    }),
    loadedProfile: {
      ...profile,
      firstName: "Bluebird",
      lastName: "Member",
      isComplete: true,
    },
  });
  const result = await loadClerkBluebirdProfile(api);

  assert.equal(result.kind, "authenticated");
  assert.equal(result.completion, "complete");
  assert.equal(canEditClerkBluebirdProfile(result), true);
});

test("only an explicit editable-profile update calls PUT and returns API values", async () => {
  const api = fakeApi({
    updateResult: {
      ...profile,
      firstName: "Updated",
      lastName: "Name",
      isComplete: true,
    },
  });
  const result = await loadClerkBluebirdProfile(api);
  const update = {
    firstName: "Updated",
    lastName: "Name",
    dob: "1985-04-03",
    gender: "female",
    homeAirportCode: "SFO",
    favoriteCityKeys: ["san-francisco"],
    phoneE164: "+14155550123",
    phoneCountry: "US",
  };

  const saved = await updateClerkBluebirdProfileExplicitly(api, result, update);
  assert.equal(saved.firstName, "Updated");
  assert.deepEqual(api.calls.map(({ method, path }) => `${method} ${path}`), [
    "GET /me",
    "GET /me/profile",
    "PUT /me/profile",
  ]);
  assert.deepEqual(api.calls[2].data, update);
});

test("stale and cancelled profile responses are discarded when the Clerk identity changes", () => {
  assert.equal(isClerkBluebirdProfileResultCurrent({
    requestedClerkUserId: "clerk-user-a",
    currentClerkUserId: "clerk-user-a",
    aborted: false,
  }), true);
  assert.equal(isClerkBluebirdProfileResultCurrent({
    requestedClerkUserId: "clerk-user-a",
    currentClerkUserId: "clerk-user-b",
    aborted: false,
  }), false);
  assert.equal(isClerkBluebirdProfileResultCurrent({
    requestedClerkUserId: "clerk-user-a",
    currentClerkUserId: "clerk-user-a",
    aborted: true,
  }), false);
});

test("API errors are not converted into anonymous or registration-required states", async () => {
  const api = fakeApi();
  api.getMe = async () => { throw new Error("API unavailable"); };
  await assert.rejects(loadClerkBluebirdProfile(api), /API unavailable/);
  assert.deepEqual(api.calls, []);
});
