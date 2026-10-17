import { expect, test } from "@playwright/test";

const plans = {
  plans: [
    {
      tier: "base",
      name: "Base",
      priceUsd: 3995,
      cadence: "annual",
      priceLabel: "$3,995",
      cadenceLabel: "/ year",
      tagline: "Verified Base plan details.",
      highlight: false,
    },
    {
      tier: "plus",
      name: "Plus",
      priceUsd: 9995,
      cadence: "annual",
      priceLabel: "$9,995",
      cadenceLabel: "/ year",
      tagline: "Verified Plus plan details.",
      highlight: true,
    },
  ],
  features: [
    { label: "Domestic flights", base: true, plus: true },
    { label: "International access", base: false, plus: true },
  ],
  cardFeatures: {
    base: ["Verified Base benefit"],
    plus: ["Verified Plus benefit"],
  },
  signupsEnabled: false,
  charterEnabled: false,
  buyNowEnabled: false,
};

function membership(tier, overrides = {}) {
  return {
    tier,
    plans: [],
    family: null,
    linePassCount: 0,
    renewalDate: "2027-04-02",
    features: tier === "none" ? [] : ["Account-confirmed benefit"],
    totalSavedUsd: 0,
    lifetimeCompletedFlights: 0,
    annualFlightAllowance: 10,
    flightsThisYear: 2,
    ...overrides,
  };
}

async function setupLocalMembership(page, {
  accountTier = "none",
  membershipResponse,
  plansResponse = plans,
} = {}) {
  const localUser = {
    id: `membership-mvp-${accountTier}`,
    name: "Membership MVP Tester",
    email: "membership-mvp@example.test",
    // This deliberately disagrees with server membership responses in tests;
    // local cached identity must never establish Membership status.
    membershipTier: accountTier === "none" ? "plus" : "none",
    linePassCount: 91,
    homeAirports: ["DAL"],
  };

  await page.addInitScript((user) => {
    localStorage.setItem("bluebird_token", "membership-mvp-test-token");
    localStorage.setItem("bluebird_user", JSON.stringify(user));
  }, localUser);

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/plans") {
      return route.fulfill({ status: 200, json: plansResponse });
    }
    if (url.hostname === "bluebirdjets.com") return route.continue();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (request.method() !== "GET") {
      return route.fulfill({ status: 405, json: { error: "Unexpected mutation in read-only Membership test" } });
    }
    if (url.pathname === "/api/auth/me") return route.fulfill({ json: localUser });
    if (url.pathname === "/api/membership") {
      if (typeof membershipResponse === "function") return membershipResponse(route);
      return route.fulfill({ status: 200, json: membershipResponse ?? membership("none") });
    }
    if (
      url.pathname === "/api/notifications" ||
      url.pathname === "/api/queue/status" ||
      url.pathname === "/api/trips" ||
      url.pathname === "/api/flights"
    ) {
      return route.fulfill({ status: 200, json: [] });
    }
    return route.fulfill({ status: 200, json: [] });
  });
}

test("Membership status follows the authenticated API and plan details return to Membership without writes", async ({ page }) => {
  const mutations = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && new URL(request.url()).pathname.startsWith("/api/")) {
      mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
  await setupLocalMembership(page, { accountTier: "none", membershipResponse: membership("none") });
  await page.goto("/membership");

  await expect(page.getByText("Not a member yet", { exact: true })).toBeVisible();
  await expect(page.getByTestId("membership-skip-line")).toContainText("active membership is required");
  await expect(page.getByTestId("membership-plan-details-base")).toBeVisible();
  await page.getByTestId("membership-plan-details-base").click();
  await expect(page.getByText("PUBLIC PRODUCTION PLAN", { exact: true })).toBeVisible();
  await expect(page.getByText("$3,995 / year", { exact: true }).last()).toBeVisible();
  await page.getByTestId("header-back").click();
  await expect(page.getByTestId("membership-skip-line")).toBeVisible();
  expect(mutations).toEqual([]);
});

test("active membership and pass availability come only from account API values", async ({ page }) => {
  await setupLocalMembership(page, {
    accountTier: "none",
    membershipResponse: membership("plus", { linePassCount: 3 }),
  });
  await page.goto("/membership");

  await expect(page.getByText("Plus Member", { exact: true })).toBeVisible();
  await expect(page.getByTestId("membership-skip-line")).toContainText("3 account-confirmed passes available");
  await expect(page.getByTestId("membership-benefits")).toContainText("Account-confirmed benefit");
  await expect(page.getByTestId("membership-view-flights")).toBeVisible();
  await expect(page.getByText("91", { exact: true })).toHaveCount(0);
});

test("an absent account pass balance remains unavailable rather than becoming zero", async ({ page }) => {
  await setupLocalMembership(page, {
    accountTier: "none",
    membershipResponse: membership("plus", { linePassCount: undefined }),
  });
  await page.goto("/membership");

  await expect(page.getByTestId("membership-skip-line")).toContainText("Pass balance unavailable");
  await expect(page.getByTestId("membership-skip-line")).not.toContainText("0 available");
});

test("an empty public catalog is explained without showing guessed plan details", async ({ page }) => {
  const emptyCatalog = {
    plans: [],
    features: [],
    cardFeatures: {},
    signupsEnabled: false,
    charterEnabled: false,
    buyNowEnabled: false,
  };
  await setupLocalMembership(page, { plansResponse: emptyCatalog });

  await page.goto("/membership");
  await expect(page.getByTestId("membership-catalog-empty")).toContainText("No public membership plans");
  await expect(page.getByTestId("membership-plan-details-base")).toHaveCount(0);
  await page.goto("/membership/plans");
  await expect(page.getByTestId("membership-catalog-empty")).toContainText("Prices, billing periods, and benefits are unavailable");
  await page.goto("/membership/join");
  await expect(page.getByTestId("membership-catalog-empty")).toContainText("No public membership plans");
});

test("membership loading is visible until the account response arrives", async ({ page }) => {
  let releaseResponse;
  const pendingResponse = new Promise((resolve) => { releaseResponse = resolve; });
  await setupLocalMembership(page, {
    membershipResponse: async (route) => {
      await pendingResponse;
      await route.fulfill({ status: 200, json: membership("none") });
    },
  });

  await page.goto("/membership");
  await expect(page.getByTestId("membership-loading")).toBeVisible();
  releaseResponse();
  await expect(page.getByText("Not a member yet", { exact: true })).toBeVisible();
});

test("an API failure is not shown as non-membership", async ({ page }) => {
  await setupLocalMembership(page, {
    accountTier: "none",
    membershipResponse: (route) => route.fulfill({ status: 503, json: { error: "unavailable" } }),
  });
  await page.goto("/membership");

  await expect(page.getByText("Membership status unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText(/does not mean your membership has ended/i)).toBeVisible();
  await expect(page.getByText("Not a member yet", { exact: true })).toHaveCount(0);
});

test("returning from membership-required details keeps the selected flight context", async ({ page }) => {
  await setupLocalMembership(page);
  await page.goto("/membership/join?flightId=98765");
  await expect(page.getByTestId("membership-return-to-flight")).toBeVisible();
  await page.getByTestId("membership-return-to-flight").click();
  await expect(page).toHaveURL(/\/flight\/98765$/);
  await expect(page).not.toHaveURL(/discover/);
});

test("Membership DEMO preview states are isolated, labeled, and never issue API requests", async ({ page }) => {
  const apiRequests = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url());
  });

  await page.goto("/membership/dev-preview?state=non-member");
  await expect(page.getByTestId("membership-demo-label")).toContainText("DEMO");
  for (const state of ["non-member", "active-member", "unavailable", "loading", "api-error"]) {
    await page.getByTestId(`membership-demo-state-${state}`).click();
    await expect(page.getByTestId("membership-demo-state-title")).toContainText("DEMO");
    if (state === "loading") {
      await expect(page.getByTestId("membership-demo-loading")).toBeVisible();
    }
  }
  expect(apiRequests).toEqual([]);
});
