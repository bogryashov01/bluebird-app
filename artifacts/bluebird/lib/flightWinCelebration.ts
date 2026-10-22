const pendingFlightWins = new Set<string>();

export function markFlightWinCelebration(flightId?: string | number | null): void {
  if (flightId === undefined || flightId === null || String(flightId).length === 0) return;
  pendingFlightWins.add(String(flightId));
}

export function consumeFlightWinCelebration(flightId?: string | number | null): boolean {
  if (flightId === undefined || flightId === null || String(flightId).length === 0) return false;
  const key = String(flightId);
  const shouldCelebrate = pendingFlightWins.has(key);
  pendingFlightWins.delete(key);
  return shouldCelebrate;
}
