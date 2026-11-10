import { flightAcceptsQueueActions } from "./flightQueueGuards";

/**
 * Existing Skip the Line rules for the local/demo queue API.
 *
 * Redeeming a pass confirms the caller's waiting entry immediately (instant
 * win), consumes exactly one personal or family pass in the same transaction,
 * and renumbers waiting members behind that entry. It does not invent a new
 * ranking algorithm — confirmed seats leave the waiting queue; remaining
 * waiters keep relative order with positions closed up.
 */

export const SKIP_PASS_FLIGHT_CLOSED =
  "This flight is no longer available for Skip the Line. Your pass was not used.";

export const SKIP_PASS_FLIGHT_MISSING =
  "This flight could not be found for Skip the Line. Your pass was not used.";

export const SKIP_PASS_ENTRY_INACTIVE =
  "This queue entry is no longer active, so a Skip the Line pass can't be used on it. Your pass was not used.";

export const SKIP_PASS_INSUFFICIENT =
  "You do not have any Skip the Line passes";

export type SkipPassFlight = {
  status: string;
  departureDate: string;
  departureTime: string;
};

/** Reject closed, departed, or missing flights before any pass is consumed. */
export function skipPassFlightRejection(
  flight: SkipPassFlight | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!flight) return SKIP_PASS_FLIGHT_MISSING;
  if (!flightAcceptsQueueActions(flight, now)) return SKIP_PASS_FLIGHT_CLOSED;
  return null;
}

/**
 * Waiting entries behind a redeemed position close the gap by one.
 * Confirmed / non-waiting rows are unchanged. Relative order is preserved.
 */
export function renumberWaitingPositionsAfterSkip(input: {
  redeemedPosition: number;
  waitingPositions: readonly number[];
}): number[] {
  const redeemed = input.redeemedPosition;
  if (!Number.isSafeInteger(redeemed) || redeemed < 1) return [...input.waitingPositions];
  return input.waitingPositions.map((position) =>
    Number.isSafeInteger(position) && position > redeemed ? position - 1 : position,
  );
}

/**
 * Canonical waiting-queue order for winner selection / display: ascending
 * position among still-waiting members. Skip confirmation removes the
 * redeemer from this list; the next lowest position becomes front.
 */
export function canonicalWaitingRankOrder(
  waiting: readonly { id: string; position: number }[],
): { id: string; position: number }[] {
  return [...waiting]
    .filter((row) => Number.isSafeInteger(row.position) && row.position >= 1)
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
}

/** True when a second redemption must not spend another pass. */
export function skipPassAlreadySettled(status: string | null | undefined): boolean {
  return status === "confirmed";
}
