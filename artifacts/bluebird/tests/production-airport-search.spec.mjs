import assert from "node:assert/strict";
import {
  fetchProductionAirportCities,
  fetchProductionAirportSearch,
  mapProductionAirportCityGroup,
  mapProductionAirportCityGroups,
  mapProductionAirport,
  mapProductionAirports,
  PRODUCTION_API_BASE_URL,
  ProductionReadNetworkError,
} from "../scripts/.production-airport-search.test.mjs";

process.env.EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT = "production";
process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL = "https://bluebirdjets.com/api";
process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY = "pk_live_Y2xlcmsuZXhhbXBsZS5jb20k";

const airport = {
  code: "DAL",
  name: "Dallas Love Field",
  city: "Dallas",
  state: "Texas",
  country: "United States",
  latitude: 32.844776,
  longitude: -96.84766,
  tz: "America/Chicago",
  longestRunwayFt: null,
};
const cityGroup = {
  key: "metro:dallas",
  displayName: "Dallas–Fort Worth",
  country: "United States",
  tier: 0,
  airportCodes: ["DAL", "DFW", "KDAL", "KDFW"],
  airportLabels: ["DAL — Dallas Love Field", "DFW — Dallas Fort Worth International Airport"],
};

assert.equal(PRODUCTION_API_BASE_URL, "https://bluebirdjets.com/api");
assert.equal(mapProductionAirport({ ...airport, code: " dal " }).code, "DAL");
assert.deepEqual(mapProductionAirports([]), []);
assert.deepEqual(mapProductionAirports([airport]), [airport]);
assert.throws(() => mapProductionAirports({ results: [airport] }), /must be an array/i);
assert.throws(() => mapProductionAirports([{ ...airport, longitude: 181 }]), /coordinates/i);
assert.throws(() => mapProductionAirports([{ ...airport, tz: 42 }]), /tz.*string or null/i);

assert.deepEqual(mapProductionAirportCityGroup(cityGroup), cityGroup);
assert.deepEqual(mapProductionAirportCityGroups([cityGroup]), [cityGroup]);
assert.throws(() => mapProductionAirportCityGroups({ cities: [cityGroup] }), /must be an array/i);
assert.throws(() => mapProductionAirportCityGroup(null), /must be an object/i);
assert.throws(() => mapProductionAirportCityGroup({ ...cityGroup, tier: 1.5 }), /integer/i);
assert.throws(
  () => mapProductionAirportCityGroup({ ...cityGroup, airportCodes: ["K DAL"] }),
  /valid airport code/i,
);
assert.throws(
  () => mapProductionAirportCityGroup({ ...cityGroup, airportLabels: [null] }),
  /non-empty string/i,
);

const requests = [];
const signal = new AbortController().signal;
const fetchedSearch = await fetchProductionAirportSearch("  DAL & Dallas  ", {
  signal,
  fetcher: async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify([airport]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  },
});
assert.equal(fetchedSearch[0].code, "DAL");
assert.equal(requests.length, 1);
const searchUrl = new URL(requests[0].url);
assert.equal(searchUrl.origin + searchUrl.pathname, `${PRODUCTION_API_BASE_URL}/airports/search`);
assert.equal(searchUrl.searchParams.get("q"), "DAL & Dallas");
assert.equal(requests[0].init.method, "GET");
assert.equal(requests[0].init.headers.Accept, "application/json");
assert.equal(requests[0].init.headers.Authorization, undefined);
assert.equal(requests[0].init.credentials, "omit");
assert.notEqual(requests[0].init.signal, signal, "the reader composes caller cancellation with its timeout");
assert.equal(requests[0].init.signal.aborted, false);

requests.length = 0;
assert.deepEqual(
  await fetchProductionAirportSearch("   ", {
    fetcher: async (...args) => {
      requests.push(args);
      throw new Error("blank input should not send a request");
    },
  }),
  [],
);
assert.equal(requests.length, 0, "blank search input does not call the production endpoint");

requests.length = 0;
assert.deepEqual(
  await fetchProductionAirportSearch("missing", {
    fetcher: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response("[]", { status: 200 });
    },
  }),
  [],
  "an empty production response stays empty",
);

requests.length = 0;
const fetchedCities = await fetchProductionAirportCities({
  fetcher: async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify([cityGroup]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  },
});
assert.deepEqual(fetchedCities, [cityGroup]);
assert.equal(requests[0].url, `${PRODUCTION_API_BASE_URL}/airports/cities`);
assert.equal(requests[0].init.method, "GET");
assert.equal(requests[0].init.headers.Authorization, undefined);
assert.equal(requests[0].init.credentials, "omit");

await assert.rejects(
  () => fetchProductionAirportSearch("DAL", {
    fetcher: async () => new Response('{"not":"an array"}', { status: 200 }),
  }),
  /airport lookup response must be an array/i,
  "malformed search payloads fail rather than using local results",
);
await assert.rejects(
  () => fetchProductionAirportCities({
    fetcher: async () => new Response("unavailable", { status: 503 }),
  }),
  /HTTP 503/i,
);
await assert.rejects(
  () => fetchProductionAirportSearch("DAL", {
    fetcher: async () => {
      throw new Error("network unavailable");
    },
  }),
  (error) => error instanceof ProductionReadNetworkError,
  "network errors propagate without a fixture fallback",
);

console.log("Production airport-search reader tests passed.");
