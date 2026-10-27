import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";
import {
  canReadJoinFlightQueue,
  canSubmitProductionQueueJoin,
  joinFlightDisclosures,
  joinFlightQueueCountLabel,
  joinFlightQueuePositionLabel,
  joinFlightRouteParams,
  JOIN_FLIGHT_QUEUE_FOOTNOTE,
  parseJoinFlightDisplay,
  presentJoinFlightQueuePanel,
  presentVerifiedQueueJoinSuccess,
  queueJoinSuccessModel,
} from "../scripts/.join-flight-presentation.test.mjs";

const projectRoot = resolve(import.meta.dirname, "..");

const flight = {
  fromAirport: "DAL",
  toAirport: "SFO",
  fromCity: "Dallas",
  toCity: "San Francisco",
  departureDate: "2026-11-01",
  departureTime: "10:00",
  aircraftType: "Citation Latitude",
  aircraftTypeName: null,
  international: false,
  status: "published",
};

const verifiedEntry = {
  emptyLegId: 42,
  joinedAt: "2026-10-27T00:00:00.000Z",
  position: 3,
  queueCount: 11,
  memberQueueCount: 4,
  userInQueue: true,
  userTier: "base",
  userHasLineSkip: false,
  userHasInternationalPass: false,
};

test("the prepared join screen cannot submit a production queue request", () => {
  assert.equal(canSubmitProductionQueueJoin(), false);
  const readiness = readFileSync(resolve(projectRoot, "lib/productionQueueReadiness.ts"), "utf8");
  assert.match(readiness, /deployedMainService: false/);
  assert.match(readiness, /trustedSkipLineCreditSource: false/);
  const policy = readFileSync(resolve(projectRoot, "lib/nativeAuthTestPolicy.ts"), "utf8");
  assert.match(policy, /'\/api\/me\/referrals'/);
  assert.match(policy, /EMPTY_LEG_QUEUE_PATH = \/\^\\\/api\\\/empty-legs\\\/\(\[1-9\]\\d\*\)\\\/queue\$\//);
  assert.doesNotMatch(policy, /skip-line|winner|passengers/);
  const hook = readFileSync(resolve(projectRoot, "lib/useJoinFlightQueueRead.ts"), "utf8");
  const confirmation = readFileSync(resolve(projectRoot, "components/QueueJoinConfirmation.tsx"), "utf8");
  assert.match(hook, /createProductionQueueActions\(api\.authenticated\)\.read\(/);
  assert.match(confirmation, /disabled=\{!canSubmitProductionQueueJoin\(\) && !demoEnabled\}/);
  assert.match(confirmation, /if \(canSubmitProductionQueueJoin\(\)\) return;/);
  assert.doesNotMatch(hook, /\.join\(|\.leave\(|\.skipLine\(|getMembership|joinEmptyLegQueue|leaveEmptyLegQueue|confirmEmptyLegWinner|declineEmptyLegWinner/);
  assert.doesNotMatch(confirmation, /joinEmptyLegQueue|leaveEmptyLegQueue|skipLine|getMembership|fetch\(|useMutation/);
});

test("confirmation copy explains the queue without prices or invented eligibility", () => {
  const domestic = joinFlightDisclosures(false).join("\n");
  assert.match(domestic, /does not create a confirmed booking/);
  assert.match(domestic, /does not guarantee a seat/);
  assert.match(domestic, /active membership and a complete profile are required/);
  assert.match(domestic, /does not check either one/);
  assert.match(domestic, /does not use a credit or start a payment/);
  assert.doesNotMatch(domestic, /international|\$|fee/);

  const international = joinFlightDisclosures(true).join("\n");
  assert.match(international, /This flight is international/);
  assert.match(international, /No fee is shown here/);
  assert.doesNotMatch(international, /\$|\d+\s*(?:USD|dollars)/);

  const unknown = joinFlightDisclosures(null).join("\n");
  assert.match(unknown, /international status is not confirmed/);
  assert.doesNotMatch(unknown, /\$/);
});

test("route params carry loaded flight facts and ignore forged queue results", () => {
  const params = joinFlightRouteParams(42, flight);
  assert.deepEqual(params, {
    flightId: "42",
    from: "DAL",
    to: "SFO",
    fromCity: "Dallas",
    toCity: "San Francisco",
    departureDate: "2026-11-01",
    departureTime: "10:00",
    aircraft: "Citation Latitude",
    international: "0",
    flightStatus: "published",
  });
  assert.equal(joinFlightRouteParams(42, { ...flight, status: "available" }).flightStatus, "");
  assert.equal(canReadJoinFlightQueue("published"), true);
  assert.equal(canReadJoinFlightQueue(null), false);
  assert.equal("position" in params, false);
  assert.equal("queueCount" in params, false);
  assert.deepEqual(joinFlightRouteParams(0, flight), {});

  const parsed = parseJoinFlightDisplay({
    ...params,
    position: "7",
    totalInQueue: "23",
    price: "2000",
  });
  assert.equal(parsed.flightId, 42);
  assert.equal(parsed.fromAirport, "DAL");
  assert.equal(parsed.international, false);
  assert.equal(parsed.flightStatus, "published");
  assert.equal(parseJoinFlightDisplay({ ...params, flightStatus: "available" }).flightStatus, null);
  assert.equal("position" in parsed, false);
  assert.equal(parseJoinFlightDisplay({ flightId: "0", from: "DAL" }), null);
  assert.equal(parseJoinFlightDisplay({ flightId: "42", from: "not a code", international: "" }).fromAirport, null);
  assert.equal(parseJoinFlightDisplay({ flightId: "42", international: "" }).international, null);
});

test("queue read display uses participant count and viewer position without seat or eligibility claims", () => {
  const waiting = {
    entries: [
      { position: 1, initials: "AA", tier: "base", hasLineSkip: false, isViewer: false },
      { position: 2, initials: "BB", tier: "plus", hasLineSkip: false, isViewer: true },
    ],
    viewer: { status: "in-queue", position: 2 },
  };
  const panel = presentJoinFlightQueuePanel({
    flightStatus: "published",
    sessionReady: true,
    signedIn: true,
    loading: false,
    failed: false,
    read: waiting,
  });
  assert.deepEqual(panel, { kind: "participants", participantCount: 2, viewerPosition: 2 });
  assert.equal(joinFlightQueueCountLabel(2), "2 people are in this queue.");
  assert.equal(joinFlightQueuePositionLabel(2), "Your position is #2.");
  assert.doesNotMatch(joinFlightQueueCountLabel(2), /seat|eligible/i);
  assert.match(JOIN_FLIGHT_QUEUE_FOOTNOTE, /not a count of available seats/);
  assert.match(JOIN_FLIGHT_QUEUE_FOOTNOTE, /does not confirm that you can join/);

  assert.deepEqual(presentJoinFlightQueuePanel({
    flightStatus: "published",
    sessionReady: true,
    signedIn: true,
    loading: false,
    failed: false,
    read: { entries: [], viewer: { status: "not-in-queue" } },
  }), { kind: "empty" });
  assert.equal(presentJoinFlightQueuePanel({
    flightStatus: null,
    sessionReady: true,
    signedIn: true,
    loading: false,
    failed: false,
    read: waiting,
  }).kind, "not-published");
  assert.equal(presentJoinFlightQueuePanel({
    flightStatus: "published",
    sessionReady: true,
    signedIn: true,
    loading: false,
    failed: true,
    read: waiting,
  }).kind, "unavailable");
});

test("success fields come only from a validated queue response and stay hidden while the gate is closed", () => {
  assert.deepEqual(queueJoinSuccessModel(42, verifiedEntry), {
    flightId: 42,
    position: 3,
    participantCount: 11,
  });
  assert.equal(queueJoinSuccessModel(99, verifiedEntry), null);
  assert.equal(queueJoinSuccessModel(42, { ...verifiedEntry, userInQueue: false }), null);
  assert.equal(queueJoinSuccessModel(42, { ...verifiedEntry, position: 0 }), null);
  assert.equal(queueJoinSuccessModel(42, { ...verifiedEntry, queueCount: 2 }), null);
  assert.equal(presentVerifiedQueueJoinSuccess(42, verifiedEntry), null);
  assert.equal(presentVerifiedQueueJoinSuccess(42, null), null);
});

test("the join screens do not call queue, payment, or membership mutations", () => {
  const flightDetails = readFileSync(resolve(projectRoot, "app/flight/[id].tsx"), "utf8");
  const joinScreen = readFileSync(resolve(projectRoot, "app/flight/join.tsx"), "utf8");
  const confirmation = readFileSync(resolve(projectRoot, "components/QueueJoinConfirmation.tsx"), "utf8");
  const success = readFileSync(resolve(projectRoot, "components/QueueJoinSuccess.tsx"), "utf8");
  assert.match(flightDetails, /pathname: '\/flight\/join'/);
  assert.doesNotMatch(flightDetails, /pathname: demoJoin\.enabled \? '\/flight\/demo-policy'/);
  assert.match(flightDetails, /Join the Flight/);
  assert.match(flightDetails, /if \(isProductionQueueVerified\(\)\)/);
  assert.doesNotMatch(flightDetails, /pathname: '\/queue\/production-unavailable'/);
  assert.match(joinScreen, /presentVerifiedQueueJoinSuccess\(flight\.flightId, null\)/);
  assert.match(joinScreen, /useJoinFlightQueueRead\(flight\?\.flightId \?\? 0, flight\?\.flightStatus \?\? null\)/);
  for (const source of [joinScreen, confirmation, success]) {
    assert.doesNotMatch(source, /joinEmptyLegQueue|leaveEmptyLegQueue|skipLine|getMembership|getEmptyLegQueue|createProductionQueueActions|useMutation|fetch\(/);
  }
  assert.match(confirmation, /disabled=\{!canSubmitProductionQueueJoin\(\) && !demoEnabled\}/);
  assert.match(confirmation, /if \(canSubmitProductionQueueJoin\(\)\) return;/);
  const demoRoutes = readFileSync(resolve(projectRoot, "lib/fullAppDemo.ts"), "utf8");
  assert.match(demoRoutes, /policy\|confirmed/);
  assert.doesNotMatch(demoRoutes, /flight\/join/);
});
