import { Router } from "express";
import { db } from "@workspace/db";
import { flightsTable } from "@workspace/db/schema";
import { eq, ilike, and } from "drizzle-orm";
import { authMiddleware } from "../middlewares/auth";

const router = Router();

// GET /flights
router.get("/", authMiddleware, async (req, res) => {
  try {
    const { from, to } = req.query;
    let query = db.select().from(flightsTable).$dynamic();

    const conditions = [];
    if (from) conditions.push(ilike(flightsTable.fromCity, `%${from}%`));
    if (to) conditions.push(ilike(flightsTable.toCity, `%${to}%`));
    if (conditions.length > 0) query = query.where(and(...conditions));

    const flights = await query.orderBy(flightsTable.departureDate);
    return res.json(flights);
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch flights" });
  }
});

// GET /flights/:id
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const [flight] = await db.select().from(flightsTable).where(eq(flightsTable.id, String(req.params.id)));
    if (!flight) {
      return res.status(404).json({ error: "Flight not found" });
    }
    return res.json(flight);
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch flight" });
  }
});

export default router;
