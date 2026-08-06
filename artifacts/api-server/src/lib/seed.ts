import { db } from "@workspace/db";
import { flightsTable } from "@workspace/db/schema";
import { eq, count } from "drizzle-orm";
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
