import { Router } from "express";
import { db, pool } from "@workspace/db";
import {
  tripsTable,
  flightsTable,
  queueEntriesTable,
  usersTable,
  notificationsTable,
} from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db/schema";
import { authMiddleware } from "../middlewares/auth";

const router = Router();

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

// GET /trips
router.get("/", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  try {
    const trips = await db.select().from(tripsTable).where(eq(tripsTable.userId, userId)).orderBy(tripsTable.bookedAt);
    const enriched = await Promise.all(
      trips.map(async (trip) => {
        const [flight] = await db.select().from(flightsTable).where(eq(flightsTable.id, trip.flightId));
        return { ...trip, flight };
      })
    );
    return res.json(enriched);
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch trips" });
  }
});

// POST /trips/:id/cancel
//
// Cancels the member's own confirmed booking (an upcoming trip). In one
// SERIALIZABLE transaction:
//   - the trip flips upcoming → cancelled (atomic test-and-set — the guard
//     against double-cancel / double-refund across devices),
//   - the linked confirmed queue entry (same user + flight) is cancelled,
//     which frees derived seat capacity automatically (flights.seatsAvailable
//     is a baseline and is never mutated),
//   - if that entry consumed a Skip the Line pass, the pass is returned to
//     the member's balance,
//   - a cancellation notification is created.
// Departed / past flights are blocked; already-cancelled trips are idempotent
// successes with no second refund.
router.post("/:id/cancel", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;

  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const txDb = drizzle(client, { schema });

    // 1. Load the trip — ownership enforced in the WHERE clause.
    const [trip] = await txDb
      .select()
      .from(tripsTable)
      .where(and(eq(tripsTable.id, String(req.params.id)), eq(tripsTable.userId, userId)));
    if (!trip) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Trip not found" });
    }
    if (trip.status === "cancelled") {
      // Idempotent: already cancelled (double-tap or second device). Never
      // refund again — the refund happened in the transaction that flipped
      // the status the first time.
      const [me] = await txDb
        .select({ linePassCount: usersTable.linePassCount })
        .from(usersTable)
        .where(eq(usersTable.id, userId));
      await client.query("ROLLBACK");
      return res.json({ success: true, passRefunded: false, linePassCount: me?.linePassCount ?? 0 });
    }
    if (trip.status === "completed") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "This trip is already completed and can no longer be cancelled." });
    }

    // 2. Block departed / past flights.
    const [flight] = await txDb
      .select()
      .from(flightsTable)
      .where(eq(flightsTable.id, trip.flightId));
    if (flight) {
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const hhmm = now.toISOString().slice(11, 16);
      const departed =
        flight.status === "departed" ||
        flight.status === "completed" ||
        flight.departureDate < today ||
        (flight.departureDate === today && flight.departureTime <= hhmm);
      if (departed) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: "This flight has already departed, so the booking can no longer be cancelled.",
        });
      }
    }

    // 3. Atomic test-and-set on the trip — only one transaction can win this.
    const cancelledTrips = await txDb
      .update(tripsTable)
      .set({ status: "cancelled" })
      .where(and(eq(tripsTable.id, trip.id), eq(tripsTable.status, "upcoming")))
      .returning();
    if (cancelledTrips.length === 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Trip update conflict — please try again" });
    }

    // 4. Cancel the linked confirmed queue entry (if any). Cancelling it is
    //    what frees the seat: remaining capacity is derived everywhere as
    //    seatsAvailable - sum(confirmed passengers).
    const cancelledEntries = await txDb
      .update(queueEntriesTable)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(queueEntriesTable.userId, userId),
          eq(queueEntriesTable.flightId, trip.flightId),
          eq(queueEntriesTable.status, "confirmed"),
        ),
      )
      .returning();

    // 5. Refund the Skip the Line pass if one was spent on this booking.
    //    Tied to the confirmed→cancelled entry flip above, so a second
    //    cancellation attempt can never refund again.
    const passRefunded = cancelledEntries.some((e) => e.usedLinePass);
    let linePassCount: number | null = null;
    if (passRefunded) {
      const [updatedUser] = await txDb
        .update(usersTable)
        .set({ linePassCount: sql`${usersTable.linePassCount} + 1` })
        .where(eq(usersTable.id, userId))
        .returning({ linePassCount: usersTable.linePassCount });
      linePassCount = updatedUser?.linePassCount ?? null;
    } else {
      const [me] = await txDb
        .select({ linePassCount: usersTable.linePassCount })
        .from(usersTable)
        .where(eq(usersTable.id, userId));
      linePassCount = me?.linePassCount ?? null;
    }

    // 6. Notify the member.
    const route = flight ? `${flight.fromCity} → ${flight.toCity}` : "your flight";
    await txDb.insert(notificationsTable).values({
      id: makeId(),
      userId,
      title: "Booking cancelled",
      body: passRefunded
        ? `Your booking on ${route} was cancelled and your Skip the Line pass was returned to your balance.`
        : `Your booking on ${route} was cancelled. Your seat has been released.`,
      type: "system",
    });

    await client.query("COMMIT");
    return res.json({
      success: true,
      passRefunded,
      linePassCount: linePassCount ?? 0,
      trip: { ...cancelledTrips[0], flight: flight ?? null },
    });
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    const pgCode = err?.code ?? err?.cause?.code;
    if (pgCode === "40001") {
      return res.status(409).json({ error: "Trip update conflict — please try again" });
    }
    return res.status(500).json({ error: "Failed to cancel booking" });
  } finally {
    client.release();
  }
});

export default router;
