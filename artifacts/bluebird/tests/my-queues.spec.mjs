import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  QUEUE_CANDIDATE_LIMIT,
  addQueueCandidate,
  loadQueueCandidates,
  normalizeQueueCandidateId,
  parseStoredQueueCandidates,
  queueCandidateStorageKey,
  saveQueueCandidate,
} from "../scripts/.queue-candidates.test.mjs";
import {
  MY_QUEUES_COVERAGE_NOTE,
  MY_QUEUES_EMPTY,
  MY_QUEUES_NONE_SAVED,
  MY_QUEUES_DETAILS_UNAVAILABLE,
  MY_QUEUES_LISTED_ON_CURRENT,
  MY_QUEUES_NOT_BOOKING,
  MY_QUEUES_STATUS,
  QUEUE_CLOSING_REACHED,
  QUEUE_CLOSING_UNAVAILABLE,
  QUEUE_STATUS_UNAVAILABLE,
  applyViewerMembership,
  awardedCurrentFlightIds,
  parseQueueInstant,
  presentQueueCountdown,
  presentQueueLifecycle,
  queueClosingInstant,
  queueFlightDetailsTarget,
  MY_QUEUES_PARTIAL,
  describeMyQueues,
  isRosterCacheFresh,
  presentMyQueueRequestFailure,
  presentQueueFlightMetadata,
  presentRosterEntries,
  presentServerMemberQueues,
  memberQueuePosition,
  queueFlightReference,
  runRosterPool,
  shouldAcceptRosterResult,
  shouldRequestRoster,
  uniqueQueueCandidateIds,
} from "../scripts/.my-queues-presentation.test.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const row = (position, initials, isViewer) => ({
  position,
  initials,
  tier: "base",
  hasLineSkip: false,
  isViewer,
});

function memoryStorage() {
  const values = new Map();
  const operations = [];
  return {
    operations,
    async getItem(key) {
      operations.push(["get", key]);
      return values.has(key) ? values.get(key) : null;
    },
    async setItem(key, value) {
      operations.push(["set", key]);
      values.set(key, value);
    },
    async removeItem(key) {
      operations.push(["remove", key]);
      values.delete(key);
    },
  };
}

test("candidate IDs are positive integers, deduplicated, bounded, and kept per Clerk account", async () => {
  assert.equal(normalizeQueueCandidateId(42), 42);
  assert.equal(normalizeQueueCandidateId("42"), 42);
  for (const value of [0, -1, 1.5, Number.NaN, "", "01", "2.0", null, true]) {
    assert.equal(normalizeQueueCandidateId(value), null);
  }
  assert.equal(queueCandidateStorageKey("user_a"), "bluebird.queue-candidates.user_a");
  assert.equal(queueCandidateStorageKey("user_b"), "bluebird.queue-candidates.user_b");
  assert.equal(queueCandidateStorageKey("../user_a"), null);
  assert.notEqual(queueCandidateStorageKey("user_a"), queueCandidateStorageKey("user_b"));

  const storage = memoryStorage();
  assert.deepEqual(await saveQueueCandidate(storage, "user_a", 4), [4]);
  assert.deepEqual(await saveQueueCandidate(storage, "user_a", 4), [4]);
  assert.deepEqual(await saveQueueCandidate(storage, "user_a", 9), [9, 4]);
  assert.deepEqual(await saveQueueCandidate(storage, "user_b", 9), [9]);
  assert.deepEqual(await loadQueueCandidates(storage, "user_a"), [9, 4]);
  assert.deepEqual(await loadQueueCandidates(storage, "user_b"), [9]);
  assert.equal(await saveQueueCandidate(storage, "user_a", 0), null);
  assert.equal(storage.operations.some((entry) => entry[0] === "remove"), false);

  let ids = [];
  for (let id = 1; id <= QUEUE_CANDIDATE_LIMIT + 1; id += 1) ids = addQueueCandidate(ids, id);
  assert.equal(ids.length, QUEUE_CANDIDATE_LIMIT);
  assert.equal(ids[0], QUEUE_CANDIDATE_LIMIT + 1);
  assert.equal(ids.includes(1), false);
  assert.deepEqual(parseStoredQueueCandidates("{"), []);
  assert.deepEqual(parseStoredQueueCandidates(JSON.stringify({ v: 2, ids: [3] })), []);
  assert.deepEqual(parseStoredQueueCandidates(JSON.stringify({ v: 1, ids: [3, "4", 3, 0] })), [3, 4]);
});

test("a queue appears only when the roster marks the signed-in viewer", () => {
  const confirmed = presentRosterEntries([row(1, "AA", false), row(2, "BB", true)]);
  assert.equal(confirmed.kind, "confirmed");
  assert.equal(confirmed.position, 2);
  assert.equal(confirmed.participantCount, 2);
  assert.equal(confirmed.positionLabel, "Your position is #2.");
  assert.equal(confirmed.countLabel, "2 people are in this queue.");
  assert.equal(presentRosterEntries([row(1, "AA", false)]).kind, "absent");
  assert.equal(presentRosterEntries([]).kind, "absent");
  assert.equal(presentMyQueueRequestFailure({ status: 401, code: "session_expired" }), "unauthorized");
  assert.equal(presentMyQueueRequestFailure({ status: 500 }), "unavailable");
  assert.equal(presentMyQueueRequestFailure(new Error("network")), "unavailable");

  const confirmedCheck = {
    flightId: 2,
    status: "confirmed",
    position: 2,
    participantCount: 2,
    positionLabel: "Your position is #2.",
    countLabel: "2 people are in this queue.",
  };
  const mixed = describeMyQueues({
    storageState: "ready",
    checks: [
      confirmedCheck,
      { flightId: 3, status: "absent" },
      { flightId: 4, status: "unauthorized" },
      { flightId: 5, status: "unavailable" },
    ],
  });
  assert.deepEqual(mixed.verified.map((entry) => entry.flightId), [2]);
  assert.deepEqual(mixed.failed.map((entry) => entry.status), ["unauthorized", "unavailable"]);
  assert.equal(mixed.emptyTitle, null);
  assert.equal(mixed.partialNotice, MY_QUEUES_PARTIAL);
  assert.equal(describeMyQueues({ storageState: "ready", checks: [] }).emptyTitle, MY_QUEUES_NONE_SAVED);
  assert.equal(describeMyQueues({
    storageState: "ready",
    checks: [{ flightId: 8, status: "absent" }],
  }).emptyTitle, MY_QUEUES_EMPTY);
  assert.equal(describeMyQueues({
    storageState: "ready",
    checks: [{ flightId: 8, status: "pending" }],
  }).emptyTitle, null);
  assert.equal(presentMyQueueRequestFailure({ code: "timeout" }), "unavailable");
  assert.equal(presentMyQueueRequestFailure({ code: "invalid_schema" }), "unavailable");
});

test("missing flight metadata stays unlabeled and listing viewer fields are not participation", () => {
  assert.deepEqual(presentQueueFlightMetadata(null), { routeLabel: null, departureLabel: null });
  assert.equal(presentQueueFlightMetadata({
    fromAirport: "DAL",
    toAirport: null,
    fromCity: "Dallas",
    toCity: null,
    departureDate: null,
    departureTime: null,
  }).routeLabel, null);
  const listed = presentQueueFlightMetadata({
    fromAirport: "DAL",
    toAirport: "SFO",
    fromCity: "Dallas",
    toCity: "San Francisco",
    departureDate: "2026-10-29",
    departureTime: "15:40",
  });
  assert.equal(listed.routeLabel, "DAL → SFO");
  assert.match(listed.departureLabel, /October 29/);
  assert.equal(queueFlightReference(42, { routeLabel: null, departureLabel: null }), "Flight 42");
  const presentation = readFileSync(resolve(projectRoot, "lib/myQueuesPresentation.ts"), "utf8");
  const metadataFn = presentation.match(/export function presentQueueFlightMetadata[\s\S]*?\n\}/);
  assert.ok(metadataFn);
  assert.doesNotMatch(metadataFn[0], /userInQueue|viewerQueuePosition|viewerIsEffectiveWinner/);
  assert.doesNotMatch(presentation, /Lost/);
});

test("My Queues is a third Trips tab and does not mutate production or mix in demo data", () => {
  const trips = readFileSync(resolve(projectRoot, "components/ClerkTrips.tsx"), "utf8");
  const panel = readFileSync(resolve(projectRoot, "components/MyQueuesPanel.tsx"), "utf8");
  const reader = readFileSync(resolve(projectRoot, "lib/useMyQueues.ts"), "utf8");
  const store = readFileSync(resolve(projectRoot, "lib/queueCandidates.ts"), "utf8");
  const join = readFileSync(resolve(projectRoot, "app/flight/join.tsx"), "utf8");
  assert.match(trips, /id: 'current' as const, label: 'Upcoming'[\s\S]*id: 'queues' as const, label: 'In Queue'[\s\S]*id: 'past' as const, label: 'Past'/);
  assert.match(trips, /React\.useState<TripList>\(\s*params\.list === 'queues' \? 'queues' : 'current',\s*\)/);
  assert.match(trips, /clerk-trips-tab-\$\{tab\.id\}/);
  assert.match(trips, /id: 'queues'/);
  assert.match(trips, /keepQueues/);
  assert.match(trips, /<MyQueuesPanel awardedFlightIds=\{awardedFlightIds\} active=\{activeList === 'queues'\} \/>/);
  assert.match(trips, /queueViewerListQueryKey/);
  assert.match(trips, /awardedCurrentFlightIds\(query\.isSuccess \? query\.data\.current : \[\]\)/);
  assert.match(trips, /currentTripChecklistTarget/);
  assert.doesNotMatch(trips, /fetchProductionFlight|router\.replace|getTrip\(/);
  assert.match(trips, /queuesHidden/);
  assert.match(trips, /return api\.authenticated\.listTrips\(\{ signal \}\)/);
  assert.match(trips, /removeQueries/);
  assert.doesNotMatch(store, /removeItem/);
  assert.match(panel, /presentServerMemberQueues|memberQueueFlightId/);
  assert.match(panel, /MY_QUEUES_SERVER_EMPTY/);
  assert.match(panel, /People in queue/);
  assert.match(panel, /accessibilityLabel="Try again for upcoming queues"/);
  assert.match(panel, /\{MY_QUEUES_COVERAGE_NOTE\}/);
  assert.match(panel, /\{MY_QUEUES_NOT_BOOKING\}/);
  assert.match(panel, /presentQueueLifecycle/);
  assert.match(panel, /presentQueueCountdown/);
  assert.match(panel, /setInterval\(\(\) => setNowMs\(Date\.now\(\)\), 1000\)/);
  assert.match(panel, /clearInterval\(timer\)/);
  assert.match(panel, /if \(!active\) return undefined/);
  assert.doesNotMatch(reader, /setInterval|loadQueueCandidates|AsyncStorage/);
  assert.match(panel, /\{MY_QUEUES_DETAILS_UNAVAILABLE\}/);
  assert.match(panel, /router\.push\(detailsTarget\)/);
  assert.match(panel, /accessibilityHint="Opens flight details"/);
  assert.doesNotMatch(panel, /fetchProductionFlight\(|empty-legs\/|You won|Queue is open|Queue closed|\/demo\/flight|\/queue\/status/);
  assert.match(MY_QUEUES_EMPTY, /No verified queues found among flights saved on this device/);
  assert.match(MY_QUEUES_COVERAGE_NOTE, /upcoming flights Bluebird reports/);
  assert.match(MY_QUEUES_NOT_BOOKING, /not a confirmed booking/);
  assert.match(panel, /RefreshControl/);
  assert.match(panel, /testID="my-queues-pull-refresh"/);
  assert.match(panel, /useFocusEffect/);
  assert.match(panel, /flight\.userInQueue === true/);
  assert.doesNotMatch(panel, /accessibilityLabel="Refresh queues"|my-queues-refresh/);
  assert.match(panel, /my-queues-retry-/);
  assert.doesNotMatch(join, /saveQueueCandidate|AsyncStorage/);
  assert.match(reader, /fetchUpcomingMemberFlights/);
  assert.match(reader, /isNativeProductionAuthTestEnabled/);
  assert.doesNotMatch(reader, /past=false/);
  assert.doesNotMatch(reader, /setInterval|refetchInterval/);
  for (const source of [trips, panel, reader, store, join]) {
    assert.doesNotMatch(source, /joinEmptyLegQueue|leaveEmptyLegQueue|skipLine|getMembership|fetchProductionFlight\(|winner\/confirm|winner\/decline|\/api\/membership/);
  }
  assert.doesNotMatch(panel, /demoJoin|fullAppDemo|viewerQueuePosition|publicFlight\?\.userInQueue/);
  assert.match(panel, /flight\.userInQueue/);
  assert.doesNotMatch(reader, /\.leave\(|\.skipLine\(|fetchProductionFlight\(|\.join\(flightId/);
  assert.match(reader, /fetchUpcomingMemberFlights\(/);
  const policy = readFileSync(resolve(projectRoot, "lib/nativeAuthTestPolicy.ts"), "utf8");
  assert.match(policy, /EMPTY_LEG_QUEUE_PATH/);
  assert.match(policy, /method\.toUpperCase\(\) !== 'GET'/);
  assert.doesNotMatch(policy, /past=false/);
  const readiness = readFileSync(resolve(projectRoot, "lib/productionQueueReadiness.ts"), "utf8");
  assert.match(readiness, /deployedMainService: false/);
  assert.match(MY_QUEUES_NONE_SAVED, /No flights saved on this device yet/);
  assert.equal(MY_QUEUES_STATUS, "Queue participation verified");
});

test("verified queue cards open Flight Details, which keeps cached Discover data and then reads the detail endpoint", () => {
  const route = { routeLabel: "DAL → SFO", departureLabel: "October 29" };
  assert.deepEqual(queueFlightDetailsTarget(42, route), { pathname: "/flight/[id]", params: { id: "42" } });
  assert.equal(queueFlightDetailsTarget(42, { routeLabel: null, departureLabel: "October 29" }), null);
  assert.equal(queueFlightDetailsTarget(0, route), null);
  const details = readFileSync(resolve(projectRoot, "app/flight/[id].tsx"), "utf8");
  const discover = readFileSync(resolve(projectRoot, "app/(tabs)/discover/index.tsx"), "utf8");
  const mapNative = readFileSync(resolve(projectRoot, "components/FlightMap.native.tsx"), "utf8");
  const mapWeb = readFileSync(resolve(projectRoot, "components/FlightMap.web.tsx"), "utf8");
  const reader = readFileSync(resolve(projectRoot, "lib/useMyQueues.ts"), "utf8");
  assert.match(details, /selectDisplayedFlight/);
  assert.match(details, /enabled: identityReady && \(demoMode \|\| !localReadMode\) && numericFlightId !== null/);
  assert.match(details, /enabled: !localReadMode && flight\?\.source === 'production'/);
  assert.match(details, /PRODUCTION_FLIGHTS_QUERY_KEY/);
  assert.match(details, /flight-detail-unavailable/);
  assert.match(details, /flight-detail-refresh-error/);
  assert.match(details, /\.\.\.FLIGHT_DETAIL_QUERY_BEHAVIOR/);
  assert.match(details, /presentCachedDepartureClock/);
  assert.match(details, /fetchProductionFlight\(flightId, \{/);
  assert.match(details, /if \(demoMode\) \{/);
  assert.doesNotMatch(details, /fetchProductionFlights|getMembership|\/api\/membership|setInterval|joinEmptyLegQueue|getEmptyLegQueue/);
  assert.match(discover, /pathname: '\/flight\/\[id\]'/);
  assert.match(discover, /pathname: '\/demo\/flight\/\[id\]'/);
  assert.match(mapNative, /router\.push\(`\/flight\/\$\{id\}`\)/);
  assert.match(mapWeb, /router\.push\(`\/flight\/\$\{id\}`\)/);
  assert.doesNotMatch(reader, /fetchProductionFlight\(|router\.push\(|\/flight\/\[id\]|\/api\/membership/);
  assert.match(reader, /fetchUpcomingMemberFlights\(/);
  assert.doesNotMatch(reader, /loadQueueCandidates/);
  assert.match(MY_QUEUES_DETAILS_UNAVAILABLE, /not available for this flight/);
  const roster = presentRosterEntries([row(1, "AA", true)]);
  assert.equal(roster.kind, "confirmed");
  assert.equal(Object.hasOwn(roster, "winner"), false);
  assert.equal(Object.hasOwn(roster, "queueClosed"), false);
  assert.equal(Object.hasOwn(roster, "queueOpen"), false);
  const awarded = awardedCurrentFlightIds([
    { checklist: { emptyLegId: 4, awarded: true } },
    { checklist: { emptyLegId: 5, awarded: false } },
    { checklist: { emptyLegId: 0, awarded: true } },
  ]);
  assert.deepEqual(awarded, [4]);
  const hidden = describeMyQueues({
    storageState: "ready",
    checks: [
      { flightId: 4, status: "confirmed", position: 1, participantCount: 3, positionLabel: "Your position is #1.", countLabel: "3 people are in this queue." },
      { flightId: 9, status: "confirmed", position: 2, participantCount: 3, positionLabel: "Your position is #2.", countLabel: "3 people are in this queue." },
    ],
    awardedFlightIds: awarded,
  });
  assert.deepEqual(hidden.verified.map((entry) => entry.flightId), [9]);
  assert.equal(hidden.emptyTitle, null);
  const moved = describeMyQueues({
    storageState: "ready",
    checks: [
      { flightId: 4, status: "confirmed", position: 1, participantCount: 1, positionLabel: "Your position is #1.", countLabel: "1 person is in this queue." },
    ],
    awardedFlightIds: [4],
  });
  assert.deepEqual(moved.verified, []);
  assert.equal(moved.emptyTitle, MY_QUEUES_LISTED_ON_CURRENT);
  assert.match(MY_QUEUES_LISTED_ON_CURRENT, /Upcoming/);
  assert.doesNotMatch(MY_QUEUES_STATUS, /winner|open|closed/i);
});

test("queue countdown and status use server timestamps and viewer fields", () => {
  const now = Date.parse("2026-10-29T12:00:00.000Z");
  const closes = "2026-10-29T12:00:10.000Z";
  const departure = "2026-10-29T18:00:00.000Z";
  assert.equal(queueClosingInstant({ queueClosesAt: closes, departureInstant: departure }), Date.parse(closes));
  assert.equal(queueClosingInstant({ queueClosesAt: "not-a-time", departureInstant: departure }), Date.parse(departure));
  assert.equal(queueClosingInstant({ queueClosesAt: null, departureInstant: "08:36" }), null);
  assert.equal(parseQueueInstant("2026-10-29T12:00:10.000Z"), Date.parse(closes));
  assert.equal(presentQueueCountdown(now, Date.parse(closes)), "Closes in 0m 10s");
  assert.equal(presentQueueCountdown(now, now), QUEUE_CLOSING_REACHED);
  assert.equal(presentQueueCountdown(now, now - 1), QUEUE_CLOSING_REACHED);
  assert.equal(presentQueueCountdown(now, null), QUEUE_CLOSING_UNAVAILABLE);
  assert.equal(presentQueueCountdown(Number.NaN, Date.parse(closes)), QUEUE_CLOSING_UNAVAILABLE);
  const open = {
    viewerFieldsAvailable: true,
    userInQueue: true,
    viewerIsBookedPassenger: false,
    viewerIsEffectiveWinner: false,
    viewerConfirmationStatus: null,
    closingMs: now + (2 * 60 * 60 * 1000),
    nowMs: now,
  };
  assert.equal(presentQueueLifecycle(open), "Queue Open");
  assert.equal(presentQueueLifecycle({ ...open, closingMs: now + (30 * 60 * 1000) }), "Queue Closing Soon");
  assert.equal(presentQueueLifecycle({ ...open, closingMs: now }), "Queue Closing Time Reached");
  assert.equal(presentQueueLifecycle({ ...open, closingMs: null }), "Decision Pending");
  assert.equal(presentQueueLifecycle({ ...open, viewerFieldsAvailable: false, closingMs: null }), QUEUE_STATUS_UNAVAILABLE);
  assert.equal(presentQueueLifecycle({ ...open, viewerIsEffectiveWinner: true }), "Current Winner — Not Yet Formally Awarded");
  assert.equal(presentQueueLifecycle({ ...open, viewerConfirmationStatus: "pending" }), "Confirmation Pending");
  assert.equal(presentQueueLifecycle({ ...open, viewerConfirmationStatus: "confirmed" }), "Confirmed");
  assert.equal(presentQueueLifecycle({ ...open, viewerConfirmationStatus: "declined" }), "Declined");
  assert.equal(presentQueueLifecycle({ ...open, viewerIsBookedPassenger: true }), "Booked Passenger");
  assert.equal(presentQueueLifecycle({ ...open, viewerConfirmationStatus: "lost" }), QUEUE_STATUS_UNAVAILABLE);
  assert.doesNotMatch(presentQueueLifecycle(open), /lost|won/i);
  const confirmed = {
    flightId: 4,
    status: "confirmed",
    position: 1,
    participantCount: 3,
    positionLabel: "Your position is #1.",
    countLabel: "3 people are in this queue.",
  };
  assert.deepEqual(applyViewerMembership([confirmed], { 4: false }).map((entry) => entry.status), ["absent"]);
  assert.equal(applyViewerMembership([confirmed], { 4: true })[0].status, "confirmed");
  assert.equal(applyViewerMembership([confirmed], null)[0].status, "confirmed");
  const stillQueued = describeMyQueues({
    storageState: "ready",
    checks: [confirmed],
    awardedFlightIds: [],
    viewerMembership: { 4: true },
  });
  assert.deepEqual(stillQueued.verified.map((entry) => entry.flightId), [4]);
  assert.equal(stillQueued.emptyTitle, null);
});

test("roster checks stay bounded and drop results after sign-out or an account change", async () => {
  assert.deepEqual(uniqueQueueCandidateIds([4, 4, 0, 9, 4]), [4, 9]);
  assert.equal(shouldRequestRoster({ refresh: true, cacheFresh: true }), true);
  assert.equal(shouldRequestRoster({ refresh: false, cacheFresh: true }), false);
  assert.equal(isRosterCacheFresh(1_000, 1_500, 1_000), true);
  assert.equal(isRosterCacheFresh(1_000, 3_000, 1_000), false);
  assert.equal(shouldAcceptRosterResult({
    requestedUserId: "user_a",
    activeUserId: "user_b",
    requestedGeneration: 1,
    activeGeneration: 1,
    signedIn: true,
  }), false);
  assert.equal(shouldAcceptRosterResult({
    requestedUserId: "user_a",
    activeUserId: null,
    requestedGeneration: 2,
    activeGeneration: 3,
    signedIn: false,
  }), false);

  let active = 0;
  let maxActive = 0;
  const seen = [];
  const controller = new AbortController();
  await runRosterPool({
    ids: [1, 1, 2, 3, 4],
    concurrency: 3,
    requestedUserId: "user_a",
    generation: 1,
    signal: controller.signal,
    isCurrent: () => ({ signedIn: true, activeUserId: "user_a", generation: 1 }),
    read: async (id) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return id;
    },
    onResult: (id) => seen.push(id),
    onError: () => { throw new Error("unexpected roster error"); },
  });
  assert.equal(maxActive <= 3, true);
  assert.deepEqual(seen.sort((left, right) => left - right), [1, 2, 3, 4]);

  let applied = 0;
  let reads = 0;
  let activeUserId = "user_a";
  await runRosterPool({
    ids: [7, 8],
    concurrency: 1,
    requestedUserId: "user_a",
    generation: 4,
    signal: new AbortController().signal,
    isCurrent: () => ({ signedIn: true, activeUserId, generation: 4 }),
    read: async (id) => {
      reads += 1;
      activeUserId = "user_b";
      return id;
    },
    onResult: () => { applied += 1; },
    onError: () => { applied += 1; },
  });
  assert.equal(reads, 1);
  assert.equal(applied, 0);

  let signedIn = true;
  let published = 0;
  await runRosterPool({
    ids: [11],
    concurrency: 1,
    requestedUserId: "user_a",
    generation: 5,
    signal: new AbortController().signal,
    isCurrent: () => ({ signedIn, activeUserId: signedIn ? "user_a" : null, generation: 5 }),
    read: async () => {
      signedIn = false;
      return 11;
    },
    onResult: () => { published += 1; },
    onError: () => { published += 1; },
  });
  assert.equal(published, 0);

  const failures = [];
  const successes = [];
  await runRosterPool({
    ids: [1, 2, 3],
    concurrency: 3,
    requestedUserId: "user_a",
    generation: 6,
    signal: new AbortController().signal,
    isCurrent: () => ({ signedIn: true, activeUserId: "user_a", generation: 6 }),
    read: async (id) => {
      if (id === 2) throw Object.assign(new Error("unavailable"), { status: 500 });
      if (id === 3) throw Object.assign(new Error("expired"), { status: 401, code: "session_expired" });
      return id;
    },
    onResult: (id) => successes.push(id),
    onError: (id, error) => failures.push([id, presentMyQueueRequestFailure(error)]),
  });
  assert.deepEqual(successes, [1]);
  assert.deepEqual(failures.sort((left, right) => left[0] - right[0]), [
    [2, "unavailable"],
    [3, "unauthorized"],
  ]);
});

test("upcoming member flights select queues and winner fields without inventing a position", () => {
  const queued = {
    id: "42",
    userInQueue: true,
    viewerQueuePosition: 3,
    queueCount: 8,
    viewerIsEffectiveWinner: false,
    viewerConfirmationStatus: null,
  };
  const winnerOnly = {
    id: "7",
    userInQueue: false,
    viewerQueuePosition: null,
    queueCount: null,
    viewerIsEffectiveWinner: true,
    viewerConfirmationStatus: "pending",
  };
  const stranger = {
    id: "9",
    userInQueue: false,
    viewerQueuePosition: 1,
    queueCount: 4,
    viewerIsEffectiveWinner: false,
    viewerConfirmationStatus: null,
  };
  const selected = presentServerMemberQueues([queued, winnerOnly, stranger, { ...queued, id: "0" }]);
  assert.deepEqual(selected.map((flight) => flight.id), ["42", "7"]);
  assert.equal(memberQueuePosition(queued), 3);
  assert.equal(memberQueuePosition(winnerOnly), null);
  assert.equal(memberQueuePosition({ ...queued, viewerQueuePosition: null }), null);
  const flights = readFileSync(resolve(projectRoot, "lib/productionFlights.ts"), "utf8");
  assert.match(flights, /export const UPCOMING_MEMBER_FLIGHTS_PATH = '\/empty-legs\?past=false'/);
  assert.match(flights, /fetchUpcomingMemberFlights/);
});
