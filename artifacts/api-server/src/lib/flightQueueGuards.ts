/**
 * Pure flight/queue action guards shared by departure sweeps and Skip the Line.
 * Keep this module free of database imports so unit tests can bundle it alone.
 */

/**
 * Single source of truth for "has this flight's departure passed?".
 * Compares departureDate + departureTime (both stored as UTC-naive strings)
 * against the current UTC date/time.
 */
export function departurePassed(
  flight: { departureDate: string; departureTime: string },
  now: Date = new Date(),
): boolean {
  const today = now.toISOString().slice(0, 10);
  const hhmm = now.toISOString().slice(11, 16);
  return (
    flight.departureDate < today ||
    (flight.departureDate === today && flight.departureTime <= hhmm)
  );
}

/**
 * Queue-action guard: true when a flight can still accept queue transitions
 * (joins, pass use, promotions, simulated advancement).
 */
export function flightAcceptsQueueActions(
  flight: { status: string; departureDate: string; departureTime: string },
  now: Date = new Date(),
): boolean {
  return flight.status === "available" && !departurePassed(flight, now);
}
