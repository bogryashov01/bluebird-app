import assert from "node:assert/strict";
import {
  BAGGAGE_POLICY,
  getMockReply,
  SYSTEM_PROMPT,
} from "../src/lib/concierge-guidance.ts";

const expectedTerms = ["25 kg per passenger", "aircraft capacity", "operational limitations"];

for (const query of ["What is the baggage policy?", "How much luggage can I bring?"]) {
  const reply = getMockReply(query);
  for (const term of expectedTerms) {
    assert.match(reply, new RegExp(term, "i"), `Fallback reply for "${query}" must include "${term}"`);
  }
}

for (const term of expectedTerms) {
  assert.match(BAGGAGE_POLICY, new RegExp(term, "i"));
  assert.match(SYSTEM_PROMPT, new RegExp(term, "i"), `Live-AI prompt must include "${term}"`);
}

assert.doesNotMatch(`${BAGGAGE_POLICY}\n${SYSTEM_PROMPT}`, /(?:1\s*[-–—]\s*2|2)\s+bags?\s+per\s+seat/i);

console.log("Concierge baggage guidance checks passed.");