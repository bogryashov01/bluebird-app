import { expect, test } from "@playwright/test";

const liveFlight = {
  id: 98765,
  status: "published",
  originAirport: "SEA",
  originCity: "Seattle",
  originTz: "America/Los_Angeles",
  destinationAirport: "SFO",
  destinationCity: "San Francisco",
  destinationTz: "America/Los_Angeles",
  departureTime: "2026-11-01T16:00:00.000Z",
  arrivalTime: "2026-11-01T18:05:00.000Z",
  durationHours: 2.1,
  aircraftType: "Light jet",
  aircraftTypeName: "Cessna Citation CJ3",
  aircraftTypeCode: "C525B",
  aircraftGalleryUrls: [],
  queueCount: 3,
  totalPrice: 7800,
  isInternational: false,
};

function trackProductionRequests(page) {
  const requests = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname === "bluebirdjets.com") {
      const headers = request.headers();
      requests.push({
        method: request.method(),
        path: url.pathname,
        hasAuthorization: Boolean(headers.authorization),
        hasCookie: Boolean(headers.cookie),
      });
    }
  });
  return requests;
}

async function mockProduction(page, response) {
  await page.route("https://bluebirdjets.com/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const result = await response({ path: url.pathname, method: request.method() });
    return route.fulfill({
      status: result.status ?? 200,
      headers: { "access-control-allow-origin": "*" },
      contentType: "application/json",
      body: JSON.stringify(result.body ?? {}),
    });
  });
}

function expectAnonymousReadOnlyTraffic(requests) {
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every((request) =>
    request.method === "GET" && !request.hasAuthorization && !request.hasCookie,
  )).toBe(true);
}

test("the regular Bluebird tabs and flight detail work in the identity-free demo", async ({ page }) => {
  const requests = trackProductionRequests(page);
  const externalWrites = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() !== "GET" && !["127.0.0.1", "localhost"].includes(url.hostname)) {
      externalWrites.push(`${request.method()} ${url.hostname}${url.pathname}`);
    }
  });
  await mockProduction(page, async ({ path }) => {
    if (path === "/api/empty-legs") return { body: [liveFlight] };
    if (path === "/api/empty-legs/98765") return { body: liveFlight };
    if (path.startsWith("/api/airports")) return { body: [] };
    return { status: 404, body: { error: "not found" } };
  });

  await page.goto("/");
  await expect(page.getByTestId("full-app-demo-banner")).toContainText("DEMO MODE");
  await expect(page.getByTestId("production-flight-card-98765")).toBeVisible();
  await expect(page.getByRole("tab", { name: /Discover/ })).toBeVisible();

  await page.getByRole("tab", { name: /Membership/ }).click();
  await expect(page.getByTestId("full-app-demo-membership")).toContainText("Base");
  await expect(page.getByTestId("full-app-demo-membership")).toContainText("Active");

  await page.getByRole("tab", { name: /Profile/ }).click();
  await expect(page.getByTestId("full-app-demo-profile")).toContainText("Sample profile");
  await expect(page.getByText("Paul Mulko")).toBeVisible();
  await expect(page.getByText("Appearance", { exact: true })).toBeVisible();
  await expect(page.getByTestId("full-app-demo-disabled-profile-row")).toHaveAttribute("aria-disabled", "true");

  await page.getByRole("tab", { name: /Trips/ }).click();
  await expect(page.getByTestId("full-app-demo-upcoming-empty")).toContainText("No upcoming bookings");
  await page.getByTestId("full-app-demo-trips-tab-pending").click();
  await expect(page.getByTestId("full-app-demo-my-queue-empty")).toContainText("No simulated flights yet");

  await page.getByRole("tab", { name: /Discover/ }).click();
  await expect(page.getByTestId("production-flight-card-98765")).toBeVisible();
  await page.getByTestId("production-flight-card-98765").click();
  await expect(page.getByTestId("flight-detail-route")).toContainText("SEA → SFO");
  await expect(page.getByTestId("flight-info-aircraft-type")).toContainText("Cessna Citation CJ3");
  await expect(page.getByTestId("full-app-demo-join-queue")).toBeVisible();
  await expect(page.getByTestId("flight-skip-line-pass-card")).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByText("Ask AI Concierge", { exact: true })).toHaveCount(0);

  await page.goto("/flight/98765");
  await expect(page.getByTestId("full-app-demo-denied")).toBeVisible();
  expectAnonymousReadOnlyTraffic(requests);
  expect(externalWrites).toEqual([]);
});

test("live queue join and leave stay local and appear consistently on My Flights", async ({ page }) => {
  const requests = trackProductionRequests(page);
  const externalWrites = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() !== "GET" && !["127.0.0.1", "localhost"].includes(url.hostname)) {
      externalWrites.push(`${request.method()} ${url.hostname}${url.pathname}`);
    }
  });
  await mockProduction(page, async ({ path, method }) => {
    if (method !== "GET") return { status: 405, body: { error: "read only" } };
    if (path === "/api/empty-legs") return { body: [liveFlight] };
    if (path === "/api/empty-legs/98765") return { body: liveFlight };
    if (path.startsWith("/api/airports")) return { body: [] };
    return { status: 404, body: { error: "not found" } };
  });

  await page.goto("/");
  await page.getByTestId("production-flight-card-98765").click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("full-app-demo-join-queue").click();
  await expect(page.getByTestId("full-app-demo-queue-status")).toContainText("#1");
  await expect(page.getByTestId("full-app-demo-leave-queue")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("full-app-demo-queue-status")).toContainText("#1");
  await expect(page.getByTestId("full-app-demo-leave-queue")).toBeVisible();
  await page.getByTestId("flight-detail-back").click();
  await page.getByRole("tab", { name: /Trips/ }).click();
  await page.getByTestId("full-app-demo-trips-tab-pending").click();
  const queuedFlight = page.getByTestId("trip-card-open-details");
  await expect(queuedFlight).toContainText("SIMULATED QUEUE · #1");
  await expect(queuedFlight).toContainText("Seattle → San Francisco");
  await queuedFlight.click();
  await expect(page.getByTestId("full-app-demo-queue-status")).toContainText("#1");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("full-app-demo-leave-queue").click();
  await expect(page.getByTestId("full-app-demo-join-queue")).toBeVisible();
  await page.getByTestId("flight-detail-back").click();
  await page.getByTestId("full-app-demo-trips-tab-pending").click();
  await expect(page.getByTestId("full-app-demo-my-queue-empty")).toBeVisible();

  expectAnonymousReadOnlyTraffic(requests);
  expect(externalWrites).toEqual([]);
});

test("failed live flight reads fall back to typed fixture cards and details without queue actions", async ({ page }) => {
  const requests = trackProductionRequests(page);
  const externalWrites = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() !== "GET" && !["127.0.0.1", "localhost"].includes(url.hostname)) {
      externalWrites.push(`${request.method()} ${url.hostname}${url.pathname}`);
    }
  });
  await mockProduction(page, async ({ path }) => {
    if (path.startsWith("/api/empty-legs")) return { status: 503, body: { error: "temporarily unavailable" } };
    return { status: 404, body: { error: "not found" } };
  });

  await page.goto("/");
  const fixtureCard = page.getByTestId("full-app-demo-fixture-card-98765");
  await expect(fixtureCard).toBeVisible();
  await expect(page.getByTestId("full-app-demo-fixture-badge-98765")).toContainText("SAMPLE DATA");
  await fixtureCard.click();
  await expect(page.getByTestId("flight-detail-route")).toContainText("SEA → SFO");
  await expect(page.getByTestId("full-app-demo-flight-fixture-badge")).toContainText("QUEUE DISABLED");
  await expect(page.getByText("Sample flight · queue disabled", { exact: true })).toBeVisible();
  await expect(page.getByTestId("full-app-demo-join-queue")).toHaveCount(0);
  expectAnonymousReadOnlyTraffic(requests);
  expect(externalWrites).toEqual([]);
});
