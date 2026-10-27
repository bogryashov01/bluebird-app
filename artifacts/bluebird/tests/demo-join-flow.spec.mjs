import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";
import {
  DEMO_JOIN_FLOW_DEFAULT_ENABLED,
  DEMO_POLICY_ACKNOWLEDGEMENTS,
  applySimulatedSkipLine,
  canContinueDemoPolicy,
  confirmDemoFlight,
  createDemoJoin,
  demoTripFromEntry,
  isDemoJoinFlowAllowed,
  parseStoredDemoEntry,
  readDemoJoinSetting,
  separateDemoTrip,
  shouldShowDemoInternationalNotice,
  simulateDemoWinner,
  simulatedInternationalFeeLabel,
  simulatedQueuePlacement,
} from "../scripts/.demo-join-flow.test.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const flight = {
  flightId: 42,
  fromAirport: "DAL",
  toAirport: "SFO",
  fromCity: "Dallas",
  toCity: "San Francisco",
  departureDate: "2026-11-01",
  departureTime: "10:00",
  aircraft: "Citation Latitude",
  international: false,
  flightStatus: "published",
};

test("demo join mode is off by default and cannot run in a release build", () => {
  assert.equal(DEMO_JOIN_FLOW_DEFAULT_ENABLED, false);
  assert.equal(readDemoJoinSetting(null), false);
  assert.equal(readDemoJoinSetting("true"), false);
  assert.equal(readDemoJoinSetting("enabled"), true);
  assert.equal(isDemoJoinFlowAllowed(true, false), false);
  assert.equal(isDemoJoinFlowAllowed(false, true), false);
  assert.equal(isDemoJoinFlowAllowed(false, false), false);
  assert.equal(isDemoJoinFlowAllowed(true, true), true);
});

test("simulated join, winner, and confirmation stay local and are never a booking", () => {
  assert.deepEqual(simulatedQueuePlacement(42), { position: 2, participantCount: 5 });
  const joined = createDemoJoin(flight);
  assert.equal(joined.booked, false);
  assert.equal(joined.simulated, true);
  assert.equal(joined.source, "demo-join-flow");
  assert.equal(joined.phase, "joined");
  assert.equal(joined.position, 2);
  assert.equal(joined.participantCount, 5);
  assert.equal(demoTripFromEntry(joined), null);
  const winner = simulateDemoWinner(joined);
  assert.equal(winner.phase, "winner");
  assert.equal(winner.booked, false);
  assert.equal(confirmDemoFlight(joined), null);
  assert.equal(simulateDemoWinner(winner), null);
  const confirmed = confirmDemoFlight(winner);
  assert.equal(confirmed.phase, "confirmed");
  assert.equal(confirmed.booked, false);
  assert.equal(confirmed.simulated, true);
  const trip = demoTripFromEntry(confirmed);
  assert.equal(trip.booked, false);
  assert.equal(trip.source, "demo-join-flow");
  assert.equal(trip.routeLabel, "DAL → SFO");
  assert.equal(parseStoredDemoEntry(JSON.stringify({ ...confirmed, booked: true })), null);
  assert.equal(parseStoredDemoEntry(JSON.stringify({ ...confirmed, source: "production" })), null);
});

test("demo trips stay outside the real current and past arrays", () => {
  const current = [{ id: "real-current" }];
  const past = [{ id: "real-past" }];
  const confirmed = confirmDemoFlight(simulateDemoWinner(createDemoJoin(flight)));
  const separated = separateDemoTrip({ current, past }, confirmed);
  assert.equal(separated.current, current);
  assert.equal(separated.past, past);
  assert.deepEqual(separated.current, [{ id: "real-current" }]);
  assert.deepEqual(separated.past, [{ id: "real-past" }]);
  assert.equal(separated.demo.booked, false);
  assert.equal(separated.demo.flightId, 42);
  const withoutDemo = separateDemoTrip({ current, past }, null);
  assert.equal(withoutDemo.demo, null);
  assert.equal(withoutDemo.current, current);
});

test("Join the Flight stays on the allowlisted join route before any demo screen", () => {
  const flightDetails = readFileSync(resolve(projectRoot, "app/flight/[id].tsx"), "utf8");
  const joinScreen = readFileSync(resolve(projectRoot, "app/flight/join.tsx"), "utf8");
  assert.match(flightDetails, /pathname: '\/flight\/join'/);
  assert.doesNotMatch(flightDetails, /\/flight\/demo-policy/);
  assert.match(joinScreen, /DemoPolicyScreen/);
  assert.doesNotMatch(joinScreen, /pathname: '\/flight\/demo-policy'/);
  assert.match(joinScreen, /if \(demo\.available && demo\.enabled\)/);
});

test("flight policy requires every acknowledgement and the international notice is conditional", () => {
  assert.equal(DEMO_POLICY_ACKNOWLEDGEMENTS.length, 3);
  assert.equal(canContinueDemoPolicy([true, true, false]), false);
  assert.equal(canContinueDemoPolicy([true, true]), false);
  assert.equal(canContinueDemoPolicy([true, true, true]), true);
  assert.equal(shouldShowDemoInternationalNotice(true), true);
  assert.equal(shouldShowDemoInternationalNotice(false), false);
  assert.equal(shouldShowDemoInternationalNotice(null), false);
  assert.match(simulatedInternationalFeeLabel(), /^Simulated \$/);
  const reference = readFileSync(resolve(projectRoot, "components/DemoJoinReference.tsx"), "utf8");
  const policySource = readFileSync(resolve(projectRoot, "lib/demoJoinFlow.ts"), "utf8");
  for (const acknowledgement of DEMO_POLICY_ACKNOWLEDGEMENTS) {
    assert.equal(policySource.includes(acknowledgement), true);
  }
  assert.match(reference, /DEMO_POLICY_ACKNOWLEDGEMENTS/);
  assert.match(reference, /shouldShowDemoInternationalNotice\(flight\.international\)/);
  assert.match(reference, /I Acknowledge — Continue/);
  assert.match(reference, /Continue with Base/);
  assert.doesNotMatch(reference, /bringing a pet|pet weight|passenger questionnaire/);
});

test("skip the line and purchases stay on local demo state", () => {
  const joined = createDemoJoin(flight);
  assert.equal(applySimulatedSkipLine(joined, 0), null);
  const used = applySimulatedSkipLine(joined, 2);
  assert.equal(used.phase, "pass-simulated");
  assert.equal(used.booked, false);
  assert.equal(used.simulated, true);
  assert.equal(demoTripFromEntry(used), null);
  assert.equal(confirmDemoFlight(used), null);
  const reference = readFileSync(resolve(projectRoot, "components/DemoJoinReference.tsx"), "utf8");
  const store = readFileSync(resolve(projectRoot, "lib/demoJoinFlowStore.tsx"), "utf8");
  assert.match(reference, /Use 1 Skip the Line Pass\?/);
  assert.match(reference, /Confirm — Use Skip the Line Pass/);
  assert.match(reference, /useSimulatedPass/);
  assert.match(reference, /label="Buy 1 Pass" disabled/);
  assert.match(reference, /label="Upgrade to Plus" disabled/);
  assert.match(reference, /testID="demo-purchase-apple-pay"[\s\S]*disabled/);
  assert.match(reference, /does not confirm a production seat/);
  assert.doesNotMatch(reference, /\bfetch\(|Stripe\(|requestPayment\(|buyLinePass\(|useBuyLinePass|useUseLinePassOnQueueEntry|ApplePay\.|presentPaymentSheet/);
  assert.doesNotMatch(store, /fetch\(|skipLine|buyLinePass/);
});

test("demo screens and the join button do not call production mutations", () => {
  const files = [
    "lib/demoJoinFlow.ts",
    "lib/demoJoinFlowStore.tsx",
    "components/DemoJoinStage.tsx",
    "components/DemoJoinReference.tsx",
    "components/QueueJoinConfirmation.tsx",
    "app/flight/join.tsx",
    "app/flight/demo-policy.tsx",
    "app/flight/demo-intl.tsx",
    "app/flight/demo-joined.tsx",
    "app/flight/demo-status.tsx",
    "app/flight/demo-pass.tsx",
    "app/flight/demo-purchase.tsx",
    "components/ClerkTrips.tsx",
  ].map((path) => readFileSync(resolve(projectRoot, path), "utf8"));
  for (const source of files) {
    assert.doesNotMatch(source, /joinEmptyLegQueue|leaveEmptyLegQueue|skipLine|confirmEmptyLegWinner|declineEmptyLegWinner|getMembership|createProductionQueueActions/);
  }
  const confirmation = readFileSync(resolve(projectRoot, "components/QueueJoinConfirmation.tsx"), "utf8");
  assert.match(confirmation, /if \(canSubmitProductionQueueJoin\(\)\) return;/);
  assert.match(confirmation, /disabled=\{!canSubmitProductionQueueJoin\(\) && !demoEnabled\}/);
  const trips = readFileSync(resolve(projectRoot, "components/ClerkTrips.tsx"), "utf8");
  assert.match(trips, /separateDemoTrip\(query\.data, demo\.entry\)/);
  assert.match(trips, /\(items \?\? \[\]\)\.map/);
  assert.doesNotMatch(trips, /current\.push|past\.push|\.\.\.items/);
  const readiness = readFileSync(resolve(projectRoot, "lib/productionQueueReadiness.ts"), "utf8");
  assert.match(readiness, /deployedMainService: false/);
  const policy = readFileSync(resolve(projectRoot, "lib/nativeAuthTestPolicy.ts"), "utf8");
  assert.match(policy, /'\/api\/me'/);
  assert.match(policy, /'\/api\/trips'/);
  assert.match(policy, /'\/api\/me\/referrals'/);
  assert.match(policy, /EMPTY_LEG_QUEUE_PATH/);
  assert.doesNotMatch(policy, /demo-join|DEMO_JOIN/);
});
