import { Router } from "express";
import OpenAI from "openai";
import { ConciergeChatBody } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { authMiddleware } from "../middlewares/auth";

const router = Router();

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

// Mock reply table used when no AI key is configured. Keeps the concierge
// fully usable in demos; swaps to real AI automatically once a key is set.
const MOCK_RESPONSES: Record<string, string> = {
  default: "I'm here to help with your Bluebird experience. Ask me about flights, membership, or anything else!",
  flight: "Empty leg flights are repositioning trips available to Bluebird members at no cost. Browse the Discover tab to see current available flights and join a queue.",
  membership: "Bluebird offers Base, Plus, and Concierge tiers. Plus members get 2 Skip the Line passes per month, while Concierge members enjoy unlimited passes and 24/7 AI support.",
  queue: "The queue system lets you request a seat on any available empty leg flight. Skip the Line passes move you to the front of the queue instantly.",
  pass: "Skip the Line passes are earned through Plus/Concierge membership and referrals. Each pass guarantees you the next available seat on your chosen flight.",
  referral: "Earn 1 Skip the Line pass for every friend who joins Bluebird using your referral code. Find your code in the Referral section of your profile.",
  international: "International empty leg flights require a valid passport. Bluebird currently operates domestic US routes, with international access available on Plus membership.",
  luggage: "Luggage allowances vary by aircraft type. Generally expect 1-2 bags per seat. Specific allowances are communicated upon flight confirmation.",
  cancel: "Cancellations: You can leave a queue at any time without penalty. Skip the Line passes are not refunded if a flight is cancelled by the operator.",
  help: "I can help with: flight information, queue system, membership perks, referrals, luggage policies, and general aviation questions. What would you like to know?",
};

function getMockReply(text: string): string {
  const lower = text.toLowerCase();
  for (const [key, response] of Object.entries(MOCK_RESPONSES)) {
    if (key !== "default" && lower.includes(key)) return response;
  }
  return MOCK_RESPONSES.default;
}

const SYSTEM_PROMPT = `You are the Bluebird AI Concierge, the in-app assistant for Bluebird, a private aviation membership app for empty leg flights.

Facts about Bluebird you should use when relevant:
- Empty leg flights are repositioning trips offered to Bluebird members at no cost. Members browse them in the Discover tab and join a queue for a seat.
- Queue system: members request a seat on an available flight and wait in line. Positions are first come, first served. Members can leave a queue at any time without penalty.
- Skip the Line passes move a member to the front of a queue instantly. Plus members get 2 passes per month; Concierge members get unlimited passes. Passes are also earned via referrals (1 pass per friend who joins with your referral code, found in the Referral section of the profile).
- Membership tiers: Base (browse flights, join queues, notifications, community), Plus (everything in Base, 2 Skip the Line passes/month, priority support, international flight access, guest pass for one), Concierge (everything in Plus, unlimited passes, 24/7 AI concierge, dedicated flight coordinator, first-class lounge access, custom flight requests).
- International empty legs require a valid passport and Plus membership or above; Bluebird primarily operates domestic US routes.
- Luggage allowances vary by aircraft, generally 1-2 bags per seat; exact allowances are communicated at flight confirmation.
- Skip the Line passes are not refunded if a flight is cancelled by the operator.

Guidelines:
- Be warm, concise, and helpful — a premium concierge tone. Keep replies short (1-3 short paragraphs, no markdown headings).
- Answer questions about flights, queues, membership, referrals, luggage, and general private-aviation topics.
- If asked something unrelated to travel or Bluebird, politely steer back to how you can help with their Bluebird experience.
- Never invent specific flight schedules, prices, or availability; direct members to the Discover tab for live flights.`;

// POST /concierge/chat
router.post("/chat", authMiddleware, async (req, res) => {
  const parsed = ConciergeChatBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request: provide 1-40 messages with role and content" });
  }

  const ai = getClient();
  if (!ai) {
    // No AI key configured — serve mock replies so the concierge stays usable.
    const lastUserMessage = [...parsed.data.messages].reverse().find((m) => m.role === "user");
    return res.json({ reply: getMockReply(lastUserMessage?.content ?? "") });
  }

  // Personalize with the member's first name and tier when available.
  let userContext = "";
  try {
    const userId = (req as any).userId;
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
    return res.json({ reply });
  } catch (err) {
    req.log?.error?.({ err }, "concierge chat failed");
    return res.status(503).json({ error: "The concierge is temporarily unavailable" });
  }
});

export default router;
