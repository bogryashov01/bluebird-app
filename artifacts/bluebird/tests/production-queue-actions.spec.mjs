import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createProductionQueueActions,
  ProductionQueueContractError,
} from "../scripts/.production-queue-actions.test.mjs";

const viewer = {
  position: 2,
  initials: "PM",
  tier: "plus",
  hasLineSkip: false,
  isViewer: true,
};

const joinedEntry = {
  emptyLegId: 81001,
  joinedAt: "2026-10-01T00:00:00.000Z",
  position: 2,
  queueCount: 2,
  memberQueueCount: 2,
  userInQueue: true,
  userTier: "plus",
  userHasLineSkip: false,
  userHasInternationalPass: false,
};

test("queue read identifies the viewer only from exactly one isViewer response row", async () => {
  const actions = createProductionQueueActions({
    getEmptyLegQueue: async () => [{ ...viewer }],
    joinEmptyLegQueue: async () => joinedEntry,
    leaveEmptyLegQueue: async () => ({ emptyLegId: 81001, queueCount: 1, memberQueueCount: 1, userInQueue: false, lockedForFreeUsers: false }),
    skipLine: async () => ({ id: 81001, viewerIsEffectiveWinner: true }),
  });
  assert.deepEqual(await actions.read(81001), {
    entries: [{ ...viewer }],
    viewer: { status: "in-queue", position: 2 },
  });

  const noViewer = createProductionQueueActions({
    getEmptyLegQueue: async () => [{ ...viewer, isViewer: false }],
    joinEmptyLegQueue: async () => joinedEntry,
    leaveEmptyLegQueue: async () => ({ emptyLegId: 81001, queueCount: 1, memberQueueCount: 1, userInQueue: false, lockedForFreeUsers: false }),
    skipLine: async () => ({ id: 81001, viewerIsEffectiveWinner: true }),
  });
  assert.deepEqual((await noViewer.read(81001)).viewer, { status: "not-in-queue" });

  const ambiguous = createProductionQueueActions({
    getEmptyLegQueue: async () => [{ ...viewer }, { ...viewer, position: 3 }],
    joinEmptyLegQueue: async () => joinedEntry,
    leaveEmptyLegQueue: async () => ({ emptyLegId: 81001, queueCount: 1, memberQueueCount: 1, userInQueue: false, lockedForFreeUsers: false }),
    skipLine: async () => ({ id: 81001, viewerIsEffectiveWinner: true }),
  });
  await assert.rejects(ambiguous.read(81001), (error) =>
    error instanceof ProductionQueueContractError && error.code === "ambiguous_viewer");
});

test("Main API read failures propagate without a local/demo retry", async () => {
  const apiFailure = new Error("Main API rejected this request");
  let requestCount = 0;
  const actions = createProductionQueueActions({
    getEmptyLegQueue: async () => {
      requestCount += 1;
      throw apiFailure;
    },
    joinEmptyLegQueue: async () => joinedEntry,
    leaveEmptyLegQueue: async () => ({ emptyLegId: 81001, queueCount: 1, memberQueueCount: 1, userInQueue: false, lockedForFreeUsers: false }),
    skipLine: async () => ({ id: 81001, viewerIsEffectiveWinner: true }),
  });
  await assert.rejects(actions.read(81001), (error) => error === apiFailure);
  assert.equal(requestCount, 1);
});

test("join and leave return success only when the API confirms the requested transition", async () => {
  const calls = [];
  const actions = createProductionQueueActions({
    getEmptyLegQueue: async () => [],
    joinEmptyLegQueue: async (id, body) => {
      calls.push(["join", id, body]);
      return joinedEntry;
    },
    leaveEmptyLegQueue: async (id) => {
      calls.push(["leave", id]);
      return { emptyLegId: id, queueCount: 1, memberQueueCount: 1, userInQueue: false, lockedForFreeUsers: false };
    },
    skipLine: async () => ({ id: 81001, viewerIsEffectiveWinner: true }),
  });

  assert.equal((await actions.join(81001, {
    internationalPassAuthorized: true,
    useInternationalPassCredit: true,
  })).position, 2);
  assert.equal((await actions.leave(81001)).userInQueue, false);
  assert.deepEqual(calls, [
    ["join", 81001, { internationalPassAuthorized: true, useInternationalPassCredit: true }],
    ["leave", 81001],
  ]);

  const rejectedJoin = createProductionQueueActions({
    getEmptyLegQueue: async () => [],
    joinEmptyLegQueue: async () => ({ ...joinedEntry, userInQueue: false }),
    leaveEmptyLegQueue: async () => ({ emptyLegId: 81001, queueCount: 1, memberQueueCount: 1, userInQueue: true, lockedForFreeUsers: false }),
    skipLine: async () => ({ id: 81001, viewerIsEffectiveWinner: true }),
  });
  await assert.rejects(rejectedJoin.join(81001), { code: "invalid_transition" });
  await assert.rejects(rejectedJoin.leave(81001), { code: "invalid_transition" });
});

test("Skip the Line uses an existing credit only and needs a confirmed winner response", async () => {
  const calls = [];
  const actions = createProductionQueueActions({
    getEmptyLegQueue: async () => [],
    joinEmptyLegQueue: async () => joinedEntry,
    leaveEmptyLegQueue: async () => ({ emptyLegId: 81001, queueCount: 1, memberQueueCount: 1, userInQueue: false, lockedForFreeUsers: false }),
    skipLine: async (id, body) => {
      calls.push([id, body]);
      return { id, viewerIsEffectiveWinner: true };
    },
  });

  await assert.rejects(actions.skipLine(81001, 0), { code: "credit_required" });
  await assert.rejects(actions.skipLine(81001, -1), { code: "credit_required" });
  assert.deepEqual(calls, []);
  assert.equal((await actions.skipLine(81001, 1)).viewerIsEffectiveWinner, true);
  assert.deepEqual(calls, [[81001, { useCredit: true }]]);

  const notConfirmed = createProductionQueueActions({
    getEmptyLegQueue: async () => [],
    joinEmptyLegQueue: async () => joinedEntry,
    leaveEmptyLegQueue: async () => ({ emptyLegId: 81001, queueCount: 1, memberQueueCount: 1, userInQueue: false, lockedForFreeUsers: false }),
    skipLine: async () => ({ id: 81001, viewerIsEffectiveWinner: false }),
  });
  await assert.rejects(notConfirmed.skipLine(81001, 1), { code: "invalid_transition" });
});
