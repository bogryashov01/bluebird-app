import { Router } from "express";
import crypto from "crypto";
import { db } from "@workspace/db";
import { usersTable, notificationsTable, revokedTokensTable, loginCodesTable } from "@workspace/db/schema";
import { and, eq, lt, sql } from "drizzle-orm";
import { activeSmsProvider, sendSms } from "../lib/sms";
import jwt from "jsonwebtoken";
import { signToken, authMiddleware, hashToken } from "../middlewares/auth";
import { seedDemoDataForUser } from "../lib/seed";

const router = Router();

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

const CODE_TTL_MS = 5 * 60 * 1000; // codes expire after 5 minutes
const RESEND_COOLDOWN_MS = 30 * 1000; // 30s between sends per phone
const MAX_ATTEMPTS = 5; // wrong guesses before the code is invalidated

/**
 * Normalizes a phone number to E.164-ish form: digits only with a leading +.
 * Bare 10-digit numbers are assumed to be US and get a +1 prefix.
 * Returns null when the input can't be a valid phone number.
 */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
}

function makeReferralCode(name: string): string {
  return (name.replace(/\s+/g, "").toUpperCase().slice(0, 4) + Math.random().toString(36).slice(2, 6).toUpperCase());
}

function sanitizeUser<T extends Record<string, unknown>>(user: T) {
  const { ...safeUser } = user;
  return safeUser;
}

// POST /auth/request-code — issue a 6-digit SMS sign-in code (demo: no real
// SMS; the code is logged server-side and returned in the response).
router.post("/request-code", async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  if (!phone) {
    return res.status(400).json({ error: "Enter a valid phone number" });
  }
  const isProd = process.env.NODE_ENV === "production";
  const provider = activeSmsProvider();
  // Production requires a real delivery provider (Twilio env creds or an
  // SMS webhook). Fail loudly instead of silently stranding users.
  if (isProd && provider === "none") {
    return res.status(503).json({ error: "SMS sign-in is not available yet. Delivery is not configured in this environment." });
  }

  try {
    // Cryptographically random 6-digit code; only its hash is stored.
    const code = crypto.randomInt(0, 1000000).toString().padStart(6, "0");
    const values = {
      phone,
      codeHash: hashToken(code),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
      attempts: 0,
      lastSentAt: new Date(),
    };
    // Atomic issuance + cooldown: the conditional upsert only replaces an
    // existing row once its cooldown has elapsed, so concurrent requests
    // cannot each issue a code — exactly one wins, the rest get a 429.
    const issued = await db
      .insert(loginCodesTable)
      .values(values)
      .onConflictDoUpdate({
        target: loginCodesTable.phone,
        set: values,
        setWhere: sql`${loginCodesTable.lastSentAt} <= ${new Date(Date.now() - RESEND_COOLDOWN_MS)}`,
      })
      .returning();
    if (issued.length === 0) {
      const [existing] = await db.select().from(loginCodesTable).where(eq(loginCodesTable.phone, phone));
      const sinceMs = existing ? Date.now() - existing.lastSentAt.getTime() : 0;
      const wait = Math.max(1, Math.ceil((RESEND_COOLDOWN_MS - sinceMs) / 1000));
      return res.status(429).json({ error: `Please wait ${wait}s before requesting another code` });
    }

    // Opportunistic cleanup of expired codes
    await db.delete(loginCodesTable).where(lt(loginCodesTable.expiresAt, new Date()));

    // Deliver only after issuance won the atomic cooldown race.
    if (provider !== "none") {
      try {
        await sendSms(phone, `Your Bluebird sign-in code is ${code}. It expires in ${CODE_TTL_MS / 60000} minutes.`);
      } catch {
        // Explicit failure — don't leave the user waiting for an SMS that
        // never went out. The stored code stays valid for a retry.
        return res.status(502).json({ error: "We couldn't send the SMS. Please try again." });
      }
    }
    if (!isProd) {
      // Demo delivery: the raw code is logged server-side and returned
      // in-band in lieu of (or alongside) a real SMS. NEVER in production.
      console.log(`[sms-code] Sign-in code for ${phone}: ${code}`);
    }

    return res.json({
      message: `We sent a 6-digit code to ${phone}`,
      phone,
      ...(isProd ? {} : { demoCode: code }),
      expiresInSeconds: CODE_TTL_MS / 1000,
      resendCooldownSeconds: RESEND_COOLDOWN_MS / 1000,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to send code" });
  }
});

// POST /auth/verify-code — verify phone + code; creates the account on first
// successful sign-in and returns a JWT.
router.post("/verify-code", async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  if (!phone) {
    return res.status(400).json({ error: "Enter a valid phone number" });
  }
  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: "Enter the 6-digit code" });
  }

  try {
    const [entry] = await db.select().from(loginCodesTable).where(eq(loginCodesTable.phone, phone));
    if (!entry || entry.expiresAt.getTime() < Date.now()) {
      if (entry) await db.delete(loginCodesTable).where(eq(loginCodesTable.phone, phone));
      return res.status(401).json({ error: "Code expired. Request a new one." });
    }
    if (entry.attempts >= MAX_ATTEMPTS) {
      await db.delete(loginCodesTable).where(eq(loginCodesTable.phone, phone));
      return res.status(401).json({ error: "Too many attempts. Request a new code." });
    }
    if (entry.codeHash !== hashToken(code)) {
      // Atomic conditional increment: only rows still under the cap are
      // updated, so concurrent wrong guesses cannot race past MAX_ATTEMPTS.
      const [updated] = await db
        .update(loginCodesTable)
        .set({ attempts: sql`${loginCodesTable.attempts} + 1` })
        .where(and(eq(loginCodesTable.phone, phone), lt(loginCodesTable.attempts, MAX_ATTEMPTS)))
        .returning();
      if (!updated || updated.attempts >= MAX_ATTEMPTS) {
        // Cap reached (by this or a concurrent request) — invalidate the code.
        await db.delete(loginCodesTable).where(eq(loginCodesTable.phone, phone));
        return res.status(401).json({ error: "Too many attempts. Request a new code." });
      }
      return res.status(401).json({ error: "That code isn't right. Check the SMS and try again." });
    }

    // Single-use: consume the code atomically, and only while still under the
    // attempt cap (a concurrent burst of wrong guesses may have exhausted it).
    // If a concurrent request already consumed it, the delete matches nothing
    // and we reject the replay.
    const deleted = await db
      .delete(loginCodesTable)
      .where(and(
        eq(loginCodesTable.phone, phone),
        eq(loginCodesTable.codeHash, entry.codeHash),
        lt(loginCodesTable.attempts, MAX_ATTEMPTS),
      ))
      .returning();
    if (deleted.length === 0) {
      return res.status(401).json({ error: "Code already used or invalidated. Request a new one." });
    }

    // Find or create the member for this phone number.
    let [user] = await db.select().from(usersTable).where(eq(usersTable.phone, phone));
    let isNewUser = false;
    if (!user) {
      isNewUser = true;
      const userId = makeId();
      const name = "Bluebird Member";
      [user] = await db
        .insert(usersTable)
        .values({
          id: userId,
          name,
          phone,
          membershipTier: "base",
          referralCode: makeReferralCode(name),
          linePassCount: 0,
        })
        .returning();

      await db.insert(notificationsTable).values({
        id: makeId(),
        userId,
        title: "Welcome to Bluebird ✈️",
        body: "Your account is ready. Browse available empty legs and join the queue to fly.",
        type: "system",
      });
    }

    // Populate (or backfill) demo trips, queue entry, notifications, passes.
    await seedDemoDataForUser(user.id);

    const [freshUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    const token = signToken(user.id);
    return res.json({ token, user: sanitizeUser(freshUser ?? user), isNewUser });
  } catch (err) {
    return res.status(500).json({ error: "Sign in failed" });
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

// GET /auth/me
router.get("/me", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }
    return res.json(sanitizeUser(user));
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch user" });
  }
});

// PATCH /auth/me — update profile (name, email). The phone number is the
// account identifier and cannot be changed here.
router.patch("/me", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  const { name, email } = req.body ?? {};

  const updates: Record<string, string | null> = {};
  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Name cannot be empty" });
    }
    updates.name = name.trim();
  }
  if (email !== undefined) {
    if (typeof email !== "string") {
      return res.status(400).json({ error: "Invalid email" });
    }
    const trimmed = email.trim().toLowerCase();
    if (trimmed && !/^\S+@\S+\.\S+$/.test(trimmed)) {
      return res.status(400).json({ error: "Enter a valid email address" });
    }
    updates.email = trimmed || null;
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  try {
    const [updated] = await db
      .update(usersTable)
      .set(updates)
      .where(eq(usersTable.id, userId))
      .returning();
    if (!updated) return res.status(401).json({ error: "User not found" });
    return res.json(sanitizeUser(updated));
  } catch (err) {
    return res.status(500).json({ error: "Failed to update profile" });
  }
});

export default router;
