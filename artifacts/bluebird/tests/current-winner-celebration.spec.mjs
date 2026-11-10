import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";
import {
  CURRENT_WINNER_BODY,
  CURRENT_WINNER_TITLE,
  currentWinnerCountdownLabel,
  dismissCurrentWinnerCelebration,
  markCurrentWinnerCelebration,
  readCurrentWinnerCelebration,
  resetCurrentWinnerCelebrations,
} from "../scripts/.current-winner-celebration.test.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const confirmed = {
  clerkUserId: "member-a",
  flightId: 42,
  queueClosesAt: "2026-11-03T18:00:00.000Z",
  viewerIsEffectiveWinner: true,
};

test("a confirmed current winner celebrates once and a repeat does not use another pass", () => {
  resetCurrentWinnerCelebrations();
  assert.equal(markCurrentWinnerCelebration(confirmed), "pending");
  assert.equal(markCurrentWinnerCelebration(confirmed), "ignored");
  assert.deepEqual(readCurrentWinnerCelebration({ clerkUserId: "member-a", flightId: 42 }), {
    clerkUserId: "member-a",
    flightId: 42,
    queueClosesAt: "2026-11-03T18:00:00.000Z",
  });
  assert.equal(readCurrentWinnerCelebration({ clerkUserId: "member-a", flightId: 42 })?.flightId, 42);
  dismissCurrentWinnerCelebration({ clerkUserId: "member-a", flightId: 42 });
  assert.equal(readCurrentWinnerCelebration({ clerkUserId: "member-a", flightId: 42 }), null);
  assert.equal(markCurrentWinnerCelebration(confirmed), "ignored");
  assert.equal(readCurrentWinnerCelebration({ clerkUserId: "member-b", flightId: 42 }), null);
});

test("a non-winner response and invalid identity do not open the celebration", () => {
  resetCurrentWinnerCelebrations();
  assert.equal(markCurrentWinnerCelebration({ ...confirmed, viewerIsEffectiveWinner: false }), "ignored");
  assert.equal(readCurrentWinnerCelebration({ clerkUserId: "member-a", flightId: 42 }), null);
  assert.equal(markCurrentWinnerCelebration({ ...confirmed, clerkUserId: " " }), "ignored");
  assert.equal(markCurrentWinnerCelebration({ ...confirmed, flightId: 0 }), "ignored");
});

test("the countdown uses the scheduled closing time", () => {
  const now = Date.parse("2026-11-03T17:00:00.000Z");
  assert.equal(
    currentWinnerCountdownLabel("2026-11-03T18:01:05.000Z", now),
    "Queue closes in 01:01:05",
  );
  assert.equal(
    currentWinnerCountdownLabel("2026-11-03T16:00:00.000Z", now),
    "This queue is closed.",
  );
  assert.equal(
    currentWinnerCountdownLabel(null, now),
    "Queue closing time is not available for this flight.",
  );
  assert.match(CURRENT_WINNER_TITLE, /Current Queue Winner/);
  assert.match(CURRENT_WINNER_BODY, /stays open until its scheduled closing time/);
  assert.match(CURRENT_WINNER_BODY, /after the queue closes/);
  assert.doesNotMatch(`${CURRENT_WINNER_TITLE} ${CURRENT_WINNER_BODY}`, /Flight Confirmed|Booking Confirmed|You've Won the Flight/);
});

test("the production celebration stays separate from Skip Pass and the legacy demo win", () => {
  const celebration = readFileSync(resolve(projectRoot, "components/CurrentWinnerCelebration.tsx"), "utf8");
  const queueStatus = readFileSync(resolve(projectRoot, "app/flight/queue-status.tsx"), "utf8");
  const mutationHook = readFileSync(resolve(projectRoot, "lib/useProductionQueueMutation.ts"), "utf8");
  const legacy = readFileSync(resolve(projectRoot, "components/PassCelebration.tsx"), "utf8");
  const demoWin = readFileSync(resolve(projectRoot, "lib/flightWinCelebration.ts"), "utf8");
  assert.match(celebration, /useColors\(\)/);
  assert.match(celebration, /colors\.offWhite/);
  assert.match(celebration, /colors\.textOnSurface/);
  assert.match(celebration, /testID="current-winner-continue"/);
  assert.match(celebration, /currentWinnerCountdownLabel/);
  assert.doesNotMatch(celebration, /skipLine\(|fetch\(|PassCelebration|markFlightWinCelebration|Flight Confirmed|Booking Confirmed|You've Won the Flight/);
  assert.match(queueStatus, /CurrentWinnerCelebration/);
  assert.match(queueStatus, /dismissCurrentWinnerCelebration/);
  assert.match(queueStatus, /PassCelebration/);
  assert.match(queueStatus, /showSkipCelebration && mutation\.skipMessage/);
  assert.match(queueStatus, /currentWinner && !showSkipCelebration/);
  assert.doesNotMatch(queueStatus, /markFlightWinCelebration|Flight Confirmed|Booking Confirmed|You've Won the Flight|Flight Secured/);
  assert.doesNotMatch(mutationHook, /markCurrentWinnerCelebration/);
  assert.match(legacy, /PASS_CELEBRATION_TITLE/);
  assert.match(legacy, /Skip the Line Confirmed/);
  assert.doesNotMatch(demoWin, /currentWinnerCelebration|markCurrentWinnerCelebration/);
  const moduleSource = readFileSync(resolve(projectRoot, "lib/currentWinnerCelebration.ts"), "utf8");
  assert.doesNotMatch(moduleSource, /fetch\(|skipLine\(|joinEmptyLegQueue/);
  assert.match(moduleSource, /Skip the Line redemption must not call this/);
});
