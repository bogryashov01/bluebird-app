import { Router } from "express";
import OpenAI from "openai";
import { ConciergeChatBody } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { usersTable, conciergeMessagesTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { authMiddleware } from "../middlewares/auth";
import { getMockReply, SYSTEM_PROMPT } from "../lib/concierge-guidance";

const router = Router();

// Persist a user/assistant exchange. Best-effort: a storage hiccup must not
// break the chat reply the member is waiting on.
async function persistExchange(userId: string, userText: string, assistantText: string) {
  try {
    // Stagger timestamps so the user message always sorts before the reply.
    const now = Date.now();
    await db.insert(conciergeMessagesTable).values([
      { id: randomUUID(), userId, role: "user", content: userText, createdAt: new Date(now) },
      { id: randomUUID(), userId, role: "assistant", content: assistantText, createdAt: new Date(now + 1) },
    ]);
  } catch {
    // best-effort
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
    const reply = getMockReply(lastUserMessage?.content ?? "");
    if (lastUserMessage) await persistExchange(userId, lastUserMessage.content, reply);
    return res.json({ reply });
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
    const reply = completion.choices[0]?.message?.content?.trim();
    if (!reply) {
      return res.status(503).json({ error: "The concierge could not generate a reply" });
    }
    if (lastUserMessage) await persistExchange(userId, lastUserMessage.content, reply);
    return res.json({ reply });
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

  return res.json(
    rows.reverse().map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
  );
});

export default router;
