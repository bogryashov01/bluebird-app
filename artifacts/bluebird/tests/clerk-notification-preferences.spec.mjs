import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readClerkNotificationPreferences, readClerkNotificationProfile,
  notificationPreferenceRows, buildHomeAirportProfileUpdate, buildNotificationProfileUpdate,
  saveClerkHomeAirport, saveClerkNotificationPreferences,
} from "../scripts/.clerk-notification-preferences.test.mjs";

const prefs = {
  mode: "specific",
  allChannels: null,
  emptyLegHomeAirport: "email",
  departingFavorite: "sms",
  arrivingFavorite: null,
  queueUpdates: "both",
  winningNotifications: "email",
};

const profile = {
  firstName: "Test", lastName: "Member", dob: "1990-02-12", gender: "female",
  homeAirportCode: "KJFK", favoriteAirportCodes: ["KJFK", "KBOS"],
  favoriteAirportLabels: ["New York JFK", "Boston Logan"],
  favoriteCityKeys: ["new-york"], favoriteCityLabels: ["New York"],
  email: "member@example.test", emailLocked: false,
  phoneE164: "+12025550123", phoneCountry: "US", phoneVerifiedAt: "2026-10-01T00:00:00Z",
  phoneVerificationRequired: false, smsConsent: true, smsConsentAt: "2026-09-01T00:00:00Z",
  smsConsentRevokedAt: null, signupChannel: "email",
  upgradeCreditBalances: { skipTheLine: 0, internationalPass: 0 },
  weightLbs: 140, isComplete: true,
  notificationPrefs: prefs,
};

function makeSession(overrides = {}) {
  return {
    isLoaded: true,
    isSignedIn: true,
    userId: "clerk-user-a",
    ...overrides,
  };
}

test("reads only preferences for the current authenticated Clerk identity", async () => {
  const calls = [];
  const result = await readClerkNotificationPreferences({
    getCurrentSession: () => makeSession(),
    requestedClerkUserId: "clerk-user-a",
    readProfile: async (options) => {
      calls.push({ method: "GET", path: "/me/profile", options });
      return profile;
    },
  });

  assert.deepEqual(result, prefs);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].path, "/me/profile");
  assert.equal("notificationPrefs" in result, false);
});

test("does not request a profile for signed-out, incomplete, or changed identities", async () => {
  let requests = 0;
  for (const session of [
    makeSession({ isLoaded: false }),
    makeSession({ isSignedIn: false }),
    makeSession({ userId: "clerk-user-b" }),
    null,
  ]) {
    await assert.rejects(readClerkNotificationPreferences({
      getCurrentSession: () => session,
      requestedClerkUserId: "clerk-user-a",
      readProfile: async () => {
        requests += 1;
        return profile;
      },
    }));
  }
  assert.equal(requests, 0);
});

test("discards preferences if the Clerk identity changes while the profile read is pending", async () => {
  let session = makeSession();
  let completeProfileRead;
  const pendingProfileRead = new Promise((resolve) => { completeProfileRead = resolve; });
  const result = readClerkNotificationPreferences({
    getCurrentSession: () => session,
    requestedClerkUserId: "clerk-user-a",
    readProfile: async () => pendingProfileRead,
  });

  session = makeSession({ userId: "clerk-user-b" });
  completeProfileRead(profile);
  await assert.rejects(result, /account changed while preferences were loading/i);
});

test("propagates an unavailable profile response without issuing a write", async () => {
  const calls = [];
  await assert.rejects(readClerkNotificationPreferences({
    getCurrentSession: () => makeSession(),
    requestedClerkUserId: "clerk-user-a",
    readProfile: async () => {
      calls.push("GET /me/profile");
      throw new Error("profile unavailable");
    },
  }), /profile unavailable/);
  assert.deepEqual(calls, ["GET /me/profile"]);
  assert.equal(calls.some((call) => /^(PUT|POST|PATCH|DELETE)\b/.test(call)), false);
});

function saveInput(overrides = {}) {
  return {
    getCurrentSession: () => makeSession(),
    requestedClerkUserId: "clerk-user-a",
    readProfile: async () => profile,
    updateProfile: async () => ({ isAuthenticated: true }),
    preferences: { ...prefs, queueUpdates: "email" },
    ...overrides,
  };
}

test("displays only applicable contract categories for off/all/specific, including nullable channels", () => {
  for (const [mode, keys] of [
    ["off", ["mode", "queueUpdates", "winningNotifications"]],
    ["all", ["mode", "allChannels", "queueUpdates", "winningNotifications"]],
    ["specific", ["mode", "emptyLegHomeAirport", "departingFavorite", "arrivingFavorite", "queueUpdates", "winningNotifications"]],
  ]) {
    const rows = notificationPreferenceRows({ ...prefs, mode });
    assert.deepEqual(rows.map((row) => row.key), keys);
    assert.equal(rows[0].value, mode);
  }
  assert.equal(notificationPreferenceRows(prefs).find((row) => row.key === "arrivingFavorite").value, null);
});

test("builds a full update preserving required fields and optional weight/email without touching phone or consent", () => {
  const body = buildNotificationProfileUpdate(profile, prefs);
  assert.deepEqual(body, {
    firstName: profile.firstName, lastName: profile.lastName, dob: profile.dob, gender: profile.gender,
    homeAirportCode: profile.homeAirportCode, favoriteCityKeys: profile.favoriteCityKeys,
    notificationPrefs: prefs, email: profile.email, weightLbs: profile.weightLbs,
  });
  assert.notEqual(body.favoriteCityKeys, profile.favoriteCityKeys);
  assert.notEqual(body.notificationPrefs, prefs);
  const locked = buildNotificationProfileUpdate({ ...profile, emailLocked: true, weightLbs: null }, prefs);
  assert.equal("email" in locked, false);
  assert.equal(locked.weightLbs, null);
});

test("unsafe, missing or invalid complete profile values keep preferences read-only", () => {
  for (const invalid of [
    { isComplete: false }, { firstName: null }, { firstName: " " }, { lastName: null },
    { dob: null }, { dob: "2000-02-30" }, { dob: "2020-01-01" }, { dob: "not-a-date" },
    { gender: null }, { homeAirportCode: null }, { homeAirportCode: "?" },
    { favoriteCityKeys: [] }, { favoriteCityKeys: [""] }, { favoriteCityKeys: ["x".repeat(65)] },
    { email: null }, { email: "bad" }, { weightLbs: 0 }, { weightLbs: 1.5 }, { weightLbs: 1501 },
    { smsConsent: false }, { phoneVerifiedAt: null }, { phoneE164: null }, { phoneVerificationRequired: true },
  ]) assert.equal(buildNotificationProfileUpdate({ ...profile, ...invalid }, prefs), null, JSON.stringify(invalid));
});

test("email-only preferences do not infer or grant SMS consent", () => {
  const emailOnly = { ...prefs, departingFavorite: "email", queueUpdates: "email" };
  const body = buildNotificationProfileUpdate({ ...profile, smsConsent: false, phoneVerifiedAt: null }, emailOnly);
  assert.ok(body);
  assert.equal("smsConsent" in body, false);
  assert.equal(buildNotificationProfileUpdate(profile, { ...prefs, queueUpdates: null }), null);
  assert.equal(buildNotificationProfileUpdate(profile, { ...prefs, mode: "push" }), null);
});

test("active flight-alert modes require a supported flight channel", () => {
  assert.equal(buildNotificationProfileUpdate(profile, { ...prefs, mode: "all", allChannels: null }), null);
  assert.equal(buildNotificationProfileUpdate(profile, { ...prefs, mode: "specific", emptyLegHomeAirport: null }), null);
  assert.ok(buildNotificationProfileUpdate(profile, { ...prefs, mode: "all", allChannels: "email" }));
});

test("home-airport update preserves fresh required values and existing notification preferences without touching consent", () => {
  const latest = {
    ...profile,
    firstName: "Latest",
    homeAirportCode: "KJFK",
    favoriteCityKeys: ["boston", "new-york"],
    weightLbs: 152,
  };
  const request = buildHomeAirportProfileUpdate(latest, "KSFO");
  assert.deepEqual(request, {
    firstName: "Latest",
    lastName: latest.lastName,
    dob: latest.dob,
    gender: latest.gender,
    homeAirportCode: "KSFO",
    favoriteCityKeys: ["boston", "new-york"],
    notificationPrefs: latest.notificationPrefs,
    email: latest.email,
    weightLbs: 152,
  });
  assert.equal("smsConsent" in request, false);
  assert.equal("phoneE164" in request, false);
  assert.deepEqual(request.notificationPrefs, latest.notificationPrefs);
  assert.notEqual(request.favoriteCityKeys, latest.favoriteCityKeys);
  assert.equal(buildHomeAirportProfileUpdate({ ...latest, isComplete: false }, "KSFO"), null);
});

test("home-airport save re-reads before PUT and confirms the saved airport from a fresh profile", async () => {
  const calls = [];
  let reads = 0;
  const latest = { ...profile, firstName: "Latest", favoriteCityKeys: ["boston"] };
  const saved = { ...latest, homeAirportCode: "KSFO", homeAirportLabel: "San Francisco International" };
  const result = await saveClerkHomeAirport({
    getCurrentSession: () => makeSession(),
    requestedClerkUserId: "clerk-user-a",
    homeAirportCode: "KSFO",
    readProfile: async () => {
      calls.push("GET /api/me/profile");
      return ++reads === 1 ? latest : saved;
    },
    updateProfile: async (body) => {
      calls.push("PUT /api/me/profile");
      assert.equal(body.firstName, latest.firstName);
      assert.deepEqual(body.favoriteCityKeys, latest.favoriteCityKeys);
      assert.equal(body.homeAirportCode, "KSFO");
      assert.deepEqual(body.notificationPrefs, latest.notificationPrefs);
    },
  });
  assert.deepEqual(calls, ["GET /api/me/profile", "PUT /api/me/profile", "GET /api/me/profile"]);
  assert.equal(result.homeAirportCode, "KSFO");
});

test("home-airport save refuses success if the refreshed profile lost preferences, favorites, or SMS consent", async () => {
  const regressions = [
    (saved) => ({ ...saved, notificationPrefs: { ...saved.notificationPrefs, queueUpdates: "email" } }),
    (saved) => ({ ...saved, favoriteCityKeys: [] }),
    (saved) => ({ ...saved, favoriteAirportCodes: [] }),
    (saved) => ({ ...saved, smsConsent: false, smsConsentAt: null }),
  ];
  for (const change of regressions) {
    let reads = 0;
    const refreshed = change({ ...profile, homeAirportCode: "KSFO" });
    await assert.rejects(saveClerkHomeAirport({
      getCurrentSession: () => makeSession(),
      requestedClerkUserId: "clerk-user-a",
      homeAirportCode: "KSFO",
      readProfile: async () => ++reads === 1 ? profile : refreshed,
      updateProfile: async () => {},
    }), /did not confirm the selected home airport and preserved account settings/i);
  }
});

test("home-airport write never confirms a mismatch and never writes after the account changes", async () => {
  let writes = 0;
  let reads = 0;
  await assert.rejects(saveClerkHomeAirport({
    getCurrentSession: () => makeSession(),
    requestedClerkUserId: "clerk-user-a",
    homeAirportCode: "KSFO",
    readProfile: async () => {
      reads++;
      return reads === 1 ? profile : { ...profile, homeAirportCode: "KJFK" };
    },
    updateProfile: async () => { writes++; },
  }), /did not confirm the selected home airport/i);
  assert.equal(writes, 1);

  let session = makeSession();
  writes = 0;
  await assert.rejects(saveClerkHomeAirport({
    getCurrentSession: () => session,
    requestedClerkUserId: "clerk-user-a",
    homeAirportCode: "KSFO",
    readProfile: async () => {
      session = makeSession({ userId: "clerk-user-b" });
      return profile;
    },
    updateProfile: async () => { writes++; },
  }), /account changed/i);
  assert.equal(writes, 0);
});

test("home-airport read and PUT failures stay failures and never trigger an automatic retry", async () => {
  for (const phase of ["read", "write"]) {
    let reads = 0;
    let writes = 0;
    await assert.rejects(saveClerkHomeAirport({
      getCurrentSession: () => makeSession(),
      requestedClerkUserId: "clerk-user-a",
      homeAirportCode: "KSFO",
      readProfile: async () => {
        reads++;
        if (phase === "read") throw new Error("profile read failed");
        return profile;
      },
      updateProfile: async () => {
        writes++;
        if (phase === "write") throw new Error("profile save failed");
      },
    }), phase === "read" ? /profile read failed/ : /profile save failed/);
    assert.equal(reads, 1);
    assert.equal(writes, phase === "read" ? 0 : 1);
  }
});

test("save reads latest full profile, writes once, and returns refreshed server preferences rather than the draft or PUT body", async () => {
  const calls = [];
  let reads = 0;
  const serverPrefs = { ...prefs, queueUpdates: "email" };
  const latest = { ...profile, firstName: "Latest", favoriteCityKeys: ["boston"], weightLbs: 155 };
  const result = await saveClerkNotificationPreferences(saveInput({
    readProfile: async () => {
      calls.push("GET /api/me/profile");
      return ++reads === 1 ? latest : { ...latest, notificationPrefs: serverPrefs };
    },
    updateProfile: async (body) => {
      calls.push("PUT /api/me/profile");
      assert.equal(body.firstName, latest.firstName);
      assert.equal(body.weightLbs, latest.weightLbs);
      assert.deepEqual(body.favoriteCityKeys, latest.favoriteCityKeys);
      assert.equal(body.notificationPrefs.queueUpdates, "email");
      return { isAuthenticated: true };
    },
    preferences: { ...prefs, queueUpdates: "email" },
  }));
  assert.deepEqual(calls, ["GET /api/me/profile", "PUT /api/me/profile", "GET /api/me/profile"]);
  assert.deepEqual(result.notificationPrefs, serverPrefs);
});

test("pending writes do not return an optimistic preference projection", async () => {
  let resolveWrite;
  let returned = false;
  let reads = 0;
  let serverProfile = profile;
  const requested = { ...prefs, queueUpdates: "email" };
  const result = saveClerkNotificationPreferences(saveInput({
    readProfile: async () => { reads++; return serverProfile; },
    updateProfile: () => new Promise((resolve) => {
      resolveWrite = () => {
        serverProfile = { ...profile, notificationPrefs: requested };
        resolve({});
      };
    }),
    preferences: requested,
  })).then(() => { returned = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reads, 1);
  assert.equal(returned, false);
  resolveWrite({});
  await result;
  assert.equal(reads, 2);
});

test("notification save refuses success if the refreshed profile lost unrelated fields or consent", async () => {
  const requested = { ...prefs, queueUpdates: "email" };
  const regressions = [
    (saved) => ({ ...saved, homeAirportCode: "KSFO" }),
    (saved) => ({ ...saved, favoriteCityKeys: [] }),
    (saved) => ({ ...saved, favoriteAirportCodes: [] }),
    (saved) => ({ ...saved, smsConsent: false, smsConsentAt: null }),
  ];
  for (const change of regressions) {
    let reads = 0;
    const refreshed = change({ ...profile, notificationPrefs: requested });
    await assert.rejects(saveClerkNotificationPreferences(saveInput({
      readProfile: async () => ++reads === 1 ? profile : refreshed,
      preferences: requested,
    })), /did not confirm the requested preferences and preserved account settings/i);
  }
});

test("read-only fallback never writes when the latest full profile cannot form a safe update", async () => {
  let writes = 0;
  await assert.rejects(saveClerkNotificationPreferences(saveInput({
    readProfile: async () => ({ ...profile, dob: null }),
    updateProfile: async () => { writes++; },
  })), /read-only/);
  assert.equal(writes, 0);
});

test("failed writes and failed refreshes never report success or automatically retry the PUT", async () => {
  for (const phase of ["write", "refresh"]) {
    let writes = 0;
    let reads = 0;
    await assert.rejects(saveClerkNotificationPreferences(saveInput({
      readProfile: async () => {
        if (++reads === 2) throw new Error("refresh failed");
        return profile;
      },
      updateProfile: async () => {
        writes++;
        if (phase === "write") throw new Error("HTTP 400");
      },
    })), phase === "write" ? /HTTP 400/ : /refresh failed/);
    assert.equal(writes, 1);
    assert.equal(reads, phase === "write" ? 1 : 2);
  }
  await assert.rejects(saveClerkNotificationPreferences(saveInput({
    readProfile: async () => profile,
    updateProfile: async () => ({}),
    preferences: { ...prefs, queueUpdates: "email" },
  })), /did not confirm the requested preferences and preserved account settings/i);
});

test("identity changes during pre-save read prevent writes; changes during PUT prevent refresh and exposure", async () => {
  for (const phase of ["read", "write"]) {
    let session = makeSession();
    let writes = 0;
    let reads = 0;
    await assert.rejects(saveClerkNotificationPreferences(saveInput({
      getCurrentSession: () => session,
      readProfile: async () => {
        reads++;
        if (phase === "read") session = makeSession({ userId: "clerk-user-b" });
        return profile;
      },
      updateProfile: async () => { writes++; session = makeSession({ isSignedIn: false }); },
    })), /account changed/);
    assert.equal(writes, phase === "read" ? 0 : 1);
    assert.equal(reads, 1);
  }
});

test("a cancelled read or save cannot expose a profile or submit an update", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const input = saveInput({
    signal: controller.signal,
    readProfile: async () => { calls++; return profile; },
    updateProfile: async () => { calls++; },
  });
  await assert.rejects(readClerkNotificationProfile(input), /cancelled/);
  await assert.rejects(saveClerkNotificationPreferences(input), /cancelled/);
  assert.equal(calls, 0);
});

test("identity changes during post-save refresh discard the result without a second write", async () => {
  let reads = 0;
  let writes = 0;
  let session = makeSession();
  await assert.rejects(saveClerkNotificationPreferences(saveInput({
    getCurrentSession: () => session,
    readProfile: async () => {
      if (++reads === 2) session = makeSession({ userId: "clerk-user-b" });
      return profile;
    },
    updateProfile: async () => { writes++; },
  })), /account changed/);
  assert.equal(reads, 2);
  assert.equal(writes, 1);
});
