import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";
import {
  claimWinnerCelebration,
  presentWinnerOffer,
  presentWinnerOfferCopy,
  resetWinnerCelebrations,
} from "../scripts/.winner-offer.test.mjs";
import {
  tripLifecycleOpenTarget,
  upcomingFlightDetailsTarget,
} from "../scripts/.member-flight-placement.test.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const now = Date.parse("2026-11-03T18:30:00.000Z");

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

test("a closed queue does not make the first-ranked member a winner", () => {
  const result = offer({ viewerIsEffectiveWinner: false, viewerConfirmationStatus: null });
  assert.equal(result.kind, "non-winner");
  assert.equal(presentWinnerOfferCopy(result)?.body, "Queue position does not award this flight.");
});

test("a pending offer, confirmed booking, decline, cancellation, and expiry stay distinct", () => {
  assert.equal(offer().kind, "pending");
  assert.equal(presentWinnerOfferCopy(offer())?.body, "Awaiting confirmation");
  assert.equal(offer({ awarded: true }).kind, "confirmed");
  assert.equal(offer({ bookedPassenger: true, viewerConfirmationStatus: "pending" }).kind, "confirmed");
  assert.equal(offer({ viewerConfirmationStatus: "declined" }).kind, "declined");
  assert.equal(offer({ flightStatus: "cancelled", viewerConfirmationStatus: "pending" }).kind, "cancelled");
  assert.equal(offer({
    deadlineIso: "2026-11-03T18:00:00.000Z",
    viewerConfirmationStatus: "pending",
  }).kind, "expired");
  assert.equal(offer({ deadlineIso: null }).kind, "pending");
  assert.equal(offer({ queueClosed: false }).kind, "unavailable");
  assert.equal(offer({ queueClosed: null }).kind, "unavailable");
  assert.equal(offer({ viewerIsEffectiveWinner: null, queueClosed: true }).kind, "waiting");
  assert.equal(offer({ tripStatus: "queue_pending" }).kind, "waiting");
  assert.equal(offer({ viewerIsEffectiveWinner: false, queueClosed: true }).kind, "non-winner");
});

test("the celebration plays once per account and flight", () => {
  resetWinnerCelebrations();
  assert.equal(claimWinnerCelebration("member-a", 42), true);
  assert.equal(claimWinnerCelebration("member-a", 42), false);
  assert.equal(claimWinnerCelebration("member-b", 42), true);
});

test("awaiting confirmation opens the review screen and an awarded trip does not", () => {
  assert.deepEqual(upcomingFlightDetailsTarget({ list: "current", legId: 42 }), {
    pathname: "/flight/[id]",
    params: { id: "42" },
  });
  assert.equal(upcomingFlightDetailsTarget({ list: "past", legId: 42 }), null);
  assert.equal(upcomingFlightDetailsTarget({ list: "current", legId: 0 }), null);
  assert.deepEqual(tripLifecycleOpenTarget({
    list: "current",
    legId: 42,
    status: "queue_pending",
    awarded: false,
  }), { pathname: "/flight/queue-status", params: { flightId: "42" } });
  assert.deepEqual(tripLifecycleOpenTarget({
    list: "current",
    legId: 42,
    status: "winner_confirmation_required",
    awarded: false,
  }), { pathname: "/flight/winner", params: { flightId: "42" } });
  const screen = readFileSync(resolve(projectRoot, "app/flight/winner.tsx"), "utf8");
  const queue = readFileSync(resolve(projectRoot, "app/flight/queue-status.tsx"), "utf8");
  const trips = readFileSync(resolve(projectRoot, "components/ClerkTrips.tsx"), "utf8");
  assert.match(screen, /return \{ flight, viewerAuthenticated: true \}/);
  assert.match(screen, /deadlineIso: null/);
  assert.match(screen, /winner-review-continue/);
  // Continue accepts the winner offer via the existing confirmation client.
  assert.match(screen, /useWinnerActions/);
  assert.match(screen, /reviewWinnerConfirmation/);
  assert.match(screen, /winnerActions\.confirm/);
  assert.match(screen, /canConfirmProductionWinner/);
  assert.doesNotMatch(screen, /declineEmptyLegWinner|confirmTripChecklist|deadlineIso: '/);
  assert.doesNotMatch(screen, /pathname: '\/flight\/\[id\]'/);
  assert.match(queue, /Review \& Confirm Flight/);
  assert.match(queue, /offer\.kind === 'waiting'/);
  assert.match(trips, /tripLifecycleOpenTarget/);
  assert.match(trips, /router\.push\(detailsTarget\)/);
  assert.match(trips, /queue_pending|Winner confirmation required/);
});

test("expired winner stays non-actionable without a backend deadline field", () => {
  const screen = readFileSync(resolve(projectRoot, "app/flight/winner.tsx"), "utf8");
  assert.match(screen, /deadlineIso: null/);
  assert.match(screen, /Expiration requires a verified backend deadline field/);
  // With a verified deadline the presentation can expire; UI must not invent one.
  assert.equal(offer({
    deadlineIso: "2026-11-03T18:00:00.000Z",
    viewerConfirmationStatus: "pending",
  }).kind, "expired");
  assert.equal(presentWinnerOfferCopy(offer({
    deadlineIso: "2026-11-03T18:00:00.000Z",
  }))?.title, "This confirmation offer has expired");
  assert.match(screen, /offer\.kind === 'expired'/);
  assert.match(screen, /winner-review-expired/);
  assert.doesNotMatch(screen, /Date\.now\(\)\s*\+|expiresAt:\s*['"]|deadlineIso:\s*['"]/);
});
