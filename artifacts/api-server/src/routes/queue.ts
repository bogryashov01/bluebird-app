import { Router } from "express";
import { db, pool } from "@workspace/db";
import { queueEntriesTable, flightsTable, usersTable, notificationsTable } from "@workspace/db/schema";
import { eq, and, count, sql, sum, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db/schema";
import { authMiddleware } from "../middlewares/auth";

const router = Router();

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

// POST /queue/join
//
// Runs the entire eligibility + position + insert flow inside a SERIALIZABLE
// transaction.  SERIALIZABLE prevents two concurrent joins from reading the
// same queue count and inserting duplicate positions.  If two transactions
// conflict Postgres will abort one with a serialization error, which the
// client can safely retry.
router.post("/join", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  const { flightId, useLinePass, passengers: passengersRaw } = req.body;
  const passengers = Math.max(1, Math.min(10, parseInt(passengersRaw ?? "1", 10) || 1));

  if (!flightId) {
    return res.status(400).json({ error: "Flight ID is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const txDb = drizzle(client, { schema });

    // 1. Verify flight exists and is available
    const [flight] = await txDb
      .select()
      .from(flightsTable)
      .where(eq(flightsTable.id, String(flightId)));
    if (!flight) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Flight not found" });
    }
    if (flight.status !== "available") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Flight is no longer available" });
    }
    // 1b. Aggregate seat capacity enforcement — sum passengers already reserved
    //     by all active (waiting or confirmed) entries for this flight, then
    //     reject when existing + requested would exceed seats_available.
    const [{ value: reservedPassengers }] = await txDb
      .select({ value: sql<number>`coalesce(sum(${queueEntriesTable.passengers}), 0)` })
      .from(queueEntriesTable)
      .where(
        and(
          eq(queueEntriesTable.flightId, String(flightId)),
          inArray(queueEntriesTable.status, ["waiting", "confirmed"]),
        ),
      );
    if (Number(reservedPassengers) + passengers > flight.seatsAvailable) {
      await client.query("ROLLBACK");
      const remaining = flight.seatsAvailable - Number(reservedPassengers);
      return res.status(400).json({
        error: remaining <= 0
          ? "This flight is fully booked"
          : `Only ${remaining} seat${remaining === 1 ? "" : "s"} remaining for this flight`,
      });
    }

    // 2. Guard against duplicate queue entry
    const [existing] = await txDb
      .select()
      .from(queueEntriesTable)
      .where(
        and(
          eq(queueEntriesTable.userId, userId),
          eq(queueEntriesTable.flightId, String(flightId)),
          eq(queueEntriesTable.status, "waiting"),
        ),
      );
    if (existing) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "You are already in the queue for this flight" });
    }

    // 3. Consume a line pass (conditional update — fails if balance is 0)
    if (useLinePass) {
      const result = await txDb
        .update(usersTable)
        .set({ linePassCount: sql`${usersTable.linePassCount} - 1` })
        .where(and(eq(usersTable.id, userId), sql`${usersTable.linePassCount} > 0`))
        .returning({ linePassCount: usersTable.linePassCount });
      if (result.length === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "You do not have any Skip the Line passes" });
      }

      // Shift every existing waiting entry down by one to make room at position 1
      await txDb
        .update(queueEntriesTable)
        .set({ position: sql`${queueEntriesTable.position} + 1` })
        .where(
          and(
            eq(queueEntriesTable.flightId, String(flightId)),
            eq(queueEntriesTable.status, "waiting"),
          ),
        );
    }

    // 4. Derive position after any shift (inside the same serializable snapshot)
    const [{ value: queueCount }] = await txDb
      .select({ value: count() })
      .from(queueEntriesTable)
      .where(
        and(
          eq(queueEntriesTable.flightId, String(flightId)),
          eq(queueEntriesTable.status, "waiting"),
        ),
      );
    const position = useLinePass ? 1 : Number(queueCount) + 1;

    // 5. Insert the new entry
    const [entry] = await txDb
      .insert(queueEntriesTable)
      .values({
        id: makeId(),
        userId,
        flightId: String(flightId),
        position,
        status: "waiting",
        usedLinePass: Boolean(useLinePass),
        passengers,
      })
      .returning();

    // 6. Notify the member
    await txDb.insert(notificationsTable).values({
      id: makeId(),
      userId,
      title: "Added to queue",
      body: `You're #${position} in the queue for ${flight.fromCity} → ${flight.toCity}`,
      type: "queue_update",
    });

    await client.query("COMMIT");

    const totalInQueue = Number(queueCount) + 1;
    return res.status(201).json({ ...entry, flight, totalInQueue });
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    // Postgres serialization failure — client should retry
    if (err?.code === "40001") {
      return res.status(409).json({ error: "Queue update conflict — please try again" });
    }
    return res.status(500).json({ error: "Failed to join queue" });
  } finally {
    client.release();
  }
});

// GET /queue/status
router.get("/status", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  try {
    const entries = await db
      .select()
      .from(queueEntriesTable)
      .where(and(eq(queueEntriesTable.userId, userId), eq(queueEntriesTable.status, "waiting")));

    const enriched = await Promise.all(
      entries.map(async (entry) => {
        const [flight] = await db.select().from(flightsTable).where(eq(flightsTable.id, entry.flightId));
        const [{ value: totalInQueue }] = await db
          .select({ value: count() })
          .from(queueEntriesTable)
          .where(and(eq(queueEntriesTable.flightId, entry.flightId), eq(queueEntriesTable.status, "waiting")));
        return { ...entry, flight, totalInQueue: Number(totalInQueue) };
      })
    );

    return res.json(enriched);
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch queue status" });
  }
});

// DELETE /queue/:id (cancel)
//
// Cancels the entry and atomically renumbers every remaining waiting entry
// for the same flight so positions stay contiguous (no gaps after removal).
router.delete("/:id", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const txDb = drizzle(client, { schema });

    const [entry] = await txDb
      .select()
      .from(queueEntriesTable)
      .where(and(eq(queueEntriesTable.id, String(req.params.id)), eq(queueEntriesTable.userId, userId)));

    if (!entry) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Queue entry not found" });
    }

    // Mark the entry cancelled
    await txDb
      .update(queueEntriesTable)
      .set({ status: "cancelled" })
      .where(eq(queueEntriesTable.id, String(req.params.id)));

    // Close the gap: decrement position of every waiting entry ranked after
    // the one we just removed, keeping positions contiguous.
    await txDb
      .update(queueEntriesTable)
      .set({ position: sql`${queueEntriesTable.position} - 1` })
      .where(
        and(
          eq(queueEntriesTable.flightId, entry.flightId),
          eq(queueEntriesTable.status, "waiting"),
          sql`${queueEntriesTable.position} > ${entry.position}`,
        ),
      );

    await client.query("COMMIT");
    return res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return res.status(500).json({ error: "Failed to cancel queue entry" });
  } finally {
    client.release();
  }
});

export default router;
