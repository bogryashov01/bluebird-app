import { ISO_3166_COUNTRIES } from './iso3166Countries';

/**
 * Resolves a country name or ISO 3166-1 code to its alpha-2 identifier.
 * Unrecognized text stays unresolved. Airport codes are not interpreted here.
 */
export function canonicalCountryCode(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const key = countryKey(value);
  if (!key) return null;
  const code = countryIndex().get(key);
  return code ? code : null;
}

function countryKey(value: string): string | null {
  const collapsed = value.trim().replace(/\./g, '').replace(/\s+/g, ' ');
  if (collapsed.length < 2 || collapsed.length > 120) return null;
  if (!/^[\p{L}\p{M}][\p{L}\p{M} '().,-]{1,119}$/u.test(collapsed)) return null;
  return collapsed.toLocaleLowerCase('en-US');
}

let cachedIndex: Map<string, string> | null = null;

function countryIndex(): Map<string, string> {
  if (cachedIndex) return cachedIndex;
  const index = new Map<string, string>();
  const nameToAlpha2 = new Map<string, string>();
  for (const country of ISO_3166_COUNTRIES) {
    register(index, country.alpha2, country.alpha2);
    register(index, country.alpha3, country.alpha2);
    register(index, country.name, country.alpha2);
    if (country.officialName) register(index, country.officialName, country.alpha2);
    const nameKey = countryKey(country.name);
    if (nameKey && !nameToAlpha2.has(nameKey)) nameToAlpha2.set(nameKey, country.alpha2);
  }
  registerDisplayNames(index, nameToAlpha2);
  cachedIndex = index;
  return index;
}

function register(index: Map<string, string>, alias: string, alpha2: string): void {
  const key = countryKey(alias);
  if (!key) return;
  const existing = index.get(key);
  if (existing === undefined) {
    index.set(key, alpha2);
    return;
  }
  if (existing !== alpha2) index.set(key, '');
}

function registerDisplayNames(index: Map<string, string>, nameToAlpha2: ReadonlyMap<string, string>): void {
  const DisplayNames = Intl.DisplayNames;
  if (typeof DisplayNames !== 'function') return;
  let display: Intl.DisplayNames;
  try {
    display = new DisplayNames(['en'], { type: 'region' });
  } catch {
    return;
  }
  for (let first = 65; first <= 90; first += 1) {
    for (let second = 65; second <= 90; second += 1) {
      const code = String.fromCharCode(first, second);
      let name: string | undefined;
      try {
        name = display.of(code);
      } catch {
        continue;
      }
      if (!name) continue;
      const alpha2 = nameToAlpha2.get(countryKey(name) ?? '');
      if (alpha2) register(index, code, alpha2);
    }
  }
}
