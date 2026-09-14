import { db } from "@workspace/db";
import {
  flightsTable,
  tripsTable,
  queueEntriesTable,
  notificationsTable,
} from "@workspace/db/schema";
import { and, eq, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { logger } from "./logger";
import { isSimUserId } from "./simulation";

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

/**
 * Single source of truth for "has this flight's departure passed?".
 * Compares departureDate + departureTime (both stored as UTC-naive strings)
 * against the current UTC date/time — the exact comparison used by the
 * trip-cancellation guard, so the two can never disagree.
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

/** SQL predicate mirroring departurePassed() for set-based sweeps. */
function departurePassedSql(now: Date): SQL {
  const today = now.toISOString().slice(0, 10);
  const hhmm = now.toISOString().slice(11, 16);
  return or(
    lt(flightsTable.departureDate, today),
    and(
      eq(flightsTable.departureDate, today),
      sql`${flightsTable.departureTime} <= ${hhmm}`,
    ),
  )!;
}

/**
 * Queue-action guard: true when a flight can still accept queue transitions
 * (joins, pass use, promotions, simulated advancement). A flight that is not
 * 'available' or whose departure has passed must never gain new
 * confirmations or trips.
 */
export function flightAcceptsQueueActions(
  flight: { status: string; departureDate: string; departureTime: string },
  now: Date = new Date(),
): boolean {
  return flight.status === "available" && !departurePassed(flight, now);
}

/**
 * Transitions past-departure flights to 'completed', their upcoming trips to
 * 'completed', and expires any still-waiting queue entries on them so active
 * queue state can never contradict a completed flight. Idempotent and cheap
 * (three set-based UPDATEs), so it is safe to run lazily on reads and on the
 * periodic simulation tick.
 *
 * Never touches cancelled flights, cancelled trips, or confirmed queue
 * entries (those remain as the historical record backing completed trips).
 * Waiting entries never hold a consumed Skip-the-Line pass (pass joins and
 * pass use confirm atomically), so expiring them forfeits nothing.
 */
export async function completeDepartedFlights(): Promise<void> {
  const now = new Date();
  const passed = departurePassedSql(now);

  const completedFlights = await db
    .update(flightsTable)
    .set({ status: "completed" })
    .where(
      and(
        inArray(flightsTable.status, ["available", "boarding", "departed"]),
        passed,
      ),
    )
    .returning({ id: flightsTable.id });

  // Complete upcoming trips on ANY completed, past-departure flight — this
  // also catches trips left 'upcoming' on flights completed earlier.
  const completedTrips = await db
    .update(tripsTable)
    .set({ status: "completed" })
    .where(
      and(
        eq(tripsTable.status, "upcoming"),
        inArray(
          tripsTable.flightId,
          db
            .select({ id: flightsTable.id })
            .from(flightsTable)
            .where(and(eq(flightsTable.status, "completed"), passed)),
        ),
      ),
    )
    .returning({
      id: tripsTable.id,
      userId: tripsTable.userId,
      flightId: tripsTable.flightId,
    });

  // Tell each real member their flight has landed and moved to Past. The
  // trips UPDATE above only ever flips a trip 'upcoming' → 'completed' once,
  // so notifying exactly the returned rows is naturally idempotent — repeated
  // sweeps can never duplicate the notification. Simulated members are
  // skipped.
  const tripsToNotify = completedTrips.filter((t) => !isSimUserId(t.userId));
  if (tripsToNotify.length > 0) {
    const flightIds = [...new Set(tripsToNotify.map((t) => t.flightId))];
    const flights = await db
      .select({
        id: flightsTable.id,
        fromCity: flightsTable.fromCity,
        toCity: flightsTable.toCity,
      })
      .from(flightsTable)
      .where(inArray(flightsTable.id, flightIds));
    const flightById = new Map(flights.map((f) => [f.id, f]));

    await db.insert(notificationsTable).values(
      tripsToNotify.map((trip) => {
        const flight = flightById.get(trip.flightId);
        const route = flight ? `${flight.fromCity} → ${flight.toCity}` : "your flight";
        return {
          id: makeId(),
          userId: trip.userId,
          title: "Hope you enjoyed your flight ✈️",
          body: `Your trip on ${route} is complete and now lives in your Past trips. Ready for the next one? Browse flights on Discover.`,
          type: "flight_completed",
        };
      }),
    );
  }

  // Expire waiting queue entries on completed past-departure flights — the
  // queue no longer exists once the plane has left.
  const expiredEntries = await db
    .update(queueEntriesTable)
    .set({ status: "expired" })
    .where(
      and(
        eq(queueEntriesTable.status, "waiting"),
        inArray(
          queueEntriesTable.flightId,
          db
            .select({ id: flightsTable.id })
            .from(flightsTable)
            .where(and(eq(flightsTable.status, "completed"), passed)),
        ),
      ),
    )
    .returning({ id: queueEntriesTable.id });

  if (completedFlights.length > 0 || completedTrips.length > 0 || expiredEntries.length > 0) {
    logger.info(
      {
        flights: completedFlights.length,
        trips: completedTrips.length,
        expiredQueueEntries: expiredEntries.length,
      },
      "Departure sweep: moved past-departure flights/trips to completed",
    );
  }
}

/**
 * Read-path wrapper: runs the sweep but never fails the caller's request —
 * a sweep error is logged and the read proceeds with current data.
 */
export async function sweepDeparturesSafe(): Promise<void> {
  try {
    await completeDepartedFlights();
  } catch (err) {
    logger.error({ err }, "Departure sweep failed");
  }
}
