import assert from "node:assert/strict";
import {
  fetchProductionMembershipPlans,
  formatProductionPlanPrice,
  mapProductionMembershipPlans,
  productionPlanFeatureLabel,
  productionPlanPurchaseNotice,
  PRODUCTION_MEMBERSHIP_PLANS_URL,
} from "../scripts/.production-membership-plans.test.mjs";

const responseFixture = {
  plans: [
    {
      tier: "base",
      name: "Base",
      priceUsd: 3995,
      cadence: "annual",
      priceLabel: "$3,995",
      cadenceLabel: "/ year",
      tagline: "The basics to start flying.",
      highlight: false,
    },
    {
      tier: "plus",
      name: "Plus",
      priceUsd: 9995,
      cadence: "annual",
      priceLabel: "$9,995",
      cadenceLabel: "/ year",
      tagline: "Move up the queue with priority access.",
      highlight: true,
    },
  ],
  features: [
    { label: "Unlimited Empty Leg Access", base: true, plus: true },
    { label: "International Empty Legs", base: "Extra Fee", plus: true },
    { label: "Priority Queue Placement", base: false, plus: true },
    { label: "5 Complimentary Skip the Line Upgrades", base: false, plus: true },
    { label: "On Demand Charter", base: "Market Price", plus: "Transparent Cost +20%" },
    { label: "Trip Protection for Charter", base: "Extra Fee", plus: true },
  ],
  cardFeatures: {
    base: [
      "Unlimited Domestic Empty Legs",
      "Standard queue placement",
      "Concierge Support- Standard",
      "Cancel anytime",
    ],
    plus: [
      "Unlimited Domestic & International Empty Legs",
      "Priority queue placement",
      "5 Skip-The-Line upgrades included",
      "Concierge support- Dedicated",
      "Cancel anytime",
    ],
  },
  signupsEnabled: true,
  charterEnabled: false,
  buyNowEnabled: false,
};

const mapped = mapProductionMembershipPlans(responseFixture);
assert.deepEqual(mapped.plans.map(({ tier, name, priceUsd, cadence, priceLabel, cadenceLabel, tagline, highlight }) => ({
  tier, name, priceUsd, cadence, priceLabel, cadenceLabel, tagline, highlight,
})), responseFixture.plans);
assert.equal(formatProductionPlanPrice(mapped.plans[0]), "$3,995 / year");
assert.equal(formatProductionPlanPrice(mapped.plans[1]), "$9,995 / year");
assert.equal(mapped.features[3].label, "5 Complimentary Skip the Line Upgrades");
assert.equal(mapped.features[3].values.base, false);
assert.equal(mapped.features[3].values.plus, true);
assert.equal(productionPlanFeatureLabel(false), "Not included");
assert.equal(productionPlanFeatureLabel("Extra Fee"), "Extra Fee");
assert.deepEqual(mapped.cardFeatures.plus, responseFixture.cardFeatures.plus);
assert.deepEqual(mapped.availability, {
  signupsEnabled: true,
  charterEnabled: false,
  buyNowEnabled: false,
});
assert.equal(
  productionPlanPurchaseNotice(mapped.availability),
  "Membership purchases are currently unavailable.",
);
assert.deepEqual(mapped.plans.map((plan) => plan.tier), ["base", "plus"]);
assert.equal(mapped.plans.some((plan) => plan.tier === "concierge"), false);

assert.throws(
  () => mapProductionMembershipPlans({ ...responseFixture, buyNowEnabled: "false" }),
  /buyNowEnabled.*boolean/i,
);
assert.throws(
  () => mapProductionMembershipPlans({
    ...responseFixture,
    plans: [...responseFixture.plans, responseFixture.plans[0]],
  }),
  /duplicate plan identifiers/i,
);
assert.throws(
  () => mapProductionMembershipPlans({
    ...responseFixture,
    features: [{ label: "Unexpected", base: true }],
  }),
  /missing the "plus" value/i,
);
assert.throws(
  () => mapProductionMembershipPlans({
    ...responseFixture,
    cardFeatures: { base: ["Valid"], plus: "not-an-array" },
  }),
  /cardFeatures\.plus.*array/i,
);
assert.throws(
  () => mapProductionMembershipPlans({ plans: [] }),
  /at least one plan/i,
);

const requests = [];
const fetched = await fetchProductionMembershipPlans({
  fetcher: async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify(responseFixture), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  },
});
assert.equal(requests.length, 1);
assert.equal(requests[0].url, "https://bluebirdjets.com/api/plans");
assert.equal(requests[0].url, PRODUCTION_MEMBERSHIP_PLANS_URL);
assert.equal(requests[0].init.method, "GET");
assert.equal(requests[0].init.headers.Accept, "application/json");
assert.equal(requests[0].init.headers.Authorization, undefined);
assert.equal(requests[0].init.credentials, "omit");
assert.equal(fetched.plans.length, 2);

await assert.rejects(
  () => fetchProductionMembershipPlans({
    fetcher: async () => new Response("unavailable", { status: 503 }),
  }),
  /HTTP 503/i,
);

console.log("Production membership plan read tests passed.");
