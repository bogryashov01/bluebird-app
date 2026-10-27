/**
 * Prepared Concierge answers for the on-device demo.
 * This module does not call a model, send a message, or read an account.
 */

export const DEMO_CONCIERGE_PROMPTS = [
  { id: 'flights', label: 'Find available flights', question: 'Find available flights' },
  { id: 'queue', label: 'How does the queue work?', question: 'How does the queue work?' },
  { id: 'skip-line', label: 'What is Skip the Line?', question: 'What is Skip the Line?' },
  { id: 'membership', label: 'Explain membership options', question: 'Explain membership options' },
  { id: 'not-selected', label: 'What happens if I don’t win?', question: 'What happens if I don’t win?' },
] as const;

export type DemoConciergeTopic =
  | 'flights'
  | 'queue'
  | 'position'
  | 'skip-line'
  | 'tiers'
  | 'pricing'
  | 'international'
  | 'international-pass'
  | 'not-selected'
  | 'cancellation'
  | 'pets-baggage'
  | 'contact'
  | 'fallback';

export interface DemoConciergeFlightContext {
  routeLabel: string | null;
}

export interface DemoConciergeReply {
  topic: DemoConciergeTopic;
  text: string;
}

export interface DemoConciergeMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  topic?: DemoConciergeTopic;
}

const REPLIES: Record<DemoConciergeTopic, string> = {
  flights: 'Published empty-leg flights are listed in Discover. This demo cannot search live availability or tell you which flights are open. Open Discover to see the flights already loaded in the app.',
  queue: 'Joining a flight places you in that flight’s queue. A place in the queue is not a confirmed seat and does not create a trip. After the queue closes, a selected member still has to confirm before a flight is awarded. This demo cannot join, leave, or change a queue.',
  position: 'A queue position is shown only when a queue response identifies the signed-in member. This demo cannot read that response, so it cannot tell you a position.',
  'skip-line': 'A Skip the Line Pass can apply an existing credit to a flight. Using one does not, by itself, confirm a production seat or close the live queue. This demo cannot see a pass balance or spend a credit.',
  tiers: 'Bluebird memberships include Base and Plus. An active membership and a complete profile are required before a member can join a queue. This demo cannot see which membership is on the account.',
  pricing: 'This demo does not load plan prices. It cannot quote a membership fee, a renewal amount, or any other charge.',
  international: 'Some empty-leg flights are international. An international flight can require pass authorization or a reserved credit. This demo does not calculate a fee and does not show one.',
  'international-pass': 'An International Pass is a credit that may be authorized or reserved for an international flight. This demo cannot tell whether an account has that credit, and it cannot authorize or spend one.',
  'not-selected': 'If you are not selected when a queue closes, no seat is booked and no trip is created from that queue. This demo cannot see the result of a live queue.',
  cancellation: 'Flights may be cancelled or changed for operational reasons. This demo cannot cancel a flight, leave a queue, or tell you the result of a cancellation.',
  'pets-baggage': 'Baggage depends on the aircraft and the space available. A pet can travel only when the operator’s policy allows it. This demo cannot confirm that a specific bag or pet is accepted.',
  contact: 'This demo cannot message the Bluebird team, send an SMS, or create a notification. Written guidance already in the app is in Help Center. Opening it does not contact anyone.',
  fallback: 'This demo can explain flights, the queue, Skip the Line, membership, international flights, pets, baggage, and where to find Help Center. It cannot look up an account or take an action. Try one of the suggested questions.',
};

const RULES: readonly { topic: DemoConciergeTopic; pattern: RegExp }[] = [
  { topic: 'international-pass', pattern: /international pass/ },
  { topic: 'skip-line', pattern: /skip the line|line pass/ },
  { topic: 'position', pattern: /queue position|my position|what position|where am i/ },
  { topic: 'not-selected', pattern: /don't win|do not win|not win|not selected|if i lose/ },
  { topic: 'pricing', pattern: /\b(price|prices|pricing|cost|fee|fees|how much)\b/ },
  { topic: 'tiers', pattern: /membership|tier/ },
  { topic: 'international', pattern: /international/ },
  { topic: 'pets-baggage', pattern: /\b(pet|pets|baggage|luggage|bag|bags)\b/ },
  { topic: 'cancellation', pattern: /cancel/ },
  { topic: 'contact', pattern: /contact|bluebird team|concierge team|\bsupport\b|phone/ },
  { topic: 'queue', pattern: /queue/ },
  { topic: 'flights', pattern: /flight|available/ },
];

export function normalizeDemoConciergeQuestion(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyDemoConciergeQuestion(value: string): DemoConciergeTopic {
  const question = normalizeDemoConciergeQuestion(value);
  return RULES.find((rule) => rule.pattern.test(question))?.topic ?? 'fallback';
}

export function replyToDemoConcierge(
  question: string,
  context: DemoConciergeFlightContext | null = null,
): DemoConciergeReply {
  const topic = classifyDemoConciergeQuestion(question);
  const route = context?.routeLabel?.trim() || null;
  const contextual = route !== null && (
    topic === 'flights' ||
    topic === 'queue' ||
    topic === 'position' ||
    topic === 'international' ||
    topic === 'international-pass' ||
    topic === 'cancellation'
  );
  const text = contextual
    ? `This chat was opened from ${route}. That route is context only, not a new lookup. ${REPLIES[topic]}`
    : REPLIES[topic];
  return { topic, text };
}

export function createDemoConciergeWelcome(now: string): DemoConciergeMessage {
  return {
    id: 'welcome',
    role: 'assistant',
    text: 'Welcome to Bluebird Concierge. These are prepared answers on this device. I can explain queues, membership, and flights. I cannot see an account, search live flights, or change a booking.',
    createdAt: now,
    topic: 'fallback',
  };
}

export function appendDemoConciergeExchange(
  messages: readonly DemoConciergeMessage[],
  question: string,
  now: string,
  context: DemoConciergeFlightContext | null = null,
): readonly DemoConciergeMessage[] {
  const text = question.trim();
  if (!text) return messages;
  const reply = replyToDemoConcierge(text, context);
  return [
    ...messages,
    {
      id: `user-${messages.length + 1}`,
      role: 'user',
      text,
      createdAt: now,
    },
    {
      id: `assistant-${messages.length + 2}`,
      role: 'assistant',
      text: reply.text,
      createdAt: now,
      topic: reply.topic,
    },
  ];
}

export function demoConciergeRouteLabel(input: {
  fromAirport: string | null;
  toAirport: string | null;
  fromCity: string | null;
  toCity: string | null;
} | null): string | null {
  if (!input) return null;
  const from = input.fromCity ?? input.fromAirport;
  const to = input.toCity ?? input.toAirport;
  if (!from || !to) return null;
  return `${from} to ${to}`;
}
