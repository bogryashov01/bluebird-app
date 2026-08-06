import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, notificationsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { authMiddleware } from "../middlewares/auth";

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

// GET /membership
router.get("/", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) return res.status(404).json({ error: "User not found" });

    const tier = user.membershipTier as "base" | "plus" | "concierge";
    return res.json({
      tier,
      linePassCount: user.linePassCount,
      features: MEMBERSHIP_FEATURES[tier] ?? MEMBERSHIP_FEATURES.base,
      renewalDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    });
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

    const newTier = updated.membershipTier as "base" | "plus" | "concierge";
    return res.json({
      tier: newTier,
      linePassCount: updated.linePassCount,
      features: MEMBERSHIP_FEATURES[newTier] ?? MEMBERSHIP_FEATURES.base,
      renewalDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to upgrade membership" });
  }
});

export default router;
