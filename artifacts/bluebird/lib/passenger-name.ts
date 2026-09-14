export type PassengerNameFields = {
  firstName: string;
  lastName: string;
};

/**
 * Split the account's display name into the existing passenger fields.
 * The first word is the first name and the remaining words are the last name.
 * A single-word name intentionally leaves lastName blank instead of inventing
 * a surname, so the member can provide the required travel-document value.
 */
export function splitDisplayName(displayName: string | null | undefined): PassengerNameFields {
  const words = (displayName ?? '').trim().split(/\s+/).filter(Boolean);
  return {
    firstName: words[0] ?? '',
    lastName: words.slice(1).join(' '),
  };
}

/**
 * Apply the account name only to a new primary passenger draft. Existing
 * primary names, partial edits, and additional travelers are preserved.
 */
export function prefillPrimaryPassenger<T extends PassengerNameFields>(
  passengers: T[],
  displayName: string | null | undefined,
): T[] {
  const primary = passengers[0];
  if (!primary || primary.firstName.trim() || primary.lastName.trim()) return passengers;

  const name = splitDisplayName(displayName);
  if (!name.firstName) return passengers;

  return passengers.map((passenger, index) =>
    index === 0 ? { ...passenger, ...name } : passenger
  );
}