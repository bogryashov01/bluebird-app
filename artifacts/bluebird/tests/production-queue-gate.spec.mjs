import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getProductionQueueReadOnlyMessage,
  getProductionQueueVerificationBlockers,
  isProductionQueueVerified,
  MAIN_SOURCE_QUEUE_EVIDENCE,
} from "../scripts/.production-queue-readiness.test.mjs";

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

test("read-only explanation acknowledges Main source evidence and rules out legacy app-JWT fallback", () => {
  const message = getProductionQueueReadOnlyMessage();
  assert.match(message, /supplied Main-source audit verifies the per-flight route definitions, Clerk Bearer handling, and Clerk-user-to-member mapping/);
  assert.match(message, /Mobile source verifies its prepared parsers and fail-closed integration, not live compatibility/);
  for (const blocker of getProductionQueueVerificationBlockers()) {
    assert.ok(message.includes(blocker), `missing blocker: ${blocker}`);
  }
  assert.match(message, /separate checked-in legacy API uses app-JWT \/api\/queue\/\* routes/);
  assert.match(message, /neither evidence for nor a fallback to the Main API/);
  assert.doesNotMatch(message, /per-flight queue endpoints (?:are )?absent|Main source (?:lacks|does not contain)/i);
});
