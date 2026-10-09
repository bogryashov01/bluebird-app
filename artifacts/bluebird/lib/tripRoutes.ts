/**
 * Trip IDs are opaque strings from the member-trip API. Do not parse them as
 * flight IDs: production empty-leg IDs are a separate, numeric identifier.
 */
export function parseTripRouteId(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 128 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    return null;
  }
  return value;
}
