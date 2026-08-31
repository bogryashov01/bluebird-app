import assert from "node:assert/strict";
import {
  filterAirportGroups,
  groupSelectionState,
  toggleAirport,
  toggleAirportGroup,
} from "../components/airport-selection.ts";

const dallas = {
  city: "Dallas",
  airports: [
    { code: "DFW", name: "Dallas Fort Worth International", city: "Dallas" },
    { code: "DAL", name: "Dallas Love Field", city: "Dallas" },
  ],
};
const newYork = {
  city: "New York",
  airports: [
    { code: "TEB", name: "Teterboro Airport", city: "New York" },
    { code: "JFK", name: "John F. Kennedy International", city: "New York" },
    { code: "LGA", name: "LaGuardia Airport", city: "New York" },
    { code: "EWR", name: "Newark Liberty International", city: "New York" },
  ],
};

let selected = toggleAirportGroup([], dallas);
assert.deepEqual(selected, ["DFW", "DAL"], "selecting Dallas selects both airports");
assert.equal(groupSelectionState(dallas, selected), "all");

selected = toggleAirport(selected, "DAL");
assert.deepEqual(selected, ["DFW"], "unchecking one child preserves the other");
assert.equal(groupSelectionState(dallas, selected), "partial");

selected = toggleAirportGroup(selected, newYork);
assert.deepEqual(
  selected,
  ["DFW", "TEB", "JFK", "LGA", "EWR"],
  "selections from multiple cities are combined",
);

selected = toggleAirportGroup(selected, newYork);
assert.deepEqual(selected, ["DFW"], "toggling a fully-selected city removes only that city");

const cityResults = filterAirportGroups([dallas, newYork], "new york");
assert.equal(cityResults.length, 1);
assert.deepEqual(
  cityResults[0].airports.map((airport) => airport.code),
  ["TEB", "JFK", "LGA", "EWR"],
  "city search reveals the complete metro group",
);

const codeResults = filterAirportGroups([dallas, newYork], "lga");
assert.deepEqual(
  codeResults[0].airports.map((airport) => airport.code),
  ["LGA"],
  "airport-code search narrows visible children",
);
assert.deepEqual(
  toggleAirportGroup(["TEB"], newYork),
  ["TEB", "JFK", "LGA", "EWR"],
  "select-all operates on the full metro group even from a filtered result",
);

assert.deepEqual(filterAirportGroups([dallas, newYork], "no match"), []);

console.log("Airport selection checks passed.");