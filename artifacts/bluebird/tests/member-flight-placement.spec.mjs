import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";
import {
  clearWinnerNoticesForAccount,
  declinedCurrentFlightIds,
  nextWinnerNotice,
  pendingOfferFlightIds,
  pendingTripFlightIds,
  pendingWinnerOfferFlightIdsFromTrips,
  productionQueueActionsVisible,
  queueEntryVisible,
  rememberWinnerNotice,
  resetWinnerNotices,
  tripLifecycleOpenTarget,
  upcomingFlightDetailsTarget,
  upcomingOwnedFlightIds,
  visibleQueueFlightIds,
  winnerNoticeWasShown,
  winnerOfferPollInterval,
  WINNER_OFFER_POLL_MS,
} from "../scripts/.member-flight-placement.test.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const now = Date.parse("2026-11-03T18:30:00.000Z");
const openClose = "2026-11-03T19:00:00.000Z";
const closedAt = "2026-11-03T18:00:00.000Z";

function trip(id, awarded = false) {
  return { leg: { id }, checklist: { emptyLegId: id, awarded } };
}

function queueFlight(id, overrides = {}) {
  return {
    id: String(id),
    userInQueue: true,
    viewerIsEffectiveWinner: false,
    viewerConfirmationStatus: null,
    viewerIsBookedPassenger: false,
    queueClosesAt: openClose,
    ...overrides,
  };
}

test("an active queue member stays in In Queue", () => {
  const ids = visibleQueueFlightIds([queueFlight(7)], [], now);
  assert.deepEqual(ids, [7]);
});

test("a closed queue with an unresolved winner stays in In Queue", () => {
  const ids = visibleQueueFlightIds([
    queueFlight(7, { viewerIsEffectiveWinner: null, queueClosesAt: closedAt }),
  ], [], now);
  assert.deepEqual(ids, [7]);
});

test("a pending winner moves from In Queue to Upcoming and is not listed twice", () => {
  const current = [trip(7, false)];
  const upcoming = upcomingOwnedFlightIds(current);
  const queueIds = visibleQueueFlightIds([
    queueFlight(7, { viewerIsEffectiveWinner: true, viewerConfirmationStatus: "pending", queueClosesAt: closedAt }),
  ], upcoming, now);
  assert.deepEqual(upcoming, [7]);
  assert.deepEqual(queueIds, []);
  assert.equal(new Set([...upcoming, ...queueIds]).size, upcoming.length);
});

test("a confirmed winner stays in Upcoming and leaves In Queue", () => {
  const current = [trip(8, true)];
  const upcoming = upcomingOwnedFlightIds(current);
  const queueIds = visibleQueueFlightIds([
    queueFlight(8, { viewerIsBookedPassenger: true, viewerConfirmationStatus: "confirmed" }),
  ], upcoming, now);
  assert.deepEqual(upcoming, [8]);
  assert.deepEqual(queueIds, []);
  assert.deepEqual(upcomingFlightDetailsTarget({ list: "current", legId: 8 }), {
    pathname: "/flight/[id]",
    params: { id: "8" },
  });
});

test("a declined winner leaves Upcoming and can remain in In Queue", () => {
  const current = [trip(9, false)];
  const confirmation = new Map([[9, "declined"]]);
  assert.deepEqual(declinedCurrentFlightIds(current, confirmation), [9]);
  assert.deepEqual(upcomingOwnedFlightIds(current, confirmation), []);
  assert.deepEqual(visibleQueueFlightIds([
    queueFlight(9, { viewerConfirmationStatus: "declined", viewerIsEffectiveWinner: false, queueClosesAt: closedAt }),
  ], [], now), [9]);
});

test("pending and confirmed Upcoming cards open flight details, and the checklist stays available", () => {
  assert.deepEqual(upcomingFlightDetailsTarget({ list: "current", legId: 42 }), {
    pathname: "/flight/[id]",
    params: { id: "42" },
  });
  assert.equal(upcomingFlightDetailsTarget({ list: "past", legId: 42 }), null);
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
  assert.deepEqual(tripLifecycleOpenTarget({
    list: "current",
    legId: 42,
    status: "awarded",
    awarded: true,
  }), { pathname: "/flight/[id]", params: { id: "42" } });
  const trips = readFileSync(resolve(projectRoot, "components/ClerkTrips.tsx"), "utf8");
  const session = readFileSync(resolve(projectRoot, "lib/clerkAuthSession.ts"), "utf8");
  assert.match(trips, /router\.push\(detailsTarget\)/);
  assert.match(trips, /tripLifecycleOpenTarget/);
  assert.match(trips, /onOpenChecklist\(flightId\)/);
  assert.doesNotMatch(trips, /router\.replace\('\/\(tabs\)\/discover'\)|router\.replace\("\/\(tabs\)\/discover"\)/);
  assert.match(session, /isClerkWinnerPath/);
});

test("winners do not keep Leave Queue or View Queue Status", () => {
  assert.equal(productionQueueActionsVisible({
    userInQueue: true,
    viewerIsEffectiveWinner: false,
    viewerConfirmationStatus: null,
    queueClosed: false,
  }), true);
  assert.equal(productionQueueActionsVisible({
    userInQueue: true,
    viewerIsEffectiveWinner: true,
    viewerConfirmationStatus: "pending",
    queueClosed: true,
  }), false);
  assert.equal(productionQueueActionsVisible({
    userInQueue: true,
    viewerIsEffectiveWinner: true,
    viewerConfirmationStatus: "confirmed",
    queueClosed: true,
  }), false);
  assert.equal(queueEntryVisible({
    userInQueue: true,
    viewerIsEffectiveWinner: false,
    viewerConfirmationStatus: null,
    queueClosed: false,
    ownedByUpcoming: false,
  }), true);
  const details = readFileSync(resolve(projectRoot, "app/flight/[id].tsx"), "utf8");
  assert.match(details, /productionQueueActionsVisible/);
  assert.match(details, /if \(selectedWinner\) return null/);
});

test("a global notice shows once away from Queue Status, and Later does not change server state", () => {
  resetWinnerNotices();
  const first = nextWinnerNotice({
    accountKey: "member-a",
    pendingFlightIds: [42],
    tripsLoaded: true,
    celebrationVisible: false,
  });
  assert.deepEqual(first, { flightId: 42, action: "show" });
  rememberWinnerNotice("member-a", 42);
  const repeat = nextWinnerNotice({
    accountKey: "member-a",
    pendingFlightIds: [42],
    tripsLoaded: true,
    celebrationVisible: false,
  });
  assert.equal(repeat, null);
  assert.equal(winnerNoticeWasShown("member-a", 42), true);
  const observer = readFileSync(resolve(projectRoot, "components/WinnerOfferObserver.tsx"), "utf8");
  const layout = readFileSync(resolve(projectRoot, "app/_layout.tsx"), "utf8");
  assert.match(observer, /Congratulations! You've Been Selected!/);
  assert.match(observer, /winner-offer-view/);
  assert.match(observer, /winner-offer-later/);
  assert.match(observer, /pathname: '\/flight\/winner'/);
  assert.doesNotMatch(observer, /confirmEmptyLegWinner|declineEmptyLegWinner|confirmTripChecklist/);
  assert.match(layout, /<WinnerOfferObserver \/>/);
  assert.match(observer, /refetchIntervalInBackground: false/);
  assert.equal(WINNER_OFFER_POLL_MS, 15000);
});

test("Queue Status celebration suppresses the notice, and polling pauses on that screen", () => {
  resetWinnerNotices();
  const suppressed = nextWinnerNotice({
    accountKey: "member-a",
    pendingFlightIds: [42, 43],
    tripsLoaded: true,
    celebrationVisible: true,
  });
  assert.equal(suppressed?.action, "suppress");
  assert.equal(nextWinnerNotice({
    accountKey: "member-a",
    pendingFlightIds: [42, 43],
    tripsLoaded: true,
    celebrationVisible: false,
  }), null);
  assert.equal(winnerOfferPollInterval({
    foreground: true,
    signedIn: true,
    pathname: "/(tabs)/membership",
  }), 15000);
  assert.equal(winnerOfferPollInterval({
    foreground: true,
    signedIn: true,
    pathname: "/flight/queue-status",
  }), false);
  assert.equal(winnerOfferPollInterval({
    foreground: false,
    signedIn: true,
    pathname: "/(tabs)/connections",
  }), false);
});

test("queue join Pending trips stay visible and are not winner offers", () => {
  // Product rule: unawarded current trips after queue join are Pending trips.
  // They must remain in Trips and must not be reinterpreted as winner offers.
  assert.deepEqual(pendingTripFlightIds([trip(10, false), trip(11, true), trip(12, false)]), [10, 12]);
  assert.deepEqual(pendingOfferFlightIds([trip(10, false), trip(12, false)]), [10, 12]);
  assert.deepEqual(pendingTripFlightIds([trip(11, true)]), []);
  assert.deepEqual(pendingTripFlightIds(null), []);
  assert.deepEqual(pendingWinnerOfferFlightIdsFromTrips([trip(10, false), trip(12, false)]), []);
  assert.deepEqual(pendingWinnerOfferFlightIdsFromTrips([
    { ...trip(10, false), status: "queue_pending" },
    { ...trip(12, false), status: "winner_confirmation_required" },
  ]), [12]);
  const observer = readFileSync(resolve(projectRoot, "components/WinnerOfferObserver.tsx"), "utf8");
  assert.match(observer, /pendingWinnerOfferFlightIdsFromTrips/);
  assert.doesNotMatch(observer, /pendingOfferFlightIds\(|pendingTripFlightIds\(/);
  assert.match(observer, /Pending \(unawarded\) Trips after queue join are product-correct/);
});

test("a failed trips response does not forget a notice, and an account switch does", () => {
  resetWinnerNotices();
  rememberWinnerNotice("member-a", 42);
  assert.equal(nextWinnerNotice({
    accountKey: "member-a",
    pendingFlightIds: [],
    tripsLoaded: false,
    celebrationVisible: false,
  }), null);
  assert.equal(winnerNoticeWasShown("member-a", 42), true);
  const delayed = nextWinnerNotice({
    accountKey: "member-a",
    pendingFlightIds: pendingOfferFlightIds([trip(42, false)]),
    tripsLoaded: true,
    celebrationVisible: false,
  });
  assert.equal(delayed, null);
  clearWinnerNoticesForAccount("member-a");
  const other = nextWinnerNotice({
    accountKey: "member-b",
    pendingFlightIds: [42],
    tripsLoaded: true,
    celebrationVisible: false,
  });
  assert.deepEqual(other, { flightId: 42, action: "show" });
  assert.equal(winnerNoticeWasShown("member-a", 42), false);
});
