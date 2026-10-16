import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getProductionQueueReadOnlyMessage,
  getProductionQueueVerificationBlockers,
  isProductionQueueVerified,
} from "../scripts/.production-queue-readiness.test.mjs";

test("queue integration stays fail-closed until every API, Clerk, identity, and credit prerequisite is verified", () => {
  assert.equal(isProductionQueueVerified(), false);
  assert.deepEqual(getProductionQueueVerificationBlockers(), [
    "the API owner has not verified the deployed per-flight queue endpoints and exact request/response contract",
    "the selected Main API and Clerk issuer pairing is unverified",
    "server-side Clerk token validation is unverified",
    "stable Clerk-to-Bluebird-member identity mapping is unverified",
    "the trusted source of an existing Skip the Line credit balance is unverified",
  ]);
});

test("read-only explanation names blockers and rules out the legacy app-JWT fallback", () => {
  const message = getProductionQueueReadOnlyMessage();
  for (const blocker of getProductionQueueVerificationBlockers()) {
    assert.ok(message.includes(blocker), `missing blocker: ${blocker}`);
  }
  assert.match(message, /legacy app-JWT queue routes; no fallback is used/);
});
