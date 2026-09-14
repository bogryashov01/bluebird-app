import { Router } from "express";
import { db } from "@workspace/db";
import { savedPassengersTable } from "@workspace/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { authMiddleware } from "../middlewares/auth";

const router = Router();

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function cleanText(value: unknown, maxLength = 100): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function optionalText(value: unknown, maxLength: number): string | null {
  const result = cleanText(value, maxLength);
  return result || null;
}

function identityKey(firstName: string, lastName: string): string {
  return `${firstName}:${lastName}`.toLocaleLowerCase().replace(/\s+/g, " ");
}

function parseInput(body: any) {
  const firstName = cleanText(body?.firstName);
  const lastName = cleanText(body?.lastName);
  const weightKg = typeof body?.weightKg === "number" ? body.weightKg : Number(body?.weightKg);
  if (!firstName || !lastName) return { error: "First and last name are required." as const };
  if (!Number.isFinite(weightKg) || weightKg < 1 || weightKg > 500) {
    return { error: "Weight must be between 1 and 500 kg." as const };
  }
  const email = optionalText(body?.email, 255)?.toLowerCase() ?? null;
  if (email && !/^\S+@\S+\.\S+$/.test(email)) {
    return { error: "Enter a valid email address." as const };
  }
  return {
    value: {
      firstName,
      lastName,
      phone: optionalText(body?.phone, 40),
      email,
      weightKg,
      identityKey: identityKey(firstName, lastName),
    },
  };
}

function response(row: any) {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone ?? null,
    email: row.email ?? null,
    weightKg: row.weightKg,
    createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
    updatedAt: row.updatedAt?.toISOString?.() ?? row.updatedAt,
  };
}

router.get("/", authMiddleware, async (req, res) => {
  const rows = await db.select().from(savedPassengersTable)
    .where(eq(savedPassengersTable.userId, (req as any).userId))
    .orderBy(asc(savedPassengersTable.lastName), asc(savedPassengersTable.firstName));
  return res.json(rows.map(response));
});

router.post("/", authMiddleware, async (req, res) => {
  const parsed = parseInput(req.body);
  if ("error" in parsed) return res.status(400).json({ error: parsed.error });
  const userId = (req as any).userId;
  const existing = await db.select().from(savedPassengersTable).where(and(
    eq(savedPassengersTable.userId, userId),
    eq(savedPassengersTable.identityKey, parsed.value.identityKey),
  ));
  if (existing[0]) {
    const [updated] = await db.update(savedPassengersTable).set({
      ...parsed.value,
      updatedAt: new Date(),
    }).where(and(
      eq(savedPassengersTable.id, existing[0].id),
      eq(savedPassengersTable.userId, userId),
    )).returning();
    return res.json(response(updated));
  }
  try {
    const [created] = await db.insert(savedPassengersTable).values({
      id: makeId(),
      userId,
      ...parsed.value,
    }).returning();
    return res.status(201).json(response(created));
  } catch (err: any) {
    if (err?.code === "23505") return res.status(409).json({ error: "A passenger with this name is already saved." });
    return res.status(500).json({ error: "Unable to save passenger." });
  }
});

router.put("/:id", authMiddleware, async (req, res) => {
  const parsed = parseInput(req.body);
  if ("error" in parsed) return res.status(400).json({ error: parsed.error });
  const userId = (req as any).userId;
  const duplicate = await db.select({ id: savedPassengersTable.id }).from(savedPassengersTable).where(and(
    eq(savedPassengersTable.userId, userId),
    eq(savedPassengersTable.identityKey, parsed.value.identityKey),
  ));
  if (duplicate[0] && duplicate[0].id !== String(req.params.id)) {
    return res.status(409).json({ error: "A passenger with this name is already saved." });
  }
  const [updated] = await db.update(savedPassengersTable).set({
    ...parsed.value,
    updatedAt: new Date(),
  }).where(and(
    eq(savedPassengersTable.id, String(req.params.id)),
    eq(savedPassengersTable.userId, userId),
  )).returning();
  if (!updated) return res.status(404).json({ error: "Passenger not found." });
  return res.json(response(updated));
});

router.delete("/:id", authMiddleware, async (req, res) => {
  const [deleted] = await db.delete(savedPassengersTable).where(and(
    eq(savedPassengersTable.id, String(req.params.id)),
    eq(savedPassengersTable.userId, (req as any).userId),
  )).returning({ id: savedPassengersTable.id });
  if (!deleted) return res.status(404).json({ error: "Passenger not found." });
  return res.json({ success: true });
});

export default router;