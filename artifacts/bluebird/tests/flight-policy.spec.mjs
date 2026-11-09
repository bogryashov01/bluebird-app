import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";
import {
  ACTIVE_FLIGHT_POLICY_PATH,
  POLICY_SCROLL_END_PX,
  createPolicyReadState,
  measurePolicyScroll,
  parseActiveFlightPolicy,
  policyAgreementScopeKey,
  presentFlightPolicyFailure,
  syncPolicyReadState,
  togglePolicyAgreement,
} from "../scripts/.flight-policy.test.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const document = {
  kind: "flight_policy",
  versionId: 123,
  versionLabel: "v1.0",
  body: "Full policy text\n\nSecond paragraph",
  publishedAt: "2026-06-15T12:00:00.000Z",
};

function scope(overrides = {}) {
  return policyAgreementScopeKey({
    clerkUserId: "user-a",
    legId: 42,
    versionId: 123,
    body: document.body,
    ...overrides,
  });
}

test("the active flight policy uses the public document endpoint", () => {
  assert.equal(ACTIVE_FLIGHT_POLICY_PATH, "/tos/active/flight_policy");
  assert.equal(POLICY_SCROLL_END_PX, 4);
  const library = readFileSync(resolve(projectRoot, "lib/flightPolicy.ts"), "utf8");
  assert.match(library, /fetchProductionJson\(ACTIVE_FLIGHT_POLICY_PATH/);
  assert.doesNotMatch(library, /accessToken/);
  const screen = readFileSync(resolve(projectRoot, "app/flight/policy-review.tsx"), "utf8");
  assert.match(screen, /fetchActiveFlightPolicy\(\{ signal \}\)/);
  assert.doesNotMatch(screen, /POLICY_SECTIONS|AsyncStorage|console\.log/);
});

test("a complete policy response parses and incomplete documents are rejected", () => {
  const parsed = parseActiveFlightPolicy(document);
  assert.equal(parsed.versionId, 123);
  assert.equal(parsed.versionLabel, "v1.0");
  assert.equal(parsed.body, document.body);
  assert.equal(parsed.publishedAt, document.publishedAt);
  assert.throws(() => parseActiveFlightPolicy({ ...document, body: "" }), TypeError);
  assert.throws(() => parseActiveFlightPolicy({ ...document, body: "   \n" }), TypeError);
  assert.throws(() => parseActiveFlightPolicy({ ...document, versionLabel: "" }), TypeError);
  assert.throws(() => parseActiveFlightPolicy({ ...document, versionId: 0 }), TypeError);
  assert.throws(() => parseActiveFlightPolicy({ ...document, kind: "terms" }), TypeError);
  assert.throws(() => parseActiveFlightPolicy({ ...document, publishedAt: "not-a-date" }), TypeError);
  const { body: _body, ...missingBody } = document;
  assert.throws(() => parseActiveFlightPolicy(missingBody), TypeError);
  assert.equal(presentFlightPolicyFailure("missing").title, "Flight policy unavailable");
  assert.equal(presentFlightPolicyFailure("invalid").body.includes("could not be shown"), true);
  assert.doesNotMatch(presentFlightPolicyFailure("network").body, /token|Full policy/);
});

test("scroll completion uses a four pixel threshold and waits for layout", () => {
  assert.equal(measurePolicyScroll({ viewportHeight: null, contentHeight: 400, offsetY: 0 }), false);
  assert.equal(measurePolicyScroll({ viewportHeight: 0, contentHeight: 400, offsetY: 0 }), false);
  assert.equal(measurePolicyScroll({ viewportHeight: 200, contentHeight: 0, offsetY: 0 }), false);
  assert.equal(measurePolicyScroll({ viewportHeight: 200, contentHeight: 500, offsetY: 0 }), false);
  assert.equal(measurePolicyScroll({ viewportHeight: 200, contentHeight: 500, offsetY: 295 }), false);
  assert.equal(measurePolicyScroll({ viewportHeight: 200, contentHeight: 500, offsetY: 296 }), true);
  assert.equal(measurePolicyScroll({ viewportHeight: 400, contentHeight: 100, offsetY: null }), true);
});

test("agreement starts unchecked, requires a tap, and resets with version, account, trip, or a failed document", () => {
  const initial = createPolicyReadState();
  assert.equal(initial.checked, false);
  const key = scope();
  const reached = syncPolicyReadState(initial, key, true);
  assert.equal(reached.checked, false);
  assert.equal(togglePolicyAgreement(reached, false, true).checked, false);
  assert.equal(togglePolicyAgreement(reached, true, false).checked, false);
  const agreed = togglePolicyAgreement(reached, true, true);
  assert.equal(agreed.checked, true);
  assert.equal(syncPolicyReadState(agreed, scope({ versionId: 124 }), true).checked, false);
  assert.equal(syncPolicyReadState(agreed, scope({ clerkUserId: "user-b" }), true).checked, false);
  assert.equal(syncPolicyReadState(agreed, scope({ legId: 43 }), true).checked, false);
  assert.equal(syncPolicyReadState(agreed, scope({ body: "A different policy" }), true).checked, false);
  const failed = syncPolicyReadState(agreed, null, true);
  assert.equal(failed.checked, false);
  assert.equal(togglePolicyAgreement(failed, true, true).checked, false);
  assert.equal(scope({ body: "   " }), null);
});

test("policy acknowledgement stays disabled and checklist completion uses the server timestamp", () => {
  const screen = readFileSync(resolve(projectRoot, "app/flight/policy-review.tsx"), "utf8");
  const checklist = readFileSync(resolve(projectRoot, "app/flight/checklist.tsx"), "utf8");
  const winner = readFileSync(resolve(projectRoot, "lib/winnerChecklist.ts"), "utf8");
  const details = readFileSync(resolve(projectRoot, "app/flight/[id].tsx"), "utf8");
  assert.match(winner, /export function canAcknowledgeProductionPolicy\(\): boolean \{\n  return true;\n\}/);
  assert.match(screen, /disabled=\{!canAcknowledgeProductionPolicy\(\)\}/);
  assert.match(screen, /if \(decision\.status !== 'ready'\) return/);
  assert.doesNotMatch(screen, /policyAckAt\s*=|addEmptyLegPassenger|joinEmptyLegQueue/);
  assert.match(checklist, /pathname: '\/flight\/policy-review'/);
  assert.match(checklist, /disabled=\{!canAcknowledgeProductionPolicy\(\)\}/);
  assert.match(winner, /complete: hasTimestamp\(checklist\.policyAckAt\)/);
  assert.doesNotMatch(details, /fetchActiveFlightPolicy|\/tos\/active\/flight_policy/);
  assert.match(screen, /enabled: !!configuration && !authTest/);
  assert.match(screen, /The flight policy cannot be loaded in this build/);
  assert.match(screen, /retry: false/);
  assert.match(screen, /refetchInterval: false/);
  assert.match(screen, /refetchOnWindowFocus: false/);
  assert.match(screen, /refetchOnReconnect: false/);
});
