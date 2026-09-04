import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, notificationsTable, tripsTable, flightsTable } from "@workspace/db/schema";
import { authMiddleware } from "../middlewares/auth";
import { and, eq, sql } from "drizzle-orm";

const router = Router();

const MEMBERSHIP_FEATURES: Record<string, string[]> = {
  base: [
    "Browse empty leg flights",
    "Join the queue for any flight",
    "Flight notifications",
    "Member community access",
  ],
  plus: [
    "Everything in Base",
    "5 Skip the Line passes / month",
    "Priority customer support",
    "International flight access",
    "Guest pass for one",
  ],
  concierge: [
    "Everything in Plus",
    "Unlimited Skip the Line passes",
    "AI Concierge 24/7",
    "Dedicated flight coordinator",
    "First-class lounge access",
    "Custom flight requests",
  ],
};

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

const TIER_ORDER: Record<string, number> = { none: -1, base: 0, plus: 1, concierge: 2 };

// Purchasable plan catalog surfaced to clients (e.g. the non-member
// membership-required screen). Pricing mirrors the app's plan screens.
const PLAN_CATALOG = [
  { id: "base" as const, label: "Base", priceMonthlyUsd: 99, features: MEMBERSHIP_FEATURES.base },
  { id: "plus" as const, label: "Plus", priceMonthlyUsd: 995, features: MEMBERSHIP_FEATURES.plus },
  { id: "concierge" as const, label: "Concierge", priceMonthlyUsd: 799, features: MEMBERSHIP_FEATURES.concierge },
];

function renewalDate(): string {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Annual flight allowance per tier (calendar year).
const ANNUAL_FLIGHT_ALLOWANCE: Record<string, number> = { base: 10, plus: 20, concierge: 40 };

async function membershipStats(user: { id: string }) {
  const completed = await db
    .select({ priceUsd: flightsTable.priceUsd, departureDate: flightsTable.departureDate, bookedAt: tripsTable.bookedAt })
    .from(tripsTable)
    .innerJoin(flightsTable, eq(tripsTable.flightId, flightsTable.id))
    .where(and(eq(tripsTable.userId, user.id), eq(tripsTable.status, "completed")));

  const totalSavedUsd = completed.reduce((sum, t) => sum + (t.priceUsd ?? 0), 0);
  const lifetimeCompletedFlights = completed.length;

  const year = String(new Date().getFullYear());
  const flightsThisYear = completed.filter(
    (t) => (t.departureDate ?? "").startsWith(year) || t.bookedAt.getFullYear().toString() === year
  ).length;

  return {
    totalSavedUsd,
    lifetimeCompletedFlights,
    flightsThisYear,
  };
}

async function membershipPayload(user: {
  id: string;
  membershipTier: string;
  linePassCount: number;
  pendingTier: string | null;
  referralCode: string;
}) {
  const tier = user.membershipTier as "none" | "base" | "plus" | "concierge";
  const stats = await membershipStats(user);
  return {
    tier,
    linePassCount: user.linePassCount,
    features: MEMBERSHIP_FEATURES[tier] ?? [],
    renewalDate: renewalDate(),
    annualFlightAllowance: ANNUAL_FLIGHT_ALLOWANCE[tier] ?? 0,
    plans: PLAN_CATALOG,
    ...stats,
    ...(user.pendingTier ? { pendingTier: user.pendingTier } : {}),
  };
}

// GET /membership
router.get("/", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) return res.status(404).json({ error: "User not found" });

    return res.json(await membershipPayload(user));
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch membership" });
  }
});

// POST /membership/upgrade
// NOTE: This endpoint is demo-only — it upgrades membership without payment verification.
// In production, gate this behind verified billing entitlements before enabling.
router.post("/upgrade", authMiddleware, async (req, res) => {
  if (process.env.DEMO_MODE !== "true" && process.env.NODE_ENV !== "development") {
    return res.status(501).json({
      error: "Membership upgrades require a payment provider integration in production. Set DEMO_MODE=true to enable the demo upgrade flow.",
    });
  }
  const userId = (req as any).userId;
  const { tier } = req.body;

  // "base" is purchasable too — that's how a non-member joins Bluebird.
  if (!tier || !["base", "plus", "concierge"].includes(tier)) {
    return res.status(400).json({ error: "Invalid tier. Choose 'base', 'plus' or 'concierge'" });
  }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) return res.status(404).json({ error: "User not found" });

    if (TIER_ORDER[tier] <= (TIER_ORDER[user.membershipTier] ?? -1)) {
      return res.status(400).json({ error: "You can only upgrade to a higher tier than your current plan" });
    }

    const wasNonMember = user.membershipTier === "none";
    const bonusPasses = tier === "base" ? 0 : tier === "plus" ? 5 : 10;
    const [updated] = await db
      .update(usersTable)
      .set({
        membershipTier: tier,
        linePassCount: sql`${usersTable.linePassCount} + ${bonusPasses}`,
        pendingTier: null,
      })
      .where(eq(usersTable.id, userId))
      .returning();
    if (!updated) return res.status(404).json({ error: "User not found" });

    const label = tier.charAt(0).toUpperCase() + tier.slice(1);
    await db.insert(notificationsTable).values({
      id: makeId(),
      userId,
      title: `Welcome to ${label}! ✨`,
      body: wasNonMember
        ? `Your Bluebird ${label} membership is active. You can now join flight queues${bonusPasses > 0 ? ` — ${bonusPasses} Skip the Line passes added` : ""}.`
        : `Your membership has been upgraded to ${label}. ${bonusPasses} Skip the Line passes added.`,
      type: "membership",
    });

    return res.json(await membershipPayload(updated));
  } catch (err) {
    return res.status(500).json({ error: "Failed to upgrade membership" });
  }
});

// POST /membership/buy-pass
// Demo-only checkout: adds one Skip the Line pass ($2,000, never billed).
// Gated exactly like the demo upgrade above.
router.post("/buy-pass", authMiddleware, async (req, res) => {
  if (process.env.DEMO_MODE !== "true" && process.env.NODE_ENV !== "development") {
    return res.status(501).json({
      error: "Pass purchases require a payment provider integration in production. Set DEMO_MODE=true to enable the demo checkout.",
    });
  }
  const userId = (req as any).userId;
  try {
    // Pass purchases are a member feature — non-members must join first.
    const [buyer] = await db
      .select({ membershipTier: usersTable.membershipTier })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    if (!buyer) return res.status(404).json({ error: "User not found" });
    if (buyer.membershipTier === "none") {
      return res.status(403).json({
        error: "A Bluebird membership is required to buy Skip the Line passes. Choose a plan to join.",
        code: "MEMBERSHIP_REQUIRED",
      });
    }

    const [updated] = await db
      .update(usersTable)
      .set({ linePassCount: sql`${usersTable.linePassCount} + 1` })
      .where(eq(usersTable.id, userId))
      .returning({ linePassCount: usersTable.linePassCount });
    if (!updated) return res.status(404).json({ error: "User not found" });

    await db.insert(notificationsTable).values({
      id: makeId(),
      userId,
      title: "Skip the Line pass purchased ⚡",
      body: "1 Skip the Line pass has been added to your account ($2,000 demo checkout — no real charge).",
      type: "membership",
    });

    return res.json({ linePassCount: updated.linePassCount });
  } catch (err) {
    return res.status(500).json({ error: "Failed to purchase pass" });
  }
});

// POST /membership/change
// Schedules a downgrade or cancellation effective at the next renewal date,
// or reverts a pending change. Mirrors the demo-only upgrade endpoint.
router.post("/change", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  const { action, tier } = req.body ?? {};

  if (!["downgrade", "cancel", "revert"].includes(action)) {
    return res.status(400).json({ error: "Invalid action. Choose 'downgrade', 'cancel', or 'revert'" });
  }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) return res.status(404).json({ error: "User not found" });

    const effective = renewalDate();
    let pendingTier: string | null;
    let title: string;
    let body: string;

    if (action === "downgrade") {
      if (!tier || !["base", "plus"].includes(tier)) {
        return res.status(400).json({ error: "Invalid tier. Choose 'base' or 'plus'" });
      }
      if (TIER_ORDER[tier] >= TIER_ORDER[user.membershipTier]) {
        return res.status(400).json({ error: "You can only downgrade to a lower tier than your current plan" });
      }
      pendingTier = tier;
      const label = tier.charAt(0).toUpperCase() + tier.slice(1);
      title = `Downgrade scheduled`;
      body = `Your membership will change to ${label} on ${effective}. You keep your current benefits until then.`;
    } else if (action === "cancel") {
      pendingTier = "cancelled";
      title = `Cancellation scheduled`;
      body = `Your membership will end on ${effective}. You keep your benefits until then.`;
    } else {
      if (!user.pendingTier) {
        return res.status(400).json({ error: "No pending plan change to revert" });
      }
      pendingTier = null;
      title = `Plan change reverted`;
      body = `Your ${user.membershipTier} membership will continue as usual.`;
    }

    const [updated] = await db
      .update(usersTable)
      .set({ pendingTier })
      .where(eq(usersTable.id, userId))
      .returning();

    await db.insert(notificationsTable).values({
      id: makeId(),
      userId,
      title,
      body,
      type: "membership",
    });

    return res.json(await membershipPayload(updated));
  } catch (err) {
    return res.status(500).json({ error: "Failed to update membership" });
  }
});

export default router;
