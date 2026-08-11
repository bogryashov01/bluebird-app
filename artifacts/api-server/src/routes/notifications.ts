import { Router } from "express";
import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { authMiddleware } from "../middlewares/auth";

const router = Router();

// GET /notifications
router.get("/", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  try {
    const notifications = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.userId, userId))
      .orderBy(notificationsTable.createdAt);
    return res.json(notifications.reverse()); // newest first
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

// POST /notifications/:id/read
router.post("/:id/read", authMiddleware, async (req, res) => {
  const userId = (req as any).userId;
  try {
    const [notification] = await db
      .update(notificationsTable)
      .set({ read: true })
      .where(and(eq(notificationsTable.id, String(req.params.id)), eq(notificationsTable.userId, userId)))
      .returning();

    if (!notification) {
      return res.status(404).json({ error: "Notification not found" });
    }
    return res.json(notification);
  } catch (err) {
    return res.status(500).json({ error: "Failed to mark notification read" });
  }
});

export default router;
