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

// ── Flight-details enrichment (aircraft specs, destination weather, FBOs) ──
const AIRCRAFT_SPECS: Record<string, { rangeNm: number; cruiseSpeed: string }> = {
  "Cessna Citation CJ3": { rangeNm: 2040, cruiseSpeed: "Mach .70" },
  "Phenom 300E":         { rangeNm: 2010, cruiseSpeed: "Mach .80" },
  "King Air 350":        { rangeNm: 1806, cruiseSpeed: "312 kts" },
  "HondaJet Elite II":   { rangeNm: 1547, cruiseSpeed: "Mach .72" },
  "Cessna Citation XLS": { rangeNm: 2100, cruiseSpeed: "Mach .75" },
  "Pilatus PC-12":       { rangeNm: 1800, cruiseSpeed: "290 kts" },
  "Gulfstream G280":     { rangeNm: 3600, cruiseSpeed: "Mach .80" },
  "Cessna Citation M2":  { rangeNm: 1550, cruiseSpeed: "Mach .71" },
  "Citation Latitude":   { rangeNm: 2700, cruiseSpeed: "Mach .74" },
};

// Static demo weather per destination airport (out of scope: live weather API)
const DEST_WEATHER: Record<string, string> = {
  SFO: "62°F Fog",   MIA: "88°F Sunny",  DAL: "95°F Clear", LAX: "75°F Sunny",
  JFK: "81°F Cloudy", SEA: "64°F Overcast", TEB: "79°F Clear", ASP: "72°F Clear",
  NAS: "86°F Sunny", YYZ: "74°F Clear",  LAS: "104°F Sunny", SDL: "98°F Sunny",
  PBI: "87°F Sunny", BOS: "73°F Clear",  ORD: "78°F Windy",  DEN: "83°F Clear",
};

// Departure FBO per origin airport
const DEPARTURE_FBOS: Record<string, string> = {
  LAX: "Clay Lacy Aviation",
  SFO: "Signature Flight Support",
  JFK: "Modern Aviation",
  MIA: "Signature Flight Support",
  ORD: "Atlantic Aviation",
  DAL: "Business Jet Center",
  LAS: "Henderson Executive",
  BOS: "Signature Flight Support",
  SEA: "Modern Aviation",
  DEN: "Signature Flight Support",
  TEB: "Signature Flight Support",
  SDL: "Ross Aviation",
  PBI: "Atlantic Aviation",
  NAS: "Odyssey Aviation",
};

function enrichmentFor(f: { aircraftType: string; fromAirport: string; toAirport: string }) {
  const spec = AIRCRAFT_SPECS[f.aircraftType];
  return {
    rangeNm: spec?.rangeNm ?? 2000,
    cruiseSpeed: spec?.cruiseSpeed ?? "Mach .74",
    destWeather: DEST_WEATHER[f.toAirport] ?? "72°F Clear",
    departureFbo: DEPARTURE_FBOS[f.fromAirport] ?? "Signature Flight Support",
  };
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

    // A confirmed queue entry backing the upcoming trip, so seeded data
    // mirrors the real booking flow (my-status + seat derivation both count
    // confirmed queue entries). Idempotent via deterministic ID.
    await db
      .insert(queueEntriesTable)
      .values({
        id: `demo-queue-confirmed-${userId}`,
        userId,
        flightId: upcomingFlight.id,
        position: 0,
        status: "confirmed",
        usedLinePass: false,
      })
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
 * Seeds the demo member reachable through the normal phone + SMS PIN flow.
 * Testers enter DEMO_MEMBER_PHONE on the phone screen; the demo code comes
 * back in the /auth/request-code response (and server log) in lieu of SMS.
 */
export const DEMO_MEMBER_PHONE = "+15555550100";
export const DEMO_MEMBER_EMAIL = "demo@bluebird.app";

export async function seedDemoMember(): Promise<void> {
  try {
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.phone, DEMO_MEMBER_PHONE));
    if (existing) return;
    // Adopt the legacy email/password-era demo row (its phone was backfilled
    // with a placeholder during migration) instead of inserting a duplicate.
    const [legacy] = await db.select().from(usersTable).where(eq(usersTable.email, DEMO_MEMBER_EMAIL));
    if (legacy) {
      await db.update(usersTable).set({ phone: DEMO_MEMBER_PHONE }).where(eq(usersTable.id, legacy.id));
      logger.info("Re-keyed legacy demo member to demo phone number");
      return;
    }
    const userId = makeId();
    await db.insert(usersTable).values({
      id: userId,
      name: "Demo Member",
      phone: DEMO_MEMBER_PHONE,
      email: DEMO_MEMBER_EMAIL,
      referralCode: "DEMO" + Math.random().toString(36).slice(2, 6).toUpperCase(),
      membershipTier: "base",
      linePassCount: 0,
    });
    await seedDemoDataForUser(userId);
    logger.info("Seeded demo member account");
  } catch (err) {
    logger.error({ err }, "Failed to seed demo member");
  }
}

// ---------------------------------------------------------------------------
// Historical completed flights — power the airport-first onboarding summary.
// Dates are generated relative to "now" at seed time so every selectable
// airport always shows credible activity within the last 30 days.
// ---------------------------------------------------------------------------

const HIST_CITIES: Record<string, string> = {
  LAX: "Los Angeles",
  SFO: "San Francisco",
  JFK: "New York",
  MIA: "Miami",
  ORD: "Chicago",
  DAL: "Dallas",
  LAS: "Las Vegas",
  BOS: "Boston",
  SEA: "Seattle",
  DEN: "Denver",
  ASP: "Aspen",
  TEB: "New York (Teterboro)",
  SDL: "Scottsdale",
  PBI: "Palm Beach",
  NAS: "Nassau",
};

const HIST_AIRCRAFT = [
  { type: "Phenom 300E", capacity: 8 },
  { type: "Cessna Citation CJ3", capacity: 6 },
  { type: "Gulfstream G280", capacity: 10 },
  { type: "King Air 350", capacity: 9 },
  { type: "HondaJet Elite II", capacity: 5 },
  { type: "Pilatus PC-12", capacity: 8 },
];

const HIST_TIMES = ["07:20", "08:45", "10:10", "11:35", "13:00", "14:25", "15:50", "17:15"];
const HIST_DURATIONS: Record<string, string> = {
  "DAL-ASP": "1h 45m", "DAL-SDL": "2h 05m", "DAL-PBI": "2h 25m", "DAL-LAS": "2h 30m", "DAL-MIA": "2h 20m",
  "TEB-MIA": "2h 50m", "TEB-PBI": "2h 40m", "TEB-BOS": "0h 50m", "TEB-ASP": "3h 55m",
  "LAX-LAS": "0h 55m", "LAX-ASP": "1h 50m", "LAX-SFO": "1h 05m", "LAX-SDL": "1h 10m",
  "MIA-TEB": "3h 05m", "MIA-NAS": "1h 05m", "MIA-PBI": "0h 35m",
  "JFK-MIA": "3h 10m", "JFK-PBI": "2h 45m", "JFK-BOS": "0h 50m",
  "ORD-DAL": "2h 20m", "ORD-ASP": "2h 25m",
  "LAS-LAX": "0h 55m", "LAS-SDL": "1h 00m",
  "BOS-TEB": "0h 50m", "BOS-JFK": "0h 50m",
  "SFO-SEA": "1h 40m", "SFO-LAS": "1h 25m",
  "DEN-ASP": "0h 40m", "DEN-SDL": "1h 45m",
};

// Route mix per origin airport: [destination, number of completed flights]
const HIST_ROUTES: Record<string, [string, number][]> = {
  DAL: [["ASP", 6], ["SDL", 5], ["PBI", 4], ["LAS", 2], ["MIA", 1]],
  TEB: [["MIA", 5], ["PBI", 4], ["BOS", 3], ["ASP", 2]],
  LAX: [["LAS", 4], ["ASP", 3], ["SFO", 3], ["SDL", 2]],
  MIA: [["TEB", 4], ["NAS", 3], ["PBI", 2]],
  JFK: [["MIA", 4], ["PBI", 3], ["BOS", 2]],
  ORD: [["DAL", 3], ["ASP", 3]],
  LAS: [["LAX", 3], ["SDL", 2]],
  BOS: [["TEB", 3], ["JFK", 2]],
  SFO: [["SEA", 3], ["LAS", 2]],
  DEN: [["ASP", 4], ["SDL", 2]],
};

function histDateStr(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function buildHistoricalFlights() {
  const rows: (typeof SEED_FLIGHTS[number] & { id: string; priceUsd: number; discountPct: number; featured: boolean })[] = [];
  for (const [from, dests] of Object.entries(HIST_ROUTES)) {
    let i = 0;
    for (const [to, n] of dests) {
      for (let k = 0; k < n; k++) {
        i += 1;
        const aircraft = HIST_AIRCRAFT[(i + k) % HIST_AIRCRAFT.length];
        const p = pricingFor(from, to);
        // Spread departures across the last ~28 days, deterministically
        const daysAgo = 1 + ((i * 5 + k * 3) % 28);
        rows.push({
          ...enrichmentFor({ aircraftType: aircraft.type, fromAirport: from, toAirport: to }),
          id: `hist-${from}-${to}-${k + 1}`,
          fromAirport: from,
          fromCity: HIST_CITIES[from] ?? from,
          toAirport: to,
          toCity: HIST_CITIES[to] ?? to,
          aircraftType: aircraft.type,
          aircraftCapacity: aircraft.capacity,
          departureDate: histDateStr(daysAgo),
          departureTime: HIST_TIMES[(i + k) % HIST_TIMES.length],
          duration: HIST_DURATIONS[`${from}-${to}`] ?? "2h 00m",
          seatsAvailable: 0,
          status: "completed",
          priceUsd: p.priceUsd,
          discountPct: p.discountPct,
          featured: false,
        });
      }
    }
  }
  return rows;
}

/**
 * Backfills completed historical flights (last 30 days) so the airport-first
 * onboarding summary has real data for every selectable airport. Idempotent:
 * deterministic IDs + onConflictDoNothing, and refreshes stale dates that
 * have drifted outside the 30-day window.
 */
async function seedHistoricalFlights(): Promise<void> {
  const rows = buildHistoricalFlights();
  await db.insert(flightsTable).values(rows).onConflictDoNothing();
  // Refresh dates on previously seeded historical flights that drifted out of window
  const cutoff = histDateStr(30);
  for (const r of rows) {
    await db
      .update(flightsTable)
      .set({ departureDate: r.departureDate })
      .where(and(eq(flightsTable.id, r.id), sql`${flightsTable.departureDate} < ${cutoff}`));
  }
  logger.info({ count: rows.length }, "Ensured historical completed flights");
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

      // Backfill details enrichment on flights seeded before it existed
      const unenriched = await db
        .select()
        .from(flightsTable)
        .where(sql`${flightsTable.departureFbo} IS NULL`);
      for (const f of unenriched) {
        await db.update(flightsTable).set(enrichmentFor(f)).where(eq(flightsTable.id, f.id));
      }
      if (unenriched.length > 0) logger.info({ count: unenriched.length }, "Backfilled flight details enrichment");

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
          return { ...f, ...enrichmentFor(f), id: makeId(), priceUsd: p.priceUsd, discountPct: p.discountPct, featured: !!p.featured };
        });
        if (intlFlights.length > 0) {
          await db.insert(flightsTable).values(intlFlights);
          logger.info({ count: intlFlights.length }, "Backfilled international flights");
        }
      }
      await seedHistoricalFlights();
      return;
    }
    const toInsert = SEED_FLIGHTS.map((f) => {
      const p = pricingFor(f.fromAirport, f.toAirport);
      return { ...f, ...enrichmentFor(f), id: makeId(), priceUsd: p.priceUsd, discountPct: p.discountPct, featured: !!p.featured };
    });
    await db.insert(flightsTable).values(toInsert);
    logger.info({ count: toInsert.length }, "Seeded flights");
    await seedHistoricalFlights();
  } catch (err) {
    logger.error({ err }, "Failed to seed flights");
  }
}
