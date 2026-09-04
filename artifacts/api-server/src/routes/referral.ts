import { Router } from "express";
import { db } from "@workspace/db";
import { referralRewardsTable, usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { authMiddleware } from "../middlewares/auth";

const router = Router();

// GET /referral
router.get("/", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.membershipTier === "none") {
      return res.status(403).json({
        error: "A Bluebird membership is required to invite friends and earn referral passes.",
        code: "MEMBERSHIP_REQUIRED",
      });
    }

    const rewards = await db
      .select({ name: usersTable.name, createdAt: referralRewardsTable.createdAt })
      .from(referralRewardsTable)
      .innerJoin(usersTable, eq(referralRewardsTable.friendUserId, usersTable.id))
      .where(eq(referralRewardsTable.inviterUserId, user.id));
    const successfulReferrals = rewards.length;
    const invited = rewards
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((reward) => ({
        name: reward.name,
        status: "joined",
      }));

    return res.json({
      code: user.referralCode,
      referralUrl: `https://bluebird.co/join/${encodeURIComponent(user.referralCode)}`,
      rewardPassesPerPerson: 1,
      successfulReferrals,
      invited,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch referral info" });
  }
});

export default router;
