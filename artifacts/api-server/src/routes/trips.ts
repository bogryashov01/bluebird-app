import { Router } from "express";
import { db, pool } from "@workspace/db";
import {
  tripsTable,
  flightsTable,
  queueEntriesTable,
  usersTable,
  notificationsTable,
  tripPassengersTable,
  manifestOperationalUpdatesTable,
  familyMembersTable,
  familyPlansTable,
} from "@workspace/db/schema";
import { eq, and, sql, asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db/schema";
import { authMiddleware } from "../middlewares/auth";
import { promoteFrontAfterSeatFreed } from "../lib/simulation";
import { departurePassed, sweepDeparturesSafe } from "../lib/departure";
import { SaveTripManifestBody } from "@workspace/api-zod";
import { exceedsPassengerCapacity, passengerCapacityError } from "../lib/passenger-capacity";

const router = Router();

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

async function eligibleManifestTrip(tripId: string, userId: string, database: any = db) {
  const [trip] = await database.select().from(tripsTable)
    .where(and(eq(tripsTable.id, tripId), eq(tripsTable.userId, userId)));
  if (!trip) return { error: "not_found" as const };
  const [flight] = await database.select().from(flightsTable).where(eq(flightsTable.id, trip.flightId));
  if (
    trip.status !== "upcoming" || !flight ||
    flight.status === "cancelled" || flight.status === "departed" ||
    flight.status === "completed" || departurePassed(flight)
  ) return { error: "ineligible" as const };
  const [entry] = await database.select().from(queueEntriesTable).where(and(
    eq(queueEntriesTable.userId, userId),
    eq(queueEntriesTable.flightId, trip.flightId),
    eq(queueEntriesTable.status, "confirmed"),
  ));
  if (!entry) return { error: "ineligible" as const };
  return { trip, flight, entry };
}

function passengerComplete(passenger: any): boolean {
  return !!passenger.firstName?.trim() &&
    !!passenger.lastName?.trim() &&
    validPastDate(passenger.dateOfBirth) &&
    validWeightKg(passenger.weightKg);
}

function validPastDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) &&
    date.toISOString().slice(0, 10) === value &&
    date < new Date();
}

function validWeightKg(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 500;
}

async function manifestResponse(trip: any, flight: any, entry: any, database: any = db) {
  const requiredCount = entry.passengers;
  const stored = await database.select().from(tripPassengersTable)
    .where(eq(tripPassengersTable.tripId, trip.id))
    .orderBy(asc(tripPassengersTable.passengerOrder));
  const passengers = (stored.length ? stored : [{ passengerOrder: 1, firstName: "", lastName: "", dateOfBirth: null, weightKg: null }])
    .map((passenger: any) => ({
      passengerOrder: passenger.passengerOrder,
      firstName: passenger.firstName,
      lastName: passenger.lastName,
      phone: passenger.phone ?? null,
      email: passenger.email ?? null,
      dateOfBirth: passenger.dateOfBirth ?? null,
      weightKg: passenger.weightKg ?? null,
    }));
  const completedCount = passengers.filter(passengerComplete).length;
  const bringingPet = !!entry.bringingPet;
  const pet = bringingPet ? {
    weightLb: trip.petWeightLb,
    crateLengthIn: trip.petCrateLengthIn,
    crateWidthIn: trip.petCrateWidthIn,
    crateHeightIn: trip.petCrateHeightIn,
  } : null;
  const petComplete = !bringingPet ||
    (Number(pet!.weightLb) > 0 && Number(pet!.weightLb) <= 500 &&
      Number(pet!.crateLengthIn) > 0 && Number(pet!.crateLengthIn) <= 200 &&
      Number(pet!.crateWidthIn) > 0 && Number(pet!.crateWidthIn) <= 200 &&
      Number(pet!.crateHeightIn) > 0 && Number(pet!.crateHeightIn) <= 200);
  return {
    tripId: trip.id,
    requiredCount,
    completedCount,
    isComplete: passengers.length === requiredCount &&
      completedCount === passengers.length && petComplete,
    international: flight.international,
    bringingPet,
    pet,
    passengers,
    version: trip.manifestVersion,
    submittedAt: trip.manifestSubmittedAt?.toISOString?.() ?? null,
    deliveryStatus: trip.manifestDeliveryStatus ?? null,
    operationsNotified: !!trip.manifestSubmittedAt,
  };
}

// GET /trips
router.get("/", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  try {
    await sweepDeparturesSafe();
    const trips = await db.select().from(tripsTable).where(eq(tripsTable.userId, userId)).orderBy(tripsTable.bookedAt);
    const enriched = await Promise.all(
      trips.map(async (trip) => {
        const [flight] = await db.select().from(flightsTable).where(eq(flightsTable.id, trip.flightId));
        const [entry] = await db.select().from(queueEntriesTable).where(and(
          eq(queueEntriesTable.userId, userId),
          eq(queueEntriesTable.flightId, trip.flightId),
          eq(queueEntriesTable.status, "confirmed"),
        ));
        const manifest = trip.status === "upcoming" && entry && flight
          ? await manifestResponse(trip, flight, entry)
          : null;
        return {
          ...trip,
          flight,
          manifest: manifest ? {
            requiredCount: manifest.requiredCount,
            completedCount: manifest.completedCount,
            isComplete: manifest.isComplete,
            version: manifest.version,
            submittedAt: manifest.submittedAt,
            deliveryStatus: manifest.deliveryStatus,
          } : undefined,
        };
      })
    );
    return res.json(enriched);
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch trips" });
  }
});

router.get("/:id/manifest", authMiddleware, async (req, res) => {
  const result = await eligibleManifestTrip(String(req.params.id), (req as any).userId);
  if (result.error === "not_found") return res.status(404).json({ error: "Trip not found" });
  if (result.error === "ineligible") return res.status(409).json({ error: "Passenger lists are only available for confirmed upcoming trips" });
  return res.json(await manifestResponse(result.trip, result.flight, result.entry));
});

router.put("/:id/manifest", authMiddleware, async (req, res) => {
  if (Array.isArray(req.body?.passengers) && req.body.passengers.length > 6) {
    return res.status(400).json({ error: passengerCapacityError() });
  }
  const parsed = SaveTripManifestBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid passenger details" });
  const userId = (req as any).userId;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM trips WHERE id = $1 FOR UPDATE", [String(req.params.id)]);
    const txDb = drizzle(client, { schema });
    const result = await eligibleManifestTrip(String(req.params.id), userId, txDb);
    if (result.error === "not_found") { await client.query("ROLLBACK"); return res.status(404).json({ error: "Trip not found" }); }
    if (result.error === "ineligible") { await client.query("ROLLBACK"); return res.status(409).json({ error: "Passenger lists are only available for confirmed upcoming trips" }); }
    const passengers = parsed.data.passengers;
    if (exceedsPassengerCapacity(passengers.length, result.entry.bringingPet)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: passengerCapacityError() });
    }
    if (passengers.length > result.flight.seatsAvailable) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: `This passenger list exceeds the ${result.flight.seatsAvailable}-seat capacity for this flight`,
      });
    }
    const orders = passengers.map((passenger) => passenger.passengerOrder);
    if (passengers.length < 1 || passengers.length > result.entry.passengers || new Set(orders).size !== orders.length ||
      orders.some((order) => !Number.isInteger(order) || order < 1 || order > result.entry.passengers) ||
      orders.slice().sort((a, b) => a - b).some((order, index) => order !== index + 1)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: `Between 1 and ${result.entry.passengers} travelers are allowed` });
    }
    const pet = parsed.data.pet;
    if (!result.entry.bringingPet && pet) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Pet details are not applicable to this booking" });
    }
    const previous = await txDb.select().from(tripPassengersTable)
      .where(eq(tripPassengersTable.tripId, result.trip.id))
      .orderBy(asc(tripPassengersTable.passengerOrder));
    const normalized = passengers.sort((a, b) => a.passengerOrder - b.passengerOrder);
    const comparable = (rows: any[]) => JSON.stringify(rows.map((p) => ({
      passengerOrder: p.passengerOrder, firstName: p.firstName.trim(), lastName: p.lastName.trim(),
      dateOfBirth: p.dateOfBirth || null,
      phone: p.phone || null,
      email: p.email || null,
      weightKg: p.weightKg ?? null,
    })));
    const previousPet = {
      weightLb: result.trip.petWeightLb, crateLengthIn: result.trip.petCrateLengthIn,
      crateWidthIn: result.trip.petCrateWidthIn, crateHeightIn: result.trip.petCrateHeightIn,
    };
    const changed = comparable(previous) !== comparable(normalized) ||
      JSON.stringify(result.entry.bringingPet ? previousPet : null) !== JSON.stringify(pet ?? null);
    await txDb.delete(tripPassengersTable).where(eq(tripPassengersTable.tripId, result.trip.id));
    await txDb.insert(tripPassengersTable).values(normalized.map((passenger) => ({
      id: makeId(), tripId: result.trip.id, passengerOrder: passenger.passengerOrder,
      firstName: passenger.firstName.trim(), lastName: passenger.lastName.trim(),
      phone: passenger.phone?.trim() || null,
      email: passenger.email?.trim().toLowerCase() || null,
      dateOfBirth: passenger.dateOfBirth || null,
      weightKg: passenger.weightKg ?? null,
    })));
    let trip = result.trip;
    [trip] = await txDb.update(tripsTable).set({
      petWeightLb: pet?.weightLb ?? null,
      petCrateLengthIn: pet?.crateLengthIn ?? null,
      petCrateWidthIn: pet?.crateWidthIn ?? null,
      petCrateHeightIn: pet?.crateHeightIn ?? null,
      ...(changed && result.trip.manifestSubmittedAt
        ? { manifestSubmittedAt: null, manifestDeliveryStatus: null }
        : {}),
    }).where(eq(tripsTable.id, result.trip.id)).returning();
    await client.query("COMMIT");
    return res.json(await manifestResponse(trip, result.flight, result.entry));
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    return res.status(500).json({ error: "Failed to save passenger list" });
  } finally { client.release(); }
});

router.post("/:id/manifest/submit", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM trips WHERE id = $1 FOR UPDATE", [String(req.params.id)]);
    const txDb = drizzle(client, { schema });
    const result = await eligibleManifestTrip(String(req.params.id), userId, txDb);
    if (result.error === "not_found") { await client.query("ROLLBACK"); return res.status(404).json({ error: "Trip not found" }); }
    if (result.error === "ineligible") { await client.query("ROLLBACK"); return res.status(409).json({ error: "Passenger lists are only available for confirmed upcoming trips" }); }
    const manifest = await manifestResponse(result.trip, result.flight, result.entry, txDb);
    if (!manifest.isComplete) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Complete every required traveler field before submitting" }); }
    if (result.trip.manifestSubmittedAt) {
      await client.query("ROLLBACK");
      return res.json(manifest);
    }
    const version = result.trip.manifestVersion + 1;
    const subject = `Passenger manifest v${version}: ${result.flight.fromAirport} to ${result.flight.toAirport}`;
    const body = [
      `Trip: ${result.trip.id}`,
      `Flight: ${result.flight.fromAirport} → ${result.flight.toAirport} on ${result.flight.departureDate} at ${result.flight.departureTime}`,
      ...manifest.passengers.map((passenger: any) =>
        `Passenger ${passenger.passengerOrder}: ${passenger.firstName} ${passenger.lastName}; Date of birth ${passenger.dateOfBirth}; Weight ${passenger.weightKg} kg${passenger.phone ? `; Phone ${passenger.phone}` : ""}${passenger.email ? `; Email ${passenger.email}` : ""}`
      ),
      ...(manifest.pet ? [
        `Pet: ${manifest.pet.weightLb} lb; Crate ${manifest.pet.crateLengthIn} × ${manifest.pet.crateWidthIn} × ${manifest.pet.crateHeightIn} in`,
      ] : []),
    ].join("\n");
    const deliveryStatus = "demo_recorded";
    await txDb.insert(manifestOperationalUpdatesTable).values({
      id: makeId(), tripId: result.trip.id, version, recipient: "hello@bluebird.co",
      subject, body, deliveryStatus,
    });
    const [trip] = await txDb.update(tripsTable).set({
      manifestVersion: version, manifestSubmittedAt: new Date(), manifestDeliveryStatus: deliveryStatus,
    }).where(eq(tripsTable.id, result.trip.id)).returning();
    await client.query("COMMIT");
    return res.json(await manifestResponse(trip, result.flight, result.entry));
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    if (err?.code === "23505") {
      const result = await eligibleManifestTrip(String(req.params.id), userId);
      if (!result.error) return res.json(await manifestResponse(result.trip, result.flight, result.entry));
    }
    return res.status(500).json({ error: "Failed to submit passenger list" });
  } finally { client.release(); }
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
      const departed =
        flight.status === "departed" ||
        flight.status === "completed" ||
        departurePassed(flight);
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
    const personalPassRefunded = cancelledEntries.some((e) => e.usedLinePass && !e.usedFamilyPass);
    let familyPassRefunded = false;
    let linePassCount: number | null = null;
    if (personalPassRefunded) {
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
    if (cancelledEntries.some((e) => e.usedFamilyPass)) {
      const [familyMember] = await txDb
        .select({
          id: familyMembersTable.id,
          renewalAt: familyPlansTable.renewalAt,
        })
        .from(familyMembersTable)
        .innerJoin(familyPlansTable, eq(familyMembersTable.familyPlanId, familyPlansTable.id))
        .where(and(
          eq(familyMembersTable.userId, userId),
          eq(familyMembersTable.status, "active"),
        ));
      for (const familyEntry of cancelledEntries.filter((entry) => entry.usedFamilyPass)) {
        if (!familyMember || !familyEntry.familyPassCycle ||
            familyEntry.familyPassCycle !== familyMember.renewalAt.toISOString()) {
          continue;
        }
        const refunded = await txDb.update(familyMembersTable)
          .set({ usedPasses: sql`GREATEST(${familyMembersTable.usedPasses} - 1, 0)` })
          .where(and(
            eq(familyMembersTable.id, familyMember.id),
            sql`${familyMembersTable.usedPasses} > 0`,
          ))
          .returning({ id: familyMembersTable.id });
        familyPassRefunded = familyPassRefunded || refunded.length > 0;
      }
    }
    const passRefunded = personalPassRefunded || familyPassRefunded;

    // 6. Notify the member.
    const route = flight ? `${flight.fromCity} → ${flight.toCity}` : "your flight";
    await txDb.insert(notificationsTable).values({
      id: makeId(),
      userId,
      title: "Booking cancelled",
      body: passRefunded
        ? familyPassRefunded
          ? `Your booking on ${route} was cancelled and your Family Skip the Line pass was returned to your assigned balance.`
          : `Your booking on ${route} was cancelled and your Skip the Line pass was returned to your balance.`
        : `Your booking on ${route} was cancelled. Your seat has been released.`,
      type: "system",
    });

    // 7. Give the freed seat to the next member in line right away (same
    //    transaction): the front waiting real member is confirmed immediately
    //    if eligible, or notified that a seat opened. Without this the queue
    //    only advances on the next simulation tick (up to 20s later).
    if (cancelledEntries.length > 0) {
      await promoteFrontAfterSeatFreed(txDb, trip.flightId);
    }

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
