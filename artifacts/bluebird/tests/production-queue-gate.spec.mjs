import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  getProductionQueueReadOnlyMessage,
  getProductionQueueVerificationBlockers,
  isProductionQueueVerified,
  MAIN_SOURCE_QUEUE_EVIDENCE,
} from "../scripts/.production-queue-readiness.test.mjs";

const projectRoot = resolve(import.meta.dirname, "..");

test("Main-source audit facts are distinguished from unresolved runtime gates", () => {
  assert.deepEqual(MAIN_SOURCE_QUEUE_EVIDENCE, {
    perFlightRoutes: true,
    clerkBearerHandling: true,
    clerkUserToMemberMapping: true,
  });
  assert.equal(isProductionQueueVerified(), false);
  assert.deepEqual(getProductionQueueVerificationBlockers(), [
    "deployment of the Main service covered by the source audit is unverified",
    "exact deployed request/response compatibility with the Mobile client is unverified",
    "the selected Main API and Clerk issuer pairing is unverified",
    "live server acceptance and validation of Clerk Bearer tokens is unverified",
    "runtime resolution of the Clerk user to the intended Bluebird member is unverified",
    "the trusted source of an existing Skip the Line credit balance is unverified",
  ]);
});

test("read-only explanation uses concise member-facing copy", () => {
  const message = getProductionQueueReadOnlyMessage();
  assert.equal(message, "Queue is temporarily unavailable. Please try again later.");
  assert.doesNotMatch(message, /Main API|Clerk|JWT|contract|verification/i);
  assert.doesNotMatch(message, /per-flight queue endpoints (?:are )?absent|Main source (?:lacks|does not contain)/i);
});

test("dual gates: mutations drive join/status skip; verification mounts ClerkQueuePanel", () => {
  const joined = readFileSync(resolve(projectRoot, "components/ProductionQueueJoined.tsx"), "utf8");
  const status = readFileSync(resolve(projectRoot, "app/flight/queue-status.tsx"), "utf8");
  const details = readFileSync(resolve(projectRoot, "app/flight/[id].tsx"), "utf8");
  const clerkQueue = readFileSync(resolve(projectRoot, "lib/useClerkQueue.ts"), "utf8");
  const winner = readFileSync(resolve(projectRoot, "app/flight/winner.tsx"), "utf8");

  // Live join success → Queue Status skip uses QUEUE_MUTATIONS, not verification.
  assert.match(joined, /canSubmitProductionQueueJoin\(\)/);
  assert.doesNotMatch(joined, /isProductionQueueVerified/);
  assert.match(status, /mutationsEnabled: canSubmitProductionQueueJoin\(\)/);
  assert.doesNotMatch(status, /isProductionQueueVerified/);

  // Verification only selects ClerkQueuePanel vs Join / View Status path.
  assert.match(details, /if \(isProductionQueueVerified\(\)\)/);
  assert.match(details, /<ClerkQueuePanel/);
  // Confirmed defect until credits are loaded: verified panel hardcodes 0.
  assert.match(details, /existingSkipLineCredits=\{0\}/);

  // ClerkQueuePanel path ignores QUEUE_MUTATIONS (verification-only).
  assert.match(clerkQueue, /isProductionQueueVerified/);
  assert.doesNotMatch(clerkQueue, /canSubmitProductionQueueJoin|isProductionQueueMutationsEnabled/);

  // Winner Continue confirms acceptance via the shared winner actions client.
  assert.match(winner, /winner-review-continue/);
  assert.match(winner, /winnerActions\.confirm|useWinnerActions/);
  assert.match(winner, /reviewWinnerConfirmation/);
  assert.doesNotMatch(winner, /declineEmptyLegWinner/);
  assert.match(winner, /deadlineIso: null/);
});
