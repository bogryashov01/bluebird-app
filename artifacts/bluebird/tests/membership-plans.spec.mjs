import { expect, test } from "@playwright/test";

const PLANS_URL = "https://bluebirdjets.com/api/plans";
const user = {
  id: "plan-catalog-test-user",
  name: "Plan Catalog Tester",
  email: "plans@example.test",
  membershipTier: "none",
  linePassCount: 0,
  homeAirports: ["BFI"],
};

const liveCatalogFixture = {
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
    { label: "5 Complimentary Skip the Line Passes", base: false, plus: true },
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
      "5 Skip the Line Passes included",
      "Concierge support- Dedicated",
      "Cancel anytime",
    ],
  },
  signupsEnabled: true,
  charterEnabled: false,
  buyNowEnabled: false,
};

const legacyDemoPlans = [
  { id: "base", label: "Base demo fallback", priceAnnualUsd: 1, features: ["Demo Base benefit"] },
  { id: "plus", label: "Plus demo fallback", priceAnnualUsd: 2, features: ["Demo Plus benefit"] },
  { id: "concierge", label: "Family/Corporate demo fallback", priceAnnualUsd: 3, features: ["Demo family benefit"] },
];

async function setupMemberPage(page, { productionPlansHandler } = {}) {
  await page.addInitScript(({ signedInUser }) => {
    localStorage.setItem("bluebird_token", "membership-plans-test-token");
    localStorage.setItem("bluebird_user", JSON.stringify(signedInUser));
  }, { signedInUser: user });

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname === "bluebirdjets.com" && url.pathname === "/api/plans") {
      if (productionPlansHandler) return productionPlansHandler(route);
      return route.continue();
    }
    if (url.hostname === "bluebirdjets.com") return route.continue();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (request.method() !== "GET") {
      return route.fulfill({ status: 405, json: { error: "Unexpected mutation in read-only plan test" } });
    }
    if (url.pathname === "/api/auth/me") return route.fulfill({ json: user });
    if (url.pathname === "/api/membership") {
      return route.fulfill({
        json: {
          tier: "none",
          plans: legacyDemoPlans,
          family: null,
          linePassCount: 0,
          totalSavedUsd: 0,
          lifetimeCompletedFlights: 0,
          annualFlightAllowance: 0,
          flightsThisYear: 0,
          features: [],
        },
      });
    }
    if (url.pathname === "/api/queue/status" || url.pathname === "/api/notifications") {
      return route.fulfill({ json: [] });
    }
    return route.fulfill({ json: [] });
  });
}

test("membership plan surfaces render the live public catalog without purchase mutations", async ({ page }) => {
  const plansRequests = [];
  const mutations = [];
  page.on("request", (request) => {
    if (request.url() === PLANS_URL) plansRequests.push(request);
    if (request.method() !== "GET" && new URL(request.url()).pathname.startsWith("/api/")) {
      mutations.push(`${request.method()} ${request.url()}`);
    }
  });
  await setupMemberPage(page);

  await page.goto("/membership/plans");
  await expect(page.getByText("$3,995 / year", { exact: true })).toBeVisible();
  await expect(page.getByText("$9,995 / year", { exact: true })).toBeVisible();
  await expect(page.getByText("The basics to start flying.", { exact: true })).toBeVisible();
  await expect(page.getByText("Move up the queue with priority access.", { exact: true })).toBeVisible();
  await expect(page.getByText("5 Complimentary Skip the Line Passes", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("5 Skip the Line Passes included", { exact: true })).toBeVisible();
  await expect(page.getByText("Signups: enabled · Charter: unavailable · Buy now: unavailable")).toBeVisible();
  await expect(page.getByText("Family/Corporate", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Base demo fallback", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Family/Corporate demo fallback", { exact: true })).toHaveCount(0);

  await page.goto("/membership");
  await expect(page.getByText("The basics to start flying.", { exact: true })).toBeVisible();
  await expect(page.getByText("5 Skip the Line Passes included", { exact: true })).toBeVisible();
  await expect(page.getByText("Purchases unavailable").first()).toBeVisible();
  await expect(page.getByText("Family/Corporate demo fallback", { exact: true })).toHaveCount(0);

  await page.goto("/membership/join?flightId=98765");
  await expect(page.getByText("Membership required", { exact: true })).toBeVisible();
  await expect(page.getByTestId("plan-purchase-unavailable-plus")).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByText("Membership purchases are currently unavailable.", { exact: false })).toBeVisible();

  await page.goto("/upgrade/plus");
  await expect(page.getByText("PUBLIC PRODUCTION PLAN", { exact: true })).toBeVisible();
  await expect(page.getByText("$9,995 / year", { exact: true })).toBeVisible();
  await expect(page.getByText("Membership purchase unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText("Visa •••• 4242", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Due today", { exact: true })).toHaveCount(0);
  expect(mutations).toEqual([]);

  expect(plansRequests.length).toBeGreaterThan(0);
  for (const request of plansRequests) {
    expect(request.method()).toBe("GET");
    const headers = await request.allHeaders();
    expect(headers.authorization).toBeUndefined();
    expect(headers.cookie).toBeUndefined();
  }
});

test("plan loading errors show no demo pricing and retry the public request", async ({ page }) => {
  let requestCount = 0;
  await setupMemberPage(page, {
    productionPlansHandler: async (route) => {
      requestCount += 1;
      if (requestCount <= 2) {
        return route.fulfill({ status: 503, json: { error: "temporarily unavailable" } });
      }
      return route.fulfill({ status: 200, json: liveCatalogFixture });
    },
  });

  await page.goto("/membership/plans");
  await expect(page.getByText("Could not load production plans", { exact: true })).toBeVisible();
  await expect(page.getByText("Plan details are unavailable. Demo pricing is not shown.", { exact: true })).toBeVisible();
  await expect(page.getByText("Base demo fallback", { exact: true })).toHaveCount(0);
  await page.getByText("Try Again", { exact: true }).click();
  await expect(page.getByText("$3,995 / year", { exact: true })).toBeVisible();
  expect(requestCount).toBe(3);
});
