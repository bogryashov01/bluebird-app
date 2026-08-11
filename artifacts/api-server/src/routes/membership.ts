import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, notificationsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { authMiddleware, requireVerifiedEmail } from "../middlewares/auth";

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
    "2 Skip the Line passes / month",
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

const TIER_ORDER: Record<string, number> = { base: 0, plus: 1, concierge: 2 };

function renewalDate(): string {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function membershipPayload(user: { membershipTier: string; linePassCount: number; pendingTier: string | null }) {
  const tier = user.membershipTier as "base" | "plus" | "concierge";
  return {
    tier,
    linePassCount: user.linePassCount,
    features: MEMBERSHIP_FEATURES[tier] ?? MEMBERSHIP_FEATURES.base,
    renewalDate: renewalDate(),
    ...(user.pendingTier ? { pendingTier: user.pendingTier } : {}),
  };
}

// GET /membership
router.get("/", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) return res.status(404).json({ error: "User not found" });

    return res.json(membershipPayload(user));
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch membership" });
  }
});

// POST /membership/upgrade
// NOTE: This endpoint is demo-only — it upgrades membership without payment verification.
// In production, gate this behind verified billing entitlements before enabling.
router.post("/upgrade", authMiddleware, requireVerifiedEmail, async (req, res) => {
  if (process.env.DEMO_MODE !== "true" && process.env.NODE_ENV !== "development") {
    return res.status(501).json({
      error: "Membership upgrades require a payment provider integration in production. Set DEMO_MODE=true to enable the demo upgrade flow.",
    });
  }
  const userId = (req as any).userId;
  const { tier } = req.body;

  if (!tier || !["plus", "concierge"].includes(tier)) {
    return res.status(400).json({ error: "Invalid tier. Choose 'plus' or 'concierge'" });
  }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) return res.status(404).json({ error: "User not found" });

    const bonusPasses = tier === "plus" ? 2 : 10;
    const [updated] = await db
      .update(usersTable)
      .set({
        membershipTier: tier,
        linePassCount: user.linePassCount + bonusPasses,
        pendingTier: null, // an upgrade supersedes any scheduled downgrade/cancellation
      })
      .where(eq(usersTable.id, userId))
      .returning();

    // Notification
    await db.insert(notificationsTable).values({
      id: makeId(),
      userId,
      title: `Upgraded to ${tier.charAt(0).toUpperCase() + tier.slice(1)} ✨`,
      body: `Welcome to ${tier} membership! You've received ${bonusPasses} Skip the Line passes.`,
      type: "membership",
    });

    return res.json(membershipPayload(updated));
  } catch (err) {
    return res.status(500).json({ error: "Failed to upgrade membership" });
  }
});

// POST /membership/change
// Schedules a downgrade or cancellation effective at the next renewal date,
// or reverts a pending change. Mirrors the demo-only upgrade endpoint.
router.post("/change", authMiddleware, requireVerifiedEmail, async (req, res) => {
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

    return res.json(membershipPayload(updated));
  } catch (err) {
    return res.status(500).json({ error: "Failed to update membership" });
  }
});

export default router;
