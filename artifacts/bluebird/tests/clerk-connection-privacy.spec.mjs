import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  IncomingConnectionPreferenceError,
  buildIncomingConnectionRequestsUpdate,
  isIncomingConnectionPreferenceConfirmed,
  saveIncomingConnectionRequestsPreference,
  withIncomingConnectionPreference,
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

function session(userId = "clerk-user-a") {
  return { isLoaded: true, isSignedIn: true, userId };
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

test("boolean false is a confirmed preference and is never treated as missing", () => {
  assert.equal(
    isIncomingConnectionPreferenceConfirmed(
      profile({
        allowIncomingConnectionRequests: false,
        allowIncomingConnectionRequestsSupported: true,
      }),
      false,
    ),
    true,
  );
  assert.equal(
    isIncomingConnectionPreferenceConfirmed(
      profile({
        allowIncomingConnectionRequests: true,
        allowIncomingConnectionRequestsSupported: false,
      }),
      false,
    ),
    false,
  );
  assert.equal(
    withIncomingConnectionPreference(profile(), false).allowIncomingConnectionRequests,
    false,
  );
});

test("successful ON → OFF confirms only the preference boolean", async () => {
  let stored = true;
  const outcome = await saveIncomingConnectionRequestsPreference({
    getCurrentSession: () => session(),
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
  assert.equal(outcome.kind, "confirmed");
  assert.equal(outcome.profile.allowIncomingConnectionRequests, false);
  assert.equal(outcome.profile.allowIncomingConnectionRequestsSupported, true);
});

test("successful OFF → ON confirms only the preference boolean", async () => {
  let stored = false;
  const outcome = await saveIncomingConnectionRequestsPreference({
    getCurrentSession: () => session(),
    requestedClerkUserId: "clerk-user-a",
    readProfile: async () => profile({
      allowIncomingConnectionRequests: stored,
      allowIncomingConnectionRequestsSupported: true,
    }),
    updateProfile: async (data) => {
      stored = data.allowIncomingConnectionRequests;
      return { isAuthenticated: true };
    },
    allowIncomingConnectionRequests: true,
  });
  assert.equal(outcome.kind, "confirmed");
  assert.equal(outcome.profile.allowIncomingConnectionRequests, true);
});

test("PUT success + GET success returns confirmed", async () => {
  let stored = true;
  const reads = [];
  const outcome = await saveIncomingConnectionRequestsPreference({
    getCurrentSession: () => session(),
    requestedClerkUserId: "clerk-user-a",
    readProfile: async () => {
      reads.push(stored);
      return profile({
        allowIncomingConnectionRequests: stored,
        allowIncomingConnectionRequestsSupported: true,
      });
    },
    updateProfile: async (data) => {
      stored = data.allowIncomingConnectionRequests;
      return { isAuthenticated: true };
    },
    allowIncomingConnectionRequests: false,
  });
  assert.equal(outcome.kind, "confirmed");
  assert.deepEqual(reads, [true, false]);
});

test("PUT success + stale GET retries until the preference confirms", async () => {
  let stored = true;
  let confirmationReads = 0;
  const outcome = await saveIncomingConnectionRequestsPreference({
    getCurrentSession: () => session(),
    requestedClerkUserId: "clerk-user-a",
    readProfile: async () => {
      if (confirmationReads === 0) {
        // Initial pre-PUT read.
        confirmationReads += 1;
        return profile({
          allowIncomingConnectionRequests: true,
          allowIncomingConnectionRequestsSupported: true,
        });
      }
      confirmationReads += 1;
      // First two confirmation reads are stale; third reflects the write.
      const fresh = confirmationReads >= 4;
      return profile({
        allowIncomingConnectionRequests: fresh ? stored : true,
        allowIncomingConnectionRequestsSupported: true,
      });
    },
    updateProfile: async (data) => {
      stored = data.allowIncomingConnectionRequests;
      return { isAuthenticated: true };
    },
    allowIncomingConnectionRequests: false,
    confirmationAttempts: 3,
    confirmationRetryDelayMs: 0,
  });
  assert.equal(outcome.kind, "confirmed");
  assert.equal(outcome.profile.allowIncomingConnectionRequests, false);
  assert.equal(stored, false);
});

test("PUT success + lasting stale GET is unconfirmed, not a save failure", async () => {
  let stored = true;
  const outcome = await saveIncomingConnectionRequestsPreference({
    getCurrentSession: () => session(),
    requestedClerkUserId: "clerk-user-a",
    readProfile: async () => profile({
      allowIncomingConnectionRequests: true,
      allowIncomingConnectionRequestsSupported: true,
    }),
    updateProfile: async (data) => {
      stored = data.allowIncomingConnectionRequests;
      return { isAuthenticated: true };
    },
    allowIncomingConnectionRequests: false,
    confirmationAttempts: 2,
    confirmationRetryDelayMs: 0,
  });
  assert.equal(stored, false);
  assert.equal(outcome.kind, "unconfirmed");
  assert.equal(outcome.writeAccepted, true);
  assert.equal(outcome.requestedValue, false);
});

test("PUT success + GET network failure is unconfirmed, not a save failure", async () => {
  let stored = true;
  let reads = 0;
  const outcome = await saveIncomingConnectionRequestsPreference({
    getCurrentSession: () => session(),
    requestedClerkUserId: "clerk-user-a",
    readProfile: async () => {
      reads += 1;
      if (reads === 1) {
        return profile({
          allowIncomingConnectionRequests: true,
          allowIncomingConnectionRequestsSupported: true,
        });
      }
      throw Object.assign(new Error("offline"), { code: "network" });
    },
    updateProfile: async (data) => {
      stored = data.allowIncomingConnectionRequests;
      return { isAuthenticated: true };
    },
    allowIncomingConnectionRequests: false,
    confirmationAttempts: 2,
    confirmationRetryDelayMs: 0,
  });
  assert.equal(stored, false);
  assert.equal(outcome.kind, "unconfirmed");
  assert.equal(outcome.writeAccepted, true);
  assert.equal(outcome.profile, null);
});

test("PUT failure with unchanged confirmation GET rejects the save", async () => {
  await assert.rejects(
    saveIncomingConnectionRequestsPreference({
      getCurrentSession: () => session(),
      requestedClerkUserId: "clerk-user-a",
      readProfile: async () => profile({
        allowIncomingConnectionRequests: true,
        allowIncomingConnectionRequestsSupported: true,
      }),
      updateProfile: async () => {
        throw Object.assign(new Error("rejected"), { status: 503 });
      },
      allowIncomingConnectionRequests: false,
      confirmationAttempts: 1,
      confirmationRetryDelayMs: 0,
    }),
    (error) => error instanceof IncomingConnectionPreferenceError &&
      /Couldn’t save this preference/i.test(error.message),
  );
});

test("a missing preference field after PUT is unconfirmed when the write settled", async () => {
  let reads = 0;
  const outcome = await saveIncomingConnectionRequestsPreference({
    getCurrentSession: () => session(),
    requestedClerkUserId: "clerk-user-a",
    readProfile: async () => {
      reads += 1;
      if (reads === 1) {
        return profile({
          allowIncomingConnectionRequests: true,
          allowIncomingConnectionRequestsSupported: true,
        });
      }
      return profile({
        allowIncomingConnectionRequests: true,
        allowIncomingConnectionRequestsSupported: false,
      });
    },
    updateProfile: async () => ({ isAuthenticated: true }),
    allowIncomingConnectionRequests: false,
    confirmationAttempts: 2,
    confirmationRetryDelayMs: 0,
  });
  assert.equal(outcome.kind, "unconfirmed");
  assert.equal(outcome.writeAccepted, true);
});

test("boolean false persists when confirmation GET returns false", async () => {
  let stored = true;
  const outcome = await saveIncomingConnectionRequestsPreference({
    getCurrentSession: () => session(),
    requestedClerkUserId: "clerk-user-a",
    readProfile: async () => profile({
      allowIncomingConnectionRequests: stored,
      allowIncomingConnectionRequestsSupported: true,
      phoneE164: null,
      weightLbs: null,
    }),
    updateProfile: async (data) => {
      stored = data.allowIncomingConnectionRequests;
      return { isAuthenticated: true };
    },
    allowIncomingConnectionRequests: false,
  });
  assert.equal(outcome.kind, "confirmed");
  assert.equal(outcome.profile.allowIncomingConnectionRequests, false);
});

test("unrelated profile field drift after PUT does not reject a confirmed preference", async () => {
  let reads = 0;
  const outcome = await saveIncomingConnectionRequestsPreference({
    getCurrentSession: () => session(),
    requestedClerkUserId: "clerk-user-a",
    readProfile: async () => {
      reads += 1;
      return profile({
        allowIncomingConnectionRequests: reads === 1 ? true : false,
        allowIncomingConnectionRequestsSupported: true,
        phoneE164: reads === 1 ? "+15555550123" : null,
        weightLbs: reads === 1 ? 170 : null,
      });
    },
    updateProfile: async () => ({ isAuthenticated: true }),
    allowIncomingConnectionRequests: false,
  });
  assert.equal(outcome.kind, "confirmed");
  assert.equal(outcome.profile.allowIncomingConnectionRequests, false);
  assert.equal(outcome.profile.phoneE164, null);
});

test("rapid toggle interactions are gated in Profile and each save confirms its own boolean", async () => {
  const source = readFileSync(resolve(projectRoot, "app/(tabs)/profile/index.tsx"), "utf8");
  assert.match(source, /incomingPreferenceSaving \|\| !incomingSupported/);
  assert.match(source, /disabled=\{incomingPreferenceSaving \|\| !profile\}/);
  assert.match(source, /saveGeneration !== incomingPreferenceSaveGeneration\.current/);

  let stored = false;
  const onToOff = await saveIncomingConnectionRequestsPreference({
    getCurrentSession: () => session(),
    requestedClerkUserId: "clerk-user-a",
    readProfile: async () => profile({
      allowIncomingConnectionRequests: stored,
      allowIncomingConnectionRequestsSupported: true,
    }),
    updateProfile: async (data) => {
      stored = data.allowIncomingConnectionRequests;
      return { isAuthenticated: true };
    },
    allowIncomingConnectionRequests: true,
  });
  const offToOn = await saveIncomingConnectionRequestsPreference({
    getCurrentSession: () => session(),
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
  assert.equal(onToOff.kind, "confirmed");
  assert.equal(onToOff.profile.allowIncomingConnectionRequests, true);
  assert.equal(offToOn.kind, "confirmed");
  assert.equal(offToOn.profile.allowIncomingConnectionRequests, false);
});

test("account switching during save rejects before applying another account's write", async () => {
  let activeUser = "clerk-user-a";
  await assert.rejects(
    saveIncomingConnectionRequestsPreference({
      getCurrentSession: () => session(activeUser),
      requestedClerkUserId: "clerk-user-a",
      readProfile: async () => {
        activeUser = "clerk-user-b";
        return profile();
      },
      updateProfile: async () => ({ isAuthenticated: true }),
      allowIncomingConnectionRequests: false,
    }),
    (error) => error instanceof IncomingConnectionPreferenceError &&
      /signed-in account changed/i.test(error.message),
  );
});

test("PUT response parse failure still succeeds when confirmation GET matches", async () => {
  let stored = true;
  const outcome = await saveIncomingConnectionRequestsPreference({
    getCurrentSession: () => session(),
    requestedClerkUserId: "clerk-user-a",
    readProfile: async () => profile({
      allowIncomingConnectionRequests: stored,
      allowIncomingConnectionRequestsSupported: true,
    }),
    updateProfile: async (data) => {
      stored = data.allowIncomingConnectionRequests;
      throw Object.assign(new Error("currentUser.isAdmin"), { code: "invalid_schema" });
    },
    allowIncomingConnectionRequests: false,
    confirmationAttempts: 1,
    confirmationRetryDelayMs: 0,
  });
  assert.equal(outcome.kind, "confirmed");
  assert.equal(outcome.profile.allowIncomingConnectionRequests, false);
});

test("the Clerk profile keeps Allow incoming requests under Preferences as privacy, not push", () => {
  const source = readFileSync(resolve(projectRoot, "app/(tabs)/profile/index.tsx"), "utf8");
  assert.match(source, /allowIncomingConnectionRequestsSupported/);
  assert.match(source, /clerk-incoming-connection-requests-switch/);
  assert.match(source, /saveIncomingConnectionRequestsPreference/);
  assert.match(source, /label: 'Allow incoming requests'/);
  assert.match(source, /outcome\.kind === 'confirmed'/);
  assert.match(source, /couldn’t confirm this preference yet/i);
  assert.match(source, /incomingPreferenceSaveGeneration/);
  assert.match(source, /withIncomingConnectionPreference/);
  const preferencesBlock = source
    .split('title="Preferences"')[1]
    ?.split('title="Connections"')[0] ?? "";
  assert.match(preferencesBlock, /label: 'Notification Settings'/);
  assert.match(preferencesBlock, /label: 'Allow incoming requests'/);
  assert.match(preferencesBlock, /clerk-incoming-connection-requests-switch/);
  assert.match(preferencesBlock, /label: 'Appearance'/);
  assert.doesNotMatch(preferencesBlock, /Get notified when someone sends you a connection request/);
  const connectionsBlock = source
    .split('title="Connections"')[1]
    ?.split('title="Support"')[0] ?? "";
  assert.doesNotMatch(connectionsBlock, /clerk-incoming-connection-requests-switch/);
  assert.doesNotMatch(source, /homeAirportLabel|upgradeCreditBalances|phoneVerifiedAt/);
});
