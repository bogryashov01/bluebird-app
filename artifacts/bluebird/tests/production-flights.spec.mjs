import assert from "node:assert/strict";
import {
  fetchProductionAirports,
  fetchProductionFlight,
  fetchProductionFlights,
  getFlightImagePresentation,
  getFlightAirportCodes,
  mapProductionAirport,
  mapProductionFlight,
  mapProductionFlights,
  normalizeAirportCodes,
  parseProductionFlightId,
  productionReadRetryDelay,
  PRODUCTION_API_BASE_URL,
  ProductionReadHttpError,
  ProductionReadInvalidJsonError,
  ProductionReadTimeoutError,
  resolveAircraftImageUrl,
  resolveFlightReadConfiguration,
  shouldRetryProductionRead,
} from "../scripts/.production-flights.test.mjs";

const rawFlight = {
  id: 98765,
  tripId: 98766,
  status: "published",
  queueClosesAt: "2026-10-07T23:00:00.000Z",
  queueCount: 2,
  memberQueueCount: null,
  userInQueue: false,
  viewerQueuePosition: null,
  lockedForFreeUsers: true,
  lineSkipPriceUsd: 10,
  lineSkipSold: false,
  viewerHasLineSkip: null,
  internationalPassPriceUsd: null,
  internationalPassRequired: false,
  viewerHasInternationalPass: null,
  viewerIsBookedPassenger: false,
  viewerIsEffectiveWinner: null,
  viewerConfirmationStatus: null,
  awardedAt: null,
  originAirport: "TST",
  originCity: "Test Origin",
  originTz: "America/Chicago",
  destinationAirport: "DST",
  destinationCity: "Test Destination",
  destinationTz: "America/New_York",
  departureTime: "2026-10-08T13:36:00.000Z",
  arrivalTime: "2026-10-08T14:00:00.000Z",
  durationHours: 0.4,
  aircraftType: null,
  aircraftGalleryUrls: ["/fixtures/test-aircraft.jpg"],
  aircraftGalleryAlts: [null],
  userInQueue: false,
  isInternational: null,
  totalPrice: null,
  msrpUsd: null,
  pricePerHour: null,
};

assert.equal(PRODUCTION_API_BASE_URL, "https://bluebirdjets.com/api");

assert.deepEqual(
  resolveFlightReadConfiguration({ isDev: false }),
  { mode: "production", baseUrl: PRODUCTION_API_BASE_URL },
);
assert.deepEqual(
  resolveFlightReadConfiguration({ isDev: true, mode: "local", baseUrl: "http://localhost:5000/api" }),
  { mode: "local", baseUrl: "" },
);
assert.deepEqual(
  resolveFlightReadConfiguration({ isDev: false, mode: "local" }),
  { mode: "production", baseUrl: PRODUCTION_API_BASE_URL },
);
for (const invalidBaseUrl of [
  "http://bluebirdjets.com/api",
  "https://my-repl.replit.dev/api",
  "https://bluebirdjets.com/other",
  "https://bluebirdjets.com/api/api",
  "not-a-url",
]) {
  assert.throws(
    () => resolveFlightReadConfiguration({ isDev: false, baseUrl: invalidBaseUrl }),
    /production flight API/i,
  );
}

assert.equal(resolveAircraftImageUrl("/aircraft/a.jpg"), "https://bluebirdjets.com/aircraft/a.jpg");
assert.equal(
  resolveAircraftImageUrl("https://cdn.example.test/aircraft/a.jpg"),
  "https://cdn.example.test/aircraft/a.jpg",
);
assert.equal(resolveAircraftImageUrl(null), null);
assert.equal(
  mapProductionFlight({ ...rawFlight, aircraftGalleryUrls: null }).imageUrl,
  null,
);

const mappedFlight = mapProductionFlight(rawFlight);
assert.equal(mappedFlight.id, "98765");
assert.equal(mappedFlight.source, "production");
assert.equal(mappedFlight.status, "published");
assert.equal(mappedFlight.fromAirport, "TST");
assert.equal(mappedFlight.originTz, "America/Chicago");
assert.equal(mappedFlight.departureDate, "2026-10-08");
assert.equal(mappedFlight.departureTime, "08:36");
assert.ok(mappedFlight.departureTimeZone);
assert.equal(mappedFlight.arrivalTime, "10:00");
assert.equal(mappedFlight.duration, "24m");
assert.equal(mappedFlight.aircraftType, null);
assert.equal(mappedFlight.imageUrl, "https://bluebirdjets.com/fixtures/test-aircraft.jpg");
assert.equal(mappedFlight.queueCount, 2);
assert.equal(mappedFlight.memberQueueCount, null);
assert.equal(mappedFlight.userInQueue, false);
assert.equal(mappedFlight.viewerQueuePosition, null);
assert.equal(mappedFlight.lockedForFreeUsers, true);
assert.equal(mappedFlight.lineSkipPriceUsd, 10);
assert.equal(mappedFlight.lineSkipSold, false);
assert.equal(mappedFlight.viewerHasLineSkip, null);
assert.equal(mappedFlight.international, null);
assert.equal(mappedFlight.internationalPassPriceUsd, null);
assert.equal(mappedFlight.internationalPassRequired, false);
assert.equal(mappedFlight.viewerHasInternationalPass, null);
assert.equal(mappedFlight.viewerIsBookedPassenger, false);
assert.equal(mappedFlight.viewerIsEffectiveWinner, null);
assert.equal(mappedFlight.viewerConfirmationStatus, null);
assert.equal(mappedFlight.awardedAt, null);
assert.equal(mappedFlight.queueClosesAt, "2026-10-07T23:00:00.000Z");
assert.equal(mappedFlight.totalPrice, null);
assert.equal(mappedFlight.msrpUsd, null);
assert.equal(mappedFlight.pricePerHour, null);
assert.equal(mappedFlight.rangeNm, null);
assert.equal(mappedFlight.seatsAvailable, null);
assert.equal(mappedFlight.featured, null);
assert.equal(getFlightImagePresentation(mappedFlight), "provided");
assert.equal(
  getFlightImagePresentation(mapProductionFlight({ ...rawFlight, aircraftGalleryUrls: null })),
  "unavailable",
  "production flights without a production photo do not use a local aircraft image",
);
assert.equal(
  getFlightImagePresentation({ source: "local", imageUrl: null }),
  "local-fallback",
  "local demo flights retain their representative aircraft imagery",
);

assert.equal(
  mapProductionFlight({ ...rawFlight, aircraftGalleryUrls: ["https://cdn.example.test/a.jpg"] }).imageUrl,
  "https://cdn.example.test/a.jpg",
);
assert.equal(mapProductionFlight({ ...rawFlight, originAirport: " tst " }).fromAirport, "TST");
assert.equal(mapProductionFlight({ ...rawFlight, isInternational: true }).international, true);
assert.throws(() => mapProductionFlights({ data: [rawFlight] }), /flight array/i);
assert.throws(() => mapProductionFlight({ ...rawFlight, id: "98765" }), /numeric ID/i);
assert.equal(parseProductionFlightId("98765"), 98765);
assert.equal(parseProductionFlightId("flight-98765"), null);
assert.equal(parseProductionFlightId("0"), null);

const airport = mapProductionAirport({
  code: "TST",
  name: "Test Origin Airport",
  city: "Test City",
  state: "Test State",
  country: "Test Country",
  latitude: 30.123,
  longitude: -97.456,
  tz: "America/Chicago",
  longestRunwayFt: null,
});
assert.equal(airport.code, "TST");
assert.equal(airport.latitude, 30.123);
assert.equal(airport.tz, "America/Chicago");
assert.equal(airport.longestRunwayFt, null);
const nullableAirport = mapProductionAirport({
  code: "ZZZ",
  name: "Fixture Airport with Nullable Metadata",
  city: null,
  state: null,
  country: null,
  latitude: 0,
  longitude: 0,
  tz: null,
  longestRunwayFt: null,
});
assert.equal(nullableAirport.city, null);
assert.equal(nullableAirport.tz, null);
assert.throws(() => mapProductionAirport({ ...nullableAirport, latitude: 91 }), /coordinates/i);

assert.deepEqual(
  getFlightAirportCodes([
    mappedFlight,
    { ...mappedFlight, fromAirport: "dst", toAirport: "TST" },
    { ...mappedFlight, fromAirport: null, toAirport: null },
  ]),
  ["TST", "DST"],
);
assert.deepEqual(normalizeAirportCodes([" tst ", "TST", "dst"]), ["TST", "DST"]);
assert.throws(
  () => normalizeAirportCodes(Array.from({ length: 201 }, (_, index) => `A${index}`)),
  /200 unique codes/i,
);

const requests = [];
const mockFetcher = async (url, init) => {
  requests.push({ url: String(url), init });
  const payload = String(url).endsWith("/empty-legs/98765") ? rawFlight : [rawFlight];
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
const previousMode = process.env.EXPO_PUBLIC_BLUEBIRD_FLIGHT_READ_MODE;
process.env.EXPO_PUBLIC_BLUEBIRD_FLIGHT_READ_MODE = "invalid";
await assert.rejects(
  () => fetchProductionFlights({ fetcher: mockFetcher }),
  /flight read mode/i,
);
assert.equal(requests.length, 0);
if (previousMode === undefined) delete process.env.EXPO_PUBLIC_BLUEBIRD_FLIGHT_READ_MODE;
else process.env.EXPO_PUBLIC_BLUEBIRD_FLIGHT_READ_MODE = previousMode;

const fetchedFlights = await fetchProductionFlights({ fetcher: mockFetcher });
assert.equal(fetchedFlights[0].id, "98765");
assert.equal(requests[0].url, `${PRODUCTION_API_BASE_URL}/empty-legs`);
assert.equal(requests[0].init.method, "GET");
assert.equal(requests[0].init.headers.Authorization, undefined);
await assert.rejects(
  () => fetchProductionFlights({
    fetcher: async () => new Response("temporarily unavailable", { status: 503 }),
  }),
  /HTTP 503/i,
  "a failed production empty-leg request does not become local demo data",
);
await assert.rejects(
  () => fetchProductionFlights({
    fetcher: async () => new Response("rate limited", {
      status: 429,
      headers: { "Retry-After": "2" },
    }),
  }),
  (error) => {
    assert(error instanceof ProductionReadHttpError);
    assert.equal(error.status, 429);
    assert.equal(error.retryAfterMs, 2000);
    assert.equal(shouldRetryProductionRead(0, error), true);
    assert.equal(shouldRetryProductionRead(1, error), false);
    assert.equal(productionReadRetryDelay(0, error), 2000);
    return true;
  },
  "HTTP 429 preserves Retry-After and automatic retry stays bounded",
);
await assert.rejects(
  () => fetchProductionFlights({
    fetcher: async () => new Response("server error", { status: 500 }),
  }),
  (error) => {
    assert.equal(error.status, 500);
    assert.equal(shouldRetryProductionRead(0, error), true);
    return true;
  },
);

let timedOutSignal;
await assert.rejects(
  () => fetchProductionFlights({
    timeoutMs: 15,
    fetcher: async (_url, init) => {
      timedOutSignal = init.signal;
      return new Promise(() => {});
    },
  }),
  (error) => error instanceof ProductionReadTimeoutError,
  "a stalled reader rejects after its finite timeout even when an injected fetcher stalls",
);
assert.equal(timedOutSignal.aborted, true);

const callerController = new AbortController();
let cancelledSignal;
const pendingRead = fetchProductionFlights({
  timeoutMs: 500,
  signal: callerController.signal,
  fetcher: async (_url, init) => {
    cancelledSignal = init.signal;
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("fetch aborted")), { once: true });
    });
  },
});
callerController.abort();
await assert.rejects(
  pendingRead,
  (error) => error.name === "AbortError",
  "caller cancellation aborts the underlying request and is not treated as a timeout",
);
assert.equal(cancelledSignal.aborted, true);

await assert.rejects(
  () => fetchProductionFlights({
    fetcher: async () => new Response("not json", { status: 200 }),
  }),
  (error) => {
    assert(error instanceof ProductionReadInvalidJsonError);
    assert.equal(shouldRetryProductionRead(0, error), false);
    return true;
  },
  "invalid JSON is reported as a payload failure rather than retried as a network failure",
);

requests.length = 0;
const fetchedFlight = await fetchProductionFlight(98765, { fetcher: mockFetcher });
assert.equal(fetchedFlight.id, "98765");
assert.equal(requests[0].url, `${PRODUCTION_API_BASE_URL}/empty-legs/98765`);
assert.equal(requests[0].init.method, "GET");
assert.equal(requests[0].init.headers.Authorization, undefined);
await assert.rejects(() => fetchProductionFlight(0, { fetcher: mockFetcher }), /numeric production flight ID/i);
await assert.rejects(
  () => fetchProductionFlight(98765, {
    fetcher: async () => new Response("temporarily unavailable", { status: 503 }),
  }),
  /HTTP 503/i,
  "a failed production flight detail request does not become local demo data",
);

requests.length = 0;
const fetchedAirports = await fetchProductionAirports(["TST", "DST", "TST"], {
  fetcher: async (url, init) => {
    requests.push({ url: String(url), init });
    const search = new URL(String(url)).searchParams;
    assert.equal(search.get("codes"), "TST,DST");
    return new Response(JSON.stringify([airport]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  },
});
assert.equal(fetchedAirports.length, 1);
assert.equal(new URL(requests[0].url).pathname, "/api/airports");
assert.equal(requests[0].init.method, "GET");
assert.equal(requests[0].init.headers.Authorization, undefined);
assert.deepEqual(await fetchProductionAirports([], { fetcher: mockFetcher }), []);

console.log("Production flight and airport read tests passed.");
