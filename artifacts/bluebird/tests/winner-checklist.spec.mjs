import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";
import {
  PASSENGER_PLACEHOLDER_NOTE,
  POLICY_UNAVAILABLE_NOTE,
  awardStateForFlight,
  canAcknowledgeProductionManifest,
  canAcknowledgeProductionPolicy,
  canConfirmProductionWinner,
  canDeclineProductionWinner,
  canSendProductionBoardingPass,
  canVerifyProductionFbo,
  currentTripChecklistTarget,
  isQueueClosed,
  labelCurrentTrips,
  listedTripForChecklist,
  PASSENGER_DETAILS_UNAVAILABLE_NOTE,
  POLICY_DOCUMENT_UNAVAILABLE_NOTE,
  presentBoardingPass,
  presentChecklistSteps,
  presentTripActionFailure,
  presentTripChecklistStatus,
  presentWinnerState,
  resolveCurrentTripChecklistNavigation,
  reviewBoardingPassSend,
  reviewFboVerification,
  reviewManifestAcknowledgement,
  reviewPolicyAcknowledgement,
  reviewWinnerConfirmation,
  reviewWinnerDecline,
  shouldApplyTripChecklist,
} from "../scripts/.winner-checklist.test.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const closedAt = "2026-10-29T10:00:00.000Z";
const now = Date.parse("2026-10-29T12:00:00.000Z");
const later = Date.parse("2026-10-29T09:00:00.000Z");

function winner(overrides = {}) {
  return presentWinnerState({
    viewerAuthenticated: true,
    viewerIsEffectiveWinner: true,
    viewerConfirmationStatus: "pending",
    queueClosesAt: closedAt,
    nowMs: now,
    awarded: false,
    ...overrides,
  });
}

test("an effective winner of a closed unawarded queue is selected, and a formal award is separate", () => {
  const selected = winner();
  assert.equal(selected.kind, "selected");
  assert.equal(selected.actions, true);
  assert.equal(selected.confirmationLabel, "Awaiting your confirmation");
  assert.equal(winner({ viewerConfirmationStatus: "confirmed" }).actions, false);
  assert.equal(winner({ awarded: true }).kind, "awarded");
  assert.equal(winner({ awarded: true, viewerConfirmationStatus: "declined" }).kind, "awarded");
  assert.equal(winner({ viewerIsEffectiveWinner: false }).kind, "hidden");
  assert.equal(presentWinnerState.length, 1);
});

test("winner copy stays hidden before queue closure and when viewer or award state is unknown", () => {
  assert.equal(isQueueClosed(null, now), false);
  assert.equal(isQueueClosed("not-a-time", now), false);
  assert.equal(winner({ queueClosesAt: "2026-10-29T13:00:00.000Z" }).kind, "hidden");
  assert.equal(winner({ queueClosesAt: null }).kind, "hidden");
  assert.equal(winner({ nowMs: later }).kind, "hidden");
  assert.equal(winner({ viewerAuthenticated: false }).kind, "hidden");
  assert.equal(winner({ awarded: null }).kind, "hidden");
  assert.equal(winner({ viewerIsEffectiveWinner: null, awarded: null }).kind, "hidden");
  assert.equal(winner({ viewerConfirmationStatus: null, viewerIsEffectiveWinner: null }).kind, "hidden");
});

test("a declined effective winner has no confirm or rejoin action", () => {
  const declined = winner({ viewerConfirmationStatus: "declined" });
  assert.equal(declined.kind, "declined");
  assert.equal("actions" in declined, false);
  const source = readFileSync(resolve(projectRoot, "components/WinnerFlightNotice.tsx"), "utf8");
  assert.match(source, /presentation\.kind !== 'declined'/);
  assert.doesNotMatch(source, /rejoin|Join Flight|joinEmptyLegQueue/i);
});

test("confirmation, decline, and checklist mutation gates stay disabled and do not prepare a request body", () => {
  assert.equal(canConfirmProductionWinner(), false);
  assert.equal(canDeclineProductionWinner(), false);
  assert.equal(canVerifyProductionFbo(), false);
  assert.equal(canAcknowledgeProductionManifest(), false);
  assert.equal(canAcknowledgeProductionPolicy(), false);
  assert.equal(canSendProductionBoardingPass(), false);
  const reviews = [
    reviewWinnerConfirmation(42),
    reviewWinnerDecline(42, true),
    reviewFboVerification(42),
    reviewManifestAcknowledgement(42),
    reviewPolicyAcknowledgement(42),
    reviewBoardingPassSend(42),
  ];
  for (const review of reviews) {
    assert.equal(review.status, "disabled");
    assert.equal(review.method, "POST");
    assert.equal(review.body, null);
  }
  assert.equal(reviewWinnerConfirmation(42).path, "/trips/42/checklist/confirmed");
  assert.equal(reviewWinnerDecline(42, true).path, "/empty-legs/42/winner/decline");
  assert.equal(reviewWinnerDecline(42, false).status, "needs-confirmation");
  assert.equal(reviewFboVerification(42).path, "/trips/42/checklist/fboVerified");
  assert.equal(reviewManifestAcknowledgement(42).path, "/trips/42/checklist/manifestAck");
  assert.equal(reviewPolicyAcknowledgement(42).path, "/trips/42/checklist/policyAck");
  assert.equal(reviewBoardingPassSend(42).path, "/trips/42/boarding-pass/send");
  assert.equal(reviewWinnerConfirmation(0).status, "invalid");
});

test("checklist screens return before a disabled mutation and do not post", () => {
  const notice = readFileSync(resolve(projectRoot, "components/WinnerFlightNotice.tsx"), "utf8");
  const checklist = readFileSync(resolve(projectRoot, "app/flight/checklist.tsx"), "utf8");
  const library = readFileSync(resolve(projectRoot, "lib/winnerChecklist.ts"), "utf8");
  for (const source of [notice, checklist, library]) {
    assert.doesNotMatch(source, /(?<![\w.])fetch\(|confirmEmptyLegWinner|declineEmptyLegWinner|joinEmptyLegQueue|awarded\s*=\s*true/);
  }
  assert.match(notice, /disabled=\{!canConfirmProductionWinner\(\)\}/);
  assert.match(notice, /disabled=\{!canDeclineProductionWinner\(\)\}/);
  assert.match(notice, /if \(!canDeclineProductionWinner\(\)\) return/);
  assert.match(notice, /if \(decision\.status !== 'ready'\) return/);
  assert.match(notice, /Confirmation is not available in this build/);
  assert.match(checklist, /disabled=\{!canConfirmProductionWinner\(\)\}/);
  assert.match(checklist, /disabled=\{!canDeclineProductionWinner\(\)\}/);
  assert.match(checklist, /disabled=\{!canVerifyProductionFbo\(\)\}/);
  assert.match(checklist, /disabled=\{!canAcknowledgeProductionManifest\(\)\}/);
  assert.match(checklist, /disabled=\{!canAcknowledgeProductionPolicy\(\)\}/);
  assert.match(checklist, /if \(!canDeclineProductionWinner\(\)\) return/);
  assert.match(checklist, /Alert\.alert/);
  assert.doesNotMatch(checklist, /reviewBoardingPassSend|boarding-pass\/send/);
  assert.doesNotMatch(library, /setInterval|confirmationExpires|60 \* 60 \* 1000|viewerIsBookedPassenger|awardedToClerkUserId|viewerQueuePosition/);
});

test("trip checklist reads are account scoped and the detail read is not used by flight details", () => {
  assert.equal(shouldApplyTripChecklist({
    requestedUserId: "user-a",
    activeUserId: "user-a",
    signedIn: true,
  }), true);
  assert.equal(shouldApplyTripChecklist({
    requestedUserId: "user-a",
    activeUserId: "user-b",
    signedIn: true,
  }), false);
  assert.equal(shouldApplyTripChecklist({
    requestedUserId: "user-a",
    activeUserId: null,
    signedIn: false,
  }), false);
  const checklist = readFileSync(resolve(projectRoot, "app/flight/checklist.tsx"), "utf8");
  const details = readFileSync(resolve(projectRoot, "app/flight/[id].tsx"), "utf8");
  const notice = readFileSync(resolve(projectRoot, "components/WinnerFlightNotice.tsx"), "utf8");
  assert.match(checklist, /mainBluebirdAuthenticatedQueryKey\(configuration\.environment, clerkUserId, 'trip', legId\)/);
  assert.match(checklist, /api\.authenticated\.getTrip\(requestedLegId, \{ signal \}\)/);
  assert.match(checklist, /retry: false/);
  assert.match(checklist, /refetchInterval: false/);
  assert.match(checklist, /refetchOnWindowFocus: false/);
  assert.match(checklist, /refetchOnReconnect: false/);
  assert.match(checklist, /refetchOnMount: false/);
  assert.match(checklist, /removeQueries/);
  assert.doesNotMatch(details, /getTrip\(|\/api\/trips\/|useGetTrip\(/);
  assert.doesNotMatch(notice, /getTrip\(|\/api\/trips\//);
  assert.match(notice, /listTrips\(\{ signal \}\)/);
  assert.match(notice, /mainBluebirdAuthenticatedQueryKey\(configuration\.environment, clerkUserId, 'trips'\)/);
});

test("current trips keep an unconfirmed effective winner and distinguish award progress", () => {
  const labels = labelCurrentTrips({
    current: [
      { checklist: { emptyLegId: 7, awarded: false, remainingSteps: ["confirmed"] } },
      { checklist: { emptyLegId: 8, awarded: true, remainingSteps: ["policyAck"] } },
      { checklist: { emptyLegId: 9, awarded: true, remainingSteps: [] } },
    ],
    past: [],
  });
  assert.deepEqual(labels, [
    { flightId: 7, label: "Awaiting confirmation" },
    { flightId: 8, label: "Checklist in progress" },
    { flightId: 9, label: "Confirmed" },
  ]);
  assert.equal(presentTripChecklistStatus({
    list: "past",
    awarded: false,
    remainingSteps: ["confirmed"],
  }), "Past trip");
  assert.equal(awardStateForFlight({
    current: [{ leg: { id: 7 }, checklist: { emptyLegId: 7, awarded: false } }],
    past: [],
  }, 7), false);
  assert.equal(awardStateForFlight(undefined, 7), null);
  const trips = readFileSync(resolve(projectRoot, "components/ClerkTrips.tsx"), "utf8");
  const checklistLibrary = readFileSync(resolve(projectRoot, "lib/winnerChecklist.ts"), "utf8");
  assert.match(trips, /presentTripChecklistStatus/);
  assert.match(trips, /clerk-trip-status/);
  assert.match(trips, /currentTripChecklistTarget/);
  assert.match(checklistLibrary, /pathname: '\/flight\/checklist'/);
  assert.doesNotMatch(trips, /boardingPass|filter\(.*awarded|getTrip\(|router\.replace/);
});

test("an awarded current trip opens the existing checklist, and other trips do not", () => {
  const awarded = {
    current: [{ leg: { id: 42 }, checklist: { awarded: true } }],
    past: [],
  };
  assert.deepEqual(currentTripChecklistTarget({ list: "current", awarded: true, legId: 42 }), {
    pathname: "/flight/checklist",
    params: { legId: "42" },
  });
  assert.equal(currentTripChecklistTarget({ list: "current", awarded: false, legId: 42 }), null);
  assert.equal(currentTripChecklistTarget({ list: "current", awarded: true, legId: 0 }), null);
  assert.equal(currentTripChecklistTarget({ list: "current", awarded: true, legId: -1 }), null);
  assert.equal(currentTripChecklistTarget({ list: "past", awarded: true, legId: 42 }), null);
  assert.deepEqual(resolveCurrentTripChecklistNavigation({
    signedIn: true,
    activeUserId: "user-a",
    accountUserId: "user-a",
    cachedTrips: awarded,
    legId: 42,
  }), { pathname: "/flight/checklist", params: { legId: "42" } });
  assert.equal(resolveCurrentTripChecklistNavigation({
    signedIn: true,
    activeUserId: "user-b",
    accountUserId: "user-a",
    cachedTrips: awarded,
    legId: 42,
  }), null);
  assert.equal(resolveCurrentTripChecklistNavigation({
    signedIn: false,
    activeUserId: null,
    accountUserId: "user-a",
    cachedTrips: awarded,
    legId: 42,
  }), null);
  assert.equal(resolveCurrentTripChecklistNavigation({
    signedIn: true,
    activeUserId: "user-a",
    accountUserId: "user-a",
    cachedTrips: { current: [{ leg: { id: 42 }, checklist: { awarded: false } }], past: [] },
    legId: 42,
  }), null);
  assert.equal(resolveCurrentTripChecklistNavigation({
    signedIn: true,
    activeUserId: "user-a",
    accountUserId: "user-a",
    cachedTrips: null,
    legId: 42,
  }), null);
  const trips = readFileSync(resolve(projectRoot, "components/ClerkTrips.tsx"), "utf8");
  assert.match(trips, /resolveCurrentTripChecklistNavigation/);
  assert.match(trips, /router\.push\(target\)/);
  assert.doesNotMatch(trips, /getTrip\(|getEmptyLegPassengers/);
});

test("a boarding pass is shown only for an awarded trip with an authorized https URL", () => {
  const url = "https://example.com/pass";
  assert.equal(presentBoardingPass({ awarded: false, boardingPassUrl: url }), null);
  assert.equal(presentBoardingPass({ awarded: true, boardingPassUrl: "http://example.com/pass" }), null);
  assert.equal(presentBoardingPass({ awarded: true, boardingPassUrl: null }), null);
  assert.equal(presentBoardingPass({ awarded: true, boardingPassUrl: "https://example.com/pass extra" }), null);
  assert.equal(presentBoardingPass({ awarded: true, boardingPassUrl: url }), url);
  const checklist = readFileSync(resolve(projectRoot, "app/flight/checklist.tsx"), "utf8");
  assert.match(checklist, /presentBoardingPass/);
  assert.doesNotMatch(checklist, /console\.log|AsyncStorage/);
});

test("passenger and policy steps state the unresolved contract and do not invent content", () => {
  assert.match(PASSENGER_PLACEHOLDER_NOTE, /Gender/);
  assert.match(PASSENGER_PLACEHOLDER_NOTE, /seat capacity/);
  assert.match(PASSENGER_PLACEHOLDER_NOTE, /Saving passenger changes is not available/);
  assert.match(POLICY_UNAVAILABLE_NOTE, /Acknowledgement is not available/);
  const steps = presentChecklistSteps({
    confirmedAt: null,
    fboVerifiedAt: null,
    manifestAckAt: null,
    policyAckAt: null,
  });
  assert.deepEqual(steps.map((step) => step.complete), [false, false, false, false]);
  const completed = presentChecklistSteps({
    confirmedAt: closedAt,
    fboVerifiedAt: closedAt,
    manifestAckAt: closedAt,
    policyAckAt: closedAt,
  });
  assert.deepEqual(completed.map((step) => step.complete), [true, true, true, true]);
  const checklist = readFileSync(resolve(projectRoot, "app/flight/checklist.tsx"), "utf8");
  assert.doesNotMatch(checklist, /POLICY_SECTIONS|passport/);
  assert.match(checklist, /FBO details are not available for this flight/);
});

test("an auth-test awarded trip uses the trip list and does not call blocked checklist reads", () => {
  const awarded = {
    current: [{
      leg: {
        id: 42,
        originAirport: "TEB",
        destinationAirport: "OPF",
        originFboName: null,
        originFboAddress: null,
        destinationFboName: null,
        destinationFboAddress: null,
      },
      checklist: {
        emptyLegId: 42,
        awarded: true,
        remainingSteps: ["manifestAck"],
        passengerCount: 1,
        boardingPassUrl: null,
        confirmedAt: null,
        fboVerifiedAt: null,
        manifestAckAt: null,
        policyAckAt: null,
      },
    }],
    past: [{
      leg: { id: 7 },
      checklist: { emptyLegId: 7, awarded: true },
    }],
  };
  assert.equal(listedTripForChecklist(awarded, 42)?.checklist.passengerCount, 1);
  assert.equal(listedTripForChecklist(awarded, 7), null);
  assert.equal(listedTripForChecklist({
    current: [{ leg: { id: 42 }, checklist: { emptyLegId: 42, awarded: false } }],
    past: [],
  }, 42), null);
  assert.equal(listedTripForChecklist(null, 42), null);
  assert.equal(listedTripForChecklist(awarded, 0), null);
  const steps = presentChecklistSteps({
    confirmedAt: null,
    fboVerifiedAt: null,
    manifestAckAt: null,
    policyAckAt: null,
  }, {
    passengerDetailsAvailable: false,
    policyDocumentAvailable: false,
  });
  assert.equal(steps.find((step) => step.id === "manifestAck")?.detail, PASSENGER_DETAILS_UNAVAILABLE_NOTE);
  assert.equal(steps.find((step) => step.id === "policyAck")?.detail, POLICY_DOCUMENT_UNAVAILABLE_NOTE);
  assert.equal(presentBoardingPass({ awarded: true, boardingPassUrl: null }), null);

  const checklist = readFileSync(resolve(projectRoot, "app/flight/checklist.tsx"), "utf8");
  const passengers = readFileSync(resolve(projectRoot, "app/flight/passengers.tsx"), "utf8");
  const policy = readFileSync(resolve(projectRoot, "lib/nativeAuthTestPolicy.ts"), "utf8");
  assert.match(checklist, /enabled: ready && !authTest/);
  assert.match(checklist, /listedTripForChecklist/);
  assert.match(checklist, /checklist-back-to-trips/);
  assert.match(checklist, /if \(router\.canGoBack\(\)\) router\.back\(\);\n  else router\.replace\('\/\(tabs\)\/trips'\)/);
  assert.match(checklist, /disabled=\{authTest\}/);
  assert.match(checklist, /Passenger count is not available for this flight/);
  assert.match(passengers, /enabled: ready && !authTest/);
  assert.match(passengers, /passengers-back-to-trips/);
  assert.doesNotMatch(policy, /\/api\/trips\/\$\{|'\/api\/trips\/'|empty-legs\/\$\{[^}]*\}\/passengers|\/passengers'/);
  assert.equal(canConfirmProductionWinner(), false);
  assert.equal(canDeclineProductionWinner(), false);
  assert.equal(canVerifyProductionFbo(), false);
  assert.equal(canAcknowledgeProductionManifest(), false);
  assert.equal(canAcknowledgeProductionPolicy(), false);
  assert.equal(canSendProductionBoardingPass(), false);
  const manifest = readFileSync(resolve(projectRoot, "lib/passengerManifest.ts"), "utf8");
  assert.match(manifest, /export function canCreateProductionPassenger\(\): boolean \{\n  return false;\n\}/);
  assert.match(manifest, /export function canUpdateProductionPassenger\(\): boolean \{\n  return false;\n\}/);
  assert.match(manifest, /export function canDeleteProductionPassenger\(\): boolean \{\n  return false;\n\}/);
});

test("trip action failures use local copy and production gates stay closed", () => {
  const failure = presentTripActionFailure(409);
  assert.match(failure.body, /Nothing was changed/);
  assert.doesNotMatch(`${failure.title} ${failure.body}`, /token|eyJ|@/);
  assert.equal(presentTripActionFailure(401).title, "Sign in required");
  assert.equal(presentTripActionFailure(403).title, "Not available");
  assert.equal(presentTripActionFailure(404).title, "Flight unavailable");
  assert.equal(presentTripActionFailure(400).title, "Request not accepted");
  assert.equal(presentTripActionFailure(null).title, "Connection problem");
  const join = readFileSync(resolve(projectRoot, "lib/joinFlightPresentation.ts"), "utf8");
  const readiness = readFileSync(resolve(projectRoot, "lib/productionQueueReadiness.ts"), "utf8");
  const policy = readFileSync(resolve(projectRoot, "lib/nativeAuthTestPolicy.ts"), "utf8");
  const api = readFileSync(resolve(projectRoot, "lib/productionAuthApi.ts"), "utf8");
  assert.match(join, /export function canSubmitProductionQueueJoin\(\): boolean \{\n  return isProductionQueueMutationsEnabled\(\);\n\}/);
  assert.match(readiness, /deployedMainService: false/);
  assert.match(policy, /method\.toUpperCase\(\) !== 'GET'/);
  assert.doesNotMatch(policy, /checklist\/confirmed|checklist\/fboVerified|winner\/decline|boarding-pass\/send|\/api\/trips\//);
  assert.match(api, /getTrip: \(legId: number/);
  assert.match(api, /request\(`\/trips\/\$\{legId\}`, 'GET'/);
});
