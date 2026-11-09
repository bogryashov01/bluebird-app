import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";
import {
  noteQueuePositionChange,
  presentProductionQueueFlightStatus,
  presentQueueDecision,
  presentQueuePositionRing,
  presentRelativeQueueTime,
  resolveProductionQueuePosition,
} from "../scripts/.production-queue-status.test.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const closeAt = "2026-11-03T18:00:00.000Z";
const beforeClose = Date.parse("2026-11-03T16:57:57.000Z");

test("a position change is recorded once and an unchanged position is not", () => {
  const first = noteQueuePositionChange(null, 3, closeAt);
  assert.equal(first.event, null);
  assert.equal(first.previous, 3);
  const same = noteQueuePositionChange(first.previous, 3, closeAt);
  assert.equal(same.event, null);
  const moved = noteQueuePositionChange(same.previous, 4, "2026-11-03T17:05:00.000Z");
  assert.equal(moved.event?.text, "Moved from #3 to #4");
  assert.equal(moved.event?.scope, "session");
  assert.equal(moved.event?.observedAt, "2026-11-03T17:05:00.000Z");
  const repeat = noteQueuePositionChange(moved.previous, 4, "2026-11-03T17:06:00.000Z");
  assert.equal(repeat.event, null);
  assert.equal(presentRelativeQueueTime("2026-11-03T17:05:00.000Z", Date.parse("2026-11-03T17:07:00.000Z")), "2m ago");
});

test("a missing total shows the position without inventing a queue size", () => {
  const reading = resolveProductionQueuePosition({
    rosterPosition: null,
    rosterCount: null,
    flightPosition: 3,
    flightCount: null,
  });
  assert.deepEqual(reading, { position: 3, total: null });
  const ring = presentQueuePositionRing(reading.position, reading.total);
  assert.equal(ring.positionText, "3");
  assert.equal(ring.totalText, null);
  assert.equal(ring.fraction, null);
});

test("flight queueCount and viewer position are preferred when they agree", () => {
  const reading = resolveProductionQueuePosition({
    rosterPosition: 9,
    rosterCount: 9,
    flightPosition: 3,
    flightCount: 12,
  });
  assert.deepEqual(reading, { position: 3, total: 12 });
  const ring = presentQueuePositionRing(reading.position, reading.total);
  assert.equal(ring.positionText, "3");
  assert.equal(ring.totalText, "12");
  assert.equal(ring.fraction, (12 - 3) / (12 - 1));
});

test("a closed queue and a missing closing time do not invent a countdown", () => {
  assert.deepEqual(presentQueueDecision(closeAt, beforeClose), { kind: "countdown", label: "Decision in 01:02:03" });
  assert.deepEqual(presentQueueDecision(closeAt, Date.parse(closeAt)), { kind: "closed", label: "Queue closed" });
  assert.deepEqual(presentQueueDecision(null, beforeClose), { kind: "unavailable" });
  assert.equal(presentProductionQueueFlightStatus({
    status: "published",
    queueClosesAt: closeAt,
    nowMs: Date.parse(closeAt),
    viewerIsBookedPassenger: null,
    viewerConfirmationStatus: null,
    viewerIsEffectiveWinner: null,
  })?.label, "Closed");
  assert.equal(presentProductionQueueFlightStatus({
    status: "published",
    queueClosesAt: closeAt,
    nowMs: beforeClose,
    viewerIsBookedPassenger: null,
    viewerConfirmationStatus: null,
    viewerIsEffectiveWinner: false,
  })?.label, "Open");
  assert.equal(presentProductionQueueFlightStatus({
    status: "cancelled",
    queueClosesAt: closeAt,
    nowMs: beforeClose,
    viewerIsBookedPassenger: null,
    viewerConfirmationStatus: null,
    viewerIsEffectiveWinner: null,
  })?.label, "Cancelled");
  assert.equal(presentProductionQueueFlightStatus({
    status: "published",
    queueClosesAt: closeAt,
    nowMs: Date.parse(closeAt),
    viewerIsBookedPassenger: false,
    viewerConfirmationStatus: "pending",
    viewerIsEffectiveWinner: true,
  })?.label, "Pending Decision");
  assert.equal(presentProductionQueueFlightStatus({
    status: "published",
    queueClosesAt: closeAt,
    nowMs: Date.parse(closeAt),
    viewerIsBookedPassenger: true,
    viewerConfirmationStatus: "confirmed",
    viewerIsEffectiveWinner: true,
  })?.label, "Awarded");
});

test("the production queue status screen keeps the member's position and hides the roster", () => {
  const screen = readFileSync(resolve(projectRoot, "app/flight/queue-status.tsx"), "utf8");
  const presentation = readFileSync(resolve(projectRoot, "lib/productionQueueStatusPresentation.ts"), "utf8");
  const join = readFileSync(resolve(projectRoot, "app/flight/join.tsx"), "utf8");
  const details = readFileSync(resolve(projectRoot, "app/flight/[id].tsx"), "utf8");
  const myQueues = readFileSync(resolve(projectRoot, "lib/myQueuesPresentation.ts"), "utf8");
  assert.match(screen, /YOUR POSITION/);
  assert.match(screen, /presentQueueDecision/);
  assert.match(presentation, /Decision in \$\{countdown\}/);
  assert.match(screen, /Flight Status/);
  assert.doesNotMatch(screen, /Queue Movement|Earlier queue movement|Seen during this visit|queue-status-movement/);
  assert.match(screen, /return \{ flight, viewerAuthenticated: true \}/);
  assert.match(screen, /readProductionFlightDetailCache\(flightQuery\.data\)/);
  assert.match(screen, /Use Skip the Line Pass/);
  assert.match(screen, /Leave the Queue/);
  assert.match(screen, /CurrentWinnerCelebration/);
  assert.doesNotMatch(screen, /queueRosterLabel|MemberProfileSheet|initials/);
  assert.doesNotMatch(screen, /refetchInterval|useFocusEffect/);
  assert.match(join, /pathname: '\/flight\/queue-status'/);
  assert.match(details, /pathname: '\/flight\/queue-status'/);
  assert.match(myQueues, /pathname: '\/flight\/\[id\]'/);
});
