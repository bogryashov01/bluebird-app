import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable, notificationsTable, revokedTokensTable } from "@workspace/db/schema";
import { and, eq, gt, lt } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { signToken, authMiddleware, hashToken, requireVerifiedEmail } from "../middlewares/auth";
import { seedDemoDataForUser } from "../lib/seed";

const router = Router();

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Creates a fresh single-use verification token for a user, stores only its
 * hash + expiry, and logs the link a real email provider would send (demo
 * environment — no outbound email). Returns the raw token so the demo client
 * can complete verification in-app in place of clicking the emailed link.
 */
async function issueVerificationToken(userId: string, email: string): Promise<string> {
  const rawToken = crypto.randomBytes(32).toString("hex");
  await db
    .update(usersTable)
    .set({
      verificationTokenHash: hashToken(rawToken),
      verificationTokenExpires: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
    })
    .where(eq(usersTable.id, userId));
  console.log(`[email-verification] Verification link for ${email}: https://bluebird.app/verify?token=${rawToken}`);
  return rawToken;
}

function makeReferralCode(name: string): string {
  return (name.replace(/\s+/g, "").toUpperCase().slice(0, 4) + Math.random().toString(36).slice(2, 6).toUpperCase());
}

// POST /auth/register
router.post("/register", async (req, res) => {
  const { firstName, lastName, name: legacyName, email, password } = req.body;
  // Accept new firstName/lastName fields, falling back to the legacy single
  // name field so older clients keep working. Stored as one full name.
  const name =
    typeof firstName === "string" && firstName.trim()
      ? `${firstName.trim()}${typeof lastName === "string" && lastName.trim() ? ` ${lastName.trim()}` : ""}`
      : typeof legacyName === "string"
        ? legacyName.trim()
        : "";
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
    // Issue the email-verification token (link is logged in this demo env;
    // the raw token is returned so the app can stand in for the email click).
    const demoVerificationToken = await issueVerificationToken(userId, email.toLowerCase());

    const [freshUser] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    const token = signToken(userId);
    const { passwordHash: _, verificationTokenHash: __, verificationTokenExpires: ___, ...safeUser } = freshUser ?? user;
    return res.status(201).json({ token, user: safeUser, demoVerificationToken });
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
    const { passwordHash: _, verificationTokenHash: __, verificationTokenExpires: ___, ...safeUser } = freshUser ?? user;
    return res.json({ token, user: safeUser });
  } catch (err) {
    return res.status(500).json({ error: "Login failed" });
  }
});

// POST /auth/logout — revoke the caller's current token
router.post("/logout", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  const token = (req as any).token as string;
  try {
    // Denylist the token until its natural expiry
    const decoded = jwt.decode(token) as { exp?: number } | null;
    const expiresAt = decoded?.exp
      ? new Date(decoded.exp * 1000)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await db
      .insert(revokedTokensTable)
      .values({ tokenHash: hashToken(token), userId, expiresAt })
      .onConflictDoNothing();
    // Opportunistic cleanup of entries past their token expiry
    await db.delete(revokedTokensTable).where(lt(revokedTokensTable.expiresAt, new Date()));
    return res.json({ message: "Signed out" });
  } catch (err) {
    return res.status(500).json({ error: "Logout failed" });
  }
});

// POST /auth/resend-verification — rotate the token and re-log the link (demo email)
router.post("/resend-verification", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }
    if (user.emailVerified) {
      return res.json({ message: "Email already verified" });
    }
    const demoVerificationToken = await issueVerificationToken(user.id, user.email);
    return res.json({ message: `Verification email sent to ${user.email}`, demoVerificationToken });
  } catch (err) {
    return res.status(500).json({ error: "Failed to resend verification email" });
  }
});

// POST /auth/verify-email — consume a single-use, expiring verification token
router.post("/verify-email", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  const { token } = req.body ?? {};
  if (typeof token !== "string" || !token) {
    return res.status(400).json({ error: "Verification token is required" });
  }
  try {
    // Atomic single-use consumption: the update only matches when the token
    // hash is current, unexpired, and the account is still unverified — so
    // replayed, expired, rotated-out, or concurrent duplicate tokens all fail.
    const [updated] = await db
      .update(usersTable)
      .set({ emailVerified: true, verificationTokenHash: null, verificationTokenExpires: null })
      .where(
        and(
          eq(usersTable.id, userId),
          eq(usersTable.emailVerified, false),
          eq(usersTable.verificationTokenHash, hashToken(token)),
          gt(usersTable.verificationTokenExpires, new Date()),
        ),
      )
      .returning();
    if (!updated) {
      return res.status(400).json({ error: "Invalid or expired verification link. Request a new one." });
    }
    const { passwordHash: _, verificationTokenHash: __, verificationTokenExpires: ___, ...safeUser } = updated;
    return res.json(safeUser);
  } catch (err) {
    return res.status(500).json({ error: "Failed to verify email" });
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
    const { passwordHash: _, verificationTokenHash: __, verificationTokenExpires: ___, ...safeUser } = user;
    return res.json(safeUser);
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch user" });
  }
});

// PATCH /auth/me — update profile (name, email, phone)
router.patch("/me", authMiddleware, requireVerifiedEmail, async (req, res) => {
  const userId = (req as any).userId;
  const { name, email, phone } = req.body ?? {};

  const updates: Record<string, string | null> = {};
  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Name cannot be empty" });
    }
    updates.name = name.trim();
  }
  if (email !== undefined) {
    if (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ error: "Enter a valid email address" });
    }
    updates.email = email.trim().toLowerCase();
  }
  if (phone !== undefined) {
    if (typeof phone !== "string") {
      return res.status(400).json({ error: "Invalid phone number" });
    }
    updates.phone = phone.trim() || null;
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  try {
    if (updates.email) {
      const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, updates.email));
      if (existing && existing.id !== userId) {
        return res.status(400).json({ error: "An account with this email already exists" });
      }
    }
    const [updated] = await db
      .update(usersTable)
      .set(updates)
      .where(eq(usersTable.id, userId))
      .returning();
    if (!updated) return res.status(401).json({ error: "User not found" });
    const { passwordHash: _, verificationTokenHash: __, verificationTokenExpires: ___, ...safeUser } = updated;
    return res.json(safeUser);
  } catch (err) {
    return res.status(500).json({ error: "Failed to update profile" });
  }
});

export default router;
