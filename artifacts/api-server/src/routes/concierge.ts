import { Router } from "express";
import OpenAI from "openai";
import { ConciergeChatBody, RequestConciergeCallbackBody } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { usersTable, conciergeMessagesTable, conciergeCallbackRequestsTable } from "@workspace/db/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { authMiddleware } from "../middlewares/auth";
import { getMockReply, parseModelReply, SYSTEM_PROMPT } from "../lib/concierge-guidance";

const router = Router();

// Persist a user/assistant exchange before returning it so any escalation action
// always references durable conversation context.
async function persistExchange(userId: string, userText: string, assistantText: string, requiresHumanFollowUp: boolean) {
  const assistantMessageId = randomUUID();
  try {
    // Stagger timestamps so the user message always sorts before the reply.
    const now = Date.now();
    await db.insert(conciergeMessagesTable).values([
      { id: randomUUID(), userId, role: "user", content: userText, createdAt: new Date(now) },
      { id: assistantMessageId, userId, role: "assistant", content: assistantText, requiresHumanFollowUp, createdAt: new Date(now + 1) },
    ]);
    return assistantMessageId;
  } catch (err) {
    throw err;
  }
}

// Prefer Replit AI Integrations proxy env vars when present; otherwise fall
// back to a plain OpenAI API key. Client is created lazily per request so a
// missing key degrades to a friendly 503 instead of crashing the server.
function getClient(): { client: OpenAI; model: string } | null {
  const proxyBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const proxyKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (proxyBaseUrl && proxyKey) {
    return {
      client: new OpenAI({ baseURL: proxyBaseUrl, apiKey: proxyKey }),
      model: process.env.CONCIERGE_MODEL ?? "gpt-5.6-terra",
    };
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    return {
      client: new OpenAI({ apiKey }),
      model: process.env.CONCIERGE_MODEL ?? "gpt-5-mini",
    };
  }
  return null;
}

// POST /concierge/chat
router.post("/chat", authMiddleware, async (req, res) => {
  const parsed = ConciergeChatBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request: provide 1-40 messages with role and content" });
  }

  const userId = (req as any).userId as string;
  const lastUserMessage = [...parsed.data.messages].reverse().find((m) => m.role === "user");

  const ai = getClient();
  if (!ai) {
    // No AI key configured — serve mock replies so the concierge stays usable.
    const guided = getMockReply(lastUserMessage?.content ?? "");
    const assistantMessageId = lastUserMessage
      ? await persistExchange(userId, lastUserMessage.content, guided.reply, guided.requiresHumanFollowUp)
      : randomUUID();
    return res.json({ ...guided, assistantMessageId });
  }

  // Personalize with the member's first name and tier when available.
  let userContext = "";
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (user) {
      const firstName = user.name?.split(" ")[0];
      const tier = user.membershipTier;
      userContext = `\n\nYou are speaking with ${firstName ?? "a member"}${tier ? `, a ${tier} tier member` : ""}.`;
    }
  } catch {
    // Personalization is best-effort; proceed without it.
  }

  try {
    const completion = await ai.client.chat.completions.create({
      model: ai.model,
      max_completion_tokens: 8192,
      messages: [
        { role: "system", content: SYSTEM_PROMPT + userContext },
        ...parsed.data.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    });
    const rawReply = completion.choices[0]?.message?.content?.trim();
    if (!rawReply) {
      return res.status(503).json({ error: "The concierge could not generate a reply" });
    }
    const guided = parseModelReply(rawReply);
    const assistantMessageId = lastUserMessage
      ? await persistExchange(userId, lastUserMessage.content, guided.reply, guided.requiresHumanFollowUp)
      : randomUUID();
    return res.json({ ...guided, assistantMessageId });
  } catch (err) {
    req.log?.error?.({ err }, "concierge chat failed");
    return res.status(503).json({ error: "The concierge is temporarily unavailable" });
  }
});

// GET /concierge/history — last N messages for the caller, oldest first.
router.get("/history", authMiddleware, async (req, res) => {
  const userId = (req as any).userId as string;
  const rawLimit = Number(req.query.limit);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100) : 50;

  const rows = await db
    .select()
    .from(conciergeMessagesTable)
    .where(eq(conciergeMessagesTable.userId, userId))
    .orderBy(desc(conciergeMessagesTable.createdAt))
    .limit(limit);
  const callbacks = await db.select({ assistantMessageId: conciergeCallbackRequestsTable.assistantMessageId })
    .from(conciergeCallbackRequestsTable)
    .where(eq(conciergeCallbackRequestsTable.userId, userId));
  const callbackMessageIds = new Set(callbacks.map((callback) => callback.assistantMessageId));

  return res.json(
    rows.reverse().map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
      requiresHumanFollowUp: m.requiresHumanFollowUp,
      callbackRequested: callbackMessageIds.has(m.id),
    })),
  );
});

router.post("/callback-requests", authMiddleware, async (req, res) => {
  const parsed = RequestConciergeCallbackBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid callback request" });
  const userId = (req as any).userId as string;
  const [message] = await db.select().from(conciergeMessagesTable).where(and(
    eq(conciergeMessagesTable.id, parsed.data.assistantMessageId),
    eq(conciergeMessagesTable.userId, userId),
    eq(conciergeMessagesTable.role, "assistant"),
    eq(conciergeMessagesTable.requiresHumanFollowUp, true),
  ));
  if (!message) return res.status(404).json({ error: "Escalated concierge reply not found" });

  const existing = await db.select().from(conciergeCallbackRequestsTable).where(and(
    eq(conciergeCallbackRequestsTable.userId, userId),
    eq(conciergeCallbackRequestsTable.assistantMessageId, message.id),
  ));
  if (existing[0]) return res.json({ id: existing[0].id, status: "requested", created: false, message: "Your callback request is already with our Concierge team." });

  // Anchor the context query inside PostgreSQL so timestamp precision is
  // preserved and older replies remain requestable after any number of newer
  // messages. ID is the deterministic tie-breaker for equal timestamps.
  const contextRows = (await db.select().from(conciergeMessagesTable)
    .where(and(
      eq(conciergeMessagesTable.userId, userId),
      sql`(
        ${conciergeMessagesTable.createdAt} < (
          SELECT created_at FROM concierge_messages WHERE id = ${message.id}
        )
        OR (
          ${conciergeMessagesTable.createdAt} = (
            SELECT created_at FROM concierge_messages WHERE id = ${message.id}
          )
          AND ${conciergeMessagesTable.id} <= ${message.id}
        )
      )`,
    ))
    .orderBy(desc(conciergeMessagesTable.createdAt), desc(conciergeMessagesTable.id))
    .limit(20)).reverse();
  const id = randomUUID();
  await db.insert(conciergeCallbackRequestsTable).values({
    id, userId, assistantMessageId: message.id,
    conversationContext: contextRows.map((row) => ({ role: row.role, content: row.content })),
  }).onConflictDoNothing();
  const [stored] = await db.select().from(conciergeCallbackRequestsTable).where(and(
    eq(conciergeCallbackRequestsTable.userId, userId),
    eq(conciergeCallbackRequestsTable.assistantMessageId, message.id),
  ));
  if (!stored) return res.status(503).json({ error: "The callback request could not be saved" });
  return res.json({ id: stored.id, status: "requested", created: stored.id === id, message: "Your callback request is with our Concierge team. A team member will contact you." });
});

export default router;
