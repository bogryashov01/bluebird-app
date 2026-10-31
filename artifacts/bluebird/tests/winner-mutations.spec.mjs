import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";
process.env.EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT = "production";
process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL = "https://bluebirdjets.com/api";
process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY = "pk_live_Y2xlcmsuZXhhbXBsZS5jb20k";

import {
  ProductionAuthHttpError,
  ProductionAuthInvalidJsonError,
  ProductionAuthNetworkError,
  ProductionAuthRequestError,
  ProductionAuthSchemaError,
  applyWinnerMutationRefresh,
  canConfirmProductionWinner,
  canDeclineProductionWinner,
  createAuthenticatedProductionApiClient,
  declinedFlightForId,
  submitWinnerConfirmation,
  submitWinnerDecline,
  winnerActionBlock,
  winnerMutationRefreshKeys,
} from "../scripts/.winner-mutations.test.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const now = Date.parse("2026-10-29T12:00:00.000Z");
const closedAt = "2026-10-29T10:00:00.000Z";
const futureClose = "2026-10-29T13:00:00.000Z";

function confirmedTrip(confirmedAt = "2026-10-29T12:05:00.000Z", id = 42) {
  return {
    leg: { id },
    checklist: { emptyLegId: id, confirmedAt, awarded: false },
  };
}

function declinedFlight(status = "declined", id = 42) {
  return { id, viewerConfirmationStatus: status, viewerIsEffectiveWinner: false };
}

function openInput(overrides = {}) {
  const calls = [];
  const input = {
    gateOpen: true,
    legId: 42,
    flightId: 42,
    signedIn: true,
    block: null,
    explicitConfirm: true,
    inFlight: { current: false },
    createClient: () => ({
      confirmTripChecklist: async (id) => {
        calls.push(["confirm", id]);
        return confirmedTrip();
      },
      declineEmptyLegWinner: async (id) => {
        calls.push(["decline", id]);
        return declinedFlight();
      },
    }),
    ...overrides,
  };
  return { input, calls };
}

test("an eligible winner confirmation posts the checklist path and requires a confirmation time", async () => {
  const { input, calls } = openInput();
  const result = await submitWinnerConfirmation(input);
  assert.equal(result.status, "confirmed");
  assert.equal(result.trip.checklist.confirmedAt, "2026-10-29T12:05:00.000Z");
  assert.deepEqual(calls, [["confirm", 42]]);
});

test("confirmation does not succeed from a matching trip that is still unconfirmed", async () => {
  const { input, calls } = openInput({
    createClient: () => ({
      confirmTripChecklist: async (id) => {
        calls.push(["confirm", id]);
        return confirmedTrip(null);
      },
      declineEmptyLegWinner: async () => { throw new Error("decline"); },
    }),
  });
  const result = await submitWinnerConfirmation(input);
  assert.equal(result.status, "failed");
  assert.match(result.failure.body, /did not confirm/);
  assert.equal(calls.length, 1);
});

test("a confirmation for a different leg is unconfirmed", async () => {
  const { input } = openInput({
    createClient: () => ({
      confirmTripChecklist: async () => confirmedTrip("2026-10-29T12:05:00.000Z", 99),
      declineEmptyLegWinner: async () => declinedFlight(),
    }),
  });
  const result = await submitWinnerConfirmation(input);
  assert.equal(result.status, "failed");
  assert.match(result.failure.body, /did not confirm/);
});

test("a non-winner, an existing confirmation, an existing decline, and a closed selection send nothing", async () => {
  for (const block of ["not-winner", "already-confirmed", "already-declined", "not-open"]) {
    const { input, calls } = openInput({ block });
    const confirmed = await submitWinnerConfirmation(input);
    const declined = await submitWinnerDecline(input);
    assert.equal(confirmed.status, "failed");
    assert.equal(declined.status, "failed");
    assert.match(confirmed.failure.body, /No request was sent/);
    assert.equal(calls.length, 0);
  }
  assert.equal(winnerActionBlock({
    isWinner: false,
    awarded: false,
    confirmed: false,
    confirmedAt: null,
    declined: false,
    queueClosesAt: closedAt,
    nowMs: now,
  }), "not-winner");
  assert.equal(winnerActionBlock({
    isWinner: true,
    awarded: false,
    confirmed: true,
    confirmedAt: null,
    declined: false,
    queueClosesAt: closedAt,
    nowMs: now,
  }), "already-confirmed");
  assert.equal(winnerActionBlock({
    isWinner: true,
    awarded: false,
    confirmed: false,
    confirmedAt: null,
    declined: true,
    queueClosesAt: closedAt,
    nowMs: now,
  }), "already-declined");
  assert.equal(winnerActionBlock({
    isWinner: true,
    awarded: false,
    confirmed: false,
    confirmedAt: null,
    declined: false,
    queueClosesAt: futureClose,
    nowMs: now,
  }), "not-open");
});

test("decline requires an explicit confirmation and a declined server status", async () => {
  const unconfirmed = openInput({ explicitConfirm: false });
  assert.equal((await submitWinnerDecline(unconfirmed.input)).status, "needs-confirmation");
  assert.equal(unconfirmed.calls.length, 0);

  const { input, calls } = openInput();
  const result = await submitWinnerDecline(input);
  assert.equal(result.status, "declined");
  assert.equal("nextWinner" in result, false);
  assert.deepEqual(calls, [["decline", 42]]);

  const pending = openInput({
    createClient: () => ({
      confirmTripChecklist: async () => confirmedTrip(),
      declineEmptyLegWinner: async () => declinedFlight("pending"),
    }),
  });
  const pendingResult = await submitWinnerDecline(pending.input);
  assert.equal(pendingResult.status, "failed");
  assert.match(pendingResult.failure.body, /did not confirm/);
  assert.equal(declinedFlightForId(42, { id: 42, viewerIsEffectiveWinner: false }), false);
  assert.equal(declinedFlightForId(42, { id: 42, winnerConfirmationStatus: "declined" }), true);
});

test("missing flight and leg ids fail before a client is created", async () => {
  for (const id of [0, -1, 1.5, null]) {
    const confirmation = openInput({ legId: id });
    const decline = openInput({ flightId: id });
    assert.equal((await submitWinnerConfirmation(confirmation.input)).status, "failed");
    assert.equal((await submitWinnerDecline(decline.input)).status, "failed");
    assert.equal(confirmation.calls.length, 0);
    assert.equal(decline.calls.length, 0);
  }
});

test("an expired or rejected winner response does not show success", async () => {
  const { input } = openInput({
    createClient: () => ({
      confirmTripChecklist: async () => {
        throw new ProductionAuthHttpError(409, { code: "queue_closed", body: { code: "queue_closed" } });
      },
      declineEmptyLegWinner: async () => {
        throw new ProductionAuthHttpError(409, null);
      },
    }),
  });
  const confirmed = await submitWinnerConfirmation(input);
  const declined = await submitWinnerDecline(input);
  assert.equal(confirmed.status, "failed");
  assert.equal(declined.status, "failed");
  assert.match(confirmed.failure.body, /Nothing was changed/);
  assert.doesNotMatch(`${confirmed.failure.title} ${confirmed.failure.body}`, /token|eyJ/);
});

test("network, schema, and unauthorized failures stay local", async () => {
  const network = openInput({
    createClient: () => ({
      confirmTripChecklist: async () => { throw new ProductionAuthNetworkError(); },
      declineEmptyLegWinner: async () => { throw new ProductionAuthNetworkError(); },
    }),
  });
  assert.equal((await submitWinnerConfirmation(network.input)).failure.title, "Connection problem");
  assert.equal((await submitWinnerDecline(network.input)).failure.title, "Connection problem");

  const schema = openInput({
    createClient: () => ({
      confirmTripChecklist: async () => { throw new ProductionAuthSchemaError("trip.checklist.confirmedAt"); },
      declineEmptyLegWinner: async () => { throw new ProductionAuthInvalidJsonError(); },
    }),
  });
  assert.match((await submitWinnerConfirmation(schema.input)).failure.body, /did not confirm/);
  assert.match((await submitWinnerDecline(schema.input)).failure.body, /did not confirm/);

  const unauthorized = openInput({
    createClient: () => ({
      confirmTripChecklist: async () => { throw new ProductionAuthHttpError(401, null); },
      declineEmptyLegWinner: async () => { throw new ProductionAuthRequestError("Main API access token is unavailable.", "token"); },
    }),
  });
  assert.equal((await submitWinnerConfirmation(unauthorized.input)).failure.title, "Sign in required");
  assert.equal((await submitWinnerDecline(unauthorized.input)).failure.title, "Sign in required");
});

test("a second tap does not send a second request", async () => {
  let release = () => {};
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const input = {
    gateOpen: true,
    legId: 42,
    flightId: 42,
    signedIn: true,
    block: null,
    explicitConfirm: true,
    inFlight: { current: false },
    createClient: () => ({
      confirmTripChecklist: async (id) => {
        calls.push(id);
        await gate;
        return confirmedTrip();
      },
      declineEmptyLegWinner: async (id) => {
        calls.push(id);
        await gate;
        return declinedFlight();
      },
    }),
  };
  const first = submitWinnerConfirmation(input);
  const second = await submitWinnerConfirmation(input);
  assert.equal(second.status, "duplicate");
  assert.match(second.failure.body, /already in progress/);
  release();
  assert.equal((await first).status, "confirmed");
  assert.deepEqual(calls, [42]);

  input.inFlight.current = false;
  const declineFirst = submitWinnerDecline(input);
  const declineSecond = await submitWinnerDecline(input);
  assert.equal(declineSecond.status, "duplicate");
  release();
  assert.equal((await declineFirst).status, "declined");
  assert.deepEqual(calls, [42, 42]);
});

test("sign-out and an account switch do not refresh or send", async () => {
  const signedOut = openInput({ signedIn: false });
  assert.equal((await submitWinnerConfirmation(signedOut.input)).failure.title, "Sign in required");
  assert.equal((await submitWinnerDecline(signedOut.input)).failure.title, "Sign in required");
  assert.equal(signedOut.calls.length, 0);

  const seen = [];
  const switched = applyWinnerMutationRefresh({
    gateOpen: true,
    requestedUserId: "user-a",
    activeUserId: "user-b",
    signedIn: true,
    environment: "production",
    legId: 42,
    invalidate: (key) => seen.push(key),
  });
  const signedOutRefresh = applyWinnerMutationRefresh({
    gateOpen: true,
    requestedUserId: "user-a",
    activeUserId: null,
    signedIn: false,
    environment: "production",
    legId: 42,
    invalidate: (key) => seen.push(key),
  });
  assert.equal(switched, false);
  assert.equal(signedOutRefresh, false);
  assert.equal(seen.length, 0);

  const keys = winnerMutationRefreshKeys({
    environment: "production",
    clerkUserId: "user-a",
    legId: 42,
  });
  const refreshed = [];
  assert.equal(applyWinnerMutationRefresh({
    gateOpen: true,
    requestedUserId: "user-a",
    activeUserId: "user-a",
    signedIn: true,
    environment: "production",
    legId: 42,
    invalidate: (key) => refreshed.push(key),
  }), true);
  assert.deepEqual(refreshed, [keys.trip, keys.trips, keys.detail, keys.queue, keys.myQueues, keys.flightList]);
  assert.equal(applyWinnerMutationRefresh({
    gateOpen: false,
    requestedUserId: "user-a",
    activeUserId: "user-a",
    signedIn: true,
    environment: "production",
    legId: 42,
    invalidate: () => { throw new Error("closed gate"); },
  }), false);
});

test("the production winner gates stay closed and the screens do not bypass them", async () => {
  const closedConfirm = openInput({ gateOpen: canConfirmProductionWinner() });
  const closedDecline = openInput({ gateOpen: canDeclineProductionWinner() });
  assert.equal((await submitWinnerConfirmation(closedConfirm.input)).status, "disabled");
  assert.equal((await submitWinnerDecline(closedDecline.input)).status, "disabled");
  assert.equal(closedConfirm.calls.length, 0);
  assert.equal(closedDecline.calls.length, 0);

  const hook = readFileSync(resolve(projectRoot, "lib/useWinnerActions.ts"), "utf8");
  const checklist = readFileSync(resolve(projectRoot, "app/flight/checklist.tsx"), "utf8");
  const notice = readFileSync(resolve(projectRoot, "components/WinnerFlightNotice.tsx"), "utf8");
  const join = readFileSync(resolve(projectRoot, "lib/joinFlightPresentation.ts"), "utf8");
  const readiness = readFileSync(resolve(projectRoot, "lib/productionQueueReadiness.ts"), "utf8");
  const policy = readFileSync(resolve(projectRoot, "lib/nativeAuthTestPolicy.ts"), "utf8");
  assert.match(hook, /gateOpen: canConfirmProductionWinner\(\)/);
  assert.match(hook, /gateOpen: canDeclineProductionWinner\(\)/);
  assert.doesNotMatch(hook, /gateOpen:\s*true/);
  assert.match(hook, /explicitConfirm: true/);
  assert.match(hook, /sessionRef\.current\?\.userId !== requestedUserId/);
  assert.match(hook, /\[clerkUserId\]/);
  assert.match(checklist, /WINNER_DECLINE_DIALOG/);
  assert.match(notice, /WINNER_DECLINE_DIALOG/);
  assert.match(notice, /winner-view-checklist/);
  assert.doesNotMatch(`${checklist}\n${notice}`, /confirmTripChecklist|declineEmptyLegWinner|confirmEmptyLegWinner/);
  assert.match(join, /export function canSubmitProductionQueueJoin\(\): boolean \{\n  return isProductionQueueMutationsEnabled\(\);\n\}/);
  assert.match(readiness, /deployedMainService: false/);
  assert.doesNotMatch(policy, /checklist\/confirmed|winner\/decline/);
});

test("the authenticated client posts the winner paths with a bearer token and no body", async () => {
  const requests = [];
  const trip = {
    leg: {
      id: 42,
      originAirport: "APF",
      destinationAirport: "MIA",
      originCity: null,
      destinationCity: null,
      departureTime: "2026-11-01T10:00:00.000Z",
      arrivalTime: null,
      tailNumber: null,
      aircraftType: null,
      originFboName: null,
      originFboAddress: null,
      destinationFboName: null,
      destinationFboAddress: null,
      queueClosesAt: closedAt,
    },
    checklist: {
      emptyLegId: 42,
      confirmedAt: "2026-10-29T12:05:00.000Z",
      fboVerifiedAt: null,
      manifestAckAt: null,
      policyAckAt: null,
      passLinkSentAt: null,
      manifestLockedAt: null,
      manifestLocked: false,
      boardingPassUrl: null,
      remainingSteps: ["fboVerified"],
      passengerCount: 1,
      awarded: false,
    },
  };
  const emptyLeg = {
    id: 42,
    originAirport: "APF",
    destinationAirport: "MIA",
    departureTime: "2026-11-01T10:00:00.000Z",
    isInternational: false,
    status: "published",
    pricePerHour: 0,
    queueCount: 1,
    memberQueueCount: 1,
    userInQueue: false,
    lockedForFreeUsers: false,
    lineSkipPriceUsd: 0,
    lineSkipSold: false,
    viewerHasLineSkip: false,
    internationalPassPriceUsd: 0,
    internationalPassRequired: false,
    viewerHasInternationalPass: false,
    viewerIsEffectiveWinner: false,
    changeFlagSeverity: "none",
    aircraftGalleryUrls: [],
    aircraftGalleryAlts: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    viewerConfirmationStatus: "declined",
  };
  const client = createAuthenticatedProductionApiClient({
    environment: "production",
    baseUrl: "https://bluebirdjets.com/api",
    tokenProvider: {
      environment: "production",
      getVerifiedAccessToken: async () => "clerk-test-token",
    },
    fetcher: async (url, init) => {
      requests.push({
        url,
        method: init.method,
        body: init.body,
        authorization: init.headers?.Authorization ?? init.headers?.authorization,
        credentials: init.credentials,
      });
      if (String(url).endsWith("/trips/42/checklist/confirmed")) {
        return { ok: true, status: 200, json: async () => trip };
      }
      if (String(url).endsWith("/empty-legs/42/winner/decline")) {
        return { ok: true, status: 200, json: async () => emptyLeg };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
  });

  const confirmed = await submitWinnerConfirmation({
    ...openInput().input,
    createClient: () => client,
  });
  assert.equal(confirmed.status, "confirmed");
  const declined = await submitWinnerDecline({
    ...openInput().input,
    createClient: () => client,
  });
  assert.equal(declined.status, "declined");
  assert.deepEqual(requests.map((request) => request.url.replace("https://bluebirdjets.com/api", "")), [
    "/trips/42/checklist/confirmed",
    "/empty-legs/42/winner/decline",
  ]);
  for (const request of requests) {
    assert.equal(request.method, "POST");
    assert.equal(request.body, undefined);
    assert.equal(request.authorization, "Bearer clerk-test-token");
    assert.equal(request.credentials, "omit");
  }

  const unconfirmed = await submitWinnerConfirmation({
    ...openInput().input,
    legId: 43,
    createClient: () => client,
  });
  assert.equal(unconfirmed.status, "failed");
  assert.match(unconfirmed.failure.body, /did not confirm/);
  assert.equal(requests.at(-1).url.endsWith("/trips/43/checklist/confirmed"), true);
});
