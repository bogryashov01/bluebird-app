import assert from "node:assert/strict";
import {
  fetchFullAppDemoFlight,
  fetchFullAppDemoFlights,
  fetchFullAppDemoQueue,
} from "../scripts/.full-app-demo-live-reads.test.mjs";

process.env.EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT = "production";
process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL = "https://bluebirdjets.com/api";
process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY =
  "pk_live_Y2xlcmsuZXhhbXBsZS5jb20k";

const requests = [];
const flight = {
  id: 98765,
  status: "published",
  originAirport: "SEA",
  destinationAirport: "SFO",
  departureTime: "2026-11-01T13:00:00.000Z",
  aircraftGalleryUrls: [],
};
const fetcher = async (url, init) => {
  requests.push({ url: String(url), init });
  const payload = String(url).endsWith("/queue")
    ? [{ position: 1, initials: "AB", tier: "base", hasLineSkip: false, isViewer: true }]
    : String(url).endsWith("/98765")
      ? flight
      : [flight];
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

const flights = await fetchFullAppDemoFlights({ fetcher });
assert.equal(flights[0].id, "98765");
assert.equal(flights[0].source, "production");
const detail = await fetchFullAppDemoFlight(98765, { fetcher });
assert.equal(detail.fromAirport, "SEA");
const queue = await fetchFullAppDemoQueue(98765, { fetcher });
assert.deepEqual(queue, [{
  position: 1,
  initials: "AB",
  tier: "base",
  hasLineSkip: false,
}]);

assert.deepEqual(requests.map(({ url, init }) => ({
  url,
  method: init.method,
  credentials: init.credentials,
  headers: init.headers,
})), [
  {
    url: "https://bluebirdjets.com/api/empty-legs",
    method: "GET",
    credentials: "omit",
    headers: { Accept: "application/json" },
  },
  {
    url: "https://bluebirdjets.com/api/empty-legs/98765",
    method: "GET",
    credentials: "omit",
    headers: { Accept: "application/json" },
  },
  {
    url: "https://bluebirdjets.com/api/empty-legs/98765/queue",
    method: "GET",
    credentials: "omit",
    headers: { Accept: "application/json" },
  },
]);

for (const status of [401, 403]) {
  await assert.rejects(
    fetchFullAppDemoQueue(98765, {
      fetcher: async () => new Response(JSON.stringify({ error: "blocked" }), { status }),
    }),
    (error) => error.status === status,
  );
}

await assert.rejects(
  fetchFullAppDemoQueue(98765, {
    fetcher: async () => new Response(JSON.stringify([{
      position: 1,
      initials: "AB",
      tier: "base",
      hasLineSkip: false,
      isViewer: false,
      email: "must-not-render@example.test",
    }])),
  }),
  /public queue/,
);

assert.throws(() => fetchFullAppDemoQueue(0), /positive numeric production flight ID/);
console.log("full-app demo live-read tests passed");
