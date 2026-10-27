export function getGreetingForHour(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  if (hour >= 17 && hour < 21) return 'Good evening';
  return 'Good night';
}

export type DiscoverFlightFilter = 'all' | 'week' | 'short';

export interface DiscoverFilterableFlight {
  fromAirport: string | null;
  toAirport: string | null;
  fromCity: string | null;
  toCity: string | null;
  aircraftType: string | null;
  departureDate: string | null;
  duration: string | null;
}

export function validDepartureDate(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}

export function durationInMinutes(value: string | null): number | null {
  if (!value) return null;
  const match = value.trim().match(/^(?:(\d+(?:\.\d+)?)\s*h)?(?:\s*(\d+)\s*m)?$/i);
  if (!match || (!match[1] && !match[2])) return null;
  return Math.round(Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0));
}

/** Monday-through-Sunday calendar week containing `now`, in `now`'s local timezone. */
export function isDepartureInCalendarWeek(date: Date, now: Date): boolean {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - weekday);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return date >= start && date < end;
}

export function discoverFlightMatchesQuery(
  flight: DiscoverFilterableFlight,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [flight.fromAirport, flight.toAirport, flight.fromCity, flight.toCity, flight.aircraftType]
    .some((value) => (value ?? '').toLowerCase().includes(q));
}

export function discoverFlightMatchesFilter(
  flight: DiscoverFilterableFlight,
  filter: DiscoverFlightFilter,
  now: Date,
): boolean {
  if (filter === 'week') {
    const date = validDepartureDate(flight.departureDate);
    return !!date && isDepartureInCalendarWeek(date, now);
  }
  if (filter === 'short') {
    const minutes = durationInMinutes(flight.duration);
    return minutes !== null && minutes < 240;
  }
  return true;
}

export function discoverResultCountLabel(input: {
  count: number;
  filter: DiscoverFlightFilter;
  hasQuery: boolean;
  productionReadOnly: boolean;
}): string {
  const { count, filter, hasQuery, productionReadOnly } = input;
  if (!hasQuery && filter === 'all') {
    if (count > 0) {
      return productionReadOnly
        ? `${count} available flight${count === 1 ? '' : 's'}`
        : `${count} empty legs available`;
    }
    return productionReadOnly ? 'Browse available flights' : 'Browse available empty legs';
  }
  if (hasQuery) {
    return count === 0
      ? 'No matching flights'
      : `${count} matching flight${count === 1 ? '' : 's'}`;
  }
  if (filter === 'week') {
    return count === 0
      ? 'No flights this week'
      : `${count} flight${count === 1 ? '' : 's'} this week`;
  }
  return count === 0
    ? 'No flights under 4 hrs'
    : `${count} flight${count === 1 ? '' : 's'} under 4 hrs`;
}

export function filterDiscoverFlights<T extends DiscoverFilterableFlight>(
  flights: readonly T[],
  options: { query: string; filter: DiscoverFlightFilter; now: Date },
): T[] {
  return flights.filter((flight) =>
    discoverFlightMatchesQuery(flight, options.query) &&
    discoverFlightMatchesFilter(flight, options.filter, options.now),
  );
}

export function reconcileFeaturedFlightId(
  eligibleFlightIds: readonly string[],
  selectedId: string | null,
  random: () => number = Math.random,
): string | null {
  if (eligibleFlightIds.length === 0) return null;
  if (selectedId && eligibleFlightIds.includes(selectedId)) return selectedId;

  const candidate = random();
  const index = Math.min(
    eligibleFlightIds.length - 1,
    Math.max(0, Math.floor(candidate * eligibleFlightIds.length)),
  );
  return eligibleFlightIds[index] ?? null;
}
