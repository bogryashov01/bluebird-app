import assert from "node:assert/strict";
import { AIRPORT_GROUPS, AIRPORT_CODES } from "../src/lib/airport-catalog.ts";

const byCity = new Map(AIRPORT_GROUPS.map((group) => [group.city, group]));

assert.deepEqual(
  byCity.get("Dallas")?.airports.map((airport) => airport.code),
  ["DFW", "DAL"],
);
assert.deepEqual(
  byCity.get("New York")?.airports.map((airport) => airport.code),
  ["TEB", "JFK", "LGA", "EWR"],
);
assert.equal(AIRPORT_CODES.size, AIRPORT_GROUPS.flatMap((group) => group.airports).length);
assert.ok(AIRPORT_CODES.has("DFW"));
assert.ok(AIRPORT_CODES.has("EWR"));

console.log("Airport catalog checks passed.");