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
  canAcknowledgeProductionManifest,
  createAuthenticatedProductionApiClient,
  manifestActionBlock,
  submitManifestAcknowledgement,
} from "../scripts/.manifest-acknowledgement.test.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const acknowledgedAt = "2026-10-29T12:05:00.000Z";

function trip(manifestAckAt = acknowledgedAt, id = 42, manifestLocked = false) {
  return {
    leg: { id },
    checklist: { emptyLegId: id, manifestAckAt, manifestLocked, awarded: true },
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
      acknowledgeTripManifest: async (id) => {
        calls.push(id);
        return trip();
      },
    }),
    ...overrides,
  };
  return { input, calls };
}

const ready = {
  isWinner: true,
  checklistAvailable: true,
  manifestAvailable: true,
  manifestAckAt: null,
  manifestLocked: false,
};

test("an eligible checklist records acknowledgement only when manifestAckAt is present", async () => {
  assert.equal(manifestActionBlock(ready), null);
  const { input, calls } = openInput();
  const result = await submitManifestAcknowledgement(input);
  assert.equal(result.status, "acknowledged");
  assert.equal(result.trip.checklist.manifestAckAt, acknowledgedAt);
  assert.deepEqual(calls, [42]);
});

test("a non-winner, a missing checklist, a missing manifest, an existing acknowledgement, and a lock send nothing", async () => {
  assert.equal(manifestActionBlock({ ...ready, isWinner: false }), "not-winner");
  assert.equal(manifestActionBlock({ ...ready, checklistAvailable: false }), "checklist-unavailable");
  assert.equal(manifestActionBlock({ ...ready, manifestAvailable: false }), "manifest-unavailable");
  assert.equal(manifestActionBlock({ ...ready, manifestAckAt: acknowledgedAt }), "already-acknowledged");
  assert.equal(manifestActionBlock({ ...ready, manifestLocked: true }), "manifest-locked");
  for (const block of [
    "not-winner",
    "checklist-unavailable",
    "manifest-unavailable",
    "already-acknowledged",
    "manifest-locked",
  ]) {
    const { input, calls } = openInput({ block });
    const result = await submitManifestAcknowledgement(input);
    assert.equal(result.status, "failed");
    assert.match(result.failure.body, /No request was sent/);
    assert.equal(calls.length, 0);
  }
});

test("a closed gate, a missing confirmation, and a missing leg id do not create a client", async () => {
  const closed = openInput({ gateOpen: canAcknowledgeProductionManifest() });
  assert.equal((await submitManifestAcknowledgement(closed.input)).status, "disabled");
  assert.equal(closed.calls.length, 0);
  const unconfirmed = openInput({ explicitConfirm: false });
  assert.equal((await submitManifestAcknowledgement(unconfirmed.input)).status, "needs-confirmation");
  assert.equal(unconfirmed.calls.length, 0);
  for (const legId of [0, -1, null]) {
    const { input, calls } = openInput({ legId });
    assert.equal((await submitManifestAcknowledgement(input)).status, "failed");
    assert.equal(calls.length, 0);
  }
});

test("a response without manifestAckAt, for another trip, or with the wrong shape stays unconfirmed", async () => {
  const missingTime = openInput({
    createClient: () => ({ acknowledgeTripManifest: async () => trip(null) }),
  });
  assert.match((await submitManifestAcknowledgement(missingTime.input)).failure.body, /did not confirm this passenger acknowledgement/);

  const otherTrip = openInput({
    createClient: () => ({ acknowledgeTripManifest: async () => trip(acknowledgedAt, 99) }),
  });
  assert.match((await submitManifestAcknowledgement(otherTrip.input)).failure.body, /did not confirm this passenger acknowledgement/);

  const schema = openInput({
    createClient: () => ({
      acknowledgeTripManifest: async () => { throw new ProductionAuthSchemaError("trip.checklist.manifestAckAt"); },
    }),
  });
  assert.match((await submitManifestAcknowledgement(schema.input)).failure.body, /did not confirm this passenger acknowledgement/);

  const invalidJson = openInput({
    createClient: () => ({
      acknowledgeTripManifest: async () => { throw new ProductionAuthInvalidJsonError(); },
    }),
  });
  assert.match((await submitManifestAcknowledgement(invalidJson.input)).failure.body, /did not confirm this passenger acknowledgement/);
});

test("HTTP 401, HTTP 403, HTTP 409, network failure, and sign-out do not show success", async () => {
  async function fail(error) {
    const { input } = openInput({
      createClient: () => ({ acknowledgeTripManifest: async () => { throw error; } }),
    });
    return submitManifestAcknowledgement(input);
  }
  assert.equal((await fail(new ProductionAuthHttpError(401, null))).failure.title, "Sign in required");
  assert.equal((await fail(new ProductionAuthHttpError(403, null))).failure.title, "Not available");
  assert.match((await fail(new ProductionAuthHttpError(409, null))).failure.body, /Nothing was changed/);
  assert.equal((await fail(new ProductionAuthNetworkError())).failure.title, "Connection problem");
  assert.equal((await fail(new ProductionAuthRequestError("Main API access token is unavailable.", "token"))).failure.title, "Sign in required");
  const signedOut = openInput({ signedIn: false });
  assert.equal((await submitManifestAcknowledgement(signedOut.input)).failure.title, "Sign in required");
  assert.equal(signedOut.calls.length, 0);
});

test("a second tap does not send a second acknowledgement", async () => {
  let release = () => {};
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const input = {
    ...openInput().input,
    createClient: () => ({
      acknowledgeTripManifest: async (id) => {
        calls.push(id);
        await gate;
        return trip();
      },
    }),
  };
  const first = submitManifestAcknowledgement(input);
  const second = await submitManifestAcknowledgement(input);
  assert.equal(second.status, "duplicate");
  release();
  assert.equal((await first).status, "acknowledged");
  assert.deepEqual(calls, [42]);
});

test("an account switch does not refresh another member", () => {
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

test("the acknowledgement gate stays closed and passenger saves do not acknowledge the manifest", () => {
  const hook = readFileSync(resolve(projectRoot, "lib/useWinnerActions.ts"), "utf8");
  const passengers = readFileSync(resolve(projectRoot, "lib/passengerMutations.ts"), "utf8");
  const checklist = readFileSync(resolve(projectRoot, "app/flight/checklist.tsx"), "utf8");
  const winners = readFileSync(resolve(projectRoot, "lib/winnerChecklist.ts"), "utf8");
  const policy = readFileSync(resolve(projectRoot, "lib/nativeAuthTestPolicy.ts"), "utf8");
  assert.match(hook, /gateOpen: canAcknowledgeProductionManifest\(\)/);
  assert.match(hook, /explicitConfirm: true/);
  assert.match(hook, /sessionRef\.current\?\.userId !== requestedUserId/);
  assert.doesNotMatch(hook, /gateOpen:\s*true/);
  assert.doesNotMatch(passengers, /acknowledgeTripManifest|checklist\/manifestAck/);
  assert.match(checklist, /disabled=\{!canAcknowledgeProductionManifest\(\)\}/);
  assert.match(checklist, /if \(decision\.status !== 'ready'\) return/);
  assert.match(checklist, /MANIFEST_ACK_DIALOG/);
  assert.match(checklist, /Passenger acknowledgement is not available in this build/);
  assert.match(checklist, /pathname: '\/flight\/passengers'/);
  assert.doesNotMatch(checklist, /acknowledgeTripManifest|getEmptyLegPassengers/);
  assert.match(winners, /export function canAcknowledgeProductionManifest\(\): boolean \{\n  return false;\n\}/);
  assert.match(winners, /export function canVerifyProductionFbo\(\): boolean \{\n  return false;\n\}/);
  assert.match(winners, /export function canConfirmProductionWinner\(\): boolean \{\n  return false;\n\}/);
  assert.match(winners, /export function canDeclineProductionWinner\(\): boolean \{\n  return false;\n\}/);
  assert.match(winners, /export function canAcknowledgeProductionPolicy\(\): boolean \{\n  return false;\n\}/);
  assert.match(winners, /export function canSendProductionBoardingPass\(\): boolean \{\n  return false;\n\}/);
  assert.doesNotMatch(policy, /checklist\/manifestAck|checklist\/fboVerified|winner\/decline/);
});

test("the authenticated client posts the manifest path with a bearer token and no body", async () => {
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
      confirmedAt: acknowledgedAt,
      fboVerifiedAt: null,
      manifestAckAt: acknowledgedAt,
      policyAckAt: null,
      passLinkSentAt: null,
      manifestLockedAt: acknowledgedAt,
      manifestLocked: true,
      boardingPassUrl: null,
      remainingSteps: ["policyAck"],
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
      if (String(url).endsWith("/trips/42/checklist/manifestAck")) {
        return { ok: true, status: 200, json: async () => body };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
  });
  const result = await submitManifestAcknowledgement({
    ...openInput().input,
    createClient: () => client,
  });
  assert.equal(result.status, "acknowledged");
  assert.equal(result.trip.checklist.manifestLocked, true);
  assert.equal(requests[0].url, "https://bluebirdjets.com/api/trips/42/checklist/manifestAck");
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].body, undefined);
  assert.equal(requests[0].authorization, "Bearer clerk-test-token");
  assert.equal(requests[0].credentials, "omit");
  const invalid = await submitManifestAcknowledgement({
    ...openInput().input,
    legId: 43,
    createClient: () => client,
  });
  assert.equal(invalid.status, "failed");
  assert.match(invalid.failure.body, /did not confirm this passenger acknowledgement/);
});
