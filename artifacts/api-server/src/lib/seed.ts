import { db } from "@workspace/db";
import { flightsTable, tripsTable, queueEntriesTable, notificationsTable, usersTable } from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";
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

// One-time fee applied to Base members on international routes (Plus/Family/Corporate waive it)
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

// Display-ready departure FBO details per origin airport.
const DEPARTURE_FBOS: Record<string, { name: string; address: string }> = {
  LAX: { name: "Clay Lacy Aviation", address: "7435 Valjean Avenue\nVan Nuys, CA 91406" },
  SFO: { name: "Signature Aviation", address: "1052 North Access Road\nSan Francisco, CA 94128" },
  JFK: { name: "Modern Aviation", address: "1 Hangar Road\nJamaica, NY 11430" },
  MIA: { name: "Signature Aviation", address: "5700 Northwest 36th Street\nMiami, FL 33122" },
  ORD: { name: "Atlantic Aviation", address: "10510 West Zemke Boulevard\nChicago, IL 60666" },
  DAL: { name: "Business Jet Center", address: "8611 Lemmon Avenue\nDallas, TX 75209" },
  LAS: { name: "Henderson Executive Airport", address: "3500 Executive Terminal Drive\nHenderson, NV 89052" },
  BOS: { name: "Signature Aviation", address: "240 Prescott Street\nEast Boston, MA 02128" },
  SEA: { name: "Modern Aviation", address: "8285 Perimeter Road South\nSeattle, WA 98108" },
  DEN: { name: "Signature Aviation", address: "7850 Harry B Combs Parkway\nDenver, CO 80249" },
  TEB: { name: "Signature Aviation", address: "101 Charles A. Lindbergh Drive\nTeterboro, NJ 07608" },
  SDL: { name: "Ross Aviation", address: "14600 North Airport Drive\nScottsdale, AZ 85260" },
  PBI: { name: "Atlantic Aviation", address: "3800 Southern Boulevard\nWest Palm Beach, FL 33406" },
  NAS: { name: "Odyssey Aviation", address: "Coral Harbour Road\nNassau, The Bahamas" },
};

function enrichmentFor(f: { aircraftType: string; fromAirport: string; toAirport: string }) {
  const spec = AIRCRAFT_SPECS[f.aircraftType];
  const fbo = DEPARTURE_FBOS[f.fromAirport];
  return {
    rangeNm: spec?.rangeNm ?? 2000,
    cruiseSpeed: spec?.cruiseSpeed ?? "Mach .74",
    destWeather: DEST_WEATHER[f.toAirport] ?? "72°F Clear",
    departureFbo: fbo?.name ?? null,
    departureFboAddress: fbo?.address ?? null,
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

const DAY_MS = 24 * 60 * 60 * 1000;
const DEMO_FLIGHT_PREFIX = "demo-flight-";

function demoFlightId(flight: (typeof SEED_FLIGHTS)[number]): string {
  return `${DEMO_FLIGHT_PREFIX}${flight.fromAirport}-${flight.toAirport}`;
}

function upcomingDate(index: number): string {
  return new Date(Date.now() + (index + 2) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Seeds demo data for a user so the app feels alive after login:
 * a completed trip, an upcoming trip, an active queue entry,
 * a few notifications, and 2 Skip the Line passes.
 * Safe to call repeatedly: every fixture is independently keyed and restored.
 */
export async function seedDemoDataForUser(userId: string): Promise<void> {
  const completedFlightId = "hist-LAX-SFO-1";
  const upcomingFlightId = demoFlightId(SEED_FLIGHTS[0]);
  const queuedFlightId = demoFlightId(SEED_FLIGHTS[1]);
  const [completedFlight, upcomingFlight, queuedFlight] = await Promise.all(
    [completedFlightId, upcomingFlightId, queuedFlightId].map(async (id) => {
      const [flight] = await db.select().from(flightsTable).where(eq(flightsTable.id, id));
      return flight;
    }),
  );
  if (!completedFlight || !upcomingFlight || !queuedFlight) {
    throw new Error("Required demo flights are missing; restore flights before member fixtures");
  }

  await db.transaction(async (tx) => {
    const completedTrip = {
      id: `demo-trip-completed-${userId}`,
      userId,
      flightId: completedFlight.id,
      status: "completed",
      bookedAt: new Date(Date.now() - 21 * DAY_MS),
    };
    const upcomingTrip = {
      id: `demo-trip-upcoming-${userId}`,
      userId,
      flightId: upcomingFlight.id,
      status: "upcoming",
      bookedAt: new Date(Date.now() - 2 * DAY_MS),
    };
    await tx.insert(tripsTable).values([
      completedTrip,
      upcomingTrip,
    ]).onConflictDoNothing();
    await tx.update(tripsTable).set({
      flightId: completedTrip.flightId,
      status: completedTrip.status,
    }).where(and(
      eq(tripsTable.id, completedTrip.id),
      sql`${tripsTable.flightId} <> ${completedTrip.flightId}`,
    ));
    await tx.update(tripsTable).set({
      flightId: upcomingTrip.flightId,
      status: upcomingTrip.status,
    }).where(and(
      eq(tripsTable.id, upcomingTrip.id),
      sql`${tripsTable.flightId} <> ${upcomingTrip.flightId}`,
    ));

    // A confirmed queue entry backing the upcoming trip, so seeded data
    // mirrors the real booking flow (my-status + seat derivation both count
    // confirmed queue entries). Idempotent via deterministic ID.
    const confirmedQueue = {
        id: `demo-queue-confirmed-${userId}`,
        userId,
        flightId: upcomingFlight.id,
        position: 0,
        status: "confirmed",
        usedLinePass: false,
      };
    await tx.insert(queueEntriesTable).values(confirmedQueue).onConflictDoNothing();
    await tx.update(queueEntriesTable).set({
      flightId: confirmedQueue.flightId,
      position: confirmedQueue.position,
      status: confirmedQueue.status,
    }).where(and(
      eq(queueEntriesTable.id, confirmedQueue.id),
      sql`${queueEntriesTable.flightId} <> ${confirmedQueue.flightId}`,
    ));

    // Restore simulated queue fixtures independently of the member's row.
    const simulatedQueueFixtures = [
      {
        id: `demo-simq-${queuedFlight.id}-1`,
        userId: `${SIM_USER_PREFIX}1`,
        flightId: queuedFlight.id,
        position: 1,
        status: "waiting",
        usedLinePass: false,
      },
      {
        id: `demo-simq-${queuedFlight.id}-2`,
        userId: `${SIM_USER_PREFIX}2`,
        flightId: queuedFlight.id,
        position: 2,
        status: "waiting",
        usedLinePass: false,
      },
    ];
    await tx.insert(queueEntriesTable).values(simulatedQueueFixtures).onConflictDoNothing();

    // Seed the user a few positions back, behind simulated members, so the
    // queue simulation visibly advances them toward the front.
    const activeQueueId = `demo-queue-${userId}`;
    const [fixtureQueue] = await tx
      .select()
      .from(queueEntriesTable)
      .where(eq(queueEntriesTable.id, activeQueueId));
    if (fixtureQueue) {
      // Preserve a queue that simulation or the member already resolved.
      // Only move legacy fixture rows that still point at an obsolete flight.
      if (fixtureQueue.flightId !== queuedFlight.id) {
        await tx.update(queueEntriesTable).set({
          flightId: queuedFlight.id,
          position: 3,
          status: "waiting",
          usedLinePass: false,
          frontNotifiedAt: null,
          movementHistory: [],
        }).where(eq(queueEntriesTable.id, activeQueueId));
      }
    } else {
      const [alreadyQueued] = await tx
      .select()
      .from(queueEntriesTable)
      .where(and(eq(queueEntriesTable.userId, userId), eq(queueEntriesTable.flightId, queuedFlight.id)));
      if (!alreadyQueued) {
        await tx.insert(queueEntriesTable).values({
          id: activeQueueId,
          userId,
          flightId: queuedFlight.id,
          position: 3,
          status: "waiting",
          usedLinePass: false,
        }).onConflictDoNothing();
      }
    }

    // Demo notifications
    await tx
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
    await tx
      .update(usersTable)
      .set({ linePassCount: sql`GREATEST(${usersTable.linePassCount}, 2)` })
      .where(eq(usersTable.id, userId));
  });
  logger.info({ userId }, "Restored demo data for member");
}

/**
 * Seeds the demo member reachable through the normal phone + SMS PIN flow.
 * Testers enter DEMO_MEMBER_PHONE on the phone screen; the demo code comes
 * back in the /auth/request-code response (and server log) in lieu of SMS.
 */
export const DEMO_MEMBER_PHONE = "+15555550100";
export const DEMO_MEMBER_EMAIL = "demo@bluebird.app";
export const DEMO_MEMBER_ID = "demo-member";

export async function seedDemoMember(): Promise<void> {
    let [member] = await db.select().from(usersTable).where(eq(usersTable.phone, DEMO_MEMBER_PHONE));
    if (member) {
      await seedDemoDataForUser(member.id);
      return;
    }
    // Adopt the legacy email/password-era demo row (its phone was backfilled
    // with a placeholder during migration) instead of inserting a duplicate.
    const [legacy] = await db.select().from(usersTable).where(eq(usersTable.email, DEMO_MEMBER_EMAIL));
    if (legacy) {
      await db.update(usersTable).set({ phone: DEMO_MEMBER_PHONE }).where(eq(usersTable.id, legacy.id));
      logger.info("Re-keyed legacy demo member to demo phone number");
      member = { ...legacy, phone: DEMO_MEMBER_PHONE };
      await seedDemoDataForUser(member.id);
      return;
    }
    const [created] = await db.insert(usersTable).values({
      id: DEMO_MEMBER_ID,
      name: "Demo Member",
      phone: DEMO_MEMBER_PHONE,
      email: DEMO_MEMBER_EMAIL,
      referralCode: "DEMOBIRD",
      membershipTier: "base",
      linePassCount: 0,
    }).returning();
    await seedDemoDataForUser(created.id);
    logger.info("Seeded demo member account");
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
    const toInsert = SEED_FLIGHTS.map((f, index) => {
      const p = pricingFor(f.fromAirport, f.toAirport);
      return {
        ...f,
        ...enrichmentFor(f),
        id: demoFlightId(f),
        departureDate: upcomingDate(index),
        priceUsd: p.priceUsd,
        discountPct: p.discountPct,
        featured: !!p.featured,
      };
    });
    await db.insert(flightsTable).values(toInsert).onConflictDoNothing();
    for (const flight of toInsert) {
      await db.update(flightsTable).set({
        fromAirport: flight.fromAirport,
        fromCity: flight.fromCity,
        toAirport: flight.toAirport,
        toCity: flight.toCity,
        aircraftType: flight.aircraftType,
        aircraftCapacity: flight.aircraftCapacity,
        departureDate: flight.departureDate,
        departureTime: flight.departureTime,
        duration: flight.duration,
        seatsAvailable: flight.seatsAvailable,
        priceUsd: flight.priceUsd,
        discountPct: flight.discountPct,
        featured: flight.featured,
        international: flight.international ?? false,
        internationalFeeUsd: flight.internationalFeeUsd ?? 0,
        status: flight.status,
        ...enrichmentFor(flight),
      }).where(eq(flightsTable.id, flight.id));
    }
    await seedHistoricalFlights();
    logger.info({ count: toInsert.length }, "Restored demo flight fixtures");
}

export async function restoreDemoData(): Promise<void> {
  await seedFlights();
  await ensureSimUsers();
  await seedDemoMember();
}
