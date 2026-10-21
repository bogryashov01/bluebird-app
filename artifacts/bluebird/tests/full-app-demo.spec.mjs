import { expect, test } from "@playwright/test";

const demoFlight = {
  id: 98765,
  status: "published",
  originAirport: "SEA",
  originCity: "Seattle",
  destinationAirport: "SFO",
  destinationCity: "San Francisco",
  originTz: "America/Los_Angeles",
  departureTime: "2026-11-01T13:00:00.000Z",
  aircraftGalleryUrls: [],
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

async function routeProductionApi(page, respond) {
  await page.route("https://bluebirdjets.com/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname === "bluebirdjets.com") {
      const result = await respond({ path: url.pathname, method: request.method() });
      return route.fulfill({
        status: result.status ?? 200,
        headers: { "access-control-allow-origin": "*" },
        contentType: "application/json",
        body: JSON.stringify(result.body ?? {}),
      });
    }
    return route.continue();
  });
}

test("demo preserves its local identity fixtures while opening live flights read-only", async ({ page }) => {
  const requests = trackProductionRequests(page);
  const externalWrites = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() !== "GET" && !["127.0.0.1", "localhost"].includes(url.hostname)) {
      externalWrites.push(`${request.method()} ${url.hostname}${url.pathname}`);
    }
  });
  await routeProductionApi(page, async ({ path }) => {
    if (path === "/api/empty-legs") return { body: [demoFlight] };
    if (path === "/api/empty-legs/98765") return { body: demoFlight };
    if (path === "/api/empty-legs/98765/queue") {
      return { status: 403, body: { error: "forbidden" } };
    }
    return { status: 404, body: { error: "not found" } };
  });
  await page.goto("/");
  await expect(page.getByTestId("full-app-demo-banner")).toContainText("DEMO MODE");
  await expect(page.getByRole("tab", { name: /Membership/ })).toBeVisible();

  await page.getByRole("tab", { name: /Membership/ }).click();
  await expect(page.getByTestId("full-app-demo-membership")).toContainText("Base");
  await expect(page.getByTestId("full-app-demo-membership")).toContainText("Active");
  await page.getByTestId("full-app-demo-browse-plans").click();
  await expect(page.getByTestId("full-app-demo-plans")).toContainText("Plan catalog unavailable");
  await expect(page.getByTestId("full-app-demo-banner")).toBeVisible();
  await page.getByTestId("header-back").click();
  await expect(page.getByTestId("full-app-demo-membership")).toBeVisible();

  await page.getByRole("tab", { name: /Profile/ }).click();
  await expect(page.getByTestId("full-app-demo-profile")).toContainText("Paul Mulko");
  await expect(page.getByTestId("full-app-demo-profile")).toContainText("Admin flag");
  await expect(page.getByTestId("full-app-demo-profile")).toContainText("Concierge flag");
  await expect(page.getByTestId("full-app-demo-admin-flag")).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByTestId("full-app-demo-concierge-flag")).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByTestId("full-app-demo-banner")).toBeVisible();

  await page.getByRole("tab", { name: /Discover/ }).click();
  await expect(page.getByTestId("production-flight-card-98765")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Map" })).toHaveCount(0);
  await expect(page.getByTestId("full-app-demo-banner")).toBeVisible();
  await page.getByTestId("production-flight-card-98765").click();
  await expect(page.getByTestId("full-app-demo-flight-summary")).toContainText("SEA → SFO");
  await expect(page.getByTestId("full-app-demo-queue-endpoint-error"))
    .toContainText("GET /api/empty-legs/98765/queue — HTTP 403");
  await expect(page.getByTestId("full-app-demo-banner")).toBeVisible();
  await page.getByTestId("full-app-demo-flight-back").click();
  await expect(page.getByTestId("production-flight-card-98765")).toBeVisible();

  await page.getByRole("tab", { name: /Trips/ }).click();
  await expect(page.getByTestId("full-app-demo-trips-empty")).toContainText("not connected");
  await expect(page.getByTestId("full-app-demo-banner")).toBeVisible();

  await page.goto("/concierge");
  await expect(page.getByTestId("full-app-demo-denied")).toContainText("Demo unavailable");
  await page.goto("/demo/concierge");
  await expect(page.getByTestId("full-app-demo-denied")).toContainText("Demo unavailable");

  await page.goto("/flight/98765");
  await expect(page.getByTestId("full-app-demo-denied")).toContainText("Demo unavailable");
  expect(requests).toHaveLength(3);
  expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
    "GET /api/empty-legs",
    "GET /api/empty-legs/98765",
    "GET /api/empty-legs/98765/queue",
  ]);
  expect(requests.every((request) =>
    request.method === "GET" && !request.hasAuthorization && !request.hasCookie,
  )).toBe(true);
  expect(externalWrites).toEqual([]);
});

test("successful public queue projection never treats a demo profile as the viewer", async ({ page }) => {
  const requests = trackProductionRequests(page);
  await routeProductionApi(page, async ({ path }) => {
    if (path === "/api/empty-legs") return { body: [demoFlight] };
    if (path === "/api/empty-legs/98765") return { body: demoFlight };
    if (path === "/api/empty-legs/98765/queue") {
      return {
        body: [
          { position: 1, initials: "AB", tier: "base", hasLineSkip: false, isViewer: true },
          { position: 2, initials: "CD", tier: "plus", hasLineSkip: true, isViewer: false },
        ],
      };
    }
    return { status: 404, body: { error: "not found" } };
  });
  await page.goto("/");
  await page.getByTestId("production-flight-card-98765").click();
  await expect(page.getByTestId("full-app-demo-queue-entry-1")).toContainText("AB");
  await expect(page.getByTestId("full-app-demo-queue-entry-1")).toContainText("Position 1");
  await expect(page.getByTestId("full-app-demo-queue-entry-2")).toContainText("Line skip");
  await expect(page.getByTestId("full-app-demo-queue")).not.toContainText("isViewer");
  await expect(page.getByTestId("full-app-demo-queue")).not.toContainText("Paul");
  await expect(page.getByTestId("full-app-demo-banner")).toBeVisible();
  expect(requests.every(({ method, hasAuthorization, hasCookie }) =>
    method === "GET" && !hasAuthorization && !hasCookie,
  )).toBe(true);
});

test("queue access denial displays the actual 401 status and exact endpoint", async ({ page }) => {
  await routeProductionApi(page, async ({ path }) => {
    if (path === "/api/empty-legs") return { body: [demoFlight] };
    if (path === "/api/empty-legs/98765") return { body: demoFlight };
    if (path === "/api/empty-legs/98765/queue") {
      return { status: 401, body: { error: "unauthorized" } };
    }
    return { status: 404, body: { error: "not found" } };
  });
  await page.goto("/");
  await page.getByTestId("production-flight-card-98765").click();
  await expect(page.getByTestId("full-app-demo-queue-endpoint-error"))
    .toContainText("GET /api/empty-legs/98765/queue — HTTP 401");
});

test("Discover shows API failure, retry, and live empty states", async ({ page }) => {
  const requests = trackProductionRequests(page);
  let inventoryReads = 0;
  await routeProductionApi(page, async ({ path }) => {
    if (path !== "/api/empty-legs") return { status: 404, body: { error: "not found" } };
    inventoryReads += 1;
    if (inventoryReads === 1) await new Promise((resolve) => setTimeout(resolve, 700));
    return inventoryReads <= 2
      ? { status: 503, body: { error: "temporarily unavailable" } }
      : { body: [] };
  });
  await page.goto("/");
  await expect(page.getByTestId("full-app-demo-discover-loading")).toBeVisible();
  await expect(page.getByText("Could not load live flights (HTTP 503).")).toBeVisible();
  await page.getByTestId("discover-flight-retry").click();
  await expect(page.getByTestId("full-app-demo-flight-empty")).toContainText("No live flights");
  expect(inventoryReads).toBe(3);
  expect(requests.every(({ method, hasAuthorization, hasCookie }) =>
    method === "GET" && !hasAuthorization && !hasCookie,
  )).toBe(true);
});
