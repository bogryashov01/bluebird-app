import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";
import {
  ProductionAuthHttpError,
  ProductionAuthNetworkError,
  ProductionAuthRequestError,
  applyQueueMutationRefresh,
  assessProductionQueueJoin,
  canSubmitProductionQueueJoin,
  sanitizeProductionHttpFailure,
  submitProductionQueueJoin,
  submitProductionQueueLeave,
  submitProductionQueueSkipLine,
} from "../scripts/.production-queue-mutations.test.mjs";

const projectRoot = resolve(import.meta.dirname, "..");

const joinedEntry = {
  emptyLegId: 42,
  joinedAt: "2026-10-27T00:00:00.000Z",
  position: 3,
  queueCount: 11,
  memberQueueCount: 4,
  userInQueue: true,
  userTier: "base",
  userHasLineSkip: false,
  userHasInternationalPass: false,
};

const leftStatus = {
  emptyLegId: 42,
  queueCount: 10,
  memberQueueCount: 3,
  userInQueue: false,
  lockedForFreeUsers: false,
};

function httpError(status, body) {
  const details = sanitizeProductionHttpFailure(body);
  return new ProductionAuthHttpError(status, details);
}

function openJoin(overrides = {}) {
  const calls = [];
  const input = {
    gateOpen: true,
    flightId: 42,
    consent: "none",
    internationalPassRequired: false,
    signedIn: true,
    inFlight: { current: false },
    createClient: () => ({
      joinEmptyLegQueue: async (id, body) => {
        calls.push(["join", id, body]);
        return joinedEntry;
      },
      leaveEmptyLegQueue: async (id) => {
        calls.push(["leave", id]);
        return leftStatus;
      },
    }),
    ...overrides,
  };
  return { input, calls };
}

test("a successful standard join sends an empty body and uses the confirmed server position", async () => {
  const { input, calls } = openJoin();
  const result = await submitProductionQueueJoin(input);
  assert.equal(result.status, "joined");
  assert.equal(result.entry.position, 3);
  assert.deepEqual(calls, [["join", 42, {}]]);
  assert.equal(result.entry.userInQueue, true);
});

test("International Pass cash authorization omits the credit flag and credit authorization sends both", async () => {
  assert.deepEqual(assessProductionQueueJoin({
    consent: "none",
    internationalPassRequired: true,
  }), { status: "consent-required", body: null });

  const authorize = openJoin({
    consent: "authorize-pass",
    internationalPassRequired: true,
  });
  const authorized = await submitProductionQueueJoin(authorize.input);
  assert.equal(authorized.status, "joined");
  assert.deepEqual(authorize.calls, [["join", 42, { internationalPassAuthorized: true }]]);

  const unconfirmedCredit = openJoin({
    consent: "use-credit",
    internationalPassRequired: true,
    creditConfirmed: false,
  });
  const withheldCredit = await submitProductionQueueJoin(unconfirmedCredit.input);
  assert.equal(withheldCredit.status, "consent-required");
  assert.deepEqual(unconfirmedCredit.calls, []);

  const credit = openJoin({
    consent: "use-credit",
    internationalPassRequired: true,
    creditConfirmed: true,
  });
  const credited = await submitProductionQueueJoin(credit.input);
  assert.equal(credited.status, "joined");
  assert.deepEqual(credit.calls, [["join", 42, {
    internationalPassAuthorized: true,
    useInternationalPassCredit: true,
  }]]);
  assert.equal("useInternationalPassCredit" in authorize.calls[0][2], false);

  const withheld = openJoin({
    consent: "none",
    internationalPassRequired: true,
  });
  const blocked = await submitProductionQueueJoin(withheld.input);
  assert.equal(blocked.status, "consent-required");
  assert.deepEqual(withheld.calls, []);
});

test("a successful leave sends DELETE only after explicit confirmation", async () => {
  const unconfirmed = openJoin({ explicitConfirm: false });
  const waiting = await submitProductionQueueLeave(unconfirmed.input);
  assert.equal(waiting.status, "needs-confirmation");
  assert.deepEqual(unconfirmed.calls, []);

  const confirmed = openJoin({ explicitConfirm: true });
  const left = await submitProductionQueueLeave(confirmed.input);
  assert.equal(left.status, "left");
  assert.equal(left.queueStatus.userInQueue, false);
  assert.deepEqual(confirmed.calls, [["leave", 42]]);
});

test("closed queue, missing membership, incomplete profile, and same-day conflict use server codes", async () => {
  const cases = [
    {
      status: 409,
      body: { code: "queue_closed", message: "secret-token" },
      title: "Queue closed",
    },
    {
      status: 403,
      body: { code: "membership_required", message: "member@example.com" },
      title: "Membership required",
    },
    {
      status: 403,
      body: { code: "profile_incomplete", error: "raw profile payload" },
      title: "Profile incomplete",
    },
    {
      status: 409,
      body: {
        code: "same_day_queue_conflict",
        message: "secret-token",
        conflict: {
          emptyLegId: 88,
          originAirport: "AUS",
          destinationAirport: "TEB",
          departureTime: "2026-11-02T15:00:00.000Z",
          email: "member@example.com",
        },
      },
      title: "You already have a queue that day",
    },
  ];
  for (const item of cases) {
    const { input, calls } = openJoin({
      createClient: () => ({
        joinEmptyLegQueue: async () => {
          calls.push("join");
          throw httpError(item.status, item.body);
        },
        leaveEmptyLegQueue: async () => leftStatus,
      }),
    });
    const result = await submitProductionQueueJoin(input);
    assert.equal(result.status, "failed");
    assert.equal(result.failure.title, item.title);
    assert.equal(JSON.stringify(result.failure).includes("secret-token"), false);
    assert.equal(JSON.stringify(result.failure).includes("member@example.com"), false);
    assert.equal(JSON.stringify(result.failure).includes("raw profile"), false);
    assert.equal(calls.length, 1);
  }

  const closedLeave = openJoin({
    explicitConfirm: true,
    createClient: () => ({
      joinEmptyLegQueue: async () => joinedEntry,
      leaveEmptyLegQueue: async () => {
        throw httpError(409, { code: "queue_closed", message: "secret-token" });
      },
    }),
  });
  const leaveResult = await submitProductionQueueLeave(closedLeave.input);
  assert.equal(leaveResult.status, "failed");
  assert.equal(leaveResult.failure.title, "Queue closed");
  assert.match(leaveResult.failure.body, /not removed/);
  assert.equal(JSON.stringify(leaveResult.failure).includes("secret-token"), false);
});

test("a second submission does not call the client while the first request is in flight", async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const inFlight = { current: false };
  const input = {
    gateOpen: true,
    flightId: 42,
    consent: "none",
    internationalPassRequired: false,
    signedIn: true,
    inFlight,
    createClient: () => ({
      joinEmptyLegQueue: async () => {
        calls += 1;
        await pending;
        return joinedEntry;
      },
      leaveEmptyLegQueue: async () => leftStatus,
    }),
  };
  const first = submitProductionQueueJoin(input);
  const second = await submitProductionQueueJoin(input);
  assert.equal(second.status, "duplicate");
  assert.match(second.failure.body, /already in progress/);
  assert.equal(calls, 1);
  release();
  assert.equal((await first).status, "joined");
  assert.equal(calls, 1);
});

test("network failure and an unauthorized session do not claim a queue change", async () => {
  const network = openJoin({
    createClient: () => ({
      joinEmptyLegQueue: async () => {
        throw new ProductionAuthNetworkError();
      },
      leaveEmptyLegQueue: async () => leftStatus,
    }),
  });
  const offline = await submitProductionQueueJoin(network.input);
  assert.equal(offline.status, "failed");
  assert.equal(offline.failure.title, "Connection problem");
  assert.match(offline.failure.body, /No queue change was confirmed/);

  const signedOut = openJoin({ signedIn: false });
  const unsigned = await submitProductionQueueJoin(signedOut.input);
  assert.equal(unsigned.status, "failed");
  assert.equal(unsigned.failure.title, "Sign in required");
  assert.deepEqual(signedOut.calls, []);

  const expired = openJoin({
    createClient: () => ({
      joinEmptyLegQueue: async () => {
        throw new ProductionAuthRequestError("Main API access token is unavailable.", "token");
      },
      leaveEmptyLegQueue: async () => leftStatus,
    }),
  });
  const rejected = await submitProductionQueueJoin(expired.input);
  assert.equal(rejected.status, "failed");
  assert.equal(rejected.failure.title, "Sign in required");
  assert.equal(JSON.stringify(rejected.failure).includes("token"), false);
});

test("a confirmed join refreshes flight details, the roster, My Queues, and trips for that account only", () => {
  const invalidated = [];
  const refreshed = applyQueueMutationRefresh({
    gateOpen: true,
    requestedUserId: "user_a",
    activeUserId: "user_a",
    signedIn: true,
    environment: "production",
    flightId: 42,
    invalidate: (key) => invalidated.push(key),
  });
  assert.equal(refreshed, true);
  assert.equal(invalidated.length, 5);
  assert.deepEqual(invalidated[0], ["production-empty-leg", 42, "user_a"]);
  assert.equal(invalidated[1][3], "empty-leg-queue");
  assert.equal(invalidated[1][4], 42);
  assert.equal(invalidated[2][3], "empty-leg-queue");
  assert.equal(invalidated[2].length, 4);
  assert.equal(invalidated[3][3], "trips");
  assert.equal(invalidated[4][3], "empty-leg-list");
  assert.equal(invalidated.every((key) => key.includes("user_a")), true);

  const otherAccount = [];
  assert.equal(applyQueueMutationRefresh({
    gateOpen: true,
    requestedUserId: "user_a",
    activeUserId: "user_b",
    signedIn: true,
    environment: "production",
    flightId: 42,
    invalidate: (key) => otherAccount.push(key),
  }), false);
  assert.deepEqual(otherAccount, []);
  assert.equal(applyQueueMutationRefresh({
    gateOpen: canSubmitProductionQueueJoin(),
    requestedUserId: "user_a",
    activeUserId: "user_a",
    signedIn: true,
    environment: "production",
    flightId: 42,
    invalidate: (key) => otherAccount.push(key),
  }), false);
  assert.deepEqual(otherAccount, []);
});

test("queue mutations stay disabled in auth-test even when the flag is set", () => {
  const previousFlag = process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_QUEUE_MUTATIONS;
  const previousAuth = process.env.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST;
  try {
    delete process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_QUEUE_MUTATIONS;
    delete process.env.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST;
    assert.equal(canSubmitProductionQueueJoin(), false);
    process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_QUEUE_MUTATIONS = "true";
    assert.equal(canSubmitProductionQueueJoin(), true);
    process.env.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST = "true";
    assert.equal(canSubmitProductionQueueJoin(), false);
    process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_QUEUE_MUTATIONS = "TRUE";
    delete process.env.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST;
    assert.equal(canSubmitProductionQueueJoin(), false);
  } finally {
    if (previousFlag === undefined) delete process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_QUEUE_MUTATIONS;
    else process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_QUEUE_MUTATIONS = previousFlag;
    if (previousAuth === undefined) delete process.env.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST;
    else process.env.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST = previousAuth;
  }
});

test("the production gate stays closed and the app does not call the client", async () => {
  assert.equal(canSubmitProductionQueueJoin(), false);
  const readiness = readFileSync(resolve(projectRoot, "lib/productionQueueReadiness.ts"), "utf8");
  assert.match(readiness, /deployedMainService: false/);
  const { input, calls } = openJoin({ gateOpen: canSubmitProductionQueueJoin() });
  const join = await submitProductionQueueJoin(input);
  const leave = await submitProductionQueueLeave({ ...input, explicitConfirm: true });
  assert.equal(join.status, "disabled");
  assert.equal(leave.status, "disabled");
  assert.deepEqual(calls, []);
  const skipCalls = [];
  const closedSkip = await submitProductionQueueSkipLine({
    gateOpen: false,
    flightId: 42,
    explicitConfirm: true,
    existingCreditCount: 1,
    signedIn: true,
    inFlight: { current: false },
    createClient: () => ({
      skipLine: async (id, body) => {
        skipCalls.push([id, body]);
        return { id: 42, viewerIsEffectiveWinner: true };
      },
    }),
  });
  assert.equal(closedSkip.status, "disabled");
  assert.deepEqual(skipCalls, []);

  const hook = readFileSync(resolve(projectRoot, "lib/useProductionQueueMutation.ts"), "utf8");
  const confirmation = readFileSync(resolve(projectRoot, "components/QueueJoinConfirmation.tsx"), "utf8");
  const joinScreen = readFileSync(resolve(projectRoot, "app/flight/join.tsx"), "utf8");
  const mutations = readFileSync(resolve(projectRoot, "lib/productionQueueMutations.ts"), "utf8");
  const api = readFileSync(resolve(projectRoot, "lib/productionAuthApi.ts"), "utf8");
  assert.match(hook, /gateOpen: canSubmitProductionQueueJoin\(\)/);
  assert.doesNotMatch(hook, /gateOpen:\s*true/);
  assert.match(hook, /applyQueueMutationRefresh/);
  assert.match(hook, /submitProductionQueueSkipLine/);
  assert.match(hook, /Use 1 Skip the Line Pass\?/);
  assert.match(hook, /status === 'applied'[\s\S]*markCurrentWinnerCelebration\([\s\S]*viewerIsEffectiveWinner: result\.flight\.viewerIsEffectiveWinner === true/);
  assert.doesNotMatch(hook, /PassCelebration|\/flight\/confirmed|Flight Confirmed|You've Won the Flight/);
  assert.match(confirmation, /joinFlightConfirmNote\(demoEnabled\)/);
  const presentation = readFileSync(resolve(projectRoot, "lib/joinFlightPresentation.ts"), "utf8");
  assert.match(presentation, /Queue joining is not available in this build\. No request is sent\./);
  assert.match(presentation, /if \(canSubmitProductionQueueJoin\(\)\) return JOIN_FLIGHT_CONFIRM_READY/);
  assert.match(confirmation, /if \(decision\.status === 'ready'\)/);
  assert.doesNotMatch(joinScreen, /saveQueueCandidate/);
  assert.match(readFileSync(resolve(projectRoot, "lib/productionQueueCapability.ts"), "utf8"), /nativeAuthTest !== true/);
  assert.doesNotMatch(mutations, /saveQueueCandidate|AsyncStorage/);
  assert.match(mutations, /if \(input\.gateOpen !== true\) return \{ status: 'disabled' \}/);
  assert.match(api, /joinEmptyLegQueue:[\s\S]*'POST'/);
  assert.match(api, /leaveEmptyLegQueue:[\s\S]*'DELETE'/);
  assert.doesNotMatch(api, /AUTH_TEST_READ_PATHS[\s\S]*'POST'/);
});

test("an unconfirmed join response does not invent a position", async () => {
  const { input } = openJoin({
    createClient: () => ({
      joinEmptyLegQueue: async () => ({ ...joinedEntry, userInQueue: false, position: 1 }),
      leaveEmptyLegQueue: async () => leftStatus,
    }),
  });
  const result = await submitProductionQueueJoin(input);
  assert.equal(result.status, "failed");
  assert.match(result.failure.body, /did not confirm a queue position/);
  assert.equal(JSON.stringify(result).includes('"position":1'), false);
});

test("Skip the Line applies an existing credit after joining and confirms current-winner status", async () => {
  const calls = [];
  const input = {
    gateOpen: true,
    flightId: 42,
    explicitConfirm: true,
    existingCreditCount: 2,
    signedIn: true,
    inFlight: { current: false },
    createClient: () => ({
      skipLine: async (id, body) => {
        calls.push([id, body]);
        return { id: 42, viewerIsEffectiveWinner: true };
      },
    }),
  };
  const unconfirmed = await submitProductionQueueSkipLine({ ...input, explicitConfirm: false });
  const noCredit = await submitProductionQueueSkipLine({ ...input, existingCreditCount: 0 });
  const applied = await submitProductionQueueSkipLine(input);
  const notWinner = await submitProductionQueueSkipLine({
    ...input,
    createClient: () => ({
      skipLine: async (id, body) => {
        calls.push([id, body]);
        return { id: 42, viewerIsEffectiveWinner: false, viewerQueuePosition: 1 };
      },
    }),
  });
  assert.equal(unconfirmed.status, "needs-confirmation");
  assert.equal(noCredit.status, "needs-credit");
  assert.equal(applied.status, "applied");
  assert.equal(applied.flight.viewerIsEffectiveWinner, true);
  assert.equal(applied.flight.viewerQueuePosition, undefined);
  assert.equal(notWinner.status, "failed");
  assert.match(notWinner.failure.body, /did not confirm Skip the Line/);
  assert.equal(notWinner.failure.keepsExistingQueue, true);
  assert.deepEqual(calls, [
    [42, { useCredit: true }],
    [42, { useCredit: true }],
  ]);
});
