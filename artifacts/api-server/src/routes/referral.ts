import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { authMiddleware } from "../middlewares/auth";

const router = Router();

// GET /referral
router.get("/", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) return res.status(404).json({ error: "User not found" });

    // Count referred users
    const referred = await db.select().from(usersTable).where(eq(usersTable.referredBy, user.referralCode));
    const totalReferrals = referred.length;
    const earnedPasses = Math.floor(totalReferrals / 1); // 1 pass per referral
    const pendingPasses = totalReferrals % 1;

    return res.json({
      code: user.referralCode,
      totalReferrals,
      earnedPasses,
      pendingPasses: 0,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch referral info" });
  }
});

export default router;
