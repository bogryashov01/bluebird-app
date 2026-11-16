import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";
import {
  DEMO_JOIN_FLOW_DEFAULT_ENABLED,
  DEMO_PET_FEE_ACKNOWLEDGEMENT,
  DEMO_PET_FEE_LABEL,
  DEMO_PET_QUESTION,
  DEMO_POLICY_ACKNOWLEDGEMENTS,
  EMPTY_DEMO_PET,
  acknowledgeDemoPetFee,
  applySimulatedSkipLine,
  canContinueDemoPet,
  canContinueDemoPolicy,
  chooseDemoPet,
  confirmDemoFlight,
  createDemoJoin,
  demoPetConfirmation,
  demoPetSummary,
  demoPetValidationMessage,
  demoPetWeightLbs,
  demoTripFromEntry,
  isDemoJoinFlowAllowed,
  parseStoredDemoEntry,
  planDemoQueueExit,
  readDemoJoinSetting,
  separateDemoTrip,
  shouldShowDemoInternationalNotice,
  simulateDemoWinner,
  simulatedInternationalFeeLabel,
  simulatedQueuePlacement,
  updateDemoPetWeight,
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
  assert.equal(isDemoJoinFlowAllowed(true, true, true), false);
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
  assert.match(joinScreen, /demo\.available && demo\.enabled && !productionMemberData && !canSubmitProductionQueueJoin\(\)/);
  assert.match(joinScreen, /if \(demoJoinVisible\)/);
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
  assert.match(reference, /DEMO_PET_QUESTION/);
  assert.match(reference, /demo\.petDraft/);
  assert.match(reference, /setPetDraft/);
  assert.match(reference, /keyboardType="number-pad"/);
  assert.match(policySource, new RegExp(DEMO_PET_QUESTION.replace(/[?]/g, "\\?")));
  assert.match(policySource, /DEMO_PET_FEE_USD = 500/);
  assert.equal(policySource.includes(DEMO_PET_FEE_ACKNOWLEDGEMENT), true);
  assert.equal(policySource.includes(DEMO_PET_FEE_LABEL), true);
  assert.doesNotMatch(reference, /passenger questionnaire|joinEmptyLegQueue|addEmptyLegPet|requestPayment/);
  assert.doesNotMatch(policySource, /joinEmptyLegQueue|addEmptyLegPet|requestPayment|fetch\(/);
});

function yesPet(weight = "25") {
  return acknowledgeDemoPetFee(updateDemoPetWeight(chooseDemoPet(EMPTY_DEMO_PET, true), weight), true);
}

test("pet information blocks continuation until the choice, weight, and fee acknowledgement are valid", () => {
  assert.equal(canContinueDemoPet(EMPTY_DEMO_PET), false);
  assert.equal(demoPetValidationMessage(EMPTY_DEMO_PET), "Choose whether you are bringing a pet.");
  assert.equal(createDemoJoin(flight, 1, EMPTY_DEMO_PET), null);
  assert.equal(demoPetSummary(EMPTY_DEMO_PET), null);

  const declined = chooseDemoPet(yesPet("40"), false);
  assert.deepEqual(declined, { bringingPet: false, weightLbs: "", feeAcknowledged: false });
  assert.equal(canContinueDemoPet(declined), true);
  assert.equal(demoPetSummary(declined), null);
  const declinedEntry = createDemoJoin(flight, 1, declined);
  assert.equal(declinedEntry.booked, false);
  assert.equal(demoPetConfirmation(declinedEntry), null);

  const yes = chooseDemoPet(EMPTY_DEMO_PET, true);
  assert.equal(canContinueDemoPet(yes), false);
  assert.equal(demoPetValidationMessage(yes), "Enter the pet weight in pounds.");
  for (const weight of ["", "0", "00", "-5", "12.5", "abc"]) {
    assert.equal(demoPetWeightLbs(weight), null);
  }
  for (const weight of ["0", "00"]) {
    const invalid = updateDemoPetWeight(yes, weight);
    assert.equal(canContinueDemoPet(invalid), false);
    assert.equal(createDemoJoin(flight, 1, invalid), null);
    assert.equal(demoPetValidationMessage(invalid), "Pet weight must be greater than zero.");
  }
  for (const weight of ["", "abc"]) {
    const invalid = updateDemoPetWeight(yes, weight);
    assert.equal(invalid.weightLbs, "");
    assert.equal(canContinueDemoPet(invalid), false);
    assert.equal(demoPetValidationMessage(invalid), "Enter the pet weight in pounds.");
  }

  const weighted = updateDemoPetWeight(yes, "25");
  assert.equal(canContinueDemoPet(weighted), false);
  assert.equal(demoPetValidationMessage(weighted), "Acknowledge the $500 pet fee to continue.");
  assert.equal(createDemoJoin(flight, 1, weighted), null);

  const ready = yesPet("25");
  assert.equal(canContinueDemoPet(ready), true);
  assert.deepEqual(demoPetSummary(ready), { weightLbs: 25, feeLabel: "Pet Fee — $500" });
  const joined = createDemoJoin(flight, 1, ready);
  assert.equal(joined.booked, false);
  assert.equal(joined.simulated, true);
  assert.deepEqual(joined.pet, { bringingPet: true, weightLbs: 25 });
  const restored = parseStoredDemoEntry(JSON.stringify(joined));
  assert.deepEqual(restored.pet, joined.pet);
  const confirmed = confirmDemoFlight(simulateDemoWinner(joined));
  assert.equal(confirmed.booked, false);
  assert.deepEqual(demoPetConfirmation(confirmed), { weightLbs: 25, feeLabel: "Pet Fee — $500" });
  assert.equal(demoPetConfirmation(confirmDemoFlight(simulateDemoWinner(declinedEntry))), null);
  const stage = readFileSync(resolve(projectRoot, "components/DemoJoinStage.tsx"), "utf8");
  const store = readFileSync(resolve(projectRoot, "lib/demoJoinFlowStore.tsx"), "utf8");
  assert.match(stage, /demoPetConfirmation/);
  assert.match(stage, /demo-pet-summary/);
  assert.match(store, /canContinueDemoPet\(petDraft\)/);
  assert.doesNotMatch(stage, /joinEmptyLegQueue|addEmptyLegPet|requestPayment|fetch\(/);
  assert.doesNotMatch(store, /joinEmptyLegQueue|addEmptyLegPet|requestPayment|fetch\(/);
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

test("closing the queue screens leaves for Discover or Trips without changing the queue", () => {
  const entry = createDemoJoin(flight, 1_700_000_000_000);
  const discover = planDemoQueueExit({ destination: "discover", canDismiss: false });
  const trips = planDemoQueueExit({ destination: "trips", canDismiss: true });
  assert.deepEqual(discover, { href: "/(tabs)/discover", dismissAll: false, mutatesQueue: false });
  assert.deepEqual(trips, { href: "/(tabs)/trips", dismissAll: true, mutatesQueue: false });
  assert.equal(entry.phase, "joined");
  assert.equal(entry.simulated, true);
  assert.equal(entry.booked, false);
  assert.equal(demoTripFromEntry(entry), null);

  const reference = readFileSync(resolve(projectRoot, "components/DemoJoinReference.tsx"), "utf8");
  assert.equal((reference.match(/<DemoQueueCloseButton/g) ?? []).length, 2);
  assert.match(reference, /testID="demo-queue-close"/);
  assert.match(reference, /accessibilityLabel="Close"/);
  assert.match(reference, /View My Trips/);
  assert.match(reference, /testID="demo-status-view-trips"/);
  assert.match(reference, /This simulated queue is not a trip\./);
  assert.match(reference, /testID="demo-status-skip-line"/);
  assert.match(reference, /testID="demo-status-concierge"/);
  assert.match(reference, /DEMO_PET_QUESTION/);
  const exit = reference.match(/function exitDemoQueue[\s\S]*?\n\}/);
  assert.ok(exit);
  assert.match(exit[0], /planDemoQueueExit/);
  assert.match(exit[0], /router\.dismissAll\(\)/);
  assert.match(exit[0], /router\.navigate\(plan\.href\)/);
  assert.doesNotMatch(exit[0], /router\.back\(|setEntry|setEnabled|useSimulatedPass|\bjoin\(|leaveEmptyLegQueue|fetch\(|requestPayment|skipLine/);
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
  assert.match(confirmation, /if \(decision\.status === 'ready'\)/);
  assert.match(confirmation, /decision\.status === 'disabled' && demoEnabled/);
  const joinScreen = readFileSync(resolve(projectRoot, "app/flight/join.tsx"), "utf8");
  assert.match(joinScreen, /isProductionMemberDataSelected\(\)/);
  assert.match(joinScreen, /demoJoinVisible/);
  const launcher = readFileSync(resolve(projectRoot, "scripts/live-metro.mjs"), "utf8");
  const iphoneLauncher = readFileSync(resolve(projectRoot, "scripts/dev-live-iphone.mjs"), "utf8");
  assert.match(launcher, /EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT: 'production'/);
  assert.match(launcher, /EXPO_PUBLIC_BLUEBIRD_FLIGHT_READ_MODE: 'production'/);
  assert.match(launcher, /EXPO_PUBLIC_BLUEBIRD_MEMBERSHIP_DATA_MODE: 'production'/);
  assert.match(launcher, /EXPO_PUBLIC_BLUEBIRD_PRODUCTION_QUEUE_MUTATIONS: 'true'/);
  assert.match(launcher, /EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST: 'false'/);
  assert.match(launcher, /EXPO_PUBLIC_BLUEBIRD_FULL_APP_DEMO: 'false'/);
  assert.match(launcher, /EXPO_PUBLIC_BLUEBIRD_MEMBER_CONNECTIONS: 'false'/);
  assert.match(launcher, /EXPO_PUBLIC_BLUEBIRD_MEMBER_MESSAGES: 'false'/);
  assert.match(iphoneLauncher, /EXPO_PUBLIC_BLUEBIRD_MEMBER_CONNECTIONS: 'false'/);
  assert.match(iphoneLauncher, /EXPO_PUBLIC_BLUEBIRD_MEMBER_MESSAGES: 'false'/);
  assert.match(launcher, /delete process\.env\[name\]/);
  assert.match(launcher, /EXPO_PUBLIC_DOMAIN/);
  assert.doesNotMatch(launcher, /console\.log\(process\.env\)/);
  assert.doesNotMatch(iphoneLauncher, /pk_(?:test|live)_/);
  assert.match(confirmation, /disabled=\{\(!canSubmitProductionQueueJoin\(\) && !demoEnabled\) \|\| submitting\}/);
  const trips = readFileSync(resolve(projectRoot, "components/ClerkTrips.tsx"), "utf8");
  assert.match(trips, /separateDemoTrip\(query\.data, demo\.entry\)/);
  assert.match(trips, /\(visibleItems \?\? \[\]\)\.map/);
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
