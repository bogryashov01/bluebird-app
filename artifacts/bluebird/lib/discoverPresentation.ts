export function getGreetingForHour(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  if (hour >= 17 && hour < 21) return 'Good evening';
  return 'Good night';
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
