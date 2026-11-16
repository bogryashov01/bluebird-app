import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FLIGHT_DETAIL_FRESHNESS_MS,
  FLIGHT_DETAIL_QUERY_BEHAVIOR,
  FlightDetailSessionError,
  flightDetailViewerScope,
  isDiscoverFlightListKey,
  isFlightDetailIdentityReady,
  prepareFlightDetailRequest,
  presentAircraftGallery,
  presentFlightDetailQueue,
  presentSeatsAvailable,
  planFlightDetailExitNavigation,
  productionFlightDetailQueryKey,
  readProductionFlightDetailCache,
  selectDisplayedFlight,
  shouldShowFlightDetailHistoryBack,
  FLIGHT_DETAIL_FLIGHTS_HREF,
} from "../scripts/.flight-detail-presentation.test.mjs";
import {
  fetchProductionFlight,
  mapProductionFlight,
  PRODUCTION_API_BASE_URL,
  PRODUCTION_FLIGHTS_QUERY_KEY,
  ProductionReadHttpError,
} from "../scripts/.flight-detail-flights.test.mjs";

process.env.EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT = "production";
process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL = "https://bluebirdjets.com/api";
process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY = "pk_live_Y2xlcmsuZXhhbXBsZS5jb20k";

const projectRoot = resolve(import.meta.dirname, "..");

function sampleFlight(overrides = {}) {
  return {
    id: "42",
    source: "production",
    status: "published",
    queueCount: 3,
    userInQueue: true,
    viewerQueuePosition: 2,
    lockedForFreeUsers: true,
    viewerHasLineSkip: true,
    viewerHasInternationalPass: false,
    viewerIsBookedPassenger: false,
    viewerIsEffectiveWinner: false,
    viewerConfirmationStatus: null,
    fromAirport: "DAL",
    toAirport: "SFO",
    departureTime: "08:36",
    imageUrl: "https://bluebirdjets.com/a.jpg",
    aircraftGalleryUrls: ["https://bluebirdjets.com/a.jpg", "https://bluebirdjets.com/b.jpg"],
    totalPrice: 1200,
    msrpUsd: 9999,
    pricePerHour: 400,
    ...overrides,
  };
}

const cached = sampleFlight();

const pending = selectDisplayedFlight({
  cached,
  detail: undefined,
  phase: "pending",
  httpStatus: null,
  viewerAuthenticated: false,
});
assert.equal(pending.showingCachedDiscover, true);
assert.equal(pending.flight.fromAirport, "DAL");
assert.equal(pending.flight.queueCount, 3);
assert.equal(pending.flight.viewerQueuePosition, null);
assert.equal(pending.flight.userInQueue, null);
assert.equal(pending.flight.lockedForFreeUsers, null);
assert.equal(pending.refreshFailed, false);

const authenticated = selectDisplayedFlight({
  cached,
  detail: sampleFlight({ fromCity: "Dallas", viewerQueuePosition: 1, viewerConfirmationStatus: "pending" }),
  phase: "success",
  httpStatus: null,
  viewerAuthenticated: true,
});
assert.equal(authenticated.showingCachedDiscover, false);
assert.equal(authenticated.flight.viewerQueuePosition, 1);
assert.equal(authenticated.flight.fromCity, "Dallas");
assert.equal(authenticated.flight.msrpUsd, 9999);

const anonymousDetail = selectDisplayedFlight({
  cached,
  detail: sampleFlight({ viewerQueuePosition: 4, userInQueue: true }),
  phase: "success",
  httpStatus: null,
  viewerAuthenticated: false,
});
assert.equal(anonymousDetail.flight.viewerQueuePosition, null);
assert.equal(anonymousDetail.flight.userInQueue, null);
assert.equal(anonymousDetail.flight.queueCount, 3);

const missing = selectDisplayedFlight({
  cached,
  detail: undefined,
  phase: "error",
  httpStatus: 404,
  viewerAuthenticated: true,
});
assert.equal(missing.flight, undefined);
assert.equal(missing.confirmedMissing, true);
assert.equal(missing.showingCachedDiscover, false);

// Deleted / expired / unavailable production legs resolve as confirmed-missing (404).
const deletedOrExpired = selectDisplayedFlight({
  cached: undefined,
  detail: undefined,
  phase: "error",
  httpStatus: 404,
  viewerAuthenticated: true,
});
assert.equal(deletedOrExpired.flight, undefined);
assert.equal(deletedOrExpired.confirmedMissing, true);

assert.deepEqual(planFlightDetailExitNavigation({ canGoBack: true }), { method: "back" });
assert.deepEqual(planFlightDetailExitNavigation({ canGoBack: false }), {
  method: "replace",
  href: FLIGHT_DETAIL_FLIGHTS_HREF,
});
assert.equal(FLIGHT_DETAIL_FLIGHTS_HREF, "/(tabs)/discover");
assert.equal(shouldShowFlightDetailHistoryBack({ canGoBack: true }), true);
assert.equal(shouldShowFlightDetailHistoryBack({ canGoBack: false }), false);

const failed = selectDisplayedFlight({
  cached,
  detail: undefined,
  phase: "error",
  httpStatus: 503,
  viewerAuthenticated: true,
});
assert.equal(failed.refreshFailed, true);
assert.equal(failed.flight.fromAirport, "DAL");
assert.equal(failed.flight.viewerQueuePosition, null);
assert.equal(failed.confirmedMissing, false);

const noCache = selectDisplayedFlight({
  cached: undefined,
  detail: undefined,
  phase: "error",
  httpStatus: 500,
  viewerAuthenticated: false,
});
assert.equal(noCache.flight, undefined);
assert.equal(noCache.refreshFailed, true);

assert.notDeepEqual(
  productionFlightDetailQueryKey(42, "user_a"),
  productionFlightDetailQueryKey(42, "user_b"),
);
assert.notDeepEqual(
  productionFlightDetailQueryKey(42, "user_a"),
  productionFlightDetailQueryKey(42, "anonymous"),
);
assert.equal(isDiscoverFlightListKey(PRODUCTION_FLIGHTS_QUERY_KEY), true);
assert.equal(isDiscoverFlightListKey(["full-app-demo", ...PRODUCTION_FLIGHTS_QUERY_KEY]), true);
assert.equal(isDiscoverFlightListKey(productionFlightDetailQueryKey(42, "user_a")), false);

assert.deepEqual(
  prepareFlightDetailRequest({ scope: "user_a", token: "signed-in-token", activeScope: "user_a" }),
  { accessToken: "signed-in-token", viewerAuthenticated: true },
);
assert.deepEqual(
  prepareFlightDetailRequest({ scope: "anonymous", token: "signed-in-token", activeScope: "anonymous" }),
  { accessToken: null, viewerAuthenticated: false },
);
assert.throws(
  () => prepareFlightDetailRequest({ scope: "user_a", token: "bad token", activeScope: "user_a" }),
  FlightDetailSessionError,
);
assert.throws(
  () => prepareFlightDetailRequest({ scope: "user_a", token: null, activeScope: "user_a" }),
  FlightDetailSessionError,
);
assert.throws(
  () => prepareFlightDetailRequest({ scope: "user_a", token: "signed-in-token", activeScope: "user_b" }),
  FlightDetailSessionError,
);
assert.throws(
  () => prepareFlightDetailRequest({ scope: "user_a", token: "signed-in-token", activeScope: "anonymous" }),
  FlightDetailSessionError,
);

assert.equal(flightDetailViewerScope({
  demoMode: false,
  authMode: "clerk",
  signedIn: true,
  clerkUserId: "user_a",
}), "user_a");
assert.equal(flightDetailViewerScope({
  demoMode: false,
  authMode: "clerk",
  signedIn: false,
  clerkUserId: "user_a",
}), "anonymous");
assert.equal(flightDetailViewerScope({
  demoMode: true,
  authMode: "clerk",
  signedIn: true,
  clerkUserId: "user_a",
}), "demo");
assert.equal(isFlightDetailIdentityReady({
  demoMode: false,
  authMode: "clerk",
  sessionLoaded: false,
  signedIn: false,
  sessionUserId: null,
  clerkUserId: null,
}), false);
assert.equal(isFlightDetailIdentityReady({
  demoMode: false,
  authMode: "clerk",
  sessionLoaded: true,
  signedIn: false,
  sessionUserId: null,
  clerkUserId: null,
}), true);
assert.equal(isFlightDetailIdentityReady({
  demoMode: false,
  authMode: "clerk",
  sessionLoaded: true,
  signedIn: true,
  sessionUserId: "user_b",
  clerkUserId: "user_a",
}), false);

assert.equal(FLIGHT_DETAIL_QUERY_BEHAVIOR.refetchInterval, false);
assert.equal(FLIGHT_DETAIL_QUERY_BEHAVIOR.refetchOnWindowFocus, false);
assert.equal(FLIGHT_DETAIL_QUERY_BEHAVIOR.staleTime, FLIGHT_DETAIL_FRESHNESS_MS);
assert.equal(FLIGHT_DETAIL_FRESHNESS_MS >= 30_000, true);

const queued = presentFlightDetailQueue(cached, false);
assert.equal(queued.countLabel, "3 people in queue");
assert.equal(queued.positionLabel, null);
assert.equal(queued.statusLabel, null);
const mine = presentFlightDetailQueue(
  sampleFlight({ viewerConfirmationStatus: "pending", viewerQueuePosition: 2 }),
  true,
);
assert.equal(mine.positionLabel, "Your position is #2");
assert.equal(mine.statusLabel, "Confirmation pending");
assert.equal(presentFlightDetailQueue(sampleFlight({ viewerConfirmationStatus: "lost", userInQueue: true }), true).statusLabel, null);
assert.equal(presentFlightDetailQueue(sampleFlight({ queueCount: 1 }), false).countLabel, "1 person in queue");
assert.equal(presentSeatsAvailable(4), "4");
assert.equal(presentSeatsAvailable(0), "0");
assert.equal(presentSeatsAvailable(null), null);
assert.equal(presentSeatsAvailable(undefined), null);
assert.equal(presentSeatsAvailable(-1), null);
assert.equal(presentSeatsAvailable(1.5), null);
assert.deepEqual(presentAircraftGallery(cached), [
  "https://bluebirdjets.com/a.jpg",
  "https://bluebirdjets.com/b.jpg",
]);

const mapped = mapProductionFlight({
  id: 42,
  originAirport: "DAL",
  destinationAirport: "SFO",
  aircraftGalleryUrls: ["/a.jpg", "https://cdn.example.test/b.jpg", "/a.jpg"],
  queueCount: 2,
  viewerQueuePosition: 1,
  msrpUsd: 5000,
  totalPrice: null,
});
assert.equal(mapped.imageUrl, "https://bluebirdjets.com/a.jpg");
assert.deepEqual(mapped.aircraftGalleryUrls, [
  "https://bluebirdjets.com/a.jpg",
  "https://cdn.example.test/b.jpg",
]);
assert.equal(mapped.msrpUsd, 5000);

const requests = [];
await fetchProductionFlight(42, {
  fetcher: async (url, init) => {
    requests.push({ url: String(url), authorization: init.headers.Authorization });
    return new Response(JSON.stringify({
      id: 42,
      originAirport: "DAL",
      destinationAirport: "SFO",
      aircraftGalleryUrls: [],
    }), { status: 200, headers: { "content-type": "application/json" } });
  },
  accessToken: "signed-in-token",
});
assert.equal(requests[0].url, `${PRODUCTION_API_BASE_URL}/empty-legs/42`);
assert.equal(requests[0].authorization, "Bearer signed-in-token");
requests.length = 0;
await fetchProductionFlight(42, {
  fetcher: async (url, init) => {
    requests.push(init.headers.Authorization);
    return new Response(JSON.stringify({
      id: 42,
      originAirport: "DAL",
      destinationAirport: "SFO",
    }), { status: 200, headers: { "content-type": "application/json" } });
  },
  accessToken: "bad token",
});
assert.equal(requests[0], undefined);
await assert.rejects(
  () => fetchProductionFlight(42, {
    fetcher: async () => new Response("missing", { status: 404 }),
  }),
  (error) => error instanceof ProductionReadHttpError && error.status === 404,
);

const signedInDetail = readProductionFlightDetailCache({
  flight: sampleFlight({ id: "42" }),
  viewerAuthenticated: true,
});
assert.equal(signedInDetail.flight.id, "42");
assert.equal(signedInDetail.viewerAuthenticated, true);
assert.equal(
  readProductionFlightDetailCache(sampleFlight({ id: "42" })).flight.id,
  "42",
);
assert.equal(readProductionFlightDetailCache({ viewerAuthenticated: true }), null);
assert.equal(readProductionFlightDetailCache({ flight: undefined }), null);
assert.equal(readProductionFlightDetailCache(undefined), null);
assert.equal(readProductionFlightDetailCache({ flight: undefined })?.flight.id, undefined);
assert.equal(readProductionFlightDetailCache(sampleFlight())?.flight.id, "42");

const details = readFileSync(resolve(projectRoot, "app/flight/[id].tsx"), "utf8");
const queueStatus = readFileSync(resolve(projectRoot, "app/flight/queue-status.tsx"), "utf8");
const joinScreen = readFileSync(resolve(projectRoot, "app/flight/join.tsx"), "utf8");
const myQueues = readFileSync(resolve(projectRoot, "lib/myQueuesPresentation.ts"), "utf8");
const readiness = readFileSync(resolve(projectRoot, "lib/productionQueueReadiness.ts"), "utf8");
const join = readFileSync(resolve(projectRoot, "lib/joinFlightPresentation.ts"), "utf8");
assert.match(details, /fetchProductionFlight\(flightId, \{/);
assert.match(details, /accessToken: request\.accessToken/);
assert.match(details, /createClerkProductionTokenProvider/);
assert.match(details, /\.\.\.FLIGHT_DETAIL_QUERY_BEHAVIOR/);
assert.match(details, /selectDisplayedFlight/);
assert.match(details, /readProductionFlightDetailCache\(productionFlightQuery\.data\)/);
assert.doesNotMatch(details, /productionFlightQuery\.data\?\.flight\.id/);
assert.match(queueStatus, /return \{ flight, viewerAuthenticated: true \}/);
assert.match(queueStatus, /readProductionFlightDetailCache\(flightQuery\.data\)/);
assert.doesNotMatch(queueStatus, /return fetchProductionFlight\(/);
assert.match(joinScreen, /pathname: '\/flight\/queue-status', params: \{ flightId: String\(flight\.flightId\) \}/);
assert.match(myQueues, /pathname: '\/flight\/\[id\]', params: \{ id: String\(flightId\) \}/);
assert.match(details, /PRODUCTION_FLIGHTS_QUERY_KEY/);
assert.match(details, /flight-detail-unavailable/);
assert.match(details, /flight-detail-unavailable-screen/);
assert.match(details, /flight-detail-back-to-flights/);
assert.match(details, /Back to Flights/);
assert.match(details, /planFlightDetailExitNavigation/);
assert.match(details, /shouldShowFlightDetailHistoryBack/);
assert.match(details, /FloatingBackButton/);
assert.match(details, /leaveUnavailableFlight/);
assert.match(details, /flight-detail-refresh-error/);
assert.doesNotMatch(details, /flight-detail-gallery|flight-detail-queue-count|flight-detail-queue-position|flight-skip-line-pass-card|join-nav-build-marker|join-flight-details-hint|demo-join-flow-switch/);
assert.doesNotMatch(details, /people in queue|join-nav-bundle-2026-10-27-r2|Review what joining the queue means|Demo Join Flow|join-flight-queue-viewer/);
assert.match(details, /flight-detail-view-queue/);
assert.match(details, /pathname: '\/flight\/queue-status'/);
assert.match(details, /flightId: String\(productionFlightId\)/);
assert.doesNotMatch(details, /pathname: '\/flight\/queue-status'[\s\S]{0,180}pathname: '\/'|href: '\/'/);
assert.match(details, /View Queue Status/);
assert.match(details, /Leave the Queue/);
assert.match(details, /ProductionQueueLeaveControl/);
assert.match(details, /f\.userInQueue === true && productionFlightId !== null/);
const queuedActions = details.slice(details.indexOf("const memberInQueue"), details.indexOf('testID="production-queue-read-only-cta"'));
assert.match(queuedActions, /View Queue Status/);
assert.match(queuedActions, /Leave the Queue/);
assert.doesNotMatch(queuedActions, /Join the Flight/);
assert.match(details, /flight-detail-photo/);
assert.match(details, /flight-detail-photo-unavailable/);
assert.match(details, /Seats available/);
assert.match(details, /presentSeatsAvailable\(f\.seatsAvailable\)/);
assert.match(details, /Join the Flight/);
assert.match(details, /Ask AI Concierge/);
assert.match(details, /pathname: '\/flight\/join'/);
assert.match(details, /WinnerFlightNotice/);
assert.match(details, /departure-fbo-directions/);
assert.doesNotMatch(details, /baggage|25 kg/);
assert.match(details, /isProductionQueueVerified\(\)/);
assert.match(details, /presentCachedDepartureClock/);
assert.doesNotMatch(details, /msrpUsd|pricePerHour|Hamilton|setInterval/);
const productionQuery = details.slice(
  details.indexOf("const productionFlightQuery"),
  details.indexOf("return queryClient.getQueryCache()"),
);
assert.match(productionQuery, /FLIGHT_DETAIL_QUERY_BEHAVIOR/);
assert.doesNotMatch(productionQuery, /refetchInterval:\s*[1-9]|setInterval|\/api\/trips/);
assert.doesNotMatch(details, /joinEmptyLegQueue|getEmptyLegQueue|getMembership|\/api\/membership|\/api\/trips\/|useListTrips|useGetTrip\(/);
assert.match(readiness, /deployedMainService: false/);
assert.match(join, /return false;/);
assert.doesNotMatch(details, /AsyncStorage/);

console.log("Flight detail integration tests passed.");
