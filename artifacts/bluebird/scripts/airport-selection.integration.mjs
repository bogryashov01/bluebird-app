import assert from "node:assert/strict";
import {
  filterAirportGroups,
  groupSelectionState,
  mapProductionSearchOptions,
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

const saveableAirportGroups = [
  {
    city: "Dallas",
    airports: [
      { code: "DAL", name: "Dallas Love Field" },
      { code: "DFW", name: "Dallas Fort Worth International" },
    ],
  },
  {
    city: "Miami",
    airports: [{ code: "MIA", name: "Miami International" }],
  },
];
const productionCityGroups = [
  {
    key: "metro:dallas",
    displayName: "Dallas–Fort Worth",
    country: "United States",
    tier: 0,
    airportCodes: ["DAL", "DFW", "KDAL", "KDFW"],
    airportLabels: [
      "DAL — Dallas Love Field",
      "DFW — Dallas Fort Worth International Airport",
    ],
  },
  {
    key: "metro:miami",
    displayName: "Miami",
    country: "United States",
    tier: 0,
    airportCodes: ["MIA", "KMIA", "OPF", "KOPF"],
    airportLabels: ["MIA — Miami International Airport", "OPF — Miami-Opa Locka Executive Airport"],
  },
];
const productionMatches = [
  {
    code: "KDAL",
    name: "Dallas Love Field",
    city: "Dallas",
    state: "Texas",
    country: "United States",
    latitude: 32.844776,
    longitude: -96.84766,
    tz: "America/Chicago",
    longestRunwayFt: null,
  },
  {
    code: "KDFW",
    name: "Dallas Fort Worth International Airport",
    city: "Dallas-Fort Worth",
    state: "Texas",
    country: "United States",
    latitude: 32.8968,
    longitude: -97.038,
    tz: "America/Chicago",
    longestRunwayFt: null,
  },
  {
    code: "KMIA",
    name: "Miami International Airport",
    city: "Miami",
    state: "Florida",
    country: "United States",
    latitude: 25.796011,
    longitude: -80.28975,
    tz: "America/New_York",
    longestRunwayFt: null,
  },
  {
    code: "KRBD",
    name: "Dallas Executive Airport",
    city: "Dallas",
    state: "TX",
    country: "United States",
    latitude: 32.6809,
    longitude: -96.8682,
    tz: "America/Chicago",
    longestRunwayFt: null,
  },
];
const safeSearchOptions = mapProductionSearchOptions(
  productionMatches,
  saveableAirportGroups,
  productionCityGroups,
);
assert.deepEqual(
  safeSearchOptions.map(({ airport, sourceCode, selectable, isAlias }) => ({
    code: airport.code,
    name: airport.name,
    sourceCode,
    selectable,
    isAlias,
  })),
  [
    { code: "DAL", name: "Dallas Love Field", sourceCode: "KDAL", selectable: true, isAlias: true },
    { code: "DFW", name: "Dallas Fort Worth International Airport", sourceCode: "KDFW", selectable: true, isAlias: true },
    { code: "MIA", name: "Miami International Airport", sourceCode: "KMIA", selectable: true, isAlias: true },
    { code: "KRBD", name: "Dallas Executive Airport", sourceCode: "KRBD", selectable: false, isAlias: false },
  ],
  "only production aliases proven by city labels and saved catalog resolve to selectable codes",
);
assert.equal(
  mapProductionSearchOptions([productionMatches[0]], saveableAirportGroups, []).at(0).selectable,
  false,
  "an alias cannot be accepted without live city group proof",
);
assert.equal(
  mapProductionSearchOptions(
    [productionMatches[0]],
    [{ city: "Dallas", airports: [{ code: "DAL", name: "Different Airport" }] }],
    productionCityGroups,
  )[0].selectable,
  false,
  "an alias cannot be accepted when the production name does not match the saveable airport",
);
assert.equal(
  mapProductionSearchOptions(
    [{
      ...productionMatches[0],
      code: "KSHR",
      name: "Shared Regional Airport",
    }],
    [{
      city: "Shared City",
      airports: [
        { code: "SHR", name: "Shared Regional Airport" },
        { code: "RSH", name: "Shared Regional Airport" },
      ],
    }],
    [{
      key: "city:shared",
      displayName: "Shared City",
      country: "United States",
      tier: 1,
      airportCodes: ["SHR", "RSH", "KSHR"],
      airportLabels: [
        "SHR — Shared Regional Airport",
        "RSH — Shared Regional Airport",
      ],
    }],
  )[0].selectable,
  false,
  "an alias matching more than one saved code remains non-selectable",
);
assert.equal(
  mapProductionSearchOptions(
    [
      { ...productionMatches[0], code: "DAL" },
      productionMatches[0],
    ],
    saveableAirportGroups,
    productionCityGroups,
  )[0].airport.code,
  "DAL",
  "a direct supported code takes precedence over its live alias",
);
assert.equal(
  mapProductionSearchOptions(
    [{ ...productionMatches[0], code: "DAL" }],
    saveableAirportGroups,
    [],
  )[0].selectable,
  true,
  "a direct supported code does not need alias metadata",
);

console.log("Airport selection checks passed.");