import { db } from "@workspace/db";
import { flightsTable, tripsTable, queueEntriesTable, notificationsTable, usersTable } from "@workspace/db/schema";
import { eq, and, count, sql } from "drizzle-orm";
import { logger } from "./logger";

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

const SEED_FLIGHTS = [
  {
    fromAirport: "LAX",
    fromCity: "Los Angeles",
    toAirport: "SFO",
    toCity: "San Francisco",
    aircraftType: "Cessna Citation CJ3",
    aircraftCapacity: 6,
    departureDate: "2026-08-12",
    departureTime: "08:15",
    duration: "1h 05m",
    seatsAvailable: 4,
    status: "available",
  },
  {
    fromAirport: "JFK",
    fromCity: "New York",
    toAirport: "MIA",
    toCity: "Miami",
    aircraftType: "Phenom 300E",
    aircraftCapacity: 8,
    departureDate: "2026-08-12",
    departureTime: "11:30",
    duration: "3h 10m",
    seatsAvailable: 6,
    status: "available",
  },
  {
    fromAirport: "ORD",
    fromCity: "Chicago",
    toAirport: "DAL",
    toCity: "Dallas",
    aircraftType: "King Air 350",
    aircraftCapacity: 9,
    departureDate: "2026-08-13",
    departureTime: "14:00",
    duration: "2h 20m",
    seatsAvailable: 7,
    status: "available",
  },
  {
    fromAirport: "LAS",
    fromCity: "Las Vegas",
    toAirport: "LAX",
    toCity: "Los Angeles",
    aircraftType: "HondaJet Elite II",
    aircraftCapacity: 5,
    departureDate: "2026-08-13",
    departureTime: "16:45",
    duration: "0h 55m",
    seatsAvailable: 3,
    status: "available",
  },
  {
    fromAirport: "BOS",
    fromCity: "Boston",
    toAirport: "JFK",
    toCity: "New York",
    aircraftType: "Cessna Citation XLS",
    aircraftCapacity: 8,
    departureDate: "2026-08-14",
    departureTime: "07:00",
    duration: "0h 50m",
    seatsAvailable: 5,
    status: "available",
  },
  {
    fromAirport: "SFO",
    fromCity: "San Francisco",
    toAirport: "SEA",
    toCity: "Seattle",
    aircraftType: "Pilatus PC-12",
    aircraftCapacity: 8,
    departureDate: "2026-08-14",
    departureTime: "09:30",
    duration: "1h 40m",
    seatsAvailable: 6,
    status: "available",
  },
  {
    fromAirport: "MIA",
    fromCity: "Miami",
    toAirport: "TEB",
    toCity: "New York (Teterboro)",
    aircraftType: "Gulfstream G280",
    aircraftCapacity: 10,
    departureDate: "2026-08-15",
    departureTime: "13:00",
    duration: "3h 05m",
    seatsAvailable: 8,
    status: "available",
  },
  {
    fromAirport: "DEN",
    fromCity: "Denver",
    toAirport: "ASP",
    toCity: "Aspen",
    aircraftType: "Cessna Citation M2",
    aircraftCapacity: 6,
    departureDate: "2026-08-15",
    departureTime: "10:15",
    duration: "0h 40m",
    seatsAvailable: 4,
    status: "available",
  },
];

/**
 * Seeds demo data for a user so the app feels alive after login:
 * a completed trip, an upcoming trip, an active queue entry,
 * a few notifications, and 2 Skip the Line passes.
 * Safe to call repeatedly — no-ops if the user already has trips.
 */
export async function seedDemoDataForUser(userId: string): Promise<void> {
  try {
    const [{ value: existingTrips }] = await db
      .select({ value: count() })
      .from(tripsTable)
      .where(eq(tripsTable.userId, userId));
    if (Number(existingTrips) > 0) return;

    const flights = await db.select().from(flightsTable).limit(4);
    if (flights.length < 3) return;

    const [completedFlight, upcomingFlight, queuedFlight] = flights;

    // One completed and one upcoming trip
    await db.insert(tripsTable).values([
      {
        id: makeId(),
        userId,
        flightId: completedFlight.id,
        status: "completed",
        bookedAt: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000),
      },
      {
        id: makeId(),
        userId,
        flightId: upcomingFlight.id,
        status: "upcoming",
        bookedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
    ]);

    // An active queue entry (skip if already queued for that flight)
    const [alreadyQueued] = await db
      .select()
      .from(queueEntriesTable)
      .where(and(eq(queueEntriesTable.userId, userId), eq(queueEntriesTable.flightId, queuedFlight.id)));
    if (!alreadyQueued) {
      const [{ value: queueCount }] = await db
        .select({ value: count() })
        .from(queueEntriesTable)
        .where(and(eq(queueEntriesTable.flightId, queuedFlight.id), eq(queueEntriesTable.status, "waiting")));
      await db.insert(queueEntriesTable).values({
        id: makeId(),
        userId,
        flightId: queuedFlight.id,
        position: Number(queueCount) + 1,
        status: "waiting",
        usedLinePass: false,
      });
    }

    // Demo notifications
    await db.insert(notificationsTable).values([
      {
        id: makeId(),
        userId,
        title: "Seat confirmed ✈️",
        body: `Your seat on ${upcomingFlight.fromCity} → ${upcomingFlight.toCity} is confirmed. See you onboard!`,
        type: "queue_update",
        read: false,
      },
      {
        id: makeId(),
        userId,
        title: "You're in the queue",
        body: `You joined the queue for ${queuedFlight.fromCity} → ${queuedFlight.toCity}. We'll notify you when a seat opens.`,
        type: "queue_update",
        read: false,
      },
      {
        id: makeId(),
        userId,
        title: "2 Skip the Line passes added ⚡",
        body: "Welcome gift: two Skip the Line passes have been added to your account.",
        type: "membership",
        read: true,
      },
    ]);

    // Welcome gift: 2 line passes so Skip the Line is usable right away
    await db
      .update(usersTable)
      .set({ linePassCount: sql`${usersTable.linePassCount} + 2` })
      .where(and(eq(usersTable.id, userId), sql`${usersTable.linePassCount} = 0`));

    logger.info({ userId }, "Seeded demo data for user");
  } catch (err) {
    logger.error({ err, userId }, "Failed to seed demo data for user");
  }
}

export async function seedFlights(): Promise<void> {
  try {
    const [{ value: existing }] = await db.select({ value: count() }).from(flightsTable);
    if (Number(existing) > 0) {
      logger.info("Flights already seeded, skipping.");
      return;
    }
    const toInsert = SEED_FLIGHTS.map((f) => ({ ...f, id: makeId() }));
    await db.insert(flightsTable).values(toInsert);
    logger.info({ count: toInsert.length }, "Seeded flights");
  } catch (err) {
    logger.error({ err }, "Failed to seed flights");
  }
}
