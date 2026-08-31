export type CatalogAirport = {
  code: string;
  name: string;
};

export type AirportGroup = {
  city: string;
  airports: CatalogAirport[];
};

/**
 * Airports members may save as preferences. This is deliberately independent
 * of the current flight inventory: an airport remains selectable when there
 * are no Bluebird flights departing from it today.
 */
export const AIRPORT_GROUPS: readonly AirportGroup[] = [
  {
    city: "Dallas",
    airports: [
      { code: "DFW", name: "Dallas Fort Worth International" },
      { code: "DAL", name: "Dallas Love Field" },
    ],
  },
  {
    city: "New York",
    airports: [
      { code: "TEB", name: "Teterboro Airport" },
      { code: "JFK", name: "John F. Kennedy International" },
      { code: "LGA", name: "LaGuardia Airport" },
      { code: "EWR", name: "Newark Liberty International" },
    ],
  },
  { city: "Los Angeles", airports: [{ code: "LAX", name: "Los Angeles International" }] },
  { city: "San Francisco", airports: [{ code: "SFO", name: "San Francisco International" }] },
  { city: "Miami", airports: [{ code: "MIA", name: "Miami International" }] },
  { city: "Chicago", airports: [{ code: "ORD", name: "Chicago O'Hare International" }] },
  { city: "Las Vegas", airports: [{ code: "LAS", name: "Harry Reid International" }] },
  { city: "Boston", airports: [{ code: "BOS", name: "Boston Logan International" }] },
  { city: "Seattle", airports: [{ code: "SEA", name: "Seattle-Tacoma International" }] },
  { city: "Denver", airports: [{ code: "DEN", name: "Denver International" }] },
  { city: "Aspen", airports: [{ code: "ASP", name: "Aspen/Pitkin County Airport" }] },
  { city: "Scottsdale", airports: [{ code: "SDL", name: "Scottsdale Airport" }] },
  { city: "Palm Beach", airports: [{ code: "PBI", name: "Palm Beach International" }] },
  { city: "Nassau", airports: [{ code: "NAS", name: "Lynden Pindling International" }] },
  { city: "Toronto", airports: [{ code: "YYZ", name: "Toronto Pearson International" }] },
];

export const AIRPORT_CODES = new Set(
  AIRPORT_GROUPS.flatMap((group) => group.airports.map((airport) => airport.code)),
);

export function isCatalogAirportCode(code: string): boolean {
  return AIRPORT_CODES.has(code);
}