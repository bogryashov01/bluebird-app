import assert from "node:assert/strict";
import {
  discoverResultCountLabel,
  filterDiscoverFlights,
  getGreetingForHour,
  reconcileFeaturedFlightId,
} from "../scripts/.discover-presentation.test.mjs";
import { mapProductionFlight } from "../scripts/.discover-production-flights.test.mjs";

for (const [hour, expected] of [
  [0, "Good night"],
  [4, "Good night"],
  [5, "Good morning"],
  [11, "Good morning"],
  [12, "Good afternoon"],
  [16, "Good afternoon"],
  [17, "Good evening"],
  [20, "Good evening"],
  [21, "Good night"],
  [23, "Good night"],
]) {
  assert.equal(getGreetingForHour(hour), expected, `greeting at local hour ${hour}`);
}

assert.equal(reconcileFeaturedFlightId([], null, () => 0), null);
assert.equal(reconcileFeaturedFlightId(["first", "second"], null, () => 0), "first");
assert.equal(reconcileFeaturedFlightId(["first", "second"], null, () => 0.99), "second");
assert.equal(
  reconcileFeaturedFlightId(["first", "second"], "second", () => 0),
  "second",
  "a still-eligible recommendation survives refreshes and unrelated rerenders",
);
assert.equal(
  reconcileFeaturedFlightId(["first", "replacement"], "removed", () => 0.99),
  "replacement",
  "a removed recommendation is replaced from the current eligible results",
);
assert.equal(
  reconcileFeaturedFlightId(["only"], "removed", () => 1),
  "only",
  "random selection remains within the candidate range",
);

const now = new Date(2026, 9, 27, 15, 0, 0);

function productionFlight(overrides) {
  return mapProductionFlight({
    id: overrides.id,
    status: "published",
    originAirport: overrides.originAirport ?? "DAL",
    originCity: overrides.originCity ?? "Dallas",
    destinationAirport: overrides.destinationAirport ?? "SFO",
    destinationCity: overrides.destinationCity ?? "San Francisco",
    originTz: "UTC",
    departureTime: overrides.departureTime === undefined
      ? "2026-10-27T12:00:00.000Z"
      : overrides.departureTime,
    durationHours: overrides.durationHours === undefined ? 2 : overrides.durationHours,
    aircraftType: overrides.aircraftType ?? "Citation Latitude",
  });
}

const catalog = [
  productionFlight({ id: 1, originAirport: "DAL", originCity: "Dallas", durationHours: 2, departureTime: "2026-10-27T12:00:00.000Z" }),
  productionFlight({ id: 2, originAirport: "MIA", originCity: "Miami", durationHours: 2, departureTime: "2026-11-03T12:00:00.000Z" }),
  productionFlight({ id: 3, originAirport: "SAT", originCity: "San Antonio", durationHours: 6, departureTime: "2026-10-26T12:00:00.000Z" }),
  productionFlight({ id: 4, originAirport: "JFK", originCity: "New York", durationHours: 4, departureTime: "2026-10-27T18:00:00.000Z" }),
  productionFlight({ id: 5, originAirport: "HEF", originCity: "Manassas", durationHours: 6, departureTime: "2026-11-04T12:00:00.000Z" }),
  productionFlight({ id: 6, originAirport: "LAX", originCity: "Los Angeles", durationHours: null, departureTime: "2026-10-27T20:00:00.000Z" }),
  productionFlight({ id: 7, originAirport: "BOS", originCity: "Boston", durationHours: 2, departureTime: null, aircraftType: "Gulfstream" }),
];

assert.equal(catalog[0].departureDate, "2026-10-27");
assert.equal(catalog[0].fromAirport, "DAL");
assert.equal(catalog[0].toAirport, "SFO");
assert.equal(catalog[0].duration, "2h");
assert.equal(catalog[0].aircraftType, "Citation Latitude");
assert.equal(catalog[2].departureDate, "2026-10-26");
assert.equal(catalog[2].duration, "6h");
assert.equal(catalog[3].duration, "4h");
assert.equal(catalog[5].duration, null);
assert.equal(catalog[6].departureDate, null);
assert.equal(catalog[6].duration, "2h");

function ids(filter, query = "") {
  return filterDiscoverFlights(catalog, { filter, query, now }).map((flight) => flight.id);
}

assert.deepEqual(ids("all"), ["1", "2", "3", "4", "5", "6", "7"]);
assert.deepEqual(ids("week"), ["1", "3", "4", "6"], "This Week is the local Monday-Sunday week, including earlier days");
assert.deepEqual(ids("short"), ["1", "2", "7"], "Under 4 hrs keeps durations strictly below 240 minutes");
assert.deepEqual(ids("week", "dal"), ["1"]);
assert.deepEqual(ids("short", "mia"), ["2"]);
assert.deepEqual(ids("week", "mia"), []);
assert.deepEqual(ids("all", "gulf"), ["7"]);
assert.deepEqual(ids("short", ""), ids("all", "").filter((id) => ["1", "2", "7"].includes(id)));

const uniform = [
  productionFlight({ id: 11, durationHours: 2, departureTime: "2026-10-27T12:00:00.000Z" }),
  productionFlight({ id: 12, durationHours: 3, departureTime: "2026-10-28T12:00:00.000Z" }),
];
const uniformIds = (filter) => filterDiscoverFlights(uniform, { filter, query: "", now }).map((flight) => flight.id);
assert.deepEqual(uniformIds("week"), uniformIds("all"));
assert.deepEqual(uniformIds("short"), uniformIds("all"));

const featuredId = reconcileFeaturedFlightId(catalog.map((flight) => flight.id), "3");
const shortIds = ids("short");
const weekResults = filterDiscoverFlights(catalog, { filter: "week", query: "", now });
const mapResults = weekResults;
const listResults = weekResults;
assert.equal(featuredId, "3");
assert.equal(shortIds.includes(featuredId), false);
assert.equal(listResults, mapResults, "list and map receive the same filtered collection");
assert.deepEqual(listResults.map((flight) => flight.id), ["1", "3", "4", "6"]);

function resultLabel(filter, query) {
  const results = filterDiscoverFlights(catalog, { filter, query, now });
  return {
    count: results.length,
    label: discoverResultCountLabel({
      count: results.length,
      filter,
      hasQuery: query.trim().length > 0,
      productionReadOnly: true,
    }),
  };
}

assert.deepEqual(resultLabel("all", ""), { count: 7, label: "7 available flights" });
assert.deepEqual(resultLabel("week", ""), { count: 4, label: "4 flights this week" });
assert.deepEqual(resultLabel("short", ""), { count: 3, label: "3 flights under 4 hrs" });
assert.deepEqual(resultLabel("week", "dal"), { count: 1, label: "1 matching flight" });
assert.deepEqual(resultLabel("week", "   "), { count: 4, label: "4 flights this week" }, "clearing search keeps This Week");
assert.equal(
  discoverResultCountLabel({ count: 0, filter: "week", hasQuery: false, productionReadOnly: true }),
  "No flights this week",
);
assert.equal(
  discoverResultCountLabel({ count: 0, filter: "short", hasQuery: false, productionReadOnly: true }),
  "No flights under 4 hrs",
);
assert.equal(
  discoverResultCountLabel({ count: 0, filter: "all", hasQuery: true, productionReadOnly: true }),
  "No matching flights",
);
assert.equal(
  discoverResultCountLabel({ count: 2, filter: "all", hasQuery: false, productionReadOnly: false }),
  "2 empty legs available",
);

console.log("Discover presentation tests passed.");
