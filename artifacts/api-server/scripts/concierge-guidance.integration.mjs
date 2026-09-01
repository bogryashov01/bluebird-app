import assert from "node:assert/strict";
import {
  BAGGAGE_POLICY,
  getMockReply,
  parseModelReply,
  SYSTEM_PROMPT,
} from "../src/lib/concierge-guidance.ts";

const expectedTerms = ["25 kg per passenger", "aircraft capacity", "operational limitations"];

for (const query of ["What is the baggage policy?", "How much luggage can I bring?"]) {
  const { reply, requiresHumanFollowUp } = getMockReply(query);
  assert.equal(requiresHumanFollowUp, false);
  for (const term of expectedTerms) {
    assert.match(reply, new RegExp(term, "i"), `Fallback reply for "${query}" must include "${term}"`);
  }
}

for (const term of expectedTerms) {
  assert.match(BAGGAGE_POLICY, new RegExp(term, "i"));
  assert.match(SYSTEM_PROMPT, new RegExp(term, "i"), `Live-AI prompt must include "${term}"`);
}

assert.doesNotMatch(`${BAGGAGE_POLICY}\n${SYSTEM_PROMPT}`, /(?:1\s*[-–—]\s*2|2)\s+bags?\s+per\s+seat/i);
for (const query of ["Can my pet fly?", "Where is the FBO?", "How does the queue work?", "Directions to the airport?"]) {
  assert.equal(getMockReply(query).requiresHumanFollowUp, false, `${query} should remain AI-first`);
}
for (const query of ["I have a billing dispute", "I have a safety concern"]) {
  const result = getMockReply(query);
  assert.equal(result.requiresHumanFollowUp, true);
  assert.match(result.reply, /team member will contact/i);
}
assert.match(SYSTEM_PROMPT, /\[\[HUMAN_FOLLOW_UP\]\]/);
assert.match(SYSTEM_PROMPT, /Do not provide or volunteer a phone number/i);
assert.deepEqual(parseModelReply("Routine answer.\n[[ROUTINE]]"), {
  reply: "Routine answer.",
  requiresHumanFollowUp: false,
});
assert.deepEqual(parseModelReply("A team member will contact you.\n[[HUMAN_FOLLOW_UP]]"), {
  reply: "A team member will contact you.",
  requiresHumanFollowUp: true,
});
assert.deepEqual(parseModelReply("Do not expose [[HUMAN_FOLLOW_UP]] in prose."), {
  reply: "Do not expose  in prose.",
  requiresHumanFollowUp: false,
});

console.log("Concierge baggage guidance checks passed.");