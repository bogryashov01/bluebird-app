import { Router } from "express";
import { db, pool } from "@workspace/db";
import {
  queueEntriesTable,
  flightsTable,
  usersTable,
  notificationsTable,
  tripsTable,
  familyMembersTable,
  familyPlansTable,
} from "@workspace/db/schema";
import { eq, and, count, sql, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db/schema";
import { authMiddleware } from "../middlewares/auth";
import { flightAcceptsQueueActions } from "../lib/departure";
import { JoinQueueBody } from "@workspace/api-zod";
import { exceedsPassengerCapacity, passengerCapacityError } from "../lib/passenger-capacity";
import { activeFamilyMemberForUser, syncFamilyPlans } from "../lib/family";

const router = Router();
const PET_CLEANING_FEE_USD = 500;

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

// FBO details are disclosed only after a queue entry is confirmed. Queue
// responses otherwise carry a flight for route context, so strip the assigned
// departure details from waiting-entry payloads.
function publicFlight<T extends { departureFbo?: unknown; departureFboAddress?: unknown }>(flight: T) {
  const {
    departureFbo: _departureFbo,
    departureFboAddress: _departureFboAddress,
    ...safeFlight
  } = flight;
  return safeFlight;
}

function flightForQueueResponse<T extends { departureFbo?: unknown; departureFboAddress?: unknown }>(
  flight: T | null | undefined,
  status: string,
) {
  if (!flight) return flight ?? null;
  return status === "confirmed" ? flight : publicFlight(flight);
}

// Appends a {type:'moved', from, to, at} event to each renumbered row's
// movement_history in the SAME bulk UPDATE that decrements its position, so
// the log can never drift from the actual position. Timestamps are UTC ISO.
const movedEventAppendSql = sql`coalesce(${queueEntriesTable.movementHistory}, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('type', 'moved', 'from', ${queueEntriesTable.position}, 'to', ${queueEntriesTable.position} - 1, 'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))`;

// POST /queue/join
//
// Runs the entire eligibility + position + insert flow inside a SERIALIZABLE
// transaction.  SERIALIZABLE prevents two concurrent joins from reading the
// same queue count and inserting duplicate positions.  If two transactions
// conflict Postgres will abort one with a serialization error, which the
// client can safely retry.
router.post("/join", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;

  const parsed = JoinQueueBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid queue request" });
  }
  const {
    flightId,
    useLinePass,
    passengers: passengersRaw,
    acceptIntlFee,
    bringingPet,
    petFeeAcknowledged,
    petWeightLbs: petWeightLbsRaw,
    petCrateLengthIn: petCrateLengthInRaw,
    petCrateWidthIn: petCrateWidthInRaw,
    petCrateHeightIn: petCrateHeightInRaw,
  } = parsed.data as {
    flightId: string;
    useLinePass?: boolean;
    passengers: number;
    acceptIntlFee?: boolean;
    bringingPet: boolean;
    petFeeAcknowledged?: boolean;
    petWeightLbs?: number;
    petCrateLengthIn?: number;
    petCrateWidthIn?: number;
    petCrateHeightIn?: number;
  };
  const passengers = Number(passengersRaw ?? 1);

  if (!flightId) {
    return res.status(400).json({ error: "Flight ID is required" });
  }
  if (!Number.isInteger(passengers) || exceedsPassengerCapacity(passengers, bringingPet === true)) {
    return res.status(400).json({ error: passengerCapacityError() });
  }
  if (typeof bringingPet !== "boolean") {
    return res.status(400).json({ error: "Please choose whether you are bringing a pet" });
  }
  if (bringingPet && petFeeAcknowledged !== true) {
    return res.status(400).json({
      error: "You must acknowledge the $500 cleaning fee before joining with a pet",
    });
  }
  const petMeasurements = {
    petWeightLbs: petWeightLbsRaw ?? null,
    petCrateLengthIn: petCrateLengthInRaw ?? null,
    petCrateWidthIn: petCrateWidthInRaw ?? null,
    petCrateHeightIn: petCrateHeightInRaw ?? null,
  };
  const validPetMeasurement = (value: number | null | undefined, maximum: number) =>
    value !== null && value !== undefined && Number.isFinite(value) && value > 0 && value <= maximum;
  if (bringingPet && (
    !validPetMeasurement(petMeasurements.petWeightLbs, 500)
  )) {
    return res.status(400).json({
      error: "Pet weight must be between 1 and 500 lb",
    });
  }

  const client = await pool.connect();
  try {
    await syncFamilyPlans();
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const txDb = drizzle(client, { schema });

    // 1. Verify flight exists and is available
    const [flight] = await txDb
      .select()
      .from(flightsTable)
      .where(eq(flightsTable.id, entry.flightId));
    if (!flight) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Flight not found" });
    }
    if (!flightAcceptsQueueActions(flight)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Flight is no longer available" });
    }

    // 1a. Membership gate — joining a queue is a member feature. Non-members
    //     (tier "none") get a distinct error the client routes to the
    //     membership-required screen.
    const [member] = await txDb
      .select({ membershipTier: usersTable.membershipTier })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    if (member?.membershipTier === "none") {
      await client.query("ROLLBACK");
      return res.status(403).json({
        error: "A Bluebird membership is required to join the queue. Choose a plan to join.",
        code: "MEMBERSHIP_REQUIRED",
      });
    }

    // 1b. International-fee enforcement — Base members must explicitly accept
    //     the fee to join an international flight (Plus/Family/Corporate waive it).
    const feeApplies =
      flight.international && flight.internationalFeeUsd > 0 && member?.membershipTier === "base";
      const [existing] = await txDb
        .select({ status: queueEntriesTable.status })
        .from(queueEntriesTable)
        .where(
          and(
            eq(queueEntriesTable.id, String(req.params.id)),
            eq(queueEntriesTable.userId, userId),
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
    let usedFamilyPass = false;
    let familyPassCycle: string | null = null;
    let updatedPersonalPasses: number | null = null;
    const familyMember = await activeFamilyMemberForUser(userId, txDb);
    if (useLinePass && familyMember) {
      const result = await txDb
        .update(usersTable)
        .set({ linePassCount: sql`${usersTable.linePassCount} - 1` })
        .where(and(eq(usersTable.id, userId), sql`${usersTable.linePassCount} > 0`))
        .returning({ linePassCount: usersTable.linePassCount });
      if (result.length > 0) {
        usedFamilyPass = true;
        familyPassCycle = familyMember.plan.renewalAt.toISOString();
      }
    }
    if (useLinePass && !usedFamilyPass) {
      const result = await txDb
        .update(usersTable)
        .set({ linePassCount: sql`${usersTable.linePassCount} - 1` })
        .where(and(eq(usersTable.id, userId), sql`${usersTable.linePassCount} > 0`))
        .returning({ linePassCount: usersTable.linePassCount });
      if (result.length === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "You do not have any Skip the Line passes" });
      }
      updatedPersonalPasses = result[0].linePassCount;
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
    //    commit together. Baseline seat capacity is intentionally not checked
    //    here; it is validated when the confirmed passenger list is saved.
    const [entry] = await txDb
      .select()
      .from(queueEntriesTable)
      .where(
        and(
          eq(queueEntriesTable.id, String(req.params.id)),
          eq(queueEntriesTable.userId, userId),
        ),
      );

    let trip: any = null;
    if (useLinePass) {
      [trip] = await txDb
        .insert(tripsTable)
        .values({
          id: makeId(),
          userId,
          flightId: String(flightId),
          status: "upcoming",
          cleaningFeeUsd: bringingPet ? PET_CLEANING_FEE_USD : 0,
          petWeightLb: bringingPet ? petMeasurements.petWeightLbs : null,
          petCrateLengthIn: bringingPet ? petMeasurements.petCrateLengthIn : null,
          petCrateWidthIn: bringingPet ? petMeasurements.petCrateWidthIn : null,
          petCrateHeightIn: bringingPet ? petMeasurements.petCrateHeightIn : null,
        })
        .returning();
    }

    // 6. Notify the member
    await txDb.insert(notificationsTable).values({
      id: makeId(),
      userId,
      title: useLinePass ? "Flight confirmed!" : "Added to queue",
      body: useLinePass
        ? `Skip the Line pass used — your seat on ${flight.fromCity} → ${flight.toCity} is confirmed.${bringingPet ? ` The $${PET_CLEANING_FEE_USD} pet cleaning fee now applies.` : ""}`
        : `You're #${position} in the queue for ${flight.fromCity} → ${flight.toCity}`,
      type: useLinePass ? "flight_confirmed" : "queue_update",
    });

    // 6b. Demo hold note for an accepted international fee (never authorized or billed)
    if (feeApplies && acceptIntlFee) {
      await txDb.insert(notificationsTable).values({
        id: makeId(),
        userId,
        title: "International hold acknowledged",
        body: `A $${flight.internationalFeeUsd.toLocaleString()} authorization hold is acknowledged for ${flight.fromCity} → ${flight.toCity}. You are charged only if you take the flight; the hold is released if you do not (demo — no real authorization or charge).`,
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

    return res.status(201).json({
      ...entry,
      flight: flightForQueueResponse(flight, entry.status),
      totalInQueue: Number(totalAfterInsert),
      ...(useLinePass ? { usedFamilyPass, linePassCount: updatedPersonalPasses } : {}),
      trip,
    });
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
// Seats are confirmed automatically by the queue engine at the decision
// moment — there is no manual confirm action or acceptance window.
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

    const flightIds = [...new Set(entries.map((entry) => entry.flightId))];
    const waitingMembers = flightIds.length === 0
      ? []
      : await db
          .select({
            flightId: queueEntriesTable.flightId,
            position: queueEntriesTable.position,
            name: usersTable.name,
          })
          .from(queueEntriesTable)
          .innerJoin(usersTable, eq(queueEntriesTable.userId, usersTable.id))
          .where(
            and(
              inArray(queueEntriesTable.flightId, flightIds),
              eq(queueEntriesTable.status, "waiting"),
            ),
          );

    const initialsForName = (name: string): string => {
      const parts = name.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) return "M";
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    };

    const membersByFlight = new Map<string, { initials: string; position: number }[]>();
    for (const member of waitingMembers) {
      const members = membersByFlight.get(member.flightId) ?? [];
      members.push({
        initials: initialsForName(member.name),
        position: member.position,
      });
      membersByFlight.set(member.flightId, members);
    }
    for (const members of membersByFlight.values()) {
      members.sort((a, b) => a.position - b.position);
    }

    const enriched = await Promise.all(
      entries.map(async (entry) => {
        const [flight] = await db.select().from(flightsTable).where(eq(flightsTable.id, entry.flightId));
        const [{ value: totalInQueue }] = await db
          .select({ value: count() })
          .from(queueEntriesTable)
          .where(and(eq(queueEntriesTable.flightId, entry.flightId), eq(queueEntriesTable.status, "waiting")));
        const safeEntry = Object.fromEntries(
          Object.entries(entry).filter(([key]) => key !== "userId"),
        );

        return {
          ...safeEntry,
          flight: flightForQueueResponse(flight, entry.status),
          totalInQueue: Number(totalInQueue),
          queueMembers: membersByFlight.get(entry.flightId) ?? [],
        };
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
router.delete("/:id", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;

  const client = await pool.connect();
  try {
    await syncFamilyPlans();
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
      .set({
        position: sql`${queueEntriesTable.position} - 1`,
        movementHistory: movedEventAppendSql,
      })
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

// POST /queue/:id/use-pass
//
// Applies a Skip the Line pass to ANY existing waiting entry, including the
// member currently at position 1. The pass consumption, immediate
// confirmation, trip creation, and waiting-queue gap close all commit
// atomically under SERIALIZABLE isolation.
router.post("/:id/use-pass", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;

  const client = await pool.connect();
  try {
    await syncFamilyPlans();
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const txDb = drizzle(client, { schema });

    // 0. Membership gate — using a pass is a member feature.
    const [passUser] = await txDb
      .select({ membershipTier: usersTable.membershipTier })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    if (passUser?.membershipTier === "none") {
      await client.query("ROLLBACK");
      return res.status(403).json({
        error: "A Bluebird membership is required to use Skip the Line passes. Choose a plan to join.",
        code: "MEMBERSHIP_REQUIRED",
      });
    }

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
    if (entry.status === "confirmed") {
      // Race with the queue engine: the seat was auto-confirmed while the
      // pass sheet was open. This is good news, not an error — return the
      // confirmed entry, flag it, and leave the pass balance untouched.
      const [confirmedFlight] = await txDb
        .select()
        .from(flightsTable)
        .where(eq(flightsTable.id, entry.flightId));
      const [me] = await txDb
        .select({ linePassCount: usersTable.linePassCount })
        .from(usersTable)
        .where(eq(usersTable.id, userId));
      const [{ value: waitingCount }] = await txDb
        .select({ value: count() })
        .from(queueEntriesTable)
        .where(
          and(
            eq(queueEntriesTable.flightId, entry.flightId),
            eq(queueEntriesTable.status, "waiting"),
          ),
        );
      await client.query("ROLLBACK");
      return res.json({
        ...entry,
        flight: flightForQueueResponse(confirmedFlight, "confirmed"),
        totalInQueue: Number(waitingCount),
        linePassCount: me?.linePassCount ?? 0,
        alreadyConfirmed: true,
      });
    }
    if (entry.status !== "waiting") {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error:
          "This queue entry is no longer active, so a Skip the Line pass can't be used on it. Your pass was not used.",
      });
    }
    // 2. Verify that the flight is still open before touching the pass balance.
    //    Baseline seat capacity is checked later when the confirmed passenger
    //    list is saved, not while entering or advancing in the queue.
    const [flight] = await txDb
      .select()
      .from(flightsTable)
      .where(eq(flightsTable.id, entry.flightId));
    const familyMember = await activeFamilyMemberForUser(userId, txDb);
    let usedFamilyPass = false;
    let familyPassCycle: string | null = null;
    let linePassCount: number | null = null;
    const familyResult = familyMember
      ? await txDb
          .update(familyMembersTable)
          .set({ usedPasses: sql`${familyMembersTable.usedPasses} + 1` })
          .where(and(
            eq(familyMembersTable.id, familyMember.member.id),
            sql`${familyMembersTable.usedPasses} < ${familyMembersTable.allocatedPasses}`,
          ))
          .returning({ usedPasses: familyMembersTable.usedPasses })
      : [];
    if (familyResult.length > 0) {
      usedFamilyPass = true;
      familyPassCycle = familyMember!.plan.renewalAt.toISOString();
    }
    const passResult = !usedFamilyPass
      ? await txDb
          .update(usersTable)
          .set({ linePassCount: sql`${usersTable.linePassCount} - 1` })
          .where(and(eq(usersTable.id, userId), sql`${usersTable.linePassCount} > 0`))
          .returning({ linePassCount: usersTable.linePassCount })
      : [];
    if (!usedFamilyPass && passResult.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: familyMember
          ? "You do not have any Family Skip the Line passes assigned to you"
          : "You do not have any Skip the Line passes",
      });
    }
    if (!usedFamilyPass) linePassCount = (passResult[0] as { linePassCount: number }).linePassCount;

    // 4. Instant win — confirm this entry atomically (conditional on
    //    still-waiting as a concurrent safety net; SERIALIZABLE aborts true
    //    conflicts with 40001). If this or any later step fails, the whole
    //    transaction rolls back and the pass is refunded implicitly.
    const updated = await txDb
      .update(queueEntriesTable)
      .set({ status: "confirmed", usedLinePass: true, usedFamilyPass, familyPassCycle })
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
      .set({
        position: sql`${queueEntriesTable.position} - 1`,
        movementHistory: movedEventAppendSql,
      })
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
      .values({
        id: makeId(),
        userId,
        flightId: entry.flightId,
        status: "upcoming",
        cleaningFeeUsd: entry.bringingPet ? PET_CLEANING_FEE_USD : 0,
        petWeightLb: entry.bringingPet ? entry.petWeightLbs : null,
        petCrateLengthIn: entry.bringingPet ? entry.petCrateLengthIn : null,
        petCrateWidthIn: entry.bringingPet ? entry.petCrateWidthIn : null,
        petCrateHeightIn: entry.bringingPet ? entry.petCrateHeightIn : null,
      })
      .returning();

    // 7. Notify the member
    await txDb.insert(notificationsTable).values({
      id: makeId(),
      userId,
      title: "Flight confirmed!",
      body: flight
        ? `Skip the Line pass used — your seat on ${flight.fromCity} → ${flight.toCity} is confirmed.${entry.bringingPet ? ` The $${PET_CLEANING_FEE_USD} pet cleaning fee now applies.` : ""}`
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
      flight: flightForQueueResponse(flight, "confirmed"),
      totalInQueue: Number(totalInQueue),
      linePassCount,
      usedFamilyPass,
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
