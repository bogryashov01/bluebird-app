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

function trackQueueMutations(page) {
  const mutations = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() !== "GET" && /\/api\/(?:queue|empty-legs|line-passes|membership|trips)/.test(url.pathname)) {
      mutations.push(`${request.method()} ${url.pathname}`);
    }
  });
  return mutations;
}

async function acknowledgeQueuePolicies(page) {
  await expect(page.getByTestId("queue-continue-button")).toBeDisabled();
  for (const id of [
    "queue-ack-pet-policy",
    "queue-ack-cancellation-risk",
    "queue-ack-baggage-limit",
    "queue-ack-punctuality",
    "bringing-pet-no",
  ]) {
    await page.getByTestId(id).click();
  }
  await expect(page.getByTestId("queue-continue-button")).toBeEnabled();
  await page.getByTestId("queue-continue-button").click();
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
  await expect(page.getByTestId("full-app-demo-upcoming-empty")).toContainText("No flights won yet");
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

  await page.goto("/concierge");
  await expect(page.getByTestId("full-app-demo-denied")).toBeVisible();
  expectAnonymousReadOnlyTraffic(requests);
  expect(externalWrites).toEqual([]);
});

test("domestic live-flight queue, local pass purchase, win, and My Flights persist without backend mutations", async ({ page }) => {
  const requests = trackProductionRequests(page);
  const mutations = trackQueueMutations(page);
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
  await page.getByTestId("full-app-demo-join-queue").click();
  await expect(page.getByTestId("full-app-demo-policy-continue")).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId("full-app-demo-join-queue")).toBeVisible();
  await page.getByTestId("full-app-demo-join-queue").click();
  await page.getByTestId("full-app-demo-policy-continue").click();
  await acknowledgeQueuePolicies(page);
  await expect(page.getByText("You're in the queue")).toBeVisible();
  await page.getByTestId("full-app-demo-joined-view-status").click();
  await expect(page.getByTestId("full-app-demo-queue-status")).toContainText("#1");
  await expect(page.getByTestId("full-app-demo-pass-balance")).toContainText("0 passes");

  await page.reload();
  await expect(page.getByTestId("full-app-demo-queue-status")).toContainText("#1");
  await expect(page.getByTestId("full-app-demo-pass-balance")).toContainText("0 passes");
  await page.goto("/queue/join?flightId=98765");
  await page.getByTestId("queue-continue-button").click();
  await expect(page.getByTestId("full-app-demo-queue-status")).toContainText("#1");
  const queueBeforePassFlow = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("bluebird:full-app-demo:queue:v1") ?? "null"),
  );

  await page.getByTestId("full-app-demo-use-pass").click();
  await expect(page.getByTestId("full-app-demo-empty-pass-message")).toBeVisible();
  await expect(page.getByTestId("full-app-demo-empty-pass-message")).toContainText("No Skip the Line Passes");
  await expect(page.getByTestId("full-app-demo-empty-buy-more")).toBeVisible();
  await expect(page.getByTestId("full-app-demo-cancel-pass")).toBeVisible();
  await page.getByTestId("full-app-demo-cancel-pass").click();
  await expect(page.getByTestId("full-app-demo-queue-status")).toContainText("#1");
  await expect(page.getByTestId("full-app-demo-pass-balance")).toContainText("0 passes");
  expect(await page.evaluate(() =>
    JSON.parse(localStorage.getItem("bluebird:full-app-demo:queue:v1") ?? "null"),
  )).toEqual(queueBeforePassFlow);

  await page.getByTestId("full-app-demo-use-pass").click();
  await page.getByTestId("full-app-demo-empty-buy-more").click();
  await expect(page).toHaveURL(/\/queue\/buy-pass\?/);
  await expect(page).toHaveURL(/entryId=demo-98765/);
  await expect(page).toHaveURL(/flightId=98765/);
  await page.getByTestId("full-app-demo-upgrade-plus").click();
  await expect(page).toHaveURL(/membership\/plans/);
  await page.goBack();
  await expect(page.getByTestId("full-app-demo-buy-pass")).toBeVisible();
  await expect(page.getByText("Local demo purchase — no payment or membership change will be made.")).toBeVisible();

  await page.getByTestId("floating-back").last().click();
  await expect(page.getByTestId("full-app-demo-queue-status")).toContainText("#1");
  await expect(page.getByTestId("full-app-demo-pass-balance")).toContainText("0 passes");
  expect(await page.evaluate(() =>
    JSON.parse(localStorage.getItem("bluebird:full-app-demo:queue:v1") ?? "null"),
  )).toEqual(queueBeforePassFlow);
  expect(mutations).toEqual([]);

  await page.getByTestId("full-app-demo-use-pass").click();
  await page.getByTestId("full-app-demo-empty-buy-more").click();
  await page.getByTestId("full-app-demo-buy-pass").click();
  await expect(page.getByTestId("full-app-demo-confirm-pass")).toBeVisible();
  await expect(page.getByTestId("full-app-demo-pass-balance-confirmation")).toHaveText("1 pass");

  const queueWithPurchasedPass = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("bluebird:full-app-demo:queue:v1") ?? "null"),
  );
  await page.getByTestId("full-app-demo-cancel-pass").click();
  await expect(page.getByTestId("full-app-demo-queue-status")).toContainText("#1");
  await expect(page.getByTestId("full-app-demo-pass-balance")).toContainText("1 pass");
  expect(await page.evaluate(() =>
    JSON.parse(localStorage.getItem("bluebird:full-app-demo:queue:v1") ?? "null"),
  )).toEqual(queueWithPurchasedPass);
  expect(mutations).toEqual([]);

  await page.getByTestId("full-app-demo-use-pass").click();
  await expect(page.getByTestId("full-app-demo-confirm-pass")).toBeVisible();
  await page.getByTestId("full-app-demo-confirm-pass").click();
  await expect(page.getByTestId("pass-celebration")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Flight Secured")).toBeVisible();
  await expect(page.getByText("You're confirmed!")).toBeVisible({ timeout: 10_000 });
  const wonQueueState = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("bluebird:full-app-demo:queue:v1") ?? "null"),
  );
  expect(wonQueueState.passCount).toBe(0);
  expect(wonQueueState.entries).toHaveLength(1);
  expect(wonQueueState.entries[0]).toMatchObject({ flightId: "98765", status: "won", position: 1 });
  await page.getByLabel("Skip celebration").click();
  await expect(page.getByTestId("pass-celebration")).toHaveCount(0);

  // A URL flag is not a win event: reopening the confirmation route cannot replay it.
  await page.goto("/flight/confirmed?flightId=98765&passUsed=1&from=SEA&to=SFO");
  await expect(page.getByTestId("pass-celebration")).toHaveCount(0);
  await expect(page.getByText("You're confirmed!")).toBeVisible();

  await page.goto("/queue/status?flightId=98765");
  await expect(page.getByTestId("full-app-demo-queue-status")).toContainText("Flight won");
  await page.getByTestId("full-app-demo-view-won").click();
  await expect(page).toHaveURL(/\/flight\/98765$/);
  await expect(page.getByTestId("flight-detail-route")).toContainText("SEA → SFO");
  await expect(page.getByTestId("pass-celebration")).toHaveCount(0);
  await page.getByTestId("full-app-demo-view-won-flight").click();
  await expect(page.getByTestId("flight-detail-route")).toContainText("SEA → SFO");
  await expect(page.getByTestId("pass-celebration")).toHaveCount(0);
  await page.goto("/queue/join?flightId=98765");
  await page.getByTestId("queue-continue-button").click();
  await expect(page).toHaveURL(/\/flight\/98765$/);
  await expect(page.getByTestId("flight-detail-route")).toContainText("SEA → SFO");
  await expect(page.getByTestId("pass-celebration")).toHaveCount(0);

  await page.goto("/trips");
  await expect(page.getByTestId("full-app-demo-trips")).toBeVisible();
  await expect(page.getByTestId("trip-card-open-details")).toContainText("FLIGHT WON · DEMO");
  await page.getByTestId("trip-card-open-details").click();
  await expect(page).toHaveURL(/\/flight\/98765$/);
  await expect(page.getByTestId("flight-detail-route")).toContainText("SEA → SFO");
  await expect(page.getByTestId("pass-celebration")).toHaveCount(0);
  await page.goBack();
  await expect(page.getByTestId("trip-card-open-details")).toBeVisible();
  await page.getByTestId("trip-card-open-details").click();
  await expect(page.getByTestId("flight-detail-route")).toContainText("SEA → SFO");
  await expect(page.getByTestId("pass-celebration")).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("flight-detail-route")).toContainText("SEA → SFO");
  await expect(page.getByTestId("pass-celebration")).toHaveCount(0);

  await page.goto("/trips");
  await expect(page.getByTestId("trip-card-open-details")).toContainText("FLIGHT WON · DEMO");
  await page.reload();
  await expect(page.getByTestId("trip-card-open-details")).toContainText("FLIGHT WON · DEMO");
  await page.getByTestId("trip-card-open-details").click();
  await expect(page).toHaveURL(/\/flight\/98765$/);
  await expect(page.getByTestId("flight-detail-route")).toContainText("SEA → SFO");
  await expect(page.getByTestId("pass-celebration")).toHaveCount(0);

  await page.goto("/trips");
  await page.getByTestId("full-app-demo-trips-tab-pending").click();
  await expect(page.getByTestId("full-app-demo-my-queue-empty")).toBeVisible();
  await page.goto("/flight/98765");
  await expect(page.getByTestId("full-app-demo-flight-queue-status")).toContainText("Flight won");
  await expect(page.getByTestId("full-app-demo-view-won-flight")).toBeVisible();

  expect(mutations).toEqual([]);
  expectAnonymousReadOnlyTraffic(requests);
  expect(externalWrites).toEqual([]);
});

test("international Base flow shows the notice and demo-only confirmation before joining", async ({ page }) => {
  const intlFlight = {
    ...liveFlight,
    id: 98766,
    originAirport: "SFO",
    originCity: "San Francisco",
    destinationAirport: "YVR",
    destinationCity: "Vancouver",
    destinationTz: "America/Vancouver",
    isInternational: true,
  };
  const requests = trackProductionRequests(page);
  const mutations = trackQueueMutations(page);
  const externalWrites = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() !== "GET" && !["127.0.0.1", "localhost"].includes(url.hostname)) {
      externalWrites.push(`${request.method()} ${url.hostname}${url.pathname}`);
    }
  });
  await mockProduction(page, async ({ path, method }) => {
    if (method !== "GET") return { status: 405, body: { error: "read only" } };
    if (path === "/api/empty-legs") return { body: [intlFlight] };
    if (path === "/api/empty-legs/98766") return { body: intlFlight };
    if (path.startsWith("/api/airports")) return { body: [] };
    return { status: 404, body: { error: "not found" } };
  });

  await page.goto("/");
  await page.getByTestId("production-flight-card-98766").click();
  await page.getByTestId("full-app-demo-join-queue").click();
  await page.getByTestId("full-app-demo-policy-continue").click();
  await acknowledgeQueuePolicies(page);
  await expect(page.getByText("International Flight Notice")).toBeVisible();
  await expect(page.getByText("Local demo only — continuing records no real card authorization or payment.")).toBeVisible();
  await page.getByTestId("full-app-demo-intl-continue").click();
  await expect(page.getByText("Local Preview outcome")).toBeVisible();
  await expect(page.getByTestId("full-app-demo-confirm-international")).toBeVisible();
  await page.getByTestId("full-app-demo-confirm-international").click();
  await expect(page.getByText("You're in the queue")).toBeVisible();
  await page.getByTestId("full-app-demo-joined-view-status").click();
  await expect(page.getByTestId("full-app-demo-queue-status")).toContainText("#1");

  expect(mutations).toEqual([]);
  expectAnonymousReadOnlyTraffic(requests);
  expect(externalWrites).toEqual([]);
});

test("a live flight that is no longer available cannot start a demo queue", async ({ page }) => {
  const unavailableFlight = { ...liveFlight, status: "cancelled" };
  const requests = trackProductionRequests(page);
  const mutations = trackQueueMutations(page);
  await mockProduction(page, async ({ path }) => {
    if (path === "/api/empty-legs") return { body: [unavailableFlight] };
    if (path === "/api/empty-legs/98765") return { body: unavailableFlight };
    if (path.startsWith("/api/airports")) return { body: [] };
    return { status: 404, body: { error: "not found" } };
  });

  await page.goto("/");
  await page.goto("/flight/98765");
  await expect(page.getByText("Flight no longer available")).toBeVisible();
  await expect(page.getByTestId("full-app-demo-join-queue")).toHaveCount(0);
  expect(mutations).toEqual([]);
  expectAnonymousReadOnlyTraffic(requests);
});

test("an existing local queue closes when its live flight becomes unavailable", async ({ page }) => {
  let liveStatus = "published";
  const requests = trackProductionRequests(page);
  const mutations = trackQueueMutations(page);
  await mockProduction(page, async ({ path }) => {
    const flight = { ...liveFlight, status: liveStatus };
    if (path === "/api/empty-legs") return { body: [flight] };
    if (path === "/api/empty-legs/98765") return { body: flight };
    if (path.startsWith("/api/airports")) return { body: [] };
    return { status: 404, body: { error: "not found" } };
  });

  await page.goto("/");
  await page.getByTestId("production-flight-card-98765").click();
  await page.getByTestId("full-app-demo-join-queue").click();
  await page.getByTestId("full-app-demo-policy-continue").click();
  await acknowledgeQueuePolicies(page);
  await page.getByTestId("full-app-demo-joined-view-status").click();
  await expect(page.getByTestId("full-app-demo-queue-status")).toContainText("Waiting");

  liveStatus = "cancelled";
  await page.reload();
  await expect(page.getByTestId("full-app-demo-queue-status")).toContainText("Queue closed");
  await page.goto("/flight/98765");
  await expect(page.getByTestId("full-app-demo-flight-queue-status")).toContainText("Closed");
  await expect(page.getByTestId("full-app-demo-open-queue-status")).toBeVisible();
  expect(mutations).toEqual([]);
  expectAnonymousReadOnlyTraffic(requests);
});

test("failed live reads still support the approved local queue journey from a fallback fixture", async ({ page }) => {
  const requests = trackProductionRequests(page);
  const mutations = trackQueueMutations(page);
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
  await expect(page.getByTestId("full-app-demo-flight-fixture-badge")).toContainText("LOCAL QUEUE ONLY");
  await page.getByTestId("full-app-demo-join-queue").click();
  await page.getByTestId("full-app-demo-policy-continue").click();
  await acknowledgeQueuePolicies(page);
  await expect(page.getByText("You're in the queue")).toBeVisible();
  await page.getByTestId("full-app-demo-joined-view-status").click();
  await expect(page.getByTestId("full-app-demo-queue-status")).toContainText("#1");
  expect(mutations).toEqual([]);
  expectAnonymousReadOnlyTraffic(requests);
  expect(externalWrites).toEqual([]);
});
