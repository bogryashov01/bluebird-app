import { Router } from "express";
import { db } from "@workspace/db";
import { tripsTable, flightsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { authMiddleware } from "../middlewares/auth";

const router = Router();

// GET /trips
router.get("/", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  try {
    const trips = await db.select().from(tripsTable).where(eq(tripsTable.userId, userId)).orderBy(tripsTable.bookedAt);
    const enriched = await Promise.all(
      trips.map(async (trip) => {
        const [flight] = await db.select().from(flightsTable).where(eq(flightsTable.id, trip.flightId));
        return { ...trip, flight };
      })
    );
    return res.json(enriched);
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch trips" });
  }
});

export default router;
