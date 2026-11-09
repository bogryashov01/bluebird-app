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
import { upcomingFlightDetailsTarget } from "../scripts/.member-flight-placement.test.mjs";

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
  assert.equal(offer({ viewerIsEffectiveWinner: null, queueClosed: true }).kind, "unavailable");
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
  const screen = readFileSync(resolve(projectRoot, "app/flight/winner.tsx"), "utf8");
  const queue = readFileSync(resolve(projectRoot, "app/flight/queue-status.tsx"), "utf8");
  const trips = readFileSync(resolve(projectRoot, "components/ClerkTrips.tsx"), "utf8");
  assert.match(screen, /return \{ flight, viewerAuthenticated: true \}/);
  assert.match(screen, /deadlineIso: null/);
  assert.match(screen, /winner-review-continue/);
  assert.match(screen, /pathname: '\/flight\/\[id\]'/);
  assert.doesNotMatch(screen, /confirmEmptyLegWinner|declineEmptyLegWinner|confirmTripChecklist|deadlineIso: '/);
  assert.match(queue, /Review & Confirm Flight/);
  assert.match(trips, /upcomingFlightDetailsTarget/);
  assert.match(trips, /router\.push\(detailsTarget\)/);
  assert.doesNotMatch(trips, /pathname: '\/flight\/winner'/);
});
