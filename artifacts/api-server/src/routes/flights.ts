import { Router } from "express";
import { db } from "@workspace/db";
import { flightsTable, queueEntriesTable, tripsTable, tripPassengersTable } from "@workspace/db/schema";
import { eq, ilike, and, inArray, count, desc, sql } from "drizzle-orm";
import { authMiddleware } from "../middlewares/auth";
import { sweepDeparturesSafe } from "../lib/departure";
import { AIRPORT_GROUPS } from "../lib/airport-catalog";

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

// FBO details are assigned flight data, but they are only disclosed through
// an authenticated confirmed-flight response. Keep them out of every public
// flight shape, including nested airport-summary results.
function publicFlight<T extends { departureFbo?: unknown; departureFboAddress?: unknown }>(flight: T) {
  const {
    departureFbo: _departureFbo,
    departureFboAddress: _departureFboAddress,
    ...safeFlight
  } = flight;
  return safeFlight;
}

function confirmedFlightDetails(flight: { departureFbo?: string | null; departureFboAddress?: string | null }) {
  return {
    departureFbo: flight.departureFbo ?? null,
    departureFboAddress: flight.departureFboAddress ?? null,
  };
}

// GET /flights (public — members can browse before signing in)
router.get("/", async (req, res) => {
  try {
    await sweepDeparturesSafe();
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
    return res.json(flights.map((f) => publicFlight(withDerivedSeats(f, paxMap))));
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch flights" });
  }
});

const AIRPORT_NAMES = Object.fromEntries(
  AIRPORT_GROUPS.flatMap((group) => group.airports.map((airport) => [airport.code, airport.name])),
);

function airportName(code: string, city: string): string {
  return AIRPORT_NAMES[code] ?? `${city} Airport`;
}

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function flightManifestProgress(trip: any, entry: any, _international: boolean) {
  const passengers = await db.select().from(tripPassengersTable)
    .where(eq(tripPassengersTable.tripId, trip.id));
  const complete = passengers.filter((passenger) =>
    !!passenger.firstName.trim() && !!passenger.lastName.trim() && validPastDate(passenger.dateOfBirth)
  ).length;
  const petComplete = !entry.bringingPet || [
    trip.petWeightLb, trip.petCrateLengthIn, trip.petCrateWidthIn, trip.petCrateHeightIn,
  ].every((value) => Number.isInteger(value) && value > 0);
  return {
    requiredCount: entry.passengers,
    completedCount: complete,
    isComplete: passengers.length > 0 && passengers.length <= entry.passengers &&
      complete === passengers.length && petComplete,
    version: trip.manifestVersion,
    submittedAt: trip.manifestSubmittedAt?.toISOString?.() ?? null,
    deliveryStatus: trip.manifestDeliveryStatus ?? null,
  };
}

function validPastDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) &&
    date.toISOString().slice(0, 10) === value &&
    date < new Date();
}

// GET /flights/airports (public — onboarding airport picker)
// The catalog is canonical; inventory counts are optional enrichment.
router.get("/airports", async (_req, res) => {
  try {
    const rows = await db
      .select({
        code: flightsTable.fromAirport,
        city: flightsTable.fromCity,
        flightCount: count(),
      })
      .from(flightsTable)
      .groupBy(flightsTable.fromAirport, flightsTable.fromCity)
      .orderBy(desc(count()));
    const counts = new Map(rows.map((row) => [row.code, Number(row.flightCount)]));
    return res.json(AIRPORT_GROUPS.map((group) => ({
      city: group.city,
      airports: group.airports.map((airport) => ({
        ...airport,
        city: group.city,
        ...(counts.has(airport.code) ? { flightCount: counts.get(airport.code) } : {}),
      })),
    })));
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch airports" });
  }
});

// GET /flights/airports/:code/summary (public — onboarding airport summary)
router.get("/airports/:code/summary", async (req, res) => {
  try {
    const code = String(req.params.code).toUpperCase();
    const flights = await db
      .select()
      .from(flightsTable)
      .where(eq(flightsTable.fromAirport, code));
    if (flights.length === 0) {
      return res.status(404).json({ error: "Airport not found" });
    }

    const now = new Date();
    const cutoff = dateStr(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
    const today = dateStr(now);

    // Flights over the last 30 days: departed within the window (inclusive of today)
    const last30 = flights.filter(
      (f) => f.departureDate >= cutoff && f.departureDate <= today,
    );

    // Top destinations across all flights from this airport
    const destCounts = new Map<string, { code: string; city: string; count: number }>();
    for (const f of flights) {
      const d = destCounts.get(f.toAirport) ?? { code: f.toAirport, city: f.toCity, count: 0 };
      d.count += 1;
      destCounts.set(f.toAirport, d);
    }
    const topDestinations = [...destCounts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    // Recent completed flights, newest first
    const recentFlights = flights
      .filter((f) => f.status === "completed")
      .sort((a, b) =>
        a.departureDate === b.departureDate
          ? b.departureTime.localeCompare(a.departureTime)
          : b.departureDate.localeCompare(a.departureDate),
      )
      .slice(0, 6);

    return res.json({
      airport: {
        code,
        name: airportName(code, flights[0].fromCity),
        city: flights[0].fromCity,
        flightCount: flights.length,
      },
      flightCount30d: last30.length,
      topDestinations,
      recentFlights: recentFlights.map(publicFlight),
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch airport summary" });
  }
});

// GET /flights/:id (public)
router.get("/:id", async (req, res) => {
  try {
    await sweepDeparturesSafe();
    const [[flight], paxMap] = await Promise.all([
      db.select().from(flightsTable).where(eq(flightsTable.id, String(req.params.id))),
      confirmedPaxByFlight(),
    ]);
    if (!flight) {
      return res.status(404).json({ error: "Flight not found" });
    }
    return res.json(publicFlight(withDerivedSeats(flight, paxMap)));
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
    await sweepDeparturesSafe();
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

    // A member may hold an active trip on this flight without a confirmed
    // queue entry (e.g. demo-seeded trips). An upcoming trip always means
    // confirmed — it takes precedence over waiting/none states.
    if (!entry || entry.status !== "confirmed") {
      const [activeTrip] = await db
        .select()
        .from(tripsTable)
        .where(
          and(
            eq(tripsTable.userId, userId),
            eq(tripsTable.flightId, flightId),
            eq(tripsTable.status, "upcoming"),
          ),
        )
        .orderBy(desc(tripsTable.bookedAt))
        .limit(1);
      if (activeTrip) {
        return res.json({
          status: "confirmed",
          queueEntryId: entry?.id ?? null,
          tripId: activeTrip.id,
          confirmedFlight: confirmedFlightDetails(flight),
        });
      }
    }

    if (!entry) {
      return res.json({ status: "none" });
    }

    if (entry.status === "waiting") {
      // Count how many are waiting for this flight to surface totalInQueue
      const [{ value: totalInQueue }] = await db
        .select({ value: count() })
        .from(queueEntriesTable)
        .where(and(eq(queueEntriesTable.flightId, flightId), eq(queueEntriesTable.status, "waiting")));

      // Seats are confirmed automatically by the queue engine at the
      // decision moment — there is no client-side confirm action.
      return res.json({
        status: "waiting",
        queueEntryId: entry.id,
        queuePosition: entry.position,
        totalInQueue: Number(totalInQueue),
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
      confirmedFlight: confirmedFlightDetails(flight),
      manifest: trip ? await flightManifestProgress(trip, entry, flight.international) : undefined,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch flight status" });
  }
});

export default router;
