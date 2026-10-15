import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canEditClerkBluebirdProfile,
  getClerkOnboardingStep,
  getClerkBluebirdProfileEffectDependencies,
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

const nonmemberMembership = {
  isMember: false,
  tier: null,
  cancelAtPeriodEnd: false,
  recentEvents: [],
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

function fakeApi({
  me = currentUser(),
  loadedProfile = profile,
  loadedMembership = nonmemberMembership,
  membershipError = null,
  updateResult = profile,
} = {}) {
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
    getMembership: async (options) => {
      calls.push({ method: "GET", path: "/membership", options });
      if (membershipError) throw membershipError;
      return loadedMembership;
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
  assert.equal(result.membershipState, "available");
  assert.equal(getClerkOnboardingStep(result), "profile");
  assert.equal(canEditClerkBluebirdProfile(result), true);
  assert.deepEqual(api.calls.map(({ method, path }) => `${method} ${path}`), [
    "GET /me",
    "GET /me/profile",
    "GET /membership",
  ]);
});

test("profile screen reuses the already-verified post-login /me response", async () => {
  const api = fakeApi();
  const verifiedMe = currentUser({
    isProfileComplete: false,
    firstName: "Saved",
    lastName: "Member",
  });
  const result = await loadClerkBluebirdProfile(api, undefined, verifiedMe);

  assert.equal(result.kind, "authenticated");
  assert.equal(result.currentUser, verifiedMe);
  assert.equal(result.currentUser.firstName, "Saved");
  assert.deepEqual(api.calls.map(({ method, path }) => `${method} ${path}`), [
    "GET /me/profile",
    "GET /membership",
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
  assert.deepEqual(api.calls.map(({ method }) => method), ["GET", "GET", "GET"]);
});

test("profile completion is based on matching API-owned state, not membership or missing fields", async () => {
  const api = fakeApi({
    me: currentUser({
      isMember: true,
      memberTier: "plus",
      isProfileComplete: true,
      needsSignupPhone: false,
    }),
    loadedMembership: {
      isMember: true,
      tier: "plus",
      cancelAtPeriodEnd: false,
      recentEvents: [],
    },
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
  assert.equal(result.membershipState, "available");
  assert.equal(getClerkOnboardingStep(result), "complete");
  assert.equal(canEditClerkBluebirdProfile(result), true);
});

test("membership decision is not a profile or registration step", async () => {
  const api = fakeApi({
    me: currentUser({ isProfileComplete: true, needsPlanDecision: true }),
    loadedProfile: { ...profile, isComplete: true },
  });
  const result = await loadClerkBluebirdProfile(api);
  assert.equal(result.currentUser.isMember, false);
  assert.equal(result.completion, "complete");
  assert.equal(getClerkOnboardingStep(result), "complete");
  assert.equal(canEditClerkBluebirdProfile(result), true);
  assert.deepEqual(api.calls.map(({ method, path }) => `${method} ${path}`), [
    "GET /me",
    "GET /me/profile",
    "GET /membership",
  ]);
});

test("a returning complete nonmember stays on the account path when no plan decision is required", async () => {
  const result = await loadClerkBluebirdProfile(fakeApi({
    me: currentUser({
      isMember: false,
      memberTier: null,
      isProfileComplete: true,
      needsPlanDecision: false,
      needsSignupPhone: false,
    }),
    loadedProfile: {
      ...profile,
      firstName: "Returning",
      lastName: "User",
      isComplete: true,
    },
  }));

  assert.equal(result.kind, "authenticated");
  assert.equal(result.currentUser.isMember, false);
  assert.equal(result.completion, "complete");
  assert.equal(result.membershipState, "available");
  assert.equal(getClerkOnboardingStep(result), "complete");
  assert.equal(canEditClerkBluebirdProfile(result), true);
});

test("membership errors and contradictory fields do not change profile completion", async () => {
  const unavailable = await loadClerkBluebirdProfile(fakeApi({
    me: currentUser({ isProfileComplete: true }),
    loadedProfile: { ...profile, isComplete: true },
    membershipError: new Error("membership unavailable"),
  }));
  assert.equal(unavailable.kind, "authenticated");
  assert.equal(unavailable.membershipState, "unavailable");
  assert.equal(getClerkOnboardingStep(unavailable), "complete");
  assert.equal(canEditClerkBluebirdProfile(unavailable), true);

  const mismatch = await loadClerkBluebirdProfile(fakeApi({
    me: currentUser({ isProfileComplete: true, isMember: false, memberTier: null }),
    loadedProfile: { ...profile, isComplete: true },
    loadedMembership: {
      isMember: true,
      tier: "plus",
      cancelAtPeriodEnd: false,
      recentEvents: [],
    },
  }));
  assert.equal(mismatch.membershipState, "conflict");
  assert.equal(getClerkOnboardingStep(mismatch), "complete");
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
    "GET /membership",
    "PUT /me/profile",
  ]);
  assert.deepEqual(api.calls[3].data, update);
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

test("profile loading stays stable across equivalent rerenders and reloads only for retry or identity changes", async () => {
  const configuration = {
    environment: "development",
    apiBaseUrl: "https://development.example/api",
    clerkPublishableKey: "pk_test_abcdefghijkl",
  };
  const getToken = async () => "session-token";
  const session = {
    isLoaded: true,
    isSignedIn: true,
    userId: "clerk-user-a",
    getToken,
    signOut: async () => {},
  };
  const api = fakeApi();
  let previousDependencies;
  let loadCount = 0;

  async function simulateProfileEffect(nextConfiguration, nextSession, loadAttempt) {
    const dependencies = getClerkBluebirdProfileEffectDependencies({
      configuration: nextConfiguration,
      session: nextSession,
      loadAttempt,
    });
    const changed = !previousDependencies ||
      dependencies.length !== previousDependencies.length ||
      dependencies.some((dependency, index) => !Object.is(dependency, previousDependencies[index]));
    if (!changed) return;

    previousDependencies = dependencies;
    loadCount += 1;
    await loadClerkBluebirdProfile(api);
  }

  await simulateProfileEffect(configuration, session, 0);
  for (let render = 0; render < 20; render += 1) {
    await simulateProfileEffect({ ...configuration }, { ...session }, 0);
  }
  assert.equal(loadCount, 1);
  assert.equal(api.calls.filter(({ path }) => path === "/me/profile").length, 1);

  await simulateProfileEffect(
    { ...configuration },
    { ...session, getToken: async () => "refreshed-session-token" },
    0,
  );
  assert.equal(loadCount, 1);
  assert.equal(api.calls.filter(({ path }) => path === "/me/profile").length, 1);

  await simulateProfileEffect({ ...configuration }, { ...session }, 1);
  assert.equal(loadCount, 2);
  assert.equal(api.calls.filter(({ path }) => path === "/me/profile").length, 2);

  await simulateProfileEffect(
    { ...configuration },
    { ...session, userId: "clerk-user-b" },
    1,
  );
  assert.equal(loadCount, 3);
  assert.equal(api.calls.filter(({ path }) => path === "/me/profile").length, 3);
});
