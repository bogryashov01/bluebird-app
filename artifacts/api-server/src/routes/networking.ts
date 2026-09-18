import { Router } from "express";
import { and, asc, desc, eq, inArray, ne, or } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  devicePushTokensTable,
  flightsTable,
  networkingBlocksTable,
  networkingConnectionsTable,
  networkingMessagesTable,
  networkingProfilesTable,
  networkingReportsTable,
  networkingRequestsTable,
  notificationsTable,
  queueEntriesTable,
  usersTable,
} from "@workspace/db/schema";
import { authMiddleware } from "../middlewares/auth";
import { ObjectStorageService } from "../lib/objectStorage";

const router = Router();
router.use(authMiddleware);

const MAX_BIO = 280;
const MAX_PHOTO_BYTES = 1_500_000;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const objectStorage = new ObjectStorageService();

function id(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 11)}`;
}

function memberRequired(user: { membershipTier: string } | undefined, res: any): boolean {
  if (!user || user.membershipTier === "none") {
    res.status(403).json({
      error: "A paid Bluebird membership is required for networking.",
      code: "MEMBERSHIP_REQUIRED",
    });
    return false;
  }
  return true;
}

async function currentUser(userId: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return user;
}

function profileCompletion(profile: typeof networkingProfilesTable.$inferSelect | null) {
  const missing: string[] = [];
  if (!profile?.firstName.trim()) missing.push("firstName");
  if (!profile?.lastName.trim()) missing.push("lastName");
  if (!profile?.photoAssetPath && !profile?.photoUrl) missing.push("photo");
  if (!profile?.industry.trim()) missing.push("industry");
  if (!profile?.bio.trim()) missing.push("bio");
  return { completed: missing.length === 0, missing };
}

function profilePhotoUrl(profile: typeof networkingProfilesTable.$inferSelect): string | null {
  if (profile.photoAssetPath) return `/api/storage${profile.photoAssetPath}`;
  return profile.photoUrl;
}

function profileResponse(profile: typeof networkingProfilesTable.$inferSelect) {
  return {
    ...profile,
    photoUrl: profilePhotoUrl(profile),
    ...profileCompletion(profile),
  };
}

function publicProfile(
  profile: typeof networkingProfilesTable.$inferSelect | null,
  full = false,
) {
  if (!profile) {
    return {
      firstName: "",
      lastName: "",
      photoUrl: null,
      photoAssetPath: null,
      industry: "",
      bio: "",
      ...(full ? { linkedinUrl: null, instagramUrl: null } : {}),
    };
  }
  return {
    firstName: profile.firstName,
    lastName: full ? profile.lastName : undefined,
    photoUrl: profilePhotoUrl(profile),
    photoAssetPath: profile.photoAssetPath,
    industry: profile.industry,
    bio: profile.bio,
    ...(full ? {
      linkedinUrl: profile.linkedinUrl,
      instagramUrl: profile.instagramUrl,
    } : {}),
  };
}

async function hasBlock(a: string, b: string): Promise<boolean> {
  const [block] = await db.select({ id: networkingBlocksTable.id })
    .from(networkingBlocksTable)
    .where(or(
      and(eq(networkingBlocksTable.blockerId, a), eq(networkingBlocksTable.blockedId, b)),
      and(eq(networkingBlocksTable.blockerId, b), eq(networkingBlocksTable.blockedId, a)),
    ));
  return !!block;
}

async function notify(
  userId: string,
  title: string,
  body: string,
  type: string,
  data: Record<string, string>,
) {
  await db.insert(notificationsTable).values({
    id: id(),
    userId,
    title,
    body,
    type,
    data,
  });
  await deliverPush(userId, title, body, data);
}

async function deliverPush(userId: string, title: string, body: string, data: Record<string, string>) {
  const tokens = await db.select().from(devicePushTokensTable)
    .where(eq(devicePushTokensTable.userId, userId));
  if (tokens.length === 0) return;
  const valid = tokens.filter((row) => /^ExponentPushToken\[.+\]$/.test(row.token));
  if (valid.length === 0) return;
  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(valid.map((row) => ({
        to: row.token,
        title,
        body,
        data,
      }))),
    });
    if (!response.ok) return;
    const result = await response.json() as {
      data?: Array<{ status?: string; details?: { error?: string } }>;
    };
    const invalid = valid.filter((_row, index) =>
      result.data?.[index]?.details?.error === "DeviceNotRegistered",
    );
    if (invalid.length) {
      await db.delete(devicePushTokensTable)
        .where(inArray(devicePushTokensTable.id, invalid.map((row) => row.id)));
    }
    await db.update(devicePushTokensTable)
      .set({ lastUsedAt: new Date() })
      .where(inArray(devicePushTokensTable.id, valid.map((row) => row.id)));
  } catch {
    // In-app notifications remain the source of truth when push delivery is unavailable.
  }
}

async function connectionFor(userId: string, connectionId: string) {
  const [connection] = await db.select().from(networkingConnectionsTable).where(and(
    eq(networkingConnectionsTable.id, connectionId),
    or(
      eq(networkingConnectionsTable.memberAId, userId),
      eq(networkingConnectionsTable.memberBId, userId),
    ),
  ));
  return connection;
}

async function otherMember(connection: typeof networkingConnectionsTable.$inferSelect, userId: string) {
  return connection.memberAId === userId ? connection.memberBId : connection.memberAId;
}

router.get("/profile", async (req, res) => {
  const userId = (req as any).userId as string;
  const user = await currentUser(userId);
  if (!memberRequired(user, res)) return;
  try {
    let [profile] = await db.select().from(networkingProfilesTable)
      .where(eq(networkingProfilesTable.userId, userId));
    if (!profile) {
      const [created] = await db.insert(networkingProfilesTable).values({
        userId,
        firstName: user?.name.split(/\s+/)[0] ?? "",
        lastName: user?.name.split(/\s+/).slice(1).join(" ") ?? "",
      }).returning();
      profile = created;
    }
    return res.json(profileResponse(profile));
  } catch {
    return res.status(500).json({ error: "Failed to load networking profile" });
  }
});

router.patch("/profile", async (req, res) => {
  const userId = (req as any).userId as string;
  const user = await currentUser(userId);
  if (!memberRequired(user, res)) return;
  const body = req.body ?? {};
  const updates: Partial<typeof networkingProfilesTable.$inferInsert> = {};
  for (const key of ["firstName", "lastName", "industry", "bio"] as const) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== "string") return res.status(400).json({ error: `${key} must be text` });
      const value = body[key].trim();
      if (!value || value.length > (key === "bio" ? MAX_BIO : 80)) {
        return res.status(400).json({ error: `${key} is required and has an invalid length` });
      }
      updates[key] = value;
    }
  }
  for (const key of ["linkedinUrl", "instagramUrl"] as const) {
    if (body[key] !== undefined) {
      if (body[key] !== null && typeof body[key] !== "string") {
        return res.status(400).json({ error: `${key} must be a URL or null` });
      }
      const value = body[key] === null ? null : body[key].trim();
      if (value && !/^https?:\/\/\S+$/i.test(value)) {
        return res.status(400).json({ error: `${key} must be a valid http(s) URL` });
      }
      updates[key] = value;
    }
  }
  if (body.photoUrl !== undefined) {
    if (body.photoUrl !== null && typeof body.photoUrl !== "string") {
      return res.status(400).json({ error: "photoUrl must be a URL or null" });
    }
    const value = body.photoUrl === null ? null : body.photoUrl.trim();
    if (value && !/^https?:\/\/\S+$/i.test(value)) {
      return res.status(400).json({ error: "Legacy profile photo must be a valid image URL" });
    }
    updates.photoUrl = value;
    if (body.photoAssetPath === undefined) updates.photoAssetPath = null;
  }
  if (body.photoAssetPath !== undefined) {
    if (body.photoAssetPath !== null && typeof body.photoAssetPath !== "string") {
      return res.status(400).json({ error: "photoAssetPath must be an object path or null" });
    }
    const path = body.photoAssetPath === null ? null : body.photoAssetPath.trim();
    if (path) {
      if (!/^\/objects\/uploads\/[A-Za-z0-9-]+$/.test(path)) {
        return res.status(400).json({ error: "Profile photo must be uploaded through the profile photo uploader" });
      }
      try {
        const metadata = await objectStorage.getObjectMetadata(path);
        if (!metadata.contentType || !IMAGE_TYPES.has(metadata.contentType) ||
            !metadata.size || metadata.size > MAX_PHOTO_BYTES) {
          return res.status(400).json({ error: "Profile photo must be a JPEG, PNG, or WebP under 1.5 MB" });
        }
      } catch {
        return res.status(400).json({ error: "Uploaded profile photo could not be found" });
      }
    }
    updates.photoAssetPath = path;
    updates.photoUrl = null;
  }
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: "Nothing to update" });
  try {
    const [profile] = await db.insert(networkingProfilesTable)
      .values({ userId, ...updates })
      .onConflictDoUpdate({
        target: networkingProfilesTable.userId,
        set: { ...updates, updatedAt: new Date() },
      })
      .returning();
    return res.json(profileResponse(profile));
  } catch {
    return res.status(500).json({ error: "Failed to save networking profile" });
  }
});

router.post("/push-tokens", async (req, res) => {
  const userId = (req as any).userId as string;
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  const platform = typeof req.body?.platform === "string" ? req.body.platform.slice(0, 20) : "unknown";
  if (!token || token.length > 512) return res.status(400).json({ error: "A valid push token is required" });
  try {
    const [saved] = await db.insert(devicePushTokensTable)
      .values({ id: id(), userId, token, platform, lastUsedAt: new Date() })
      .onConflictDoUpdate({
        target: devicePushTokensTable.token,
        set: { userId, platform, lastUsedAt: new Date() },
      })
      .returning();
    return res.json(saved);
  } catch {
    return res.status(500).json({ error: "Failed to register push token" });
  }
});

router.get("/flights/:flightId/front-member", async (req, res) => {
  const userId = (req as any).userId as string;
  const user = await currentUser(userId);
  if (!memberRequired(user, res)) return;
  try {
    const flightId = String(req.params.flightId);
    const [flight] = await db.select().from(flightsTable).where(eq(flightsTable.id, flightId));
    if (!flight) return res.status(404).json({ error: "Flight not found" });
    const [entry] = await db.select().from(queueEntriesTable).where(and(
      eq(queueEntriesTable.flightId, flightId),
      eq(queueEntriesTable.status, "waiting"),
      eq(queueEntriesTable.position, 1),
    )).orderBy(asc(queueEntriesTable.createdAt)).limit(1);
    if (!entry || entry.userId === userId || flight.status !== "available" || await hasBlock(userId, entry.userId)) {
      return res.json({ eligible: false, member: null });
    }
    const [profile] = await db.select().from(networkingProfilesTable)
      .where(eq(networkingProfilesTable.userId, entry.userId));
    if (!profile || !profileCompletion(profile).completed) return res.json({ eligible: false, member: null });
    return res.json({
      eligible: true,
      flightId,
      member: { userId: entry.userId, ...publicProfile(profile) },
    });
  } catch {
    return res.status(500).json({ error: "Failed to find the front member" });
  }
});

router.post("/requests", async (req, res) => {
  const userId = (req as any).userId as string;
  const user = await currentUser(userId);
  if (!memberRequired(user, res)) return;
  const flightId = typeof req.body?.flightId === "string" ? req.body.flightId : "";
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!flightId || message.length < 1 || message.length > 240) {
    return res.status(400).json({ error: "Choose a flight and write a message up to 240 characters" });
  }
  try {
    const [requesterProfile] = await db.select().from(networkingProfilesTable)
      .where(eq(networkingProfilesTable.userId, userId));
    if (!requesterProfile || !profileCompletion(requesterProfile).completed) {
      return res.status(400).json({ error: "Complete your networking profile before sending a request", code: "NETWORKING_PROFILE_INCOMPLETE" });
    }
    const [entry] = await db.select().from(queueEntriesTable).where(and(
      eq(queueEntriesTable.flightId, flightId),
      eq(queueEntriesTable.status, "waiting"),
      eq(queueEntriesTable.position, 1),
      ne(queueEntriesTable.userId, userId),
    )).orderBy(asc(queueEntriesTable.createdAt)).limit(1);
    if (!entry) return res.status(409).json({ error: "There is no eligible front member for this flight" });
    if (await hasBlock(userId, entry.userId)) return res.status(403).json({ error: "This member is unavailable for networking" });
    const [flight] = await db.select({ id: flightsTable.id, status: flightsTable.status })
      .from(flightsTable).where(eq(flightsTable.id, flightId));
    if (!flight || flight.status !== "available") return res.status(409).json({ error: "This flight is no longer available" });
    const [existing] = await db.select().from(networkingRequestsTable).where(and(
      eq(networkingRequestsTable.flightId, flightId),
      eq(networkingRequestsTable.requesterId, userId),
      eq(networkingRequestsTable.recipientId, entry.userId),
    ));
    if (existing?.status === "pending" || existing?.status === "accepted") {
      return res.status(409).json({ error: "You already sent a request for this flight", requestId: existing.id });
    }
    const request = existing
      ? (await db.update(networkingRequestsTable).set({ message, status: "pending", updatedAt: new Date() })
        .where(eq(networkingRequestsTable.id, existing.id)).returning())[0]
      : (await db.insert(networkingRequestsTable).values({
        id: id(), flightId, requesterId: userId, recipientId: entry.userId, message,
      }).returning())[0];
    await notify(entry.userId, "New flight connection request", `${requesterProfile.firstName} would like to connect before your flight.`, "networking_request", { requestId: request.id, flightId });
    return res.status(existing ? 200 : 201).json({ ...request, requester: publicProfile(requesterProfile, false) });
  } catch {
    return res.status(500).json({ error: "Failed to send connection request" });
  }
});

router.get("/requests/incoming", async (req, res) => {
  const userId = (req as any).userId as string;
  const user = await currentUser(userId);
  if (!memberRequired(user, res)) return;
  try {
    const rows = await db.select().from(networkingRequestsTable).where(and(
      eq(networkingRequestsTable.recipientId, userId),
      eq(networkingRequestsTable.status, "pending"),
    )).orderBy(desc(networkingRequestsTable.createdAt));
    const response = await Promise.all(rows.map(async (request) => {
      const [profile] = await db.select().from(networkingProfilesTable).where(eq(networkingProfilesTable.userId, request.requesterId));
      const [flight] = await db.select({ fromCity: flightsTable.fromCity, toCity: flightsTable.toCity, departureDate: flightsTable.departureDate })
        .from(flightsTable).where(eq(flightsTable.id, request.flightId));
      return { ...request, requester: publicProfile(profile ?? null), flight };
    }));
    return res.json(response);
  } catch {
    return res.status(500).json({ error: "Failed to load connection requests" });
  }
});

router.post("/requests/:id/decision", async (req, res) => {
  const userId = (req as any).userId as string;
  const user = await currentUser(userId);
  if (!memberRequired(user, res)) return;
  const action = req.body?.action;
  if (!["accept", "decline", "ignore", "block", "report"].includes(action)) {
    return res.status(400).json({ error: "Choose accept, decline, ignore, block, or report" });
  }
  try {
    const [request] = await db.select().from(networkingRequestsTable).where(and(
      eq(networkingRequestsTable.id, String(req.params.id)),
      eq(networkingRequestsTable.recipientId, userId),
    ));
    if (!request) return res.status(404).json({ error: "Connection request not found" });
    if (action === "ignore") {
      await db.delete(networkingRequestsTable).where(eq(networkingRequestsTable.id, request.id));
      return res.json({ status: "ignored" });
    }
    if (action === "block" || action === "report") {
      if (action === "block") {
        await db.insert(networkingBlocksTable).values({ id: id(), blockerId: userId, blockedId: request.requesterId }).onConflictDoNothing();
      }
      if (action === "report") {
        const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : "Member reported";
        await db.insert(networkingReportsTable).values({ id: id(), reporterId: userId, reportedId: request.requesterId, requestId: request.id, reason });
      }
      await db.update(networkingRequestsTable).set({ status: "declined", updatedAt: new Date() }).where(eq(networkingRequestsTable.id, request.id));
      return res.json({ status: action === "block" ? "blocked" : "reported" });
    }
    if (request.status !== "pending") return res.status(409).json({ error: "This request has already been decided" });
    if (action === "decline") {
      await db.update(networkingRequestsTable).set({ status: "declined", updatedAt: new Date() }).where(eq(networkingRequestsTable.id, request.id));
      await notify(request.requesterId, "Connection request declined", "Your flight connection request was declined.", "networking_declined", { requestId: request.id, flightId: request.flightId });
      return res.json({ status: "declined" });
    }
    if (await hasBlock(userId, request.requesterId)) return res.status(403).json({ error: "This member is blocked" });
    const [updated] = await db.update(networkingRequestsTable).set({ status: "accepted", updatedAt: new Date() })
      .where(and(eq(networkingRequestsTable.id, request.id), eq(networkingRequestsTable.status, "pending"))).returning();
    if (!updated) return res.status(409).json({ error: "This request has already been decided" });
    const [a, b] = [userId, request.requesterId].sort();
    const [connection] = await db.insert(networkingConnectionsTable).values({
      id: id(), requestId: request.id, memberAId: a, memberBId: b,
    }).onConflictDoNothing().returning();
    const [existingConnection] = await db.select().from(networkingConnectionsTable).where(and(
      eq(networkingConnectionsTable.memberAId, a), eq(networkingConnectionsTable.memberBId, b),
    ));
    const finalConnection = connection ?? existingConnection;
    if (!finalConnection) return res.status(409).json({ error: "Connection could not be created; please try again" });
    await notify(request.requesterId, "Your connection request was accepted", "You can now message your new flight connection.", "networking_accepted", { requestId: request.id, connectionId: finalConnection.id });
    return res.json({ status: "accepted", connection: finalConnection });
  } catch {
    return res.status(500).json({ error: "Failed to update connection request" });
  }
});

router.get("/connections", async (req, res) => {
  const userId = (req as any).userId as string;
  const user = await currentUser(userId);
  if (!memberRequired(user, res)) return;
  try {
    const connections = await db.select().from(networkingConnectionsTable).where(or(
      eq(networkingConnectionsTable.memberAId, userId),
      eq(networkingConnectionsTable.memberBId, userId),
    )).orderBy(desc(networkingConnectionsTable.createdAt));
    const result = [];
    for (const connection of connections) {
      const otherId = await otherMember(connection, userId);
      if (await hasBlock(userId, otherId)) continue;
      const [profile] = await db.select().from(networkingProfilesTable).where(eq(networkingProfilesTable.userId, otherId));
      const [lastMessage] = await db.select().from(networkingMessagesTable)
        .where(eq(networkingMessagesTable.connectionId, connection.id))
        .orderBy(desc(networkingMessagesTable.createdAt)).limit(1);
      result.push({ ...connection, member: { userId: otherId, ...publicProfile(profile ?? null, true) }, lastMessage: lastMessage ?? null });
    }
    return res.json(result);
  } catch {
    return res.status(500).json({ error: "Failed to load connections" });
  }
});

router.get("/connections/:id/messages", async (req, res) => {
  const userId = (req as any).userId as string;
  const user = await currentUser(userId);
  if (!memberRequired(user, res)) return;
  try {
    const connection = await connectionFor(userId, String(req.params.id));
    if (!connection || await hasBlock(userId, await otherMember(connection, userId))) return res.status(403).json({ error: "This conversation is unavailable" });
    const messages = await db.select().from(networkingMessagesTable)
      .where(eq(networkingMessagesTable.connectionId, connection.id))
      .orderBy(asc(networkingMessagesTable.createdAt));
    return res.json(messages);
  } catch {
    return res.status(500).json({ error: "Failed to load messages" });
  }
});

router.post("/connections/:id/messages", async (req, res) => {
  const userId = (req as any).userId as string;
  const user = await currentUser(userId);
  if (!memberRequired(user, res)) return;
  const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
  const clientMessageId = typeof req.body?.clientMessageId === "string" ? req.body.clientMessageId.slice(0, 100) : null;
  if (!content || content.length > 1000) return res.status(400).json({ error: "Message must be between 1 and 1,000 characters" });
  try {
    const connection = await connectionFor(userId, String(req.params.id));
    if (!connection || await hasBlock(userId, await otherMember(connection, userId))) return res.status(403).json({ error: "This conversation is unavailable" });
    if (clientMessageId) {
      const [duplicate] = await db.select().from(networkingMessagesTable).where(and(
        eq(networkingMessagesTable.senderId, userId),
        eq(networkingMessagesTable.clientMessageId, clientMessageId),
      ));
      if (duplicate) return res.json(duplicate);
    }
    const [message] = await db.insert(networkingMessagesTable).values({
      id: id(), connectionId: connection.id, senderId: userId, content, clientMessageId,
    }).returning();
    const recipientId = await otherMember(connection, userId);
    const [profile] = await db.select().from(networkingProfilesTable).where(eq(networkingProfilesTable.userId, userId));
    await notify(recipientId, "New message", `${profile?.firstName ?? "Your connection"} sent you a message.`, "networking_message", { connectionId: connection.id });
    return res.status(201).json(message);
  } catch {
    return res.status(500).json({ error: "Failed to send message" });
  }
});

router.post("/connections/:id/block", async (req, res) => {
  const userId = (req as any).userId as string;
  const user = await currentUser(userId);
  if (!memberRequired(user, res)) return;
  try {
    const connection = await connectionFor(userId, String(req.params.id));
    if (!connection) return res.status(404).json({ error: "Connection not found" });
    const blockedId = await otherMember(connection, userId);
    await db.insert(networkingBlocksTable).values({ id: id(), blockerId: userId, blockedId }).onConflictDoNothing();
    return res.json({ blocked: true });
  } catch {
    return res.status(500).json({ error: "Failed to block member" });
  }
});

export default router;