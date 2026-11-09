import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";

process.env.EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT = "production";
process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL = "https://bluebirdjets.com/api";
process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY = "pk_live_Y2xlcmsuZXhhbXBsZS5jb20k";

import {
  BOARDING_PASS_SENT,
  ProductionAuthHttpError,
  ProductionAuthInvalidJsonError,
  ProductionAuthNetworkError,
  ProductionAuthRequestError,
  ProductionAuthSchemaError,
  applyWinnerMutationRefresh,
  boardingPassActionBlock,
  canSendProductionBoardingPass,
  createAuthenticatedProductionApiClient,
  presentBoardingPass,
  submitBoardingPassSend,
} from "../scripts/.boarding-pass.test.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const sentAt = "2026-10-29T12:05:00.000Z";
const passUrl = "https://example.com/pass";

function trip(passLinkSentAt = sentAt, id = 42, boardingPassUrl = passUrl) {
  return {
    leg: { id },
    checklist: { emptyLegId: id, passLinkSentAt, boardingPassUrl, awarded: true },
  };
}

function openInput(overrides = {}) {
  const calls = [];
  const input = {
    gateOpen: true,
    legId: 42,
    explicitConfirm: true,
    signedIn: true,
    block: null,
    inFlight: { current: false },
    createClient: () => ({
      sendTripBoardingPass: async (id) => {
        calls.push(id);
        return trip();
      },
    }),
    ...overrides,
  };
  return { input, calls };
}

const ready = {
  checklistAvailable: true,
  awarded: true,
  boardingPassUrl: passUrl,
  passLinkSentAt: null,
};

test("an awarded https boarding pass can be opened and an unsafe link cannot", () => {
  assert.equal(presentBoardingPass({ awarded: true, boardingPassUrl: passUrl }), passUrl);
  assert.equal(presentBoardingPass({ awarded: false, boardingPassUrl: passUrl }), null);
  assert.equal(presentBoardingPass({ awarded: true, boardingPassUrl: null }), null);
  assert.equal(presentBoardingPass({ awarded: true, boardingPassUrl: "http://example.com/pass" }), null);
  assert.equal(presentBoardingPass({ awarded: true, boardingPassUrl: "https://example.com/pass extra" }), null);
  assert.equal(boardingPassActionBlock(ready), null);
  assert.equal(boardingPassActionBlock({ ...ready, boardingPassUrl: "http://example.com/pass" }), "pass-unavailable");
  assert.equal(boardingPassActionBlock({ ...ready, boardingPassUrl: null }), "pass-unavailable");
  assert.equal(boardingPassActionBlock({ ...ready, awarded: false }), "not-awarded");
  assert.equal(boardingPassActionBlock({ ...ready, checklistAvailable: false }), "checklist-unavailable");
  assert.equal(boardingPassActionBlock({ ...ready, passLinkSentAt: sentAt }), "already-sent");
});

test("an eligible send is recorded only when passLinkSentAt is present", async () => {
  const { input, calls } = openInput();
  const result = await submitBoardingPassSend(input);
  assert.equal(result.status, "pass-recorded");
  assert.equal(result.trip.checklist.passLinkSentAt, sentAt);
  assert.match(BOARDING_PASS_SENT, /Delivery is not confirmed/);
  assert.doesNotMatch(BOARDING_PASS_SENT, /SMS|email|delivered/i);
  assert.deepEqual(calls, [42]);
});

test("an ineligible send and a missing confirmation do not create a client", async () => {
  for (const block of ["checklist-unavailable", "not-awarded", "pass-unavailable", "already-sent"]) {
    const { input, calls } = openInput({ block });
    const result = await submitBoardingPassSend(input);
    assert.equal(result.status, "failed");
    assert.match(result.failure.body, /No (request|second request) was sent/);
    assert.equal(calls.length, 0);
  }
  const unconfirmed = openInput({ explicitConfirm: false });
  assert.equal((await submitBoardingPassSend(unconfirmed.input)).status, "needs-confirmation");
  assert.equal(unconfirmed.calls.length, 0);
  const closed = openInput({ gateOpen: false });
  assert.equal((await submitBoardingPassSend(closed.input)).status, "disabled");
  assert.equal(closed.calls.length, 0);
  assert.equal(canSendProductionBoardingPass(), true);
  for (const legId of [0, -1, null]) {
    const { input, calls } = openInput({ legId });
    assert.equal((await submitBoardingPassSend(input)).status, "failed");
    assert.equal(calls.length, 0);
  }
});

test("a response without passLinkSentAt, for another trip, or with the wrong shape stays unconfirmed", async () => {
  const missingTime = openInput({
    createClient: () => ({ sendTripBoardingPass: async () => trip(null) }),
  });
  assert.match((await submitBoardingPassSend(missingTime.input)).failure.body, /did not confirm that the boarding pass link was sent/);

  const otherTrip = openInput({
    createClient: () => ({ sendTripBoardingPass: async () => trip(sentAt, 99) }),
  });
  assert.match((await submitBoardingPassSend(otherTrip.input)).failure.body, /did not confirm that the boarding pass link was sent/);

  const schema = openInput({
    createClient: () => ({
      sendTripBoardingPass: async () => { throw new ProductionAuthSchemaError("trip.checklist.passLinkSentAt"); },
    }),
  });
  assert.match((await submitBoardingPassSend(schema.input)).failure.body, /did not confirm that the boarding pass link was sent/);

  const invalidJson = openInput({
    createClient: () => ({
      sendTripBoardingPass: async () => { throw new ProductionAuthInvalidJsonError(); },
    }),
  });
  assert.match((await submitBoardingPassSend(invalidJson.input)).failure.body, /did not confirm that the boarding pass link was sent/);
});

test("HTTP 401, HTTP 403, HTTP 409, network failure, and sign-out do not show success", async () => {
  async function fail(error) {
    const { input } = openInput({
      createClient: () => ({ sendTripBoardingPass: async () => { throw error; } }),
    });
    return submitBoardingPassSend(input);
  }
  assert.equal((await fail(new ProductionAuthHttpError(401, null))).failure.title, "Sign in required");
  assert.equal((await fail(new ProductionAuthHttpError(403, null))).failure.title, "Not available");
  assert.match((await fail(new ProductionAuthHttpError(409, null))).failure.body, /Nothing was changed/);
  assert.equal((await fail(new ProductionAuthNetworkError())).failure.title, "Connection problem");
  assert.equal((await fail(new ProductionAuthRequestError("Main API access token is unavailable.", "token"))).failure.title, "Sign in required");
  const signedOut = openInput({ signedIn: false });
  assert.equal((await submitBoardingPassSend(signedOut.input)).failure.title, "Sign in required");
  assert.equal(signedOut.calls.length, 0);
});

test("a second tap does not send a second boarding pass", async () => {
  let release = () => {};
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const input = {
    ...openInput().input,
    createClient: () => ({
      sendTripBoardingPass: async (id) => {
        calls.push(id);
        await gate;
        return trip();
      },
    }),
  };
  const first = submitBoardingPassSend(input);
  const second = await submitBoardingPassSend(input);
  assert.equal(second.status, "duplicate");
  release();
  assert.equal((await first).status, "pass-recorded");
  assert.deepEqual(calls, [42]);
});

test("an account switch or sign-out does not refresh another member", () => {
  const seen = [];
  assert.equal(applyWinnerMutationRefresh({
    gateOpen: true,
    requestedUserId: "user-a",
    activeUserId: "user-b",
    signedIn: true,
    environment: "production",
    legId: 42,
    invalidate: (key) => seen.push(key),
  }), false);
  assert.equal(applyWinnerMutationRefresh({
    gateOpen: true,
    requestedUserId: "user-a",
    activeUserId: null,
    signedIn: false,
    environment: "production",
    legId: 42,
    invalidate: (key) => seen.push(key),
  }), false);
  assert.equal(seen.length, 0);
});

test("the boarding pass send uses the existing endpoint and the trips card does not send by itself", () => {
  const hook = readFileSync(resolve(projectRoot, "lib/useWinnerActions.ts"), "utf8");
  const checklist = readFileSync(resolve(projectRoot, "app/flight/checklist.tsx"), "utf8");
  const winners = readFileSync(resolve(projectRoot, "lib/winnerChecklist.ts"), "utf8");
  const trips = readFileSync(resolve(projectRoot, "components/ClerkTrips.tsx"), "utf8");
  const notice = readFileSync(resolve(projectRoot, "components/WinnerFlightNotice.tsx"), "utf8");
  const authPolicy = readFileSync(resolve(projectRoot, "lib/nativeAuthTestPolicy.ts"), "utf8");
  assert.match(hook, /gateOpen: canSendProductionBoardingPass\(\)/);
  assert.match(hook, /explicitConfirm: true/);
  assert.match(hook, /legRef\.current !== requestedLegId/);
  assert.match(hook, /sessionRef\.current\?\.userId !== requestedUserId/);
  assert.doesNotMatch(hook, /gateOpen:\s*true/);
  assert.match(checklist, /disabled=\{!canSendProductionBoardingPass\(\)\}/);
  assert.match(checklist, /BOARDING_PASS_SEND_DIALOG/);
  assert.match(checklist, /presentBoardingPass/);
  assert.match(checklist, /Linking\.openURL\(boardingPassUrl\)/);
  assert.match(checklist, /checklist-boarding-pass-missing/);
  assert.doesNotMatch(checklist, /reviewBoardingPassSend|boarding-pass\/send|sendTripBoardingPass/);
  assert.doesNotMatch(trips, /Send Boarding Pass|View Boarding Pass|sendTripBoardingPass\(/);
  assert.match(notice, /checklistFullyComplete/);
  assert.match(notice, /flight-send-boarding-pass/);
  assert.match(notice, /flight-view-boarding-pass/);
  assert.match(notice, /Alert\.alert/);
  assert.match(notice, /router\.push\(detailsTarget\)|pathname: '\/flight\/checklist'/);
  assert.doesNotMatch(notice, /sendTripBoardingPass\(/);
  assert.match(winners, /export function canSendProductionBoardingPass\(\): boolean \{\n  return true;\n\}/);
  assert.match(winners, /export function canConfirmProductionWinner\(\): boolean \{\n  return true;\n\}/);
  assert.match(winners, /export function canDeclineProductionWinner\(\): boolean \{\n  return true;\n\}/);
  assert.match(winners, /export function canVerifyProductionFbo\(\): boolean \{\n  return true;\n\}/);
  assert.match(winners, /export function canAcknowledgeProductionManifest\(\): boolean \{\n  return true;\n\}/);
  assert.match(winners, /export function canAcknowledgeProductionPolicy\(\): boolean \{\n  return true;\n\}/);
  assert.doesNotMatch(authPolicy, /boarding-pass\/send|checklist\/policyAck|winner\/decline/);
});

test("the authenticated client posts the boarding pass path with a bearer token and no body", async () => {
  const requests = [];
  const body = {
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
      queueClosesAt: "2026-10-29T10:00:00.000Z",
    },
    checklist: {
      emptyLegId: 42,
      confirmedAt: sentAt,
      fboVerifiedAt: null,
      manifestAckAt: null,
      policyAckAt: null,
      passLinkSentAt: sentAt,
      manifestLockedAt: null,
      manifestLocked: false,
      boardingPassUrl: passUrl,
      remainingSteps: [],
      passengerCount: 1,
      awarded: true,
    },
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
        url: String(url),
        method: init.method,
        body: init.body,
        authorization: init.headers?.Authorization,
        credentials: init.credentials,
      });
      if (String(url).endsWith("/trips/42/boarding-pass/send")) {
        return { ok: true, status: 200, json: async () => body };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
  });
  const result = await submitBoardingPassSend({
    ...openInput().input,
    createClient: () => client,
  });
  assert.equal(result.status, "pass-recorded");
  assert.equal(requests[0].url, "https://bluebirdjets.com/api/trips/42/boarding-pass/send");
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].body, undefined);
  assert.equal(requests[0].authorization, "Bearer clerk-test-token");
  assert.equal(requests[0].credentials, "omit");
  const invalid = await submitBoardingPassSend({
    ...openInput().input,
    legId: 43,
    createClient: () => client,
  });
  assert.equal(invalid.status, "failed");
  assert.match(invalid.failure.body, /did not confirm that the boarding pass link was sent/);
});
