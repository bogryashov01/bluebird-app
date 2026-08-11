import { Router } from "express";
import { db, pool } from "@workspace/db";
import { queueEntriesTable, flightsTable, usersTable, notificationsTable, tripsTable } from "@workspace/db/schema";
import { eq, and, count, sql, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db/schema";
import { authMiddleware, requireVerifiedEmail } from "../middlewares/auth";

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
router.post("/join", authMiddleware, requireVerifiedEmail, async (req, res) => {
  const userId = (req as any).userId;

  const { flightId, useLinePass, passengers: passengersRaw, acceptIntlFee } = req.body;
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

    // 1a. International-fee enforcement — Base members must explicitly accept
    //     the fee to join an international flight (Plus/Concierge waive it).
    const [member] = await txDb
      .select({ membershipTier: usersTable.membershipTier })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    const feeApplies =
      flight.international && flight.internationalFeeUsd > 0 && member?.membershipTier === "base";
    if (feeApplies && !acceptIntlFee) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: `This international flight has a $${flight.internationalFeeUsd.toLocaleString()} fee for Base members — you must accept it to join (or upgrade to Plus to waive it).`,
      });
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

    // 2. Guard against duplicate entry — blocks both waiting AND confirmed entries
    //    so a confirmed user cannot re-join the same flight.
    const [existing] = await txDb
      .select({ status: queueEntriesTable.status })
      .from(queueEntriesTable)
      .where(
        and(
          eq(queueEntriesTable.flightId, String(flightId)),
          eq(queueEntriesTable.userId, userId),
          inArray(queueEntriesTable.status, ["waiting", "confirmed"]),
        ),
      );
    if (existing) {
      await client.query("ROLLBACK");
      const msg =
        existing.status === "confirmed"
          ? "You are already confirmed for this flight"
          : "You are already in the queue for this flight";
      return res.status(409).json({ error: msg });
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
      // Note: no position shift needed — a pass join confirms immediately
      // below (atomically, in this same transaction), so the entry never
      // occupies a waiting-queue slot. If any later step fails, the whole
      // transaction rolls back and the pass balance is untouched.
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

    // 5. Insert the new entry. A Skip-the-Line join is an atomic instant win:
    //    pass consumption, entry creation as CONFIRMED, and trip creation all
    //    commit together — the pass can never be lost without a confirmed seat
    //    (seat capacity was already enforced in step 1b within this snapshot).
    const [entry] = await txDb
      .insert(queueEntriesTable)
      .values({
        id: makeId(),
        userId,
        flightId: String(flightId),
        position,
        status: useLinePass ? "confirmed" : "waiting",
        passengers,
        usedLinePass: !!useLinePass,
        intlFeeAccepted: feeApplies && !!acceptIntlFee,
      })
      .returning();

    let trip: any = null;
    if (useLinePass) {
      [trip] = await txDb
        .insert(tripsTable)
        .values({ id: makeId(), userId, flightId: String(flightId), status: "upcoming" })
        .returning();
    }

    // 6. Notify the member
    await txDb.insert(notificationsTable).values({
      id: makeId(),
      userId,
      title: useLinePass ? "Flight confirmed!" : "Added to queue",
      body: useLinePass
        ? `Skip the Line pass used — your seat on ${flight.fromCity} → ${flight.toCity} is confirmed.`
        : `You're #${position} in the queue for ${flight.fromCity} → ${flight.toCity}`,
      type: useLinePass ? "flight_confirmed" : "queue_update",
    });

    // 6b. Demo charge note for an accepted international fee (never billed)
    if (feeApplies && acceptIntlFee) {
      await txDb.insert(notificationsTable).values({
        id: makeId(),
        userId,
        title: "International fee accepted",
        body: `A one-time $${flight.internationalFeeUsd.toLocaleString()} international fee applies to ${flight.fromCity} → ${flight.toCity} (demo — no real charge).`,
        type: "queue_update",
      });
    }

    // 7. Actual post-insert waiting count (unambiguous — counted after the
    //    new entry exists, inside the same transaction snapshot).
    const [{ value: totalAfterInsert }] = await txDb
      .select({ value: count() })
      .from(queueEntriesTable)
      .where(
        and(
          eq(queueEntriesTable.flightId, String(flightId)),
          eq(queueEntriesTable.status, "waiting"),
        ),
      );

    await client.query("COMMIT");

    return res.status(201).json({ ...entry, flight, totalInQueue: Number(totalAfterInsert), trip });
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
// Returns all active (waiting + confirmed) entries for the authenticated user.
// Terminal states (cancelled, expired) are excluded.
// Each waiting entry includes canConfirm (position===1 AND seats available).
router.get("/status", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;

  try {
    const entries = await db
      .select()
      .from(queueEntriesTable)
      .where(
        and(
          eq(queueEntriesTable.userId, userId),
          inArray(queueEntriesTable.status, ["waiting", "confirmed"]),
        ),
      );

    const enriched = await Promise.all(
      entries.map(async (entry) => {
        const [flight] = await db.select().from(flightsTable).where(eq(flightsTable.id, entry.flightId));
        const [{ value: totalInQueue }] = await db
          .select({ value: count() })
          .from(queueEntriesTable)
          .where(and(eq(queueEntriesTable.flightId, entry.flightId), eq(queueEntriesTable.status, "waiting")));

        // Compute canConfirm for waiting entries at position 1
        let canConfirm = false;
        if (entry.status === "waiting" && entry.position === 1 && flight) {
          const [{ value: confirmedPax }] = await db
            .select({ value: sql<number>`coalesce(sum(${queueEntriesTable.passengers}), 0)` })
            .from(queueEntriesTable)
            .where(
              and(
                eq(queueEntriesTable.flightId, entry.flightId),
                eq(queueEntriesTable.status, "confirmed"),
              ),
            );
          const windowExpired =
            !!entry.frontNotifiedAt &&
            Date.now() - new Date(entry.frontNotifiedAt).getTime() > 30 * 60 * 1000;
          canConfirm =
            !windowExpired && entry.passengers <= (flight.seatsAvailable - Number(confirmedPax));
        }

        return { ...entry, flight, totalInQueue: Number(totalInQueue), canConfirm };
      })
    );

    return res.json(enriched);
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch queue status" });
  }
});

// DELETE /queue/:id (cancel)
//
// Cancels a WAITING entry and atomically renumbers every remaining waiting
// entry for the same flight so positions stay contiguous.
//
// Uses SERIALIZABLE isolation — the same level as /join — so that concurrent
// transitions on different entries of the same flight (e.g. confirm #1 and
// cancel #2 racing) cannot interleave their renumber steps and produce gaps or
// duplicate positions.  Under SERIALIZABLE, Postgres detects the conflicting
// read-write dependency on the flight's position set and aborts one transaction
// with error 40001, which we surface as 409 so the caller can retry.
//
// Confirmed entries are intentionally blocked (UI only offers Leave Queue
// while status==='waiting').
router.delete("/:id", authMiddleware, requireVerifiedEmail, async (req, res) => {
  const userId = (req as any).userId;

  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const txDb = drizzle(client, { schema });

    // Atomic test-and-set: only cancels when the entry is owned by this user
    // AND is currently in 'waiting' status. Returns the full row so we can
    // use its position and flightId for the gap-close renumber below.
    const cancelled = await txDb
      .update(queueEntriesTable)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(queueEntriesTable.id, String(req.params.id)),
          eq(queueEntriesTable.userId, userId),
          eq(queueEntriesTable.status, "waiting"),
        ),
      )
      .returning();

    if (cancelled.length === 0) {
      // Distinguish 404 (not found / not owned) from already-terminal status.
      const [existing] = await txDb
        .select({ status: queueEntriesTable.status })
        .from(queueEntriesTable)
        .where(
          and(
            eq(queueEntriesTable.id, String(req.params.id)),
            eq(queueEntriesTable.userId, userId),
          ),
        );

      await client.query("ROLLBACK");
      if (!existing) {
        return res.status(404).json({ error: "Queue entry not found" });
      }
      if (existing.status === "confirmed") {
        return res.status(409).json({
          error: "Confirmed bookings cannot be cancelled here. Please contact support.",
        });
      }
      // Already cancelled or another terminal state — treat as success (idempotent).
      return res.json({ success: true });
    }

    const entry = cancelled[0];

    // Close the gap: decrement position of every remaining waiting entry that
    // ranked behind the one we just removed, keeping positions contiguous.
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
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    // Drizzle wraps pg DatabaseErrors: walk the cause chain to find 40001.
    const pgCode = err?.code ?? err?.cause?.code;
    if (pgCode === "40001") {
      return res.status(409).json({ error: "Queue update conflict — please try again" });
    }
    return res.status(500).json({ error: "Failed to cancel queue entry" });
  } finally {
    client.release();
  }
});

// POST /queue/:id/confirm
//
// Confirms the member's seat when they are at the front of the queue: checks
// the 30-minute acceptance window and seat capacity, marks the entry
// confirmed, renumbers the remaining waiting entries, and creates the trip.
// Runs under SERIALIZABLE isolation so concurrent queue transitions on the
// same flight cannot corrupt positions.
router.post("/:id/confirm", authMiddleware, requireVerifiedEmail, async (req, res) => {
  const userId = (req as any).userId;

  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const txDb = drizzle(client, { schema });

    // ── Step 1: Read entry to verify ownership and current state ────────────
    const [entryToCheck] = await txDb
      .select()
      .from(queueEntriesTable)
      .where(
        and(
          eq(queueEntriesTable.id, String(req.params.id)),
          eq(queueEntriesTable.userId, userId),
        ),
      );

    if (!entryToCheck) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Queue entry not found" });
    }

    if (entryToCheck.status !== "waiting") {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error:
          entryToCheck.status === "confirmed"
            ? "This entry is already confirmed"
            : "Only waiting entries can be confirmed",
      });
    }

    // ── Step 2: Front-of-queue eligibility ──────────────────────────────────
    if (entryToCheck.position !== 1) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        error: `Not yet your turn — you're #${entryToCheck.position} in the queue`,
      });
    }

    // ── Step 2b: 30-minute acceptance window (policy, enforced server-side) ─
    // The window starts when the member is notified their seat is ready
    // (frontNotifiedAt, set by the queue engine). If it has lapsed, expire the
    // entry right here — the server is authoritative, independent of the
    // periodic engine tick. If the member confirms before being notified
    // (e.g. they joined an empty queue at #1), the window starts now: an
    // immediate confirm is by definition within it.
    const CONFIRM_WINDOW_MS = 30 * 60 * 1000;
    if (
      entryToCheck.frontNotifiedAt &&
      Date.now() - new Date(entryToCheck.frontNotifiedAt).getTime() > CONFIRM_WINDOW_MS
    ) {
      const [expired] = await txDb
        .update(queueEntriesTable)
        .set({ status: "expired" })
        .where(
          and(
            eq(queueEntriesTable.id, String(req.params.id)),
            eq(queueEntriesTable.status, "waiting"),
          ),
        )
        .returning();
      if (expired) {
        // Close the gap so the next member moves up.
        await txDb
          .update(queueEntriesTable)
          .set({ position: sql`${queueEntriesTable.position} - 1` })
          .where(
            and(
              eq(queueEntriesTable.flightId, expired.flightId),
              eq(queueEntriesTable.status, "waiting"),
              sql`${queueEntriesTable.position} > ${expired.position}`,
            ),
          );
        await txDb.insert(notificationsTable).values({
          id: makeId(),
          userId,
          title: "Acceptance window expired",
          body: "Your 30-minute window to confirm passed, so your spot went to the next member in line.",
          type: "queue_update",
        });
      }
      await client.query("COMMIT");
      return res.status(410).json({
        error: "Your 30-minute acceptance window has expired — your spot went to the next member in line.",
      });
    }
    if (!entryToCheck.frontNotifiedAt) {
      await txDb
        .update(queueEntriesTable)
        .set({ frontNotifiedAt: new Date() })
        .where(eq(queueEntriesTable.id, String(req.params.id)));
    }

    // ── Step 3: Seat capacity check ─────────────────────────────────────────
    // Fetch flight (reused for notification + response below).
    const [flight] = await txDb
      .select()
      .from(flightsTable)
      .where(eq(flightsTable.id, entryToCheck.flightId));

    const [{ value: confirmedPax }] = await txDb
      .select({ value: sql<number>`coalesce(sum(${queueEntriesTable.passengers}), 0)` })
      .from(queueEntriesTable)
      .where(
        and(
          eq(queueEntriesTable.flightId, entryToCheck.flightId),
          eq(queueEntriesTable.status, "confirmed"),
        ),
      );

    const seatsAvailable = flight?.seatsAvailable ?? 0;
    if (entryToCheck.passengers > seatsAvailable - Number(confirmedPax)) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        error: "Not enough seats available for your party size",
      });
    }

    // ── Step 4: Atomic test-and-set (concurrent safety net) ─────────────────
    // Even though we checked status above, a concurrent request could have
    // changed this row between the SELECT and this UPDATE.  SERIALIZABLE will
    // detect the conflict and abort one transaction; the conditional WHERE
    // gives a clear 0-rows path for any other race.
    const updated = await txDb
      .update(queueEntriesTable)
      .set({ status: "confirmed" })
      .where(
        and(
          eq(queueEntriesTable.id, entryToCheck.id),
          eq(queueEntriesTable.status, "waiting"),
        ),
      )
      .returning();

    if (updated.length === 0) {
      // A concurrent transition already changed this entry's state.
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Queue update conflict — please try again" });
    }

    const entry = updated[0];

    // ── Step 5: Close the gap — renumber remaining waiting entries ───────────
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

    // ── Step 6: Create the upcoming trip ────────────────────────────────────
    const tripId = makeId();
    const [trip] = await txDb
      .insert(tripsTable)
      .values({
        id: tripId,
        userId,
        flightId: entry.flightId,
        status: "upcoming",
      })
      .returning();

    // ── Step 7: Notify the member ────────────────────────────────────────────
    if (flight) {
      await txDb.insert(notificationsTable).values({
        id: makeId(),
        userId,
        title: "Flight confirmed!",
        body: `Your seat on ${flight.fromCity} → ${flight.toCity} is confirmed.`,
        type: "flight_confirmed",
      });
    }

    await client.query("COMMIT");

    return res.json({ ...trip, flight: flight ?? null });
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    // Drizzle wraps pg DatabaseErrors: the original PostgreSQL error code lives at
    // err.cause.code (not err.code).  Walk the cause chain to find 40001.
    const pgCode = err?.code ?? err?.cause?.code;
    if (pgCode === "40001") {
      return res.status(409).json({ error: "Queue update conflict — please try again" });
    }
    return res.status(500).json({ error: "Failed to confirm queue entry" });
  } finally {
    client.release();
  }
});

// POST /queue/:id/use-pass
//
// Applies a Skip the Line pass to an EXISTING waiting entry: consumes one
// line pass, moves the entry to position 1, and shifts the entries that were
// ahead of it down by one. Mirrors the join-with-pass logic above and runs
// under the same SERIALIZABLE isolation so concurrent queue transitions on
// the same flight cannot corrupt positions.
router.post("/:id/use-pass", authMiddleware, requireVerifiedEmail, async (req, res) => {
  const userId = (req as any).userId;

  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const txDb = drizzle(client, { schema });

    // 1. Verify ownership and state
    const [entry] = await txDb
      .select()
      .from(queueEntriesTable)
      .where(
        and(
          eq(queueEntriesTable.id, String(req.params.id)),
          eq(queueEntriesTable.userId, userId),
        ),
      );

    if (!entry) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Queue entry not found" });
    }
    if (entry.status !== "waiting") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Only waiting entries can use a Skip the Line pass" });
    }
    if (entry.position === 1) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "You are already first in line" });
    }

    // 2. Seat capacity check FIRST — the pass must never be consumed unless
    //    the seat can actually be confirmed in this same transaction.
    const [flight] = await txDb
      .select()
      .from(flightsTable)
      .where(eq(flightsTable.id, entry.flightId));
    const [{ value: confirmedPax }] = await txDb
      .select({ value: sql<number>`coalesce(sum(${queueEntriesTable.passengers}), 0)` })
      .from(queueEntriesTable)
      .where(
        and(
          eq(queueEntriesTable.flightId, entry.flightId),
          eq(queueEntriesTable.status, "confirmed"),
        ),
      );
    if (entry.passengers > (flight?.seatsAvailable ?? 0) - Number(confirmedPax)) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        error: "Not enough seats available for your party size — your pass was not used",
      });
    }

    // 3. Consume a line pass (conditional update — fails if balance is 0)
    const passResult = await txDb
      .update(usersTable)
      .set({ linePassCount: sql`${usersTable.linePassCount} - 1` })
      .where(and(eq(usersTable.id, userId), sql`${usersTable.linePassCount} > 0`))
      .returning({ linePassCount: usersTable.linePassCount });
    if (passResult.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "You do not have any Skip the Line passes" });
    }
    const linePassCount = passResult[0].linePassCount;

    // 4. Instant win — confirm this entry atomically (conditional on
    //    still-waiting as a concurrent safety net; SERIALIZABLE aborts true
    //    conflicts with 40001). If this or any later step fails, the whole
    //    transaction rolls back and the pass is refunded implicitly.
    const updated = await txDb
      .update(queueEntriesTable)
      .set({ status: "confirmed", usedLinePass: true })
      .where(
        and(
          eq(queueEntriesTable.id, entry.id),
          eq(queueEntriesTable.status, "waiting"),
        ),
      )
      .returning();
    if (updated.length === 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Queue update conflict — please try again" });
    }

    // 5. Close the gap for members who were behind this entry
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

    // 6. Create the upcoming trip
    const [trip] = await txDb
      .insert(tripsTable)
      .values({ id: makeId(), userId, flightId: entry.flightId, status: "upcoming" })
      .returning();

    // 7. Notify the member
    await txDb.insert(notificationsTable).values({
      id: makeId(),
      userId,
      title: "Flight confirmed!",
      body: flight
        ? `Skip the Line pass used — your seat on ${flight.fromCity} → ${flight.toCity} is confirmed.`
        : "Skip the Line pass used — your seat is confirmed.",
      type: "flight_confirmed",
    });

    await client.query("COMMIT");

    const [{ value: totalInQueue }] = await db
      .select({ value: count() })
      .from(queueEntriesTable)
      .where(and(eq(queueEntriesTable.flightId, entry.flightId), eq(queueEntriesTable.status, "waiting")));

    return res.json({
      ...updated[0],
      flight: flight ?? null,
      totalInQueue: Number(totalInQueue),
      linePassCount,
      trip,
    });
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    const pgCode = err?.code ?? err?.cause?.code;
    if (pgCode === "40001") {
      return res.status(409).json({ error: "Queue update conflict — please try again" });
    }
    return res.status(500).json({ error: "Failed to use Skip the Line pass" });
  } finally {
    client.release();
  }
});

export default router;
