import { Router } from "express";
import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { authMiddleware } from "../middlewares/auth";
import { deliverExpoPush } from "../lib/push";
import { logger } from "../lib/logger";

const router = Router();
const IS_PROD = () => process.env.NODE_ENV === "production";

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

// POST /notifications/test-push — development-only OS push to this member's
// stored Expo tokens. 404 in production. Does not invent tokens or users.
router.post("/test-push", authMiddleware, async (req, res) => {
  if (IS_PROD()) return res.status(404).json({ error: "Not found" });
  const userId = (req as any).userId as string;
  const result = await deliverExpoPush(
    userId,
    "Bluebird Test",
    "Push notifications are working.",
    { kind: "test" },
  );
  if (!result.attempted) {
    return res.status(400).json({
      error: result.error,
      validTokenCount: result.validTokenCount,
    });
  }
  logger.info(
    {
      userId,
      httpStatus: result.httpStatus,
      validTokenCount: result.validTokenCount,
      ticketStatuses: result.tickets?.map((ticket) => ticket.status) ?? [],
    },
    "Sent development test push",
  );
  return res.json({
    sent: result.httpStatus === 200 && !result.error,
    validTokenCount: result.validTokenCount,
    expoHttpStatus: result.httpStatus,
    tickets: result.tickets,
    error: result.error,
  });
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
