import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";
import { queueAcknowledgementsComplete } from "../scripts/.queue-acknowledgements.test.mjs";
import {
  canReadJoinFlightQueue,
  canSubmitProductionQueueJoin,
  joinFlightConfirmNote,
  joinFlightPassNote,
  JOIN_FLIGHT_CONFIRM_UNAVAILABLE,
  JOIN_FLIGHT_PASS_NOTE,
  formatQueueClosingTime,
  joinFlightDisclosures,
  joinFlightQueueCountLabel,
  joinFlightQueuePositionLabel,
  joinFlightRefreshTargets,
  joinFlightRouteParams,
  JOIN_FLIGHT_QUEUE_FOOTNOTE,
  parseJoinFlightDisplay,
  prepareProductionQueueJoinBody,
  presentJoinFlightFailure,
  presentJoinFlightQueuePanel,
  presentQueueCloseCountdown,
  presentVerifiedQueueJoinSuccess,
  productionInternationalJoinStep,
  queueJoinSuccessModel,
  reviewProductionQueueJoin,
  shouldRefreshAfterJoin,
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
  assert.match(confirmation, /disabled=\{\(!canSubmitProductionQueueJoin\(\) && !demoEnabled\) \|\| submitting\}/);
  assert.match(confirmation, /if \(decision\.status === 'ready'\)/);
  assert.match(confirmation, /onJoin\?\.\(consent, creditConfirmed\)/);
  assert.doesNotMatch(hook, /\.join\(|\.leave\(|\.skipLine\(|getMembership|joinEmptyLegQueue|leaveEmptyLegQueue|confirmEmptyLegWinner|declineEmptyLegWinner/);
  assert.doesNotMatch(confirmation, /joinEmptyLegQueue|leaveEmptyLegQueue|skipLine|getMembership|fetch\(|useMutation/);
  assert.equal(joinFlightConfirmNote(false), JOIN_FLIGHT_CONFIRM_UNAVAILABLE);
  assert.equal(joinFlightConfirmNote(true), "DEMO — No real queue entry will be created.");
  assert.equal(joinFlightPassNote(), JOIN_FLIGHT_PASS_NOTE);
  assert.match(joinFlightPassNote(), /nothing is sent/);
  assert.match(confirmation, /decision\.status === 'consent-required'/);
  assert.match(readFileSync(resolve(projectRoot, "app/flight/join.tsx"), "utf8"), /demo\.enabled && !productionMemberData && !canSubmitProductionQueueJoin\(\)/);
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
  assert.deepEqual(panel, {
    kind: "participants",
    participantCount: 2,
    viewerPosition: 2,
    rows: waiting.entries,
  });
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
  assert.equal(presentJoinFlightQueuePanel({
    flightStatus: "published",
    sessionReady: true,
    signedIn: true,
    loading: false,
    failed: true,
    unauthorized: true,
    read: waiting,
  }).kind, "unauthorized");

  const watching = presentJoinFlightQueuePanel({
    flightStatus: "published",
    sessionReady: true,
    signedIn: true,
    loading: false,
    failed: false,
    read: {
      entries: [
        { position: 2, initials: "ZZ", tier: "free", hasLineSkip: false, isViewer: false },
        { position: 1, initials: "AA", tier: "plus", hasLineSkip: true, isViewer: false },
      ],
      viewer: { status: "not-in-queue" },
    },
  });
  assert.equal(watching.kind, "participants");
  assert.equal(watching.viewerPosition, null);
  assert.deepEqual(watching.rows.map((row) => row.position), [1, 2]);
  assert.equal(watching.rows[0].hasLineSkip, true);
  assert.equal(watching.rows.some((row) => row.isViewer), false);
  assert.equal(JSON.stringify(watching).includes("seat"), false);
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
  assert.match(joinScreen, /useProductionQueueMutation\(/);
  assert.match(joinScreen, /success=\{queueMutation\.success\}/);
  assert.doesNotMatch(joinScreen, /presentVerifiedQueueJoinSuccess\(flight\.flightId, null\)/);
  assert.match(joinScreen, /useJoinFlightQueueRead\(flight\?\.flightId \?\? 0, flight\?\.flightStatus \?\? null\)/);
  for (const source of [joinScreen, confirmation, success]) {
    assert.doesNotMatch(source, /joinEmptyLegQueue|leaveEmptyLegQueue|skipLine|getMembership|getEmptyLegQueue|createProductionQueueActions|useMutation|fetch\(/);
  }
  assert.match(confirmation, /disabled=\{\(!canSubmitProductionQueueJoin\(\) && !demoEnabled\) \|\| submitting\}/);
  assert.match(confirmation, /if \(decision\.status === 'ready'\)/);
  assert.match(confirmation, /onJoin\?\.\(consent, creditConfirmed\)/);
  assert.doesNotMatch(confirmation, /join-flight-queue-viewer|queueRosterTierLabel/);
  const acknowledgements = readFileSync(resolve(projectRoot, "lib/queueAcknowledgements.ts"), "utf8");
  const acknowledgementScreen = readFileSync(resolve(projectRoot, "components/QueueAcknowledgement.tsx"), "utf8");
  const queueStatus = readFileSync(resolve(projectRoot, "app/flight/queue-status.tsx"), "utf8");
  assert.match(acknowledgements, /Flights may be cancelled or changed due to operational requirements\./);
  assert.match(acknowledgements, /Baggage restrictions apply based on aircraft type and available space\./);
  assert.match(acknowledgements, /Pet policies apply — please confirm your pet meets carrier requirements\./);
  assert.match(acknowledgements, /Are you traveling with a pet\?/);
  assert.match(acknowledgements, /A \$500 pet cleaning fee may apply only if this flight is awarded/);
  assert.match(acknowledgements, /This acknowledgement is not a payment/);
  assert.doesNotMatch(acknowledgements, /DEMO_POLICY|DEMO_PET/);
  assert.match(acknowledgementScreen, /queueAcknowledgementsComplete/);
  assert.match(acknowledgementScreen, /I Acknowledge — Continue/);
  assert.match(acknowledgementScreen, /traveling-pet-\$\{value \? 'yes' : 'no'\}/);
  assert.match(joinScreen, /if \(!acknowledged\)/);
  assert.match(joinScreen, /setAcknowledged\(true\)/);
  assert.match(joinScreen, /productionInternationalJoinStep/);
  assert.match(joinScreen, /pathname: '\/flight\/queue-status'/);
  assert.doesNotMatch(acknowledgementScreen, /joinEmptyLegQueue|onJoin|fetch\(|payment|useInternationalPassCredit|internationalPassAuthorized/);
  const international = readFileSync(resolve(projectRoot, "components/ProductionInternationalNotice.tsx"), "utf8");
  const joined = readFileSync(resolve(projectRoot, "components/ProductionQueueJoined.tsx"), "utf8");
  assert.match(international, /International Flight Notice/);
  assert.match(international, /Authorize an International Pass/);
  assert.match(international, /Use an International Pass credit/);
  assert.match(international, /does not upgrade membership/);
  assert.match(international, /Upgrade to Plus is not available/);
  assert.doesNotMatch(international, /\$1,000|fetch\(|skipLine/);
  assert.match(joined, /You're in the queue/);
  assert.match(joined, /View Queue Status/);
  assert.match(joined, /disabled=\{!skipLineAvailable\}/);
  assert.doesNotMatch(joined, /skipLine\(|fetch\(/);
  assert.match(queueStatus, /join-flight-queue-viewer/);
  assert.match(queueStatus, /queueRosterTierLabel/);
  assert.match(queueStatus, /Leave the Queue/);
  assert.doesNotMatch(queueStatus, /position:\s*1|You are #1/);
  assert.match(confirmation, /View My Trips/);
  assert.doesNotMatch(confirmation, /DEMO_PET|simulatedQueue|demo-status-view-trips/);
  const queueRead = readFileSync(resolve(projectRoot, "lib/useJoinFlightQueueRead.ts"), "utf8");
  assert.match(queueRead, /\.read\(requestedFlightId/);
  assert.doesNotMatch(queueRead, /\.join\(|\.leave\(|\.skipLine\(|getMembership|\/api\/membership/);
  assert.match(queueRead, /status === 401/);
  const policy = readFileSync(resolve(projectRoot, "lib/nativeAuthTestPolicy.ts"), "utf8");
  assert.match(policy, /EMPTY_LEG_QUEUE_PATH/);
  assert.match(policy, /method\.toUpperCase\(\) !== 'GET'/);
  assert.match(policy, /'\/api\/membership'/);
  assert.doesNotMatch(policy, /\/api\/membership\//);
  const readiness = readFileSync(resolve(projectRoot, "lib/productionQueueReadiness.ts"), "utf8");
  assert.match(readiness, /deployedMainService: false/);
  const demoRoutes = readFileSync(resolve(projectRoot, "lib/fullAppDemo.ts"), "utf8");
  assert.match(demoRoutes, /policy\|confirmed/);
  assert.doesNotMatch(demoRoutes, /flight\/join/);
  assert.match(confirmation, /label="Join Flight"/);
  assert.match(confirmation, /reviewProductionQueueJoin/);
  assert.match(confirmation, /decision\.status === 'disabled' && demoEnabled/);
  assert.doesNotMatch(confirmation, /internationalPassAuthorized|useInternationalPassCredit/);
});

test("join request bodies, pass consent, conflicts, and account refresh stay behind the closed gate", () => {
  assert.deepEqual(prepareProductionQueueJoinBody("none"), {});
  assert.deepEqual(prepareProductionQueueJoinBody("authorize-pass"), { internationalPassAuthorized: true });
  assert.deepEqual(prepareProductionQueueJoinBody("use-credit"), { useInternationalPassCredit: true });
  assert.equal("useInternationalPassCredit" in prepareProductionQueueJoinBody("authorize-pass"), false);
  assert.equal("internationalPassAuthorized" in prepareProductionQueueJoinBody("use-credit"), false);
  assert.deepEqual(reviewProductionQueueJoin({
    consent: "authorize-pass",
    internationalPassRequired: true,
  }), { status: "disabled", body: null });
  assert.deepEqual(reviewProductionQueueJoin({
    consent: "none",
    internationalPassRequired: true,
  }), { status: "disabled", body: null });

  const conflict = presentJoinFlightFailure({
    status: 409,
    body: {
      code: "same_day_queue_conflict",
      message: "token secret-value",
      conflict: {
        emptyLegId: 88,
        originAirport: "aus",
        destinationAirport: "TEB",
        departureTime: "2026-11-02T15:00:00.000Z",
        email: "member@example.com",
        token: "secret-value",
      },
    },
  });
  assert.equal(conflict.keepsExistingQueue, true);
  assert.equal(conflict.conflict.emptyLegId, 88);
  assert.equal(conflict.conflict.originAirport, "AUS");
  assert.equal(conflict.conflict.destinationAirport, "TEB");
  assert.equal(JSON.stringify(conflict).includes("secret-value"), false);
  assert.equal(JSON.stringify(conflict).includes("member@example.com"), false);
  assert.match(conflict.body, /existing queue was not changed/);

  assert.equal(presentJoinFlightFailure({ status: 409, code: "queue_closed" }).title, "Queue closed");
  assert.equal(presentJoinFlightFailure({ status: 409, code: "departed" }).title, "Flight departed");
  assert.equal(presentJoinFlightFailure({ status: 409 }).conflict, null);
  assert.match(presentJoinFlightFailure({ status: 400 }).body, /did not accept/);
  assert.match(presentJoinFlightFailure({ status: 401 }).body, /Sign in again/);
  assert.match(presentJoinFlightFailure({ status: 402 }).body, /No card was charged/);
  assert.match(presentJoinFlightFailure({ status: 403 }).body, /does not confirm/);
  assert.match(presentJoinFlightFailure({ status: 404 }).body, /no longer available/);
  assert.match(presentJoinFlightFailure({ status: null }).body, /could not reach Bluebird/);

  const closing = "2026-11-01T18:30:00.000Z";
  const params = joinFlightRouteParams(42, {
    ...flight,
    international: true,
    queueClosesAt: closing,
    internationalPassRequired: true,
  });
  assert.equal(params.queueClosesAt, closing);
  assert.equal(params.internationalPassRequired, "1");
  const parsed = parseJoinFlightDisplay(params);
  assert.equal(parsed.queueClosesAt, closing);
  assert.equal(parsed.internationalPassRequired, true);
  assert.match(formatQueueClosingTime(closing), /UTC/);
  assert.equal(formatQueueClosingTime("tomorrow"), null);
  assert.equal(parseJoinFlightDisplay({ flightId: "42", queueClosesAt: "not-a-time" }).queueClosesAt, null);
  assert.equal(parseJoinFlightDisplay({ flightId: "42", internationalPassRequired: "yes" }).internationalPassRequired, null);

  const first = joinFlightRefreshTargets({ environment: "production", clerkUserId: "user_a", flightId: 42 });
  const second = joinFlightRefreshTargets({ environment: "production", clerkUserId: "user_b", flightId: 42 });
  assert.notDeepEqual(first.detail, second.detail);
  assert.notDeepEqual(first.queue, second.queue);
  assert.notDeepEqual(first.myQueues, second.myQueues);
  assert.equal(first.detail[2], "user_a");
  assert.equal(first.queue[3], "empty-leg-queue");
  assert.equal(shouldRefreshAfterJoin({
    gateOpen: canSubmitProductionQueueJoin(),
    requestedUserId: "user_a",
    activeUserId: "user_a",
    signedIn: true,
  }), false);
  assert.equal(shouldRefreshAfterJoin({
    gateOpen: true,
    requestedUserId: "user_a",
    activeUserId: "user_b",
    signedIn: true,
  }), false);
  assert.equal(shouldRefreshAfterJoin({
    gateOpen: true,
    requestedUserId: "user_a",
    activeUserId: null,
    signedIn: false,
  }), false);
});

test("queue acknowledgements and the international step gate the production join", () => {
  assert.equal(queueAcknowledgementsComplete({
    checked: [true, true, false],
    bringingPet: false,
    petFeeAcknowledged: false,
  }), false);
  assert.equal(queueAcknowledgementsComplete({
    checked: [true, true, true],
    bringingPet: null,
    petFeeAcknowledged: false,
  }), false);
  assert.equal(queueAcknowledgementsComplete({
    checked: [true, true, true],
    bringingPet: false,
    petFeeAcknowledged: false,
  }), true);
  assert.equal(queueAcknowledgementsComplete({
    checked: [true, true, true],
    bringingPet: true,
    petFeeAcknowledged: false,
  }), false);
  assert.equal(queueAcknowledgementsComplete({
    checked: [true, true, true],
    bringingPet: true,
    petFeeAcknowledged: true,
  }), true);
  assert.equal(productionInternationalJoinStep({ international: false, internationalPassRequired: true }), "skip");
  assert.equal(productionInternationalJoinStep({ international: null, internationalPassRequired: true }), "skip");
  assert.equal(productionInternationalJoinStep({ international: true, internationalPassRequired: false }), "not-required");
  assert.equal(productionInternationalJoinStep({ international: true, internationalPassRequired: true }), "required");
  assert.equal(productionInternationalJoinStep({ international: true, internationalPassRequired: null }), "unknown");
  const closing = new Date("2099-01-01T00:00:00.000Z").getTime();
  assert.equal(presentQueueCloseCountdown("2099-01-01T01:02:03.000Z", closing), "01:02:03");
  assert.equal(presentQueueCloseCountdown("not-a-time", closing), null);
  assert.equal(presentQueueCloseCountdown(null, closing), null);
});
