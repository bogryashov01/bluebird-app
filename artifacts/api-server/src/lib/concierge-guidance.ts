export const BAGGAGE_POLICY =
  "The baggage allowance is 25 kg per passenger, subject to aircraft capacity and operational limitations.";

export const MOCK_RESPONSES: Record<string, string> = {
  default: "I'm here to help with your Bluebird experience. Ask me about flights, membership, or anything else!",
  flight: "Empty leg flights are repositioning trips available to Bluebird members at no cost. Browse the Discover tab to see current available flights and join a queue.",
  membership: "Bluebird offers Base, Plus, and Concierge tiers. Plus members ($995/month) get 5 Skip the Line passes per month, while Concierge members enjoy unlimited passes and 24/7 AI support.",
  queue: "The queue system lets you request a seat on any available empty leg flight. Skip the Line passes move you to the front of the queue instantly.",
  pass: "Skip the Line passes are earned through Plus/Concierge membership and referrals. Each pass guarantees you the next available seat on your chosen flight.",
  referral: "Earn 1 Skip the Line pass for every friend who joins Bluebird using your referral code. Find your code in the Referral section of your profile.",
  international: "International empty leg flights require a valid passport. Bluebird currently operates domestic US routes, with international access available on Plus membership.",
  luggage: BAGGAGE_POLICY,
  baggage: BAGGAGE_POLICY,
  cancel: "Cancellations: You can leave a queue at any time without penalty. Skip the Line passes are not refunded if a flight is cancelled by the operator.",
  help: "I can help with: flight information, queue system, membership perks, referrals, luggage policies, and general aviation questions. What would you like to know?",
};

export function getMockReply(text: string): string {
  const lower = text.toLowerCase();
  for (const [key, response] of Object.entries(MOCK_RESPONSES)) {
    if (key !== "default" && lower.includes(key)) return response;
  }
  return MOCK_RESPONSES.default;
}

export const SYSTEM_PROMPT = `You are the Bluebird AI Concierge, the in-app assistant for Bluebird, a private aviation membership app for empty leg flights.

Facts about Bluebird you should use when relevant:
- Empty leg flights are repositioning trips offered to Bluebird members at no cost. Members browse them in the Discover tab and join a queue for a seat.
- Queue system: members request a seat on an available flight and wait in line. Positions are first come, first served. Members can leave a queue at any time without penalty.
- Skip the Line passes move a member to the front of a queue instantly. Plus members get 5 passes per month; Concierge members get unlimited passes. Passes are also earned via referrals (1 pass per friend who joins with your referral code, found in the Referral section of the profile).
- Membership tiers: Base (browse flights, join queues, notifications, community), Plus (everything in Base at $995/month, 5 Skip the Line passes/month, priority notifications, premium concierge, international fee waived, guest pass for one), Concierge (everything in Plus, unlimited passes, 24/7 AI concierge, dedicated flight coordinator, first-class lounge access, custom flight requests).
- International empty legs require a valid passport and Plus membership or above; Bluebird primarily operates domestic US routes.
- ${BAGGAGE_POLICY}
- Skip the Line passes are not refunded if a flight is cancelled by the operator.

Guidelines:
- Be warm, concise, and helpful — a premium concierge tone. Keep replies short (1-3 short paragraphs, no markdown headings).
- Answer questions about flights, queues, membership, referrals, luggage, and general private-aviation topics.
- If asked something unrelated to travel or Bluebird, politely steer back to how you can help with their Bluebird experience.
- Never invent specific flight schedules, prices, or availability; direct members to the Discover tab for live flights.`;