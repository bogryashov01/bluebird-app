import type { AirportGroup, AirportInfo } from '@workspace/api-client-react';
import type {
  AirportRecord,
  ProductionAirportCityGroupResponse,
} from '../lib/productionFlights';

export type GroupSelectionState = 'none' | 'partial' | 'all';

export interface AirportSearchOption {
  airport: AirportInfo;
  sourceCode: string;
  selectable: boolean;
  isAlias: boolean;
  locationLabel: string;
}

function normalizeAirportName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\bairport\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function resolveSelectableAirportCode(
  result: AirportRecord,
  groups: readonly AirportGroup[],
  cityGroups: readonly ProductionAirportCityGroupResponse[],
): string | null {
  const airportByCode = new Map(
    groups.flatMap((group) => group.airports.map((airport) => [airport.code.toUpperCase(), airport] as const)),
  );
  const sourceCode = result.code.toUpperCase();
  if (airportByCode.has(sourceCode)) return sourceCode;

  const resultName = normalizeAirportName(result.name);
  const candidates = new Set<string>();
  for (const cityGroup of cityGroups) {
    if (!cityGroup.airportCodes.includes(sourceCode)) continue;
    for (const label of cityGroup.airportLabels) {
      const match = /^([A-Z0-9-]+)\s*[—–-]\s*(.+)$/i.exec(label);
      if (!match) continue;
      const canonicalCode = match[1].toUpperCase();
      const canonicalAirport = airportByCode.get(canonicalCode);
      if (
        canonicalAirport &&
        cityGroup.airportCodes.includes(canonicalCode) &&
        normalizeAirportName(match[2]) === resultName &&
        normalizeAirportName(canonicalAirport.name) === resultName
      ) {
        candidates.add(canonicalCode);
      }
    }
  }
  return candidates.size === 1 ? [...candidates][0] : null;
}

export function mapProductionSearchOptions(
  results: readonly AirportRecord[],
  groups: readonly AirportGroup[],
  cityGroups: readonly ProductionAirportCityGroupResponse[],
): AirportSearchOption[] {
  const optionsByKey = new Map<string, AirportSearchOption>();
  for (const result of results) {
    const sourceCode = result.code.toUpperCase();
    const code = resolveSelectableAirportCode(result, groups, cityGroups);
    const option: AirportSearchOption = {
      airport: {
        code: code ?? sourceCode,
        name: result.name,
        city: result.city ?? '',
      },
      sourceCode,
      selectable: code !== null,
      isAlias: code !== null && code !== sourceCode,
      locationLabel: [result.city, result.state, result.country]
        .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
        .join(' · '),
    };
    const key = code ? `supported:${code}` : `unsupported:${sourceCode}`;
    const existing = optionsByKey.get(key);
    // Prefer an exact production code if both it and an alias identify the
    // same saved airport, while retaining production-provided airport details.
    if (!existing || (existing.isAlias && !option.isAlias)) {
      optionsByKey.set(key, option);
    }
  }
  return [...optionsByKey.values()];
}

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