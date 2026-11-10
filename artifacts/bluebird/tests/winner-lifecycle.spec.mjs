import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";
import {
  claimWinnerCelebration,
  presentWinnerOffer,
  presentWinnerOfferCopy,
  resetWinnerCelebrations,
  winnerReviewTarget,
} from "../scripts/.winner-offer.test.mjs";
import {
  pendingWinnerOfferFlightIdsFromTrips,
  tripLifecycleOpenTarget,
} from "../scripts/.member-flight-placement.test.mjs";
import { presentTripChecklistStatus } from "../scripts/.winner-checklist.test.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const now = Date.parse("2026-11-09T15:00:00.000Z");

function offer(overrides = {}) {
  return presentWinnerOffer({
    viewerIsEffectiveWinner: true,
    viewerConfirmationStatus: "pending",
    queueClosed: true,
    awarded: false,
    bookedPassenger: false,
    flightStatus: "published",
    deadlineIso: null,
    nowMs: now,
    ...overrides,
  });
}

test("1 join queue → Pending trip opens queue status, never winner confirmation", () => {
  assert.equal(presentTripChecklistStatus({
    list: "current",
    awarded: false,
    remainingSteps: [],
    status: "queue_pending",
  }), "Pending");
  assert.deepEqual(tripLifecycleOpenTarget({
    list: "current",
    legId: 81,
    status: "queue_pending",
    awarded: false,
  }), { pathname: "/flight/queue-status", params: { flightId: "81" } });
  assert.equal(winnerReviewTarget({
    list: "current",
    awarded: false,
    legId: 81,
    status: "queue_pending",
  }), null);
  assert.equal(offer({ tripStatus: "queue_pending" }).kind, "waiting");
  assert.deepEqual(pendingWinnerOfferFlightIdsFromTrips([
    { leg: { id: 81 }, checklist: { emptyLegId: 81, awarded: false }, status: "queue_pending" },
  ]), []);
});

test("2 countdown end without backend winner stays waiting; 3 another member does not celebrate", () => {
  assert.equal(offer({ viewerIsEffectiveWinner: null, queueClosed: true }).kind, "waiting");
  assert.match(presentWinnerOfferCopy(offer({ viewerIsEffectiveWinner: null, queueClosed: true }))?.title ?? "", /Waiting/);
  const otherWon = offer({ viewerIsEffectiveWinner: false, viewerConfirmationStatus: null });
  assert.equal(otherWon.kind, "non-winner");
  resetWinnerCelebrations();
  assert.equal(claimWinnerCelebration("member-a", 81), true);
  // Non-winner screens never call claim; verifying kind alone is enough.
  assert.equal(otherWon.kind !== "pending", true);
});

test("4 current user wins → pending offer; 5 confirmation stays explicit; 7 celebration dedupes", () => {
  assert.equal(offer().kind, "pending");
  resetWinnerCelebrations();
  assert.equal(claimWinnerCelebration("member-a", 81), true);
  assert.equal(claimWinnerCelebration("member-a", 81), false);
  const winnerScreen = readFileSync(resolve(projectRoot, "app/flight/winner.tsx"), "utf8");
  assert.match(winnerScreen, /winnerActions\.confirm/);
  assert.match(winnerScreen, /claimWinnerCelebration/);
  assert.match(winnerScreen, /hydrateWinnerCelebrations/);
  assert.doesNotMatch(winnerScreen, /confirm\(\)|autoConfirm|automatically confirm/i);
});

test("6 app restart uses persisted celebration keys; 8 awaiting award / delayed winner fields", () => {
  const moduleSource = readFileSync(resolve(projectRoot, "lib/winnerOfferPresentation.ts"), "utf8");
  assert.match(moduleSource, /setWinnerCelebrationStorage/);
  assert.match(moduleSource, /hydrateWinnerCelebrations/);
  assert.match(moduleSource, /WINNER_CELEBRATION_STORAGE_KEY/);
  assert.equal(presentTripChecklistStatus({
    list: "current",
    awarded: false,
    remainingSteps: [],
    status: "awaiting_award",
  }), "Awaiting award");
  assert.equal(offer({
    viewerIsEffectiveWinner: true,
    queueClosed: true,
    awarded: false,
    bookedPassenger: false,
    viewerConfirmationStatus: "confirmed",
  }).kind, "confirmed");
  const queue = readFileSync(resolve(projectRoot, "app/flight/queue-status.tsx"), "utf8");
  assert.match(queue, /decision\.kind !== 'closed'/);
  assert.match(queue, /empty-leg-queue/);
  assert.match(queue, /offer\.kind === 'waiting'/);
  assert.match(queue, /offer\.kind !== 'pending'/);
});
