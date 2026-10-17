import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canJoinProductionQueue,
  canStartQueueJoin,
} from "../scripts/.queue-guards/queueJoinGuards.mjs";
import {
  isQueueDevelopmentPreviewEnabled,
  parseQueuePreviewState,
  QUEUE_PREVIEW_STATES,
} from "../scripts/.queue-guards/queueDevelopmentPreview.mjs";

test("only a published flight with a complete profile and active membership can offer join", () => {
  const eligible = {
    isAlreadyInQueue: false,
    flightPublished: true,
    profileComplete: true,
    activeMember: true,
  };
  assert.equal(canJoinProductionQueue(eligible), true);
  assert.equal(canJoinProductionQueue({ ...eligible, isAlreadyInQueue: true }), false);
  assert.equal(canJoinProductionQueue({ ...eligible, flightPublished: false }), false);
  assert.equal(canJoinProductionQueue({ ...eligible, profileComplete: false }), false);
  assert.equal(canJoinProductionQueue({ ...eligible, activeMember: false }), false);
});

test("synchronous join lock blocks duplicate taps and permits retry after the request settles", () => {
  assert.equal(canStartQueueJoin(false, false), true);
  assert.equal(canStartQueueJoin(true, false), false);
  assert.equal(canStartQueueJoin(false, true), false);
  assert.equal(canStartQueueJoin(false, false), true);
});

test("development queue fixtures have named states and are excluded outside development", () => {
  assert.deepEqual(QUEUE_PREVIEW_STATES, [
    "eligible-flight",
    "join-loading",
    "confirmation",
    "waiting",
    "unavailable",
    "selected",
    "winner",
  ]);
  assert.equal(isQueueDevelopmentPreviewEnabled(true), true);
  assert.equal(isQueueDevelopmentPreviewEnabled(false), false);
  assert.equal(parseQueuePreviewState("winner"), "winner");
  assert.equal(parseQueuePreviewState("unknown"), "eligible-flight");
});
