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
  canVerifyProductionFbo,
  createAuthenticatedProductionApiClient,
  fboActionBlock,
  submitFboVerification,
} from "../scripts/.fbo-verification.test.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const verifiedAt = "2026-10-29T12:05:00.000Z";

function verifiedTrip(fboVerifiedAt = verifiedAt, id = 42) {
  return {
    leg: { id },
    checklist: { emptyLegId: id, fboVerifiedAt, awarded: true },
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
      verifyTripFbo: async (id) => {
        calls.push(id);
        return verifiedTrip();
      },
    }),
    ...overrides,
  };
  return { input, calls };
}

test("an eligible winner records FBO verification only when the server timestamp is present", async () => {
  const { input, calls } = openInput();
  const result = await submitFboVerification(input);
  assert.equal(result.status, "verified");
  assert.equal(result.trip.checklist.fboVerifiedAt, verifiedAt);
  assert.deepEqual(calls, [42]);
  assert.equal(fboActionBlock({
    isWinner: true,
    checklistAvailable: true,
    fboVerifiedAt: null,
  }), null);
});

test("a non-winner, a missing checklist, and an existing verification send nothing", async () => {
  assert.equal(fboActionBlock({
    isWinner: false,
    checklistAvailable: true,
    fboVerifiedAt: null,
  }), "not-winner");
  assert.equal(fboActionBlock({
    isWinner: true,
    checklistAvailable: false,
    fboVerifiedAt: null,
  }), "checklist-unavailable");
  assert.equal(fboActionBlock({
    isWinner: true,
    checklistAvailable: true,
    fboVerifiedAt: verifiedAt,
  }), "already-verified");
  for (const block of ["not-winner", "checklist-unavailable", "already-verified"]) {
    const { input, calls } = openInput({ block });
    const result = await submitFboVerification(input);
    assert.equal(result.status, "failed");
    assert.match(result.failure.body, /No request was sent/);
    assert.equal(calls.length, 0);
  }
});

test("a closed FBO gate and a missing confirmation do not create a client", async () => {
  const closed = openInput({ gateOpen: canVerifyProductionFbo() });
  assert.equal((await submitFboVerification(closed.input)).status, "disabled");
  assert.equal(closed.calls.length, 0);
  const unconfirmed = openInput({ explicitConfirm: false });
  assert.equal((await submitFboVerification(unconfirmed.input)).status, "needs-confirmation");
  assert.equal(unconfirmed.calls.length, 0);
});

test("a missing leg id fails before a client is created", async () => {
  for (const legId of [0, -1, 1.5, null]) {
    const { input, calls } = openInput({ legId });
    assert.equal((await submitFboVerification(input)).status, "failed");
    assert.equal(calls.length, 0);
  }
});

test("a successful-looking response without fboVerifiedAt or for another leg stays unconfirmed", async () => {
  const missingTime = openInput({
    createClient: () => ({ verifyTripFbo: async () => verifiedTrip(null) }),
  });
  const missing = await submitFboVerification(missingTime.input);
  assert.equal(missing.status, "failed");
  assert.match(missing.failure.body, /did not confirm this FBO verification/);

  const otherLeg = openInput({
    createClient: () => ({ verifyTripFbo: async () => verifiedTrip(verifiedAt, 99) }),
  });
  const mismatched = await submitFboVerification(otherLeg.input);
  assert.equal(mismatched.status, "failed");
  assert.match(mismatched.failure.body, /did not confirm this FBO verification/);
});

test("HTTP 401, HTTP 409, schema mismatch, and network failure do not show success", async () => {
  const unauthorized = openInput({
    createClient: () => ({
      verifyTripFbo: async () => { throw new ProductionAuthHttpError(401, null); },
    }),
  });
  assert.equal((await submitFboVerification(unauthorized.input)).failure.title, "Sign in required");

  const conflict = openInput({
    createClient: () => ({
      verifyTripFbo: async () => { throw new ProductionAuthHttpError(409, null); },
    }),
  });
  const conflictResult = await submitFboVerification(conflict.input);
  assert.equal(conflictResult.status, "failed");
  assert.match(conflictResult.failure.body, /Nothing was changed/);

  const schema = openInput({
    createClient: () => ({
      verifyTripFbo: async () => { throw new ProductionAuthSchemaError("trip.checklist.fboVerifiedAt"); },
    }),
  });
  assert.match((await submitFboVerification(schema.input)).failure.body, /did not confirm this FBO verification/);

  const invalidJson = openInput({
    createClient: () => ({
      verifyTripFbo: async () => { throw new ProductionAuthInvalidJsonError(); },
    }),
  });
  assert.match((await submitFboVerification(invalidJson.input)).failure.body, /did not confirm this FBO verification/);

  const network = openInput({
    createClient: () => ({
      verifyTripFbo: async () => { throw new ProductionAuthNetworkError(); },
    }),
  });
  assert.equal((await submitFboVerification(network.input)).failure.title, "Connection problem");

  const token = openInput({
    createClient: () => ({
      verifyTripFbo: async () => {
        throw new ProductionAuthRequestError("Main API access token is unavailable.", "token");
      },
    }),
  });
  assert.equal((await submitFboVerification(token.input)).failure.title, "Sign in required");
});

test("a second tap does not send a second FBO request", async () => {
  let release = () => {};
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const input = {
    ...openInput().input,
    createClient: () => ({
      verifyTripFbo: async (id) => {
        calls.push(id);
        await gate;
        return verifiedTrip();
      },
    }),
  };
  const first = submitFboVerification(input);
  const second = await submitFboVerification(input);
  assert.equal(second.status, "duplicate");
  assert.match(second.failure.body, /already in progress/);
  release();
  assert.equal((await first).status, "verified");
  assert.deepEqual(calls, [42]);
});

test("sign-out and an account switch do not send or refresh another member", async () => {
  const signedOut = openInput({ signedIn: false });
  assert.equal((await submitFboVerification(signedOut.input)).failure.title, "Sign in required");
  assert.equal(signedOut.calls.length, 0);

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

test("the FBO gate stays closed and the other production gates stay closed", () => {
  const hook = readFileSync(resolve(projectRoot, "lib/useWinnerActions.ts"), "utf8");
  const checklist = readFileSync(resolve(projectRoot, "app/flight/checklist.tsx"), "utf8");
  const winners = readFileSync(resolve(projectRoot, "lib/winnerChecklist.ts"), "utf8");
  const join = readFileSync(resolve(projectRoot, "lib/joinFlightPresentation.ts"), "utf8");
  const passengers = readFileSync(resolve(projectRoot, "lib/passengerManifest.ts"), "utf8");
  const readiness = readFileSync(resolve(projectRoot, "lib/productionQueueReadiness.ts"), "utf8");
  const policy = readFileSync(resolve(projectRoot, "lib/nativeAuthTestPolicy.ts"), "utf8");
  assert.match(hook, /gateOpen: canVerifyProductionFbo\(\)/);
  assert.match(hook, /explicitConfirm: true/);
  assert.match(hook, /sessionRef\.current\?\.userId !== requestedUserId/);
  assert.doesNotMatch(hook, /gateOpen:\s*true/);
  assert.match(checklist, /disabled=\{!canVerifyProductionFbo\(\)\}/);
  assert.match(checklist, /if \(decision\.status !== 'ready'\) return/);
  assert.match(checklist, /FBO_VERIFY_DIALOG/);
  assert.match(checklist, /FBO details are not available for this flight/);
  assert.match(checklist, /FBO verification is not available in this build/);
  assert.doesNotMatch(checklist, /verifyTripFbo|(?<![\w.])fetch\(/);
  assert.match(winners, /export function canVerifyProductionFbo\(\): boolean \{\n  return false;\n\}/);
  assert.match(winners, /export function canConfirmProductionWinner\(\): boolean \{\n  return false;\n\}/);
  assert.match(winners, /export function canDeclineProductionWinner\(\): boolean \{\n  return false;\n\}/);
  assert.match(winners, /export function canAcknowledgeProductionManifest\(\): boolean \{\n  return false;\n\}/);
  assert.match(winners, /export function canAcknowledgeProductionPolicy\(\): boolean \{\n  return false;\n\}/);
  assert.match(winners, /export function canSendProductionBoardingPass\(\): boolean \{\n  return false;\n\}/);
  assert.match(join, /export function canSubmitProductionQueueJoin\(\): boolean \{\n  return isProductionQueueMutationsEnabled\(\);\n\}/);
  assert.match(passengers, /export function canCreateProductionPassenger\(\): boolean \{\n  return false;\n\}/);
  assert.match(passengers, /export function canUpdateProductionPassenger\(\): boolean \{\n  return false;\n\}/);
  assert.match(passengers, /export function canDeleteProductionPassenger\(\): boolean \{\n  return false;\n\}/);
  assert.match(readiness, /deployedMainService: false/);
  assert.doesNotMatch(policy, /checklist\/fboVerified|checklist\/confirmed|winner\/decline/);
});

test("the authenticated client posts the FBO path with a bearer token and no body", async () => {
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
      originFboName: "Naples Jet Center",
      originFboAddress: "1 Aviation Dr",
      destinationFboName: null,
      destinationFboAddress: null,
      queueClosesAt: "2026-10-29T10:00:00.000Z",
    },
    checklist: {
      emptyLegId: 42,
      confirmedAt: verifiedAt,
      fboVerifiedAt: verifiedAt,
      manifestAckAt: null,
      policyAckAt: null,
      passLinkSentAt: null,
      manifestLockedAt: null,
      manifestLocked: false,
      boardingPassUrl: null,
      remainingSteps: ["manifestAck"],
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
      if (String(url).endsWith("/trips/42/checklist/fboVerified")) {
        return { ok: true, status: 200, json: async () => trip };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
  });
  const result = await submitFboVerification({
    ...openInput().input,
    createClient: () => client,
  });
  assert.equal(result.status, "verified");
  assert.equal(requests[0].url, "https://bluebirdjets.com/api/trips/42/checklist/fboVerified");
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].body, undefined);
  assert.equal(requests[0].authorization, "Bearer clerk-test-token");
  assert.equal(requests[0].credentials, "omit");

  const invalid = await submitFboVerification({
    ...openInput().input,
    legId: 43,
    createClient: () => client,
  });
  assert.equal(invalid.status, "failed");
  assert.match(invalid.failure.body, /did not confirm this FBO verification/);
});
