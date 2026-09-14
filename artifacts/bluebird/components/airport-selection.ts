import type { AirportGroup } from '@workspace/api-client-react';

export type GroupSelectionState = 'none' | 'partial' | 'all';

export function groupSelectionState(
  group: AirportGroup,
  selected: readonly string[],
): GroupSelectionState {
  const selectedSet = new Set(selected);
  const count = group.airports.filter((airport) => selectedSet.has(airport.code)).length;
  if (count === 0) return 'none';
  return count === group.airports.length ? 'all' : 'partial';
}

export function toggleAirport(selected: readonly string[], code: string): string[] {
  return selected.includes(code)
    ? selected.filter((selectedCode) => selectedCode !== code)
    : [...selected, code];
}

export function toggleAirportGroup(
  selected: readonly string[],
  group: AirportGroup,
): string[] {
  const codes = group.airports.map((airport) => airport.code);
  const allSelected = codes.every((code) => selected.includes(code));
  if (allSelected) return selected.filter((code) => !codes.includes(code));
  return [...selected, ...codes.filter((code) => !selected.includes(code))];
}

export function filterAirportGroups(
  groups: readonly AirportGroup[],
  search: string,
): AirportGroup[] {
  const query = search.trim().toLowerCase();
  if (!query) return [...groups];
  return groups.flatMap((group) => {
    const cityMatches = group.city.toLowerCase().includes(query);
    const airports = cityMatches
      ? group.airports
      : group.airports.filter(
          (airport) =>
            airport.code.toLowerCase().includes(query) ||
            airport.name.toLowerCase().includes(query) ||
            airport.city.toLowerCase().includes(query),
        );
    return airports.length ? [{ ...group, airports }] : [];
  });
}