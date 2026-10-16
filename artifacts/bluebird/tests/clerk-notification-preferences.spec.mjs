import assert from "node:assert/strict";
import { test } from "node:test";
import { readClerkNotificationPreferences } from "../scripts/.clerk-notification-preferences.test.mjs";

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
