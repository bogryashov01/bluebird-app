import { Router } from "express";
import { db } from "@workspace/db";
import { flightsTable, queueEntriesTable, tripsTable } from "@workspace/db/schema";
import { eq, ilike, and, inArray, count, desc, sql } from "drizzle-orm";
import { authMiddleware } from "../middlewares/auth";

const router = Router();

// flights.seatsAvailable in the DB is the capacity BASELINE for queue math
// (join/confirm checks subtract confirmed passengers from it). For browsing,
// we present the DERIVED remaining seats — baseline minus confirmed
// passengers — so seats visibly shrink/free as (simulated) members confirm
// or cancel, without ever mutating the flight row.
async function confirmedPaxByFlight(): Promise<Map<string, number>> {
  const rows = await db
    .select({
      flightId: queueEntriesTable.flightId,
      pax: sql<number>`coalesce(sum(${queueEntriesTable.passengers}), 0)`,
    })
    .from(queueEntriesTable)
    .where(eq(queueEntriesTable.status, "confirmed"))
    .groupBy(queueEntriesTable.flightId);
  return new Map(rows.map((r) => [r.flightId, Number(r.pax)]));
}

function withDerivedSeats<T extends { id: string; seatsAvailable: number }>(
  flight: T,
  paxMap: Map<string, number>,
): T {
  const remaining = Math.max(0, flight.seatsAvailable - (paxMap.get(flight.id) ?? 0));
  return { ...flight, seatsAvailable: remaining };
}

// GET /flights (public — members can browse before signing in)
router.get("/", async (req, res) => {
  try {
    const { from, to } = req.query;
    let query = db.select().from(flightsTable).$dynamic();

    const conditions = [];
    if (from) conditions.push(ilike(flightsTable.fromCity, `%${from}%`));
    if (to) conditions.push(ilike(flightsTable.toCity, `%${to}%`));
    if (conditions.length > 0) query = query.where(and(...conditions));

    const [flights, paxMap] = await Promise.all([
      query.orderBy(flightsTable.departureDate),
      confirmedPaxByFlight(),
    ]);
    return res.json(flights.map((f) => withDerivedSeats(f, paxMap)));
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch flights" });
  }
});

// GET /flights/:id (public)
router.get("/:id", async (req, res) => {
  try {
    const [[flight], paxMap] = await Promise.all([
      db.select().from(flightsTable).where(eq(flightsTable.id, String(req.params.id))),
      confirmedPaxByFlight(),
    ]);
    if (!flight) {
      return res.status(404).json({ error: "Flight not found" });
    }
    return res.json(withDerivedSeats(flight, paxMap));
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch flight" });
  }
});

// GET /flights/:id/my-status (authenticated)
// Returns the calling user's relationship to a specific flight:
//   none     — no active entry
//   waiting  — in the queue (includes position + totalInQueue)
//   confirmed — seat confirmed (includes tripId)
router.get("/:id/my-status", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  try {
    const flightId = String(req.params.id);

    // Verify the flight exists
    const [flight] = await db.select().from(flightsTable).where(eq(flightsTable.id, flightId));
    if (!flight) {
      return res.status(404).json({ error: "Flight not found" });
    }

    // Look for an active entry for this user + flight
    const [entry] = await db
      .select()
      .from(queueEntriesTable)
      .where(
        and(
          eq(queueEntriesTable.userId, userId),
          eq(queueEntriesTable.flightId, flightId),
          inArray(queueEntriesTable.status, ["waiting", "confirmed"]),
        ),
      );

    if (!entry) {
      return res.json({ status: "none" });
    }

    if (entry.status === "waiting") {
      // Count how many are waiting for this flight to surface totalInQueue
      const [{ value: totalInQueue }] = await db
        .select({ value: count() })
        .from(queueEntriesTable)
        .where(and(eq(queueEntriesTable.flightId, flightId), eq(queueEntriesTable.status, "waiting")));

      // canConfirm: true when this entry is first in line AND the flight still
      // has enough unconfirmed seats for the entry's party.
      let canConfirm = false;
      if (entry.position === 1) {
        const [{ value: confirmedPax }] = await db
          .select({ value: sql<number>`coalesce(sum(${queueEntriesTable.passengers}), 0)` })
          .from(queueEntriesTable)
          .where(
            and(
              eq(queueEntriesTable.flightId, flightId),
              eq(queueEntriesTable.status, "confirmed"),
            ),
          );
        const windowExpired =
          !!entry.frontNotifiedAt &&
          Date.now() - new Date(entry.frontNotifiedAt).getTime() > 30 * 60 * 1000;
        canConfirm =
          !windowExpired && entry.passengers <= (flight.seatsAvailable - Number(confirmedPax));
      }

      return res.json({
        status: "waiting",
        queueEntryId: entry.id,
        queuePosition: entry.position,
        totalInQueue: Number(totalInQueue),
        canConfirm,
      });
    }

    // confirmed — find the most recently created trip for this user+flight
    // (order by bookedAt DESC so the real confirmation trip wins over any seeded demo trips)
    const [trip] = await db
      .select()
      .from(tripsTable)
      .where(and(eq(tripsTable.userId, userId), eq(tripsTable.flightId, flightId)))
      .orderBy(desc(tripsTable.bookedAt))
      .limit(1);

    return res.json({
      status: "confirmed",
      queueEntryId: entry.id,
      tripId: trip?.id ?? null,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch flight status" });
  }
});

export default router;
