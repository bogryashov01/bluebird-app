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
  canAcknowledgeProductionPolicy,
  createAuthenticatedProductionApiClient,
  policyActionBlock,
  submitPolicyAcknowledgement,
} from "../scripts/.policy-acknowledgement.test.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const acknowledgedAt = "2026-10-29T12:05:00.000Z";

function trip(policyAckAt = acknowledgedAt, id = 42) {
  return {
    leg: { id },
    checklist: { emptyLegId: id, policyAckAt, awarded: true },
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
      acknowledgeTripPolicy: async (id) => {
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
  policyAvailable: true,
  scrollComplete: true,
  consentChecked: true,
  policyAckAt: null,
};

test("a reviewed policy is acknowledged only when policyAckAt is present", async () => {
  assert.equal(policyActionBlock(ready), null);
  const { input, calls } = openInput();
  const result = await submitPolicyAcknowledgement(input);
  assert.equal(result.status, "policy-acknowledged");
  assert.equal(result.trip.checklist.policyAckAt, acknowledgedAt);
  assert.deepEqual(calls, [42]);
});

test("an unread, unavailable, or ineligible policy sends nothing", async () => {
  assert.equal(policyActionBlock({ ...ready, policyAvailable: false }), "policy-unavailable");
  assert.equal(policyActionBlock({ ...ready, scrollComplete: false }), "scroll-incomplete");
  assert.equal(policyActionBlock({ ...ready, consentChecked: false }), "consent-required");
  assert.equal(policyActionBlock({ ...ready, consentChecked: true, scrollComplete: true }), null);
  assert.equal(policyActionBlock({ ...ready, isWinner: false }), "not-winner");
  assert.equal(policyActionBlock({ ...ready, checklistAvailable: false }), "checklist-unavailable");
  assert.equal(policyActionBlock({ ...ready, policyAckAt: acknowledgedAt }), "already-acknowledged");
  for (const block of [
    "policy-unavailable",
    "scroll-incomplete",
    "consent-required",
    "not-winner",
    "checklist-unavailable",
    "already-acknowledged",
  ]) {
    const { input, calls } = openInput({ block, explicitConfirm: block !== "consent-required" });
    const result = await submitPolicyAcknowledgement(input);
    assert.equal(result.status, "failed");
    assert.match(result.failure.body, /No request was sent/);
    assert.equal(calls.length, 0);
  }
  const unchecked = openInput({ explicitConfirm: false });
  assert.equal((await submitPolicyAcknowledgement(unchecked.input)).status, "needs-confirmation");
  assert.equal(unchecked.calls.length, 0);
});

test("a closed gate and a missing leg id do not create a client", async () => {
  const closed = openInput({ gateOpen: canAcknowledgeProductionPolicy() });
  assert.equal((await submitPolicyAcknowledgement(closed.input)).status, "disabled");
  assert.equal(closed.calls.length, 0);
  for (const legId of [0, -1, null]) {
    const { input, calls } = openInput({ legId });
    assert.equal((await submitPolicyAcknowledgement(input)).status, "failed");
    assert.equal(calls.length, 0);
  }
});

test("a response without policyAckAt, for another trip, or with the wrong shape stays unconfirmed", async () => {
  const missingTime = openInput({
    createClient: () => ({ acknowledgeTripPolicy: async () => trip(null) }),
  });
  assert.match((await submitPolicyAcknowledgement(missingTime.input)).failure.body, /did not confirm this flight policy acknowledgement/);

  const otherTrip = openInput({
    createClient: () => ({ acknowledgeTripPolicy: async () => trip(acknowledgedAt, 99) }),
  });
  assert.match((await submitPolicyAcknowledgement(otherTrip.input)).failure.body, /did not confirm this flight policy acknowledgement/);

  const schema = openInput({
    createClient: () => ({
      acknowledgeTripPolicy: async () => { throw new ProductionAuthSchemaError("trip.checklist.policyAckAt"); },
    }),
  });
  assert.match((await submitPolicyAcknowledgement(schema.input)).failure.body, /did not confirm this flight policy acknowledgement/);

  const invalidJson = openInput({
    createClient: () => ({
      acknowledgeTripPolicy: async () => { throw new ProductionAuthInvalidJsonError(); },
    }),
  });
  assert.match((await submitPolicyAcknowledgement(invalidJson.input)).failure.body, /did not confirm this flight policy acknowledgement/);
});

test("HTTP 401, HTTP 403, HTTP 409, network failure, and sign-out do not show success", async () => {
  async function fail(error) {
    const { input } = openInput({
      createClient: () => ({ acknowledgeTripPolicy: async () => { throw error; } }),
    });
    return submitPolicyAcknowledgement(input);
  }
  assert.equal((await fail(new ProductionAuthHttpError(401, null))).failure.title, "Sign in required");
  assert.equal((await fail(new ProductionAuthHttpError(403, null))).failure.title, "Not available");
  assert.match((await fail(new ProductionAuthHttpError(409, null))).failure.body, /Nothing was changed/);
  assert.equal((await fail(new ProductionAuthNetworkError())).failure.title, "Connection problem");
  assert.equal((await fail(new ProductionAuthRequestError("Main API access token is unavailable.", "token"))).failure.title, "Sign in required");
  const signedOut = openInput({ signedIn: false });
  assert.equal((await submitPolicyAcknowledgement(signedOut.input)).failure.title, "Sign in required");
  assert.equal(signedOut.calls.length, 0);
});

test("a second tap does not send a second acknowledgement", async () => {
  let release = () => {};
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const input = {
    ...openInput().input,
    createClient: () => ({
      acknowledgeTripPolicy: async (id) => {
        calls.push(id);
        await gate;
        return trip();
      },
    }),
  };
  const first = submitPolicyAcknowledgement(input);
  const second = await submitPolicyAcknowledgement(input);
  assert.equal(second.status, "duplicate");
  release();
  assert.equal((await first).status, "policy-acknowledged");
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

test("consent resets with the reviewed policy and the gate stays closed", () => {
  const screen = readFileSync(resolve(projectRoot, "app/flight/policy-review.tsx"), "utf8");
  const hook = readFileSync(resolve(projectRoot, "lib/useWinnerActions.ts"), "utf8");
  const checklist = readFileSync(resolve(projectRoot, "app/flight/checklist.tsx"), "utf8");
  const winners = readFileSync(resolve(projectRoot, "lib/winnerChecklist.ts"), "utf8");
  const library = readFileSync(resolve(projectRoot, "lib/flightPolicy.ts"), "utf8");
  const authPolicy = readFileSync(resolve(projectRoot, "lib/nativeAuthTestPolicy.ts"), "utf8");
  assert.match(screen, /fetchActiveFlightPolicy\(\{ signal \}\)/);
  assert.match(screen, /policy\.body/);
  assert.match(screen, /policyAgreementScopeKey\(\{/);
  assert.match(screen, /versionId: policy\.versionId/);
  assert.match(screen, /body: policy\.body/);
  assert.match(screen, /syncPolicyReadState\(stored, scopeKey, scrollComplete\)/);
  assert.match(screen, /togglePolicyAgreement\(read, true, scrollComplete\)/);
  assert.match(screen, /disabled=\{!canAcknowledgeProductionPolicy\(\)\}/);
  assert.match(screen, /if \(decision\.status !== 'ready'\) return/);
  assert.match(screen, /loading=\{winnerActions\.policySubmitting\}/);
  assert.match(screen, /flight-policy-back/);
  assert.doesNotMatch(screen, /policyAckAt\s*=|acknowledgeTripPolicy|(?<![\w.])fetch\(/);
  assert.match(hook, /gateOpen: canAcknowledgeProductionPolicy\(\)/);
  assert.match(hook, /explicitConfirm: consent === true/);
  assert.match(hook, /reviewScope\.current !== requestedScope/);
  assert.match(hook, /legRef\.current !== requestedLegId/);
  assert.match(hook, /\[clerkUserId\]/);
  assert.match(hook, /\[legId\]/);
  assert.doesNotMatch(hook, /gateOpen:\s*true/);
  assert.match(checklist, /pathname: '\/flight\/policy-review'/);
  assert.match(checklist, /disabled=\{!canAcknowledgeProductionPolicy\(\)\}/);
  assert.doesNotMatch(checklist, /acknowledgeTripPolicy/);
  assert.match(winners, /export function canAcknowledgeProductionPolicy\(\): boolean \{\n  return false;\n\}/);
  assert.match(winners, /export function canConfirmProductionWinner\(\): boolean \{\n  return false;\n\}/);
  assert.match(winners, /export function canDeclineProductionWinner\(\): boolean \{\n  return false;\n\}/);
  assert.match(winners, /export function canVerifyProductionFbo\(\): boolean \{\n  return false;\n\}/);
  assert.match(winners, /export function canAcknowledgeProductionManifest\(\): boolean \{\n  return false;\n\}/);
  assert.match(winners, /export function canSendProductionBoardingPass\(\): boolean \{\n  return false;\n\}/);
  assert.match(library, /versionId/);
  assert.match(library, /\$\{userId\}\|\$\{input\.legId\}\|\$\{input\.versionId\}\|\$\{input\.body\}/);
  assert.doesNotMatch(authPolicy, /checklist\/policyAck|checklist\/manifestAck|winner\/decline/);
});

test("the authenticated client posts the policy path with a bearer token and no body", async () => {
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
      manifestAckAt: null,
      policyAckAt: acknowledgedAt,
      passLinkSentAt: null,
      manifestLockedAt: null,
      manifestLocked: false,
      boardingPassUrl: null,
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
      if (String(url).endsWith("/trips/42/checklist/policyAck")) {
        return { ok: true, status: 200, json: async () => body };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
  });
  const result = await submitPolicyAcknowledgement({
    ...openInput().input,
    createClient: () => client,
  });
  assert.equal(result.status, "policy-acknowledged");
  assert.equal(requests[0].url, "https://bluebirdjets.com/api/trips/42/checklist/policyAck");
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].body, undefined);
  assert.equal(requests[0].authorization, "Bearer clerk-test-token");
  assert.equal(requests[0].credentials, "omit");
  assert.equal(JSON.stringify(requests[0]).includes("versionId"), false);
  const invalid = await submitPolicyAcknowledgement({
    ...openInput().input,
    legId: 43,
    createClient: () => client,
  });
  assert.equal(invalid.status, "failed");
  assert.match(invalid.failure.body, /did not confirm this flight policy acknowledgement/);
});
