import { Router } from "express";
import crypto from "crypto";
import { db } from "@workspace/db";
import {
  usersTable,
  notificationsTable,
  referralRewardsTable,
  revokedTokensTable,
  loginCodesTable,
  registrationGrantsTable,
  NOTIFICATION_DELIVERY_CHANNELS,
  type NotificationDeliveryChannel,
} from "@workspace/db/schema";
import { and, eq, lt, sql } from "drizzle-orm";
import { activeSmsProvider, sendSms } from "../lib/sms";
import jwt from "jsonwebtoken";
import { signToken, authMiddleware, hashToken } from "../middlewares/auth";
import { seedDemoDataForUser } from "../lib/seed";
import { isCatalogAirportCode } from "../lib/airport-catalog";

const router = Router();

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

const CODE_TTL_MS = 5 * 60 * 1000; // codes expire after 5 minutes
const RESEND_COOLDOWN_MS = 30 * 1000; // 30s between sends per phone
const MAX_ATTEMPTS = 5; // wrong guesses before the code is invalidated
const REGISTRATION_GRANT_TTL_MS = 10 * 60 * 1000;

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
  const prefix = name.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 4).padEnd(4, "X");
  return prefix + crypto.randomBytes(5).toString("hex").slice(0, 6).toUpperCase();
}

function sanitizeUser<T extends Record<string, unknown>>(user: T) {
  const { homeAirport: _legacyHomeAirport, ...safeUser } = user;
  return {
    ...safeUser,
    homeAirports: Array.isArray(user.homeAirports) ? user.homeAirports : [],
    notificationChannel: isNotificationDeliveryChannel(user.notificationChannel)
      ? user.notificationChannel
      : "app",
  };
}

function isNotificationDeliveryChannel(value: unknown): value is NotificationDeliveryChannel {
  return typeof value === "string"
    && (NOTIFICATION_DELIVERY_CHANNELS as readonly string[]).includes(value);
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

// POST /auth/verify-code — verify phone + code, then either sign in an
// existing user or issue a short-lived grant for profile completion.
router.post("/verify-code", async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  const referralCode = typeof req.body?.referralCode === "string" ? req.body.referralCode.trim().toUpperCase() : "";
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

    const [user] = await db.select().from(usersTable).where(eq(usersTable.phone, phone));
    if (!user) {
      const registrationGrant = crypto.randomBytes(32).toString("base64url");
      const values = {
        grantHash: hashToken(registrationGrant),
        phone,
        expiresAt: new Date(Date.now() + REGISTRATION_GRANT_TTL_MS),
      };
      await db
        .insert(registrationGrantsTable)
        .values(values)
        .onConflictDoUpdate({ target: registrationGrantsTable.phone, set: values });
      await db.delete(registrationGrantsTable).where(lt(registrationGrantsTable.expiresAt, new Date()));
      return res.json({
        outcome: "registration_required",
        registrationGrant,
        registrationGrantExpiresInSeconds: REGISTRATION_GRANT_TTL_MS / 1000,
      });
    }

    // Populate (or backfill) demo trips, queue entry, notifications, passes.
    // Non-members get none of this — trips, queues, and passes are member
    // features they haven't purchased yet.
    if (user.membershipTier !== "none") {
      await seedDemoDataForUser(user.id);
    }

    const [freshUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    let referralFeedback: "invalid_code" | "self_referral" | "already_used" | undefined;
    if (referralCode) {
      const matches = await db
        .select({ id: usersTable.id, membershipTier: usersTable.membershipTier })
        .from(usersTable)
        .where(eq(usersTable.referralCode, referralCode));
      if (matches.length !== 1) referralFeedback = "invalid_code";
      else if (matches[0].id === user.id) referralFeedback = "self_referral";
      else if (matches[0].membershipTier === "none") referralFeedback = "invalid_code";
      else referralFeedback = "already_used";
    }
    const token = signToken(user.id);
    return res.json({
      outcome: "signed_in",
      token,
      user: sanitizeUser(freshUser ?? user),
      ...(referralFeedback ? { referralFeedback } : {}),
    });
  } catch (err) {
    return res.status(500).json({ error: "Sign in failed" });
  }
});

router.post("/complete-registration", async (req, res) => {
  const registrationGrant = typeof req.body?.registrationGrant === "string" ? req.body.registrationGrant.trim() : "";
  const firstName = typeof req.body?.firstName === "string" ? req.body.firstName.trim() : "";
  const lastName = typeof req.body?.lastName === "string" ? req.body.lastName.trim() : "";
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const referralCode = typeof req.body?.referralCode === "string" ? req.body.referralCode.trim().toUpperCase() : "";
  if (!registrationGrant) return res.status(401).json({ error: "Phone verification expired. Request a new code." });
  if (firstName.length < 1 || firstName.length > 40) return res.status(400).json({ error: "Enter your first name" });
  if (lastName.length < 1 || lastName.length > 40) return res.status(400).json({ error: "Enter your last name" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: "Enter a valid email address" });
  }

  try {
    const grantHash = hashToken(registrationGrant);
    const result = await db.transaction(async (tx) => {
      const [grant] = await tx.select().from(registrationGrantsTable).where(eq(registrationGrantsTable.grantHash, grantHash));
      if (!grant || grant.expiresAt.getTime() < Date.now()) return { status: 401 as const, error: "Phone verification expired. Request a new code." };
      // Email is profile data rather than the account identifier, but two
      // registrations still must not race past the conflict check.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${email}))`);
      const [phoneConflict] = await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.phone, grant.phone));
      if (phoneConflict) return { status: 409 as const, error: "An account already exists for this phone. Sign in instead." };
      const [emailConflict] = await tx.select({ id: usersTable.id }).from(usersTable).where(sql`lower(${usersTable.email}) = ${email}`);
      if (emailConflict) return { status: 409 as const, error: "That email is already connected to another account." };

      const consumed = await tx
        .delete(registrationGrantsTable)
        .where(and(eq(registrationGrantsTable.grantHash, grantHash), sql`${registrationGrantsTable.expiresAt} > NOW()`))
        .returning();
      if (consumed.length === 0) return { status: 401 as const, error: "Phone verification expired or was already used. Request a new code." };

      const name = `${firstName} ${lastName}`;
      const userId = makeId();
      let newReferralCode = "";
      for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = makeReferralCode(name);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${candidate}))`);
        const [collision] = await tx
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(eq(usersTable.referralCode, candidate));
        if (!collision) {
          newReferralCode = candidate;
          break;
        }
      }
      if (!newReferralCode) throw new Error("Could not allocate a unique referral code");
      let inviter: typeof usersTable.$inferSelect | undefined;
      let referralFeedback: "reward_granted" | "invalid_code" | "self_referral" | "already_used" | undefined;
      if (referralCode) {
        const matches = await tx.select().from(usersTable).where(eq(usersTable.referralCode, referralCode));
        inviter = matches.length === 1 && matches[0].membershipTier !== "none" ? matches[0] : undefined;
        if (!inviter) referralFeedback = "invalid_code";
        else if (inviter.phone === grant.phone || inviter.email?.toLowerCase() === email) {
          inviter = undefined;
          referralFeedback = "self_referral";
        }
      }
      const [user] = await tx.insert(usersTable).values({
        id: userId,
        name,
        phone: grant.phone,
        email,
        membershipTier: "none",
        referralCode: newReferralCode,
        referredBy: inviter?.referralCode,
        linePassCount: inviter ? 1 : 0,
      }).returning();
      if (inviter) {
        const [reward] = await tx
          .insert(referralRewardsTable)
          .values({
            id: makeId(),
            inviterUserId: inviter.id,
            friendUserId: user.id,
            referralCode: inviter.referralCode,
          })
          .onConflictDoNothing({ target: referralRewardsTable.friendUserId })
          .returning();
        if (reward) {
          await tx
            .update(usersTable)
            .set({ linePassCount: sql`${usersTable.linePassCount} + 1` })
            .where(eq(usersTable.id, inviter.id));
          await tx.insert(notificationsTable).values([
            {
              id: makeId(),
              userId: inviter.id,
              title: "Your referral joined",
              body: `${name} joined Bluebird. Your Skip the Line Pass is ready.`,
              type: "referral",
            },
            {
              id: makeId(),
              userId,
              title: "Referral pass added",
              body: "You and your friend each received one Skip the Line Pass.",
              type: "referral",
            },
          ]);
          referralFeedback = "reward_granted";
        } else {
          referralFeedback = "already_used";
        }
      }
      await tx.insert(notificationsTable).values({
        id: makeId(),
        userId,
        title: "Welcome to Bluebird",
        body: "Your account is ready. Browse available empty legs — join Bluebird to queue for a seat.",
        type: "system",
      });
      return { status: 200 as const, user, referralFeedback };
    });
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    return res.json({
      token: signToken(result.user.id),
      user: sanitizeUser(result.user),
      ...(result.referralFeedback ? { referralFeedback: result.referralFeedback } : {}),
    });
  } catch (err) {
    return res.status(500).json({ error: "Could not create your account. Please try again." });
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

// PATCH /auth/me — update profile (name, email, preferred airports). The phone number is the
// account identifier and cannot be changed here.
router.patch("/me", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  const { name, email, weightKg, homeAirports, notificationChannel } = req.body ?? {};

  const updates: {
    name?: string;
    email?: string | null;
    weightKg?: number | null;
    homeAirports?: string[];
    notificationChannel?: NotificationDeliveryChannel;
  } = {};
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
  if (weightKg !== undefined) {
    if (weightKg === null || (typeof weightKg === "string" && weightKg.trim() === "")) {
      updates.weightKg = null;
    } else {
      const normalized = typeof weightKg === "number"
        ? weightKg
        : typeof weightKg === "string"
          ? Number(weightKg.trim())
          : Number.NaN;
      if (!Number.isFinite(normalized) || normalized < 1 || normalized > 500) {
        return res.status(400).json({ error: "Weight must be between 1 and 500 kg" });
      }
      updates.weightKg = normalized;
    }
  }
  if (homeAirports !== undefined) {
    if (!Array.isArray(homeAirports)) {
      return res.status(400).json({ error: "homeAirports must be an array of airport codes" });
    }
    if (homeAirports.length > 20) {
      return res.status(400).json({ error: "Select no more than 20 airports" });
    }
    const normalized: string[] = [];
    for (const value of homeAirports) {
      if (typeof value !== "string" || !/^[A-Za-z]{3,4}$/.test(value.trim())) {
        return res.status(400).json({ error: "Enter valid airport codes" });
      }
      const code = value.trim().toUpperCase();
      if (!isCatalogAirportCode(code)) {
        return res.status(400).json({ error: `Unknown airport code: ${code}` });
      }
      if (!normalized.includes(code)) normalized.push(code);
    }
    updates.homeAirports = normalized;
  }
  if (notificationChannel !== undefined) {
    if (!isNotificationDeliveryChannel(notificationChannel)) {
      return res.status(400).json({ error: "notificationChannel must be app, email, or both" });
    }
    updates.notificationChannel = notificationChannel;
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
