import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";
import {
  DEMO_CONCIERGE_PROMPTS,
  appendDemoConciergeExchange,
  classifyDemoConciergeQuestion,
  createDemoConciergeWelcome,
  replyToDemoConcierge,
} from "../scripts/.demo-concierge.test.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const questions = [
  ["Find available flights", "flights"],
  ["How does the queue work?", "queue"],
  ["What is my queue position?", "position"],
  ["What is Skip the Line?", "skip-line"],
  ["Explain membership options", "tiers"],
  ["What is membership pricing?", "pricing"],
  ["Tell me about international flights", "international"],
  ["What is an International Pass?", "international-pass"],
  ["What happens if I don’t win?", "not-selected"],
  ["What if a flight is cancelled?", "cancellation"],
  ["Can I bring a pet and baggage?", "pets-baggage"],
  ["How do I contact the Bluebird team?", "contact"],
  ["What is the weather in Paris?", "fallback"],
];

function assertNoLiveClaim(text) {
  assert.doesNotMatch(text, /\$\d|guaranteed seat|your position is|booked your|claude|anthropic|openai|sendblue/i);
}

test("prepared answers match the supported concierge questions", () => {
  for (const [question, topic] of questions) {
    const reply = replyToDemoConcierge(question);
    assert.equal(classifyDemoConciergeQuestion(question), topic);
    assert.equal(reply.topic, topic);
    assertNoLiveClaim(reply.text);
    assert.match(reply.text, /demo cannot|This demo|prepared|cannot/i);
  }
  for (const prompt of DEMO_CONCIERGE_PROMPTS) {
    assert.notEqual(classifyDemoConciergeQuestion(prompt.question), "fallback");
  }
});

test("unsupported questions stay on the fallback and invent no live data", () => {
  const reply = replyToDemoConcierge("Can you book seat 2A for me?");
  assert.equal(reply.topic, "fallback");
  assertNoLiveClaim(reply.text);
  assert.match(reply.text, /cannot look up an account/);
});

test("flight context is repeated only as display context", () => {
  const reply = replyToDemoConcierge("Find available flights", { routeLabel: "Austin to Denver" });
  assert.match(reply.text, /Austin to Denver/);
  assert.match(reply.text, /not a new lookup/);
  assertNoLiveClaim(reply.text);
  const general = replyToDemoConcierge("Explain membership options", { routeLabel: "Austin to Denver" });
  assert.doesNotMatch(general.text, /Austin to Denver/);
});

test("conversation state keeps each exchange on the device", () => {
  const welcome = createDemoConciergeWelcome("2026-10-27T20:00:00.000Z");
  const once = appendDemoConciergeExchange([welcome], "How does the queue work?", "2026-10-27T20:01:00.000Z");
  const twice = appendDemoConciergeExchange(once, "What is Skip the Line?", "2026-10-27T20:02:00.000Z");
  assert.equal(twice.length, 5);
  assert.deepEqual(twice.map((message) => message.role), ["assistant", "user", "assistant", "user", "assistant"]);
  assert.equal(twice[1].text, "How does the queue work?");
  assert.equal(twice[2].topic, "queue");
  assert.equal(twice[4].topic, "skip-line");
  assert.equal(appendDemoConciergeExchange(twice, "   ", "2026-10-27T20:03:00.000Z"), twice);
});

test("concierge navigation stays local and does not add a production request", () => {
  const concierge = readFileSync(resolve(projectRoot, "app/concierge.tsx"), "utf8");
  const chat = readFileSync(resolve(projectRoot, "components/DemoConciergeChat.tsx"), "utf8");
  const engine = readFileSync(resolve(projectRoot, "lib/demoConcierge.ts"), "utf8");
  const layout = readFileSync(resolve(projectRoot, "app/_layout.tsx"), "utf8");
  const flight = readFileSync(resolve(projectRoot, "app/flight/[id].tsx"), "utf8");
  const status = readFileSync(resolve(projectRoot, "components/DemoJoinReference.tsx"), "utf8");
  const membership = readFileSync(resolve(projectRoot, "app/(tabs)/membership/index.tsx"), "utf8");
  const discover = readFileSync(resolve(projectRoot, "app/(tabs)/discover/index.tsx"), "utf8");
  const profile = readFileSync(resolve(projectRoot, "app/(tabs)/profile/index.tsx"), "utf8");
  const help = readFileSync(resolve(projectRoot, "app/support/help-center.tsx"), "utf8");
  const trips = readFileSync(resolve(projectRoot, "app/(tabs)/trips/index.tsx"), "utf8");
  const policy = readFileSync(resolve(projectRoot, "lib/nativeAuthTestPolicy.ts"), "utf8");
  const readiness = readFileSync(resolve(projectRoot, "lib/productionQueueReadiness.ts"), "utf8");
  assert.match(layout, /name="concierge"/);
  assert.match(concierge, /if \(authMode === 'clerk'\) \{\s*return <DemoConciergeChat \/>;/);
  assert.match(flight, /pathname: '\/concierge'/);
  assert.match(flight, /joinFlightRouteParams\(productionFlightId, f\)/);
  assert.match(status, /pathname: '\/concierge'/);
  assert.match(status, /joinFlightRouteParams\(entry\.flightId/);
  for (const source of [membership, discover, profile, help, trips]) {
    assert.match(source, /\/concierge/);
  }
  for (const source of [chat, engine]) {
    assert.doesNotMatch(source, /\bfetch\(|anthropic|openai|sendblue|useConciergeChat|joinEmptyLegQueue|skipLine\(/i);
  }
  assert.doesNotMatch(policy, /concierge/);
  assert.match(readiness, /deployedMainService: false/);
});
