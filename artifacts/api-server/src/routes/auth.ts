import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable, notificationsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { signToken, authMiddleware } from "../middlewares/auth";
import { seedDemoDataForUser } from "../lib/seed";

const router = Router();

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function makeReferralCode(name: string): string {
  return (name.replace(/\s+/g, "").toUpperCase().slice(0, 4) + Math.random().toString(36).slice(2, 6).toUpperCase());
}

// POST /auth/register
router.post("/register", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: "Name, email, and password are required" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }

  try {
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase()));
    if (existing) {
      return res.status(400).json({ error: "An account with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userId = makeId();
    const referralCode = makeReferralCode(name);

    const [user] = await db
      .insert(usersTable)
      .values({
        id: userId,
        name,
        email: email.toLowerCase(),
        passwordHash,
        referralCode,
        membershipTier: "base",
        emailVerified: false,
        linePassCount: 0,
      })
      .returning();

    // Welcome notification
    await db.insert(notificationsTable).values({
      id: makeId(),
      userId,
      title: "Welcome to Bluebird ✈️",
      body: "Your account is ready. Browse available empty legs and join the queue to fly.",
      type: "system",
    });

    // Populate demo trips, queue entry, notifications, and welcome line passes
    await seedDemoDataForUser(userId);

    // Re-read so the response reflects seeded line passes
    const [freshUser] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    const token = signToken(userId);
    const { passwordHash: _, ...safeUser } = freshUser ?? user;
    return res.status(201).json({ token, user: safeUser });
  } catch (err) {
    return res.status(500).json({ error: "Registration failed" });
  }
});

// POST /auth/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase()));
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Backfill demo data for accounts created before demo seeding existed
    await seedDemoDataForUser(user.id);

    const [freshUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    const token = signToken(user.id);
    const { passwordHash: _, ...safeUser } = freshUser ?? user;
    return res.json({ token, user: safeUser });
  } catch (err) {
    return res.status(500).json({ error: "Login failed" });
  }
});

// GET /auth/me
router.get("/me", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }
    const { passwordHash: _, ...safeUser } = user;
    return res.json(safeUser);
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch user" });
  }
});

export default router;
