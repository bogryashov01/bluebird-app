import { expect, test } from "@playwright/test";

const localUser = {
  id: "network-reliability-preview",
  name: "Reliability Preview",
  phone: "+15555550199",
  email: "reliability@example.test",
  membershipTier: "plus",
  linePassCount: 0,
  homeAirports: ["DAL"],
};

const airports = {
  DAL: {
    code: "DAL",
    name: "Dallas Love Field",
    city: "Dallas",
    state: "Texas",
    country: "United States",
    latitude: 32.844776,
    longitude: -96.84766,
    tz: "America/Chicago",
    longestRunwayFt: null,
  },
  SFO: {
    code: "SFO",
    name: "San Francisco International",
    city: "San Francisco",
    state: "California",
    country: "United States",
    latitude: 37.6213,
    longitude: -122.379,
    tz: "America/Los_Angeles",
    longestRunwayFt: null,
  },
  MIA: {
    code: "MIA",
    name: "Miami International",
    city: "Miami",
    state: "Florida",
    country: "United States",
    latitude: 25.796011,
    longitude: -80.28975,
    tz: "America/New_York",
    longestRunwayFt: null,
  },
  JFK: {
    code: "JFK",
    name: "John F. Kennedy International",
    city: "New York",
    state: "New York",
    country: "United States",
    latitude: 40.6413,
    longitude: -73.7781,
    tz: "America/New_York",
    longestRunwayFt: null,
  },
};

const flights = [
  {
    id: 81001,
    status: "published",
    originAirport: "DAL",
    originCity: "Dallas",
    destinationAirport: "SFO",
    destinationCity: "San Francisco",
    departureTime: "2026-11-01T10:00:00.000Z",
    aircraftType: "Citation Latitude",
  },
  {
    id: 81002,
    status: "published",
    originAirport: "MIA",
    originCity: "Miami",
    destinationAirport: "JFK",
    destinationCity: "New York",
    departureTime: "2026-11-02T10:00:00.000Z",
    aircraftType: "Citation Latitude",
  },
];

const plansCatalog = {
  plans: [{
    tier: "base",
    name: "Base",
    priceUsd: 3995,
    cadence: "annual",
    priceLabel: "$3,995",
    cadenceLabel: "/ year",
    tagline: "The basics to start flying.",
    highlight: false,
  }, {
    tier: "plus",
    name: "Plus",
    priceUsd: 9995,
    cadence: "annual",
    priceLabel: "$9,995",
    cadenceLabel: "/ year",
    tagline: "Move up the queue with priority access.",
    highlight: true,
  }],
  features: [],
  cardFeatures: { base: [], plus: [] },
  signupsEnabled: true,
  charterEnabled: false,
  buyNowEnabled: false,
};

async function json(route, status, payload, headers = {}) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers,
    body: JSON.stringify(payload),
  });
}

async function setupPreview(page, productionHandler, airportGroups = []) {
  await page.addInitScript((user) => {
    localStorage.setItem("bluebird_token", "network-reliability-local-shell");
    localStorage.setItem("bluebird_user", JSON.stringify(user));
  }, localUser);

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      url.origin === "https://bluebirdjets.com" ||
      url.origin === "https://main-api-development.example.test"
    ) {
      if (url.pathname.startsWith("/api/")) {
        if (request.method() !== "GET") {
          return json(route, 405, { error: "Read-only test blocked a mutation." });
        }
        return productionHandler(route, url);
      }
      return route.continue();
    }

    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (request.method() !== "GET") {
      return json(route, 405, { error: "Read-only test blocked a mutation." });
    }
    if (url.pathname === "/api/auth/me") return json(route, 200, localUser);
    if (url.pathname === "/api/flights/airports") {
      return json(route, 200, airportGroups);
    }
    if (
      url.pathname === "/api/notifications" ||
      url.pathname === "/api/queue/status" ||
      url.pathname === "/api/flights" ||
      url.pathname === "/api/trips"
    ) {
      return json(route, 200, []);
    }
    if (url.pathname === "/api/membership") {
      return json(route, 200, { tier: "plus", plans: [], family: null });
    }
    return json(route, 200, {});
  });
}

function flightDetail(id) {
  return flights.find((flight) => flight.id === id);
}

test("Discover leaves loading after HTTP 500 and 503, then preserves a valid empty result", async ({ page }) => {
  let listRequests = 0;
  await setupPreview(page, async (route, url) => {
    if (url.pathname === "/api/empty-legs") {
      listRequests += 1;
      if (listRequests === 1) return json(route, 500, { error: "simulated" });
      if (listRequests === 2) return json(route, 503, { error: "simulated" });
      return json(route, 200, []);
    }
    return json(route, 503, { error: "Unexpected intercepted production request." });
  });

  await page.goto("/discover");
  await expect(page.getByText("Could not load flights", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("temporarily unavailable", { exact: false })).toHaveCount(0);
  await page.getByText("Try again", { exact: true }).click();
  await expect(page.getByText("No flights match", { exact: true })).toBeVisible();
  expect(listRequests).toBe(3);
  await expect(page.locator('[data-testid^="production-flight-card-"]')).toHaveCount(0);
});

test("offline empty-leg reads show a retry state without exposing raw network errors", async ({ page }) => {
  let listRequests = 0;
  await setupPreview(page, async (route, url) => {
    if (url.pathname === "/api/empty-legs") {
      listRequests += 1;
      if (listRequests <= 2) return route.abort("internetdisconnected");
      return json(route, 200, []);
    }
    return json(route, 503, { error: "Unexpected intercepted production request." });
  });

  await page.goto("/discover");
  await expect(page.getByText("Could not load flights", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Failed to fetch|NetworkError|fetch failed/i)).toHaveCount(0);
  await page.getByText("Try again", { exact: true }).click();
  await expect(page.getByText("No flights match", { exact: true })).toBeVisible();
  expect(listRequests).toBe(3);
});

test("invalid JSON and schemas stay out of demo data and recover only after Retry", async ({ page }) => {
  let listRequests = 0;
  await setupPreview(page, async (route, url) => {
    if (url.pathname === "/api/empty-legs") {
      listRequests += 1;
      if (listRequests === 1) {
        return route.fulfill({ status: 200, contentType: "application/json", body: "{broken json" });
      }
      if (listRequests === 2) return json(route, 200, { flights: [] });
      return json(route, 200, []);
    }
    return json(route, 503, { error: "Unexpected intercepted production request." });
  });

  await page.goto("/discover");
  const error = page.getByText("Could not load flights", { exact: true });
  await expect(error).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/valid JSON|flight array|Unexpected token/i)).toHaveCount(0);
  await expect(page.locator('[data-testid^="production-flight-card-"]')).toHaveCount(0);
  await page.getByText("Try again", { exact: true }).click();
  await expect(error).toBeVisible();
  expect(listRequests).toBe(2);
  await page.getByText("Try again", { exact: true }).click();
  await expect(page.getByText("No flights match", { exact: true })).toBeVisible();
  expect(listRequests).toBe(3);
});

test("public membership plans honor HTTP 429 Retry-After and recover without demo pricing", async ({ page }) => {
  let plansRequests = 0;
  await setupPreview(page, async (route, url) => {
    if (url.pathname === "/api/plans") {
      plansRequests += 1;
      if (plansRequests === 1) {
        return json(route, 429, { error: "simulated rate limit" }, { "Retry-After": "0" });
      }
      return json(route, 200, plansCatalog);
    }
    return json(route, 503, { error: "Unexpected intercepted production request." });
  });

  await page.goto("/membership/plans");
  await expect(page.getByText("$3,995 / year", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("simulated rate limit", { exact: true })).toHaveCount(0);
  expect(plansRequests).toBe(2);
});

test("Flight Details reports a timed-out read and recovers with Retry", async ({ page }) => {
  test.setTimeout(60_000);
  let detailRequests = 0;
  await setupPreview(page, async (route, url) => {
    if (url.pathname === "/api/empty-legs/81001") {
      detailRequests += 1;
      if (detailRequests === 1) {
        await new Promise((resolve) => setTimeout(resolve, 12_000));
        try {
          await json(route, 200, flightDetail(81001));
        } catch {
          // The app's request deadline cancels this simulated stalled response.
        }
        return;
      }
      if (detailRequests === 2) return json(route, 503, { error: "simulated" });
      return json(route, 200, flightDetail(81001));
    }
    return json(route, 503, { error: "Unexpected intercepted production request." });
  });

  await page.goto("/flight/81001");
  await expect(page.getByText("Could not load flight details", { exact: true })).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("flight-detail-retry").click();
  await expect(page.getByText("DAL → SFO", { exact: true })).toBeVisible();
  await expect(page.getByText("Could not load flight details", { exact: true })).toHaveCount(0);
  expect(detailRequests).toBe(3);
});

test("Airport Search shows a 503 state and manual Retry recovers", async ({ page }) => {
  let searchRequests = 0;
  const airportGroups = [{
    city: "Dallas",
    airports: [{ code: "DAL", name: "Dallas Love Field", city: "Dallas" }],
  }];
  await setupPreview(page, async (route, url) => {
    if (url.pathname === "/api/airports/cities") return json(route, 200, []);
    if (url.pathname === "/api/airports/search") {
      searchRequests += 1;
      if (searchRequests <= 2) return json(route, 503, { error: "simulated" });
      return json(route, 200, [airports.DAL]);
    }
    return json(route, 503, { error: "Unexpected intercepted production request." });
  }, airportGroups);

  await page.goto("/airport-picker");
  await page.getByTestId("airport-search-input").fill("DAL");
  await expect(page.getByText("Couldn’t search production airports.", { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("airport-search-retry").click();
  await expect(page.getByTestId("airport-result-DAL")).toBeVisible();
  expect(searchRequests).toBe(3);
});

test("Airport typeahead keeps the latest result when an older response arrives late", async ({ page }) => {
  let dallasRequests = 0;
  const airportGroups = [
    { city: "Dallas", airports: [{ code: "DAL", name: "Dallas Love Field", city: "Dallas" }] },
    { city: "Miami", airports: [{ code: "MIA", name: "Miami International", city: "Miami" }] },
  ];
  await setupPreview(page, async (route, url) => {
    if (url.pathname === "/api/airports/cities") return json(route, 200, []);
    if (url.pathname === "/api/airports/search") {
      const query = url.searchParams.get("q");
      if (query === "DAL") {
        dallasRequests += 1;
        await new Promise((resolve) => setTimeout(resolve, 1200));
        try {
          return await json(route, 200, [airports.DAL]);
        } catch {
          return;
        }
      }
      if (query === "MIA") return json(route, 200, [airports.MIA]);
      return json(route, 200, []);
    }
    return json(route, 503, { error: "Unexpected intercepted production request." });
  }, airportGroups);

  await page.goto("/airport-picker");
  const input = page.getByTestId("airport-search-input");
  await input.fill("DAL");
  await expect.poll(() => dallasRequests).toBe(1);
  await input.fill("MIA");
  await expect(page.getByTestId("airport-result-MIA")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1400);
  await expect(page.getByTestId("airport-result-MIA")).toBeVisible();
  await expect(page.getByTestId("airport-result-DAL")).toHaveCount(0);
});

test("Discover cards open their selected flights and preserve search when returning", async ({ page }) => {
  const mutationRequests = [];
  page.on("request", (request) => {
    if (request.method() !== "GET") {
      mutationRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
  await setupPreview(page, async (route, url) => {
    if (url.pathname === "/api/empty-legs") return json(route, 200, flights);
    if (url.pathname === "/api/empty-legs/81001") return json(route, 200, flightDetail(81001));
    if (url.pathname === "/api/empty-legs/81002") return json(route, 200, flightDetail(81002));
    return json(route, 503, { error: "Unexpected intercepted production request." });
  });

  await page.goto("/discover");
  const search = page.getByPlaceholder("Search routes, airports, aircraft");
  await search.fill("DAL");

  const dallasFlight = page.getByTestId("production-flight-card-81001");
  await expect(dallasFlight).toBeVisible();
  await expect(page.getByTestId("production-flight-card-81002")).toHaveCount(0);
  await dallasFlight.click({ position: { x: 16, y: 16 } });
  await expect(page).toHaveURL(/\/flight\/81001$/);
  await expect(page.getByTestId("flight-detail-route")).toHaveText("DAL → SFO");
  await expect(page.getByText("Sunday, November 1", { exact: false })).toBeVisible();

  await page.goBack();
  await expect(dallasFlight).toBeVisible();
  await expect(search).toHaveValue("DAL");
  await search.fill("MIA");

  const miamiFlight = page.getByTestId("production-flight-card-81002");
  await expect(miamiFlight).toBeVisible();
  await expect(dallasFlight).toHaveCount(0);
  await miamiFlight.click();
  await expect(page).toHaveURL(/\/flight\/81002$/);
  await expect(page.getByTestId("flight-detail-route")).toHaveText("MIA → JFK");
  await expect(page.getByText("Monday, November 2", { exact: false })).toBeVisible();

  await page.goBack();
  await expect(miamiFlight).toBeVisible();
  await expect(search).toHaveValue("MIA");
  expect(mutationRequests).toEqual([]);
});

test("Flight Details keeps the selected flight after navigating while an older read is pending", async ({ page }) => {
  let firstFlightStarted = false;
  await setupPreview(page, async (route, url) => {
    if (url.pathname === "/api/empty-legs") return json(route, 200, flights);
    if (url.pathname === "/api/empty-legs/81001") {
      firstFlightStarted = true;
      await new Promise((resolve) => setTimeout(resolve, 1200));
      try {
        return await json(route, 200, flightDetail(81001));
      } catch {
        return;
      }
    }
    if (url.pathname === "/api/empty-legs/81002") {
      return json(route, 200, flightDetail(81002));
    }
    return json(route, 503, { error: "Unexpected intercepted production request." });
  });

  await page.goto("/discover");
  await page.getByTestId("production-flight-card-81001").click();
  await expect.poll(() => firstFlightStarted).toBe(true);
  await page.goBack();
  await page.getByTestId("production-flight-card-81002").click();
  await expect(page.getByTestId("flight-detail-route")).toHaveText("MIA → JFK");
  await page.waitForTimeout(1400);
  await expect(page.getByTestId("flight-detail-route")).toHaveText("MIA → JFK");
});

test("Map retries missing airport coordinates and does not invent a route", async ({ page }) => {
  let airportLookups = 0;
  await setupPreview(page, async (route, url) => {
    if (url.pathname === "/api/empty-legs") return json(route, 200, [flightDetail(81001)]);
    if (url.pathname === "/api/airports") {
      airportLookups += 1;
      if (airportLookups <= 2) return json(route, 503, { error: "simulated" });
      const codes = url.searchParams.get("codes")?.split(",") ?? [];
      return json(route, 200, codes.map((code) => airports[code]).filter(Boolean));
    }
    return json(route, 503, { error: "Unexpected intercepted production request." });
  });

  await page.goto("/discover");
  await expect(page.getByTestId("production-flight-card-81001")).toBeVisible();
  await page.getByText("Map", { exact: true }).click();
  await expect(page.getByText("Could not load airport locations", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("No flights to display", { exact: true })).toHaveCount(0);
  await page.getByText("Try again", { exact: true }).click();
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await expect(page.getByText("Could not load airport locations", { exact: true })).toHaveCount(0);
  expect(airportLookups).toBe(3);
});

test("Map coordinates stay tied to the latest filtered route when earlier coordinates arrive late", async ({ page }) => {
  let oldAirportLookupStarted = false;
  await setupPreview(page, async (route, url) => {
    if (url.pathname === "/api/empty-legs") return json(route, 200, flights);
    if (url.pathname === "/api/airports") {
      const codes = url.searchParams.get("codes");
      if (codes === "DAL,SFO") {
        oldAirportLookupStarted = true;
        await new Promise((resolve) => setTimeout(resolve, 1200));
        try {
          return await json(route, 200, [airports.DAL, airports.SFO]);
        } catch {
          return;
        }
      }
      if (codes === "MIA,JFK") return json(route, 200, [airports.MIA, airports.JFK]);
      return json(route, 200, []);
    }
    return json(route, 503, { error: "Unexpected intercepted production request." });
  });

  await page.goto("/discover");
  await expect(page.getByTestId("production-flight-card-81001")).toBeVisible();
  const input = page.getByPlaceholder("Search routes, airports, aircraft");
  await input.fill("DAL");
  await page.getByText("Map", { exact: true }).click();
  await expect.poll(() => oldAirportLookupStarted).toBe(true);
  await input.fill("MIA");
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await expect(page.getByText("No flights to display", { exact: true })).toHaveCount(0);
  await page.waitForTimeout(1400);
  await expect(page.getByText("No flights to display", { exact: true })).toHaveCount(0);
  await expect.poll(() => page.locator(".leaflet-overlay-pane path").count()).toBeGreaterThan(0);
});

test("Leaving Membership Plans during a pending public read does not disrupt the next screen", async ({ page }) => {
  let plansStarted = false;
  await setupPreview(page, async (route, url) => {
    if (url.pathname === "/api/plans") {
      plansStarted = true;
      await new Promise((resolve) => setTimeout(resolve, 1200));
      try {
        return await json(route, 200, plansCatalog);
      } catch {
        return;
      }
    }
    if (url.pathname === "/api/empty-legs") return json(route, 200, []);
    return json(route, 503, { error: "Unexpected intercepted production request." });
  });

  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/membership/plans");
  await expect.poll(() => plansStarted).toBe(true);
  await page.goto("/discover");
  await expect(page.getByText("No flights match", { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1400);
  expect(pageErrors).toEqual([]);
  await expect(page.getByText("No flights match", { exact: true })).toBeVisible();
});
