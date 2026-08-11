import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { flightsTable, tripsTable, queueEntriesTable, notificationsTable, usersTable } from "@workspace/db/schema";
import { eq, and, count, sql } from "drizzle-orm";
import { logger } from "./logger";
import { ensureSimUsers, SIM_USER_PREFIX } from "./simulation";

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

const FLIGHT_PRICING: Record<string, { priceUsd: number; discountPct: number; featured?: boolean }> = {
  "LAX-SFO": { priceUsd: 3400, discountPct: 55 },
  "JFK-MIA": { priceUsd: 5200, discountPct: 62, featured: true },
  "ORD-DAL": { priceUsd: 4100, discountPct: 48 },
  "LAS-LAX": { priceUsd: 2800, discountPct: 51 },
  "BOS-JFK": { priceUsd: 3150, discountPct: 44 },
  "SFO-SEA": { priceUsd: 3900, discountPct: 57 },
  "MIA-TEB": { priceUsd: 6400, discountPct: 60 },
  "DEN-ASP": { priceUsd: 2450, discountPct: 40 },
  "MIA-NAS": { priceUsd: 4800, discountPct: 52 },
  "TEB-YYZ": { priceUsd: 5600, discountPct: 47, featured: true },
};

// One-time fee applied to Base members on international routes (Plus/Concierge waive it)
const INTL_FEE_USD = 1000;

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
  {
    fromAirport: "MIA",
    fromCity: "Miami",
    toAirport: "NAS",
    toCity: "Nassau",
    aircraftType: "Cessna Citation XLS",
    aircraftCapacity: 8,
    departureDate: "2026-08-16",
    departureTime: "09:00",
    duration: "1h 05m",
    seatsAvailable: 6,
    status: "available",
    international: true,
    internationalFeeUsd: INTL_FEE_USD,
  },
  {
    fromAirport: "TEB",
    fromCity: "New York (Teterboro)",
    toAirport: "YYZ",
    toCity: "Toronto",
    aircraftType: "Phenom 300E",
    aircraftCapacity: 8,
    departureDate: "2026-08-16",
    departureTime: "15:30",
    duration: "1h 35m",
    seatsAvailable: 5,
    status: "available",
    international: true,
    internationalFeeUsd: INTL_FEE_USD,
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

    // Deterministic IDs make every insert idempotent under concurrent
    // registration/login calls: a second concurrent run conflicts on the
    // primary key and is silently skipped.
    // One completed and one upcoming trip
    await db
      .insert(tripsTable)
      .values([
        {
          id: `demo-trip-completed-${userId}`,
          userId,
          flightId: completedFlight.id,
          status: "completed",
          bookedAt: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000),
        },
        {
          id: `demo-trip-upcoming-${userId}`,
          userId,
          flightId: upcomingFlight.id,
          status: "upcoming",
          bookedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        },
      ])
      .onConflictDoNothing();

    // An active queue entry (skip if already queued for that flight).
    // Seed the user a few positions back, behind simulated members, so the
    // queue simulation visibly advances them toward the front — showcasing
    // the playable loop rather than a static fixture.
    const [alreadyQueued] = await db
      .select()
      .from(queueEntriesTable)
      .where(and(eq(queueEntriesTable.userId, userId), eq(queueEntriesTable.flightId, queuedFlight.id)));
    if (!alreadyQueued) {
      await ensureSimUsers();

      // Ensure at least 2 simulated members are waiting ahead in this queue.
      const [{ value: simWaiting }] = await db
        .select({ value: count() })
        .from(queueEntriesTable)
        .where(
          and(
            eq(queueEntriesTable.flightId, queuedFlight.id),
            eq(queueEntriesTable.status, "waiting"),
            sql`${queueEntriesTable.userId} LIKE ${SIM_USER_PREFIX + "%"}`,
          ),
        );
      const simsToAdd = Math.max(0, 2 - Number(simWaiting));
      if (simsToAdd > 0) {
        const [{ value: existingWaiting }] = await db
          .select({ value: count() })
          .from(queueEntriesTable)
          .where(and(eq(queueEntriesTable.flightId, queuedFlight.id), eq(queueEntriesTable.status, "waiting")));
        await db
          .insert(queueEntriesTable)
          .values(
            Array.from({ length: simsToAdd }, (_, i) => ({
              id: `demo-simq-${queuedFlight.id}-${Number(existingWaiting) + i + 1}`,
              userId: `${SIM_USER_PREFIX}${i + 1}`,
              flightId: queuedFlight.id,
              position: Number(existingWaiting) + i + 1,
              status: "waiting",
              usedLinePass: false,
            })),
          )
          .onConflictDoNothing();
      }

      const [{ value: queueCount }] = await db
        .select({ value: count() })
        .from(queueEntriesTable)
        .where(and(eq(queueEntriesTable.flightId, queuedFlight.id), eq(queueEntriesTable.status, "waiting")));
      await db
        .insert(queueEntriesTable)
        .values({
          id: `demo-queue-${userId}`,
          userId,
          flightId: queuedFlight.id,
          position: Number(queueCount) + 1,
          status: "waiting",
          usedLinePass: false,
        })
        .onConflictDoNothing();
    }

    // Demo notifications
    await db
      .insert(notificationsTable)
      .values([
        {
          id: `demo-notif-seat-${userId}`,
          userId,
          title: "Seat confirmed ✈️",
          body: `Your seat on ${upcomingFlight.fromCity} → ${upcomingFlight.toCity} is confirmed. See you onboard!`,
          type: "queue_update",
          read: false,
        },
        {
          id: `demo-notif-queue-${userId}`,
          userId,
          title: "You're in the queue",
          body: `You joined the queue for ${queuedFlight.fromCity} → ${queuedFlight.toCity}. We'll notify you when a seat opens.`,
          type: "queue_update",
          read: false,
        },
        {
          id: `demo-notif-passes-${userId}`,
          userId,
          title: "2 Skip the Line passes added ⚡",
          body: "Welcome gift: two Skip the Line passes have been added to your account.",
          type: "membership",
          read: true,
        },
      ])
      .onConflictDoNothing();

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

/**
 * Seeds the demo member used by the mobile app's "Continue with Apple/Google"
 * buttons (demo mode — no real OAuth). The app signs in through the normal
 * /auth/login endpoint with these fixed credentials.
 */
export const DEMO_MEMBER_EMAIL = "demo@bluebird.app";
export const DEMO_MEMBER_PASSWORD = "bluebird-demo";

export async function seedDemoMember(): Promise<void> {
  try {
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, DEMO_MEMBER_EMAIL));
    if (existing) return;
    const passwordHash = await bcrypt.hash(DEMO_MEMBER_PASSWORD, 10);
    const userId = makeId();
    await db.insert(usersTable).values({
      id: userId,
      name: "Demo Member",
      email: DEMO_MEMBER_EMAIL,
      passwordHash,
      referralCode: "DEMO" + Math.random().toString(36).slice(2, 6).toUpperCase(),
      membershipTier: "base",
      emailVerified: true,
      linePassCount: 0,
    });
    await seedDemoDataForUser(userId);
    logger.info("Seeded demo member account");
  } catch (err) {
    logger.error({ err }, "Failed to seed demo member");
  }
}

function pricingFor(fromAirport: string, toAirport: string) {
  return FLIGHT_PRICING[`${fromAirport}-${toAirport}`] ?? { priceUsd: 3500, discountPct: 45 };
}

export async function seedFlights(): Promise<void> {
  try {
    const [{ value: existing }] = await db.select({ value: count() }).from(flightsTable);
    if (Number(existing) > 0) {
      // Backfill pricing on flights seeded before pricing existed
      const unpriced = await db.select().from(flightsTable).where(eq(flightsTable.priceUsd, 0));
      for (const f of unpriced) {
        const p = pricingFor(f.fromAirport, f.toAirport);
        await db
          .update(flightsTable)
          .set({ priceUsd: p.priceUsd, discountPct: p.discountPct, featured: !!p.featured })
          .where(eq(flightsTable.id, f.id));
      }
      if (unpriced.length > 0) logger.info({ count: unpriced.length }, "Backfilled flight pricing");
      else logger.info("Flights already seeded, skipping.");

      // Backfill: ensure the international demo routes exist for DBs seeded
      // before international flights were introduced.
      const [intlExisting] = await db
        .select()
        .from(flightsTable)
        .where(eq(flightsTable.international, true))
        .limit(1);
      if (!intlExisting) {
        const intlFlights = SEED_FLIGHTS.filter((f: any) => f.international).map((f) => {
          const p = pricingFor(f.fromAirport, f.toAirport);
          return { ...f, id: makeId(), priceUsd: p.priceUsd, discountPct: p.discountPct, featured: !!p.featured };
        });
        if (intlFlights.length > 0) {
          await db.insert(flightsTable).values(intlFlights);
          logger.info({ count: intlFlights.length }, "Backfilled international flights");
        }
      }
      return;
    }
    const toInsert = SEED_FLIGHTS.map((f) => {
      const p = pricingFor(f.fromAirport, f.toAirport);
      return { ...f, id: makeId(), priceUsd: p.priceUsd, discountPct: p.discountPct, featured: !!p.featured };
    });
    await db.insert(flightsTable).values(toInsert);
    logger.info({ count: toInsert.length }, "Seeded flights");
  } catch (err) {
    logger.error({ err }, "Failed to seed flights");
  }
}
