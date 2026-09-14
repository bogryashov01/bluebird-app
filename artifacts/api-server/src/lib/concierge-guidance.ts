export const BAGGAGE_POLICY =
  "The baggage allowance is 25 kg per passenger, subject to aircraft capacity and operational limitations.";

export type GuidedReply = { reply: string; requiresHumanFollowUp: boolean };

export const MOCK_RESPONSES: Record<string, string> = {
  default: "I can help with baggage, pets, FBO information, airport directions, flights, membership, and queue questions. What would you like to know?",
  flight: "Empty leg flights are repositioning trips available to Bluebird members at no cost. Browse the Discover tab to see current available flights and join a queue.",
  membership: "Bluebird offers Base, Plus, and Family/Corporate tiers. Base is $3,995/year, Plus is $9,995/year with 5 Skip the Line passes per month and priority access to flights, and Family/Corporate is $13,995/year with 7 passes, 4 memberships in 1, charter flight aviation advisors, and 24/7 AI support.",
  queue: "The queue system lets you request a seat on any available empty leg flight. Skip the Line passes move you to the front of the queue instantly.",
  pass: "Skip the Line passes are earned through Plus or Family/Corporate membership and referrals. Each pass guarantees you the next available seat on your chosen flight.",
  referral: "Earn 1 Skip the Line pass for every friend who joins Bluebird using your referral code. Find your code in the Referral section of your profile.",
  international: "International empty leg flights require a valid passport. Bluebird currently operates domestic US routes, with international access available on Plus membership.",
  luggage: BAGGAGE_POLICY,
  baggage: BAGGAGE_POLICY,
  pet: "Pets may travel when the aircraft and operator permit it. Add your pet when joining the flight queue so any applicable cleaning fee and requirements are shown before you confirm.",
  fbo: "An FBO is the private terminal used for your departure. Check the flight details for the departure FBO; the exact location and arrival instructions appear there when available.",
  direction: "Open your flight details and use the listed departure airport and FBO for directions. Confirm the FBO rather than navigating only to the main commercial terminal.",
  cancel: "Cancellations: You can leave a queue at any time without penalty. Skip the Line passes are not refunded if a flight is cancelled by the operator.",
  help: "I can help with: flight information, queue system, membership perks, referrals, luggage policies, and general aviation questions. What would you like to know?",
};

export function getMockReply(text: string): GuidedReply {
  const lower = text.toLowerCase();
  const needsHuman = /\b(safety|emergency|danger|medical|stranded|charged twice|billing dispute|account locked|custom flight|complaint)\b/i.test(lower);
  if (needsHuman) {
    return {
      reply: "This needs personal follow-up from our Concierge team. A Concierge team member will contact you after you request a callback below.",
      requiresHumanFollowUp: true,
    };
  }
  for (const [key, response] of Object.entries(MOCK_RESPONSES)) {
    if (key !== "default" && lower.includes(key)) return { reply: response, requiresHumanFollowUp: false };
  }
  return { reply: MOCK_RESPONSES.default, requiresHumanFollowUp: false };
}

export function parseModelReply(raw: string): GuidedReply {
  const lines = raw.trim().split("\n");
  const routingLine = lines.at(-1)?.trim();
  const requiresHumanFollowUp = routingLine === "[[HUMAN_FOLLOW_UP]]";
  if (routingLine === "[[ROUTINE]]" || routingLine === "[[HUMAN_FOLLOW_UP]]") lines.pop();
  const reply = lines.join("\n").replace(/\[\[(?:ROUTINE|HUMAN_FOLLOW_UP)\]\]/gi, "").trim();
  return { reply, requiresHumanFollowUp };
}

export const SYSTEM_PROMPT = `You are the Bluebird AI Concierge, the in-app assistant for Bluebird, a private aviation membership app for empty leg flights.

Facts about Bluebird you should use when relevant:
- Empty leg flights are repositioning trips offered to Bluebird members at no cost. Members browse them in the Discover tab and join a queue for a seat.
- Queue system: members request a seat on an available flight and wait in line. Positions are first come, first served. Members can leave a queue at any time without penalty.
- Skip the Line passes move a member to the front of a queue instantly. Plus members get 5 passes per month; Family/Corporate members get 7 passes. Passes are also earned via referrals (1 pass per friend who joins with your referral code, found in the Referral section of the profile).
- Membership tiers: Base ($3,995/year: browse empty-leg flights, join queues, notifications, unlimited flights, bring 5 guests), Plus ($9,995/year: everything in Base, 5 Skip the Line passes/month, priority access to flights, international flight access), Family/Corporate ($13,995/year: everything in Plus, 7 Skip the Line passes, 24/7 AI concierge, dedicated flight coordinator, custom flight requests, 4 memberships in 1, access to charter flight aviation advisors).
- International empty legs require a valid passport and Plus membership or above; Bluebird primarily operates domestic US routes.
- ${BAGGAGE_POLICY}
- Skip the Line passes are not refunded if a flight is cancelled by the operator.

Guidelines:
- Be warm, concise, and helpful — a premium concierge tone. Keep replies short (1-3 short paragraphs, no markdown headings).
- Answer questions about flights, queues, membership, referrals, luggage, and general private-aviation topics.
- Resolve routine baggage, pet, FBO, airport directions, flight, membership, and queue questions yourself before considering human follow-up.
- Do not provide or volunteer a phone number, direct-call option, or generic suggestion to contact support.
- Human follow-up is only appropriate for complex or unresolved requests, account-specific investigation, billing disputes, custom arrangements, or safety-sensitive concerns. When it is appropriate, say that a Concierge team member will contact the member after they request a callback.
- End every response with exactly one hidden routing marker on its own line: [[ROUTINE]] or [[HUMAN_FOLLOW_UP]]. Never mention these markers in the prose.
- If asked something unrelated to travel or Bluebird, politely steer back to how you can help with their Bluebird experience.
- Never invent specific flight schedules, prices, or availability; direct members to the Discover tab for live flights.`;