import { expect, test } from "@playwright/test";

test.setTimeout(120_000);

const productionReadFlightFixture = {
  id: 81001,
  status: "published",
  queueClosesAt: "2026-10-31T10:00:00.000Z",
  queueCount: 0,
  memberQueueCount: 0,
  userInQueue: false,
  viewerQueuePosition: 0,
  lockedForFreeUsers: false,
  lineSkipPriceUsd: 2000,
  lineSkipSold: false,
  viewerHasLineSkip: false,
  internationalPassPriceUsd: 0,
  internationalPassRequired: false,
  viewerHasInternationalPass: false,
  viewerIsBookedPassenger: false,
  viewerIsEffectiveWinner: false,
  viewerConfirmationStatus: "not_applicable",
  awardedAt: "",
  originAirport: "DAL",
  originCity: "Dallas",
  destinationAirport: "SFO",
  destinationCity: "San Francisco",
  originTz: "America/Chicago",
  destinationTz: "America/Los_Angeles",
  departureTime: "2026-11-01T10:00:00.000Z",
  arrivalTime: "2026-11-01T13:00:00.000Z",
  aircraftGalleryUrls: [],
  durationHours: 3,
  aircraftType: "Citation Latitude",
  isInternational: false,
  totalPrice: 2000,
  msrpUsd: 30000,
  pricePerHour: 6667,
};

const publicPlansFixture = {
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
  cardFeatures: {
    base: [],
    plus: ["5 Skip the Line Passes included"],
  },
  signupsEnabled: true,
  charterEnabled: false,
  buyNowEnabled: false,
};

const airportFixture = {
  code: "DAL",
  name: "Dallas Love Field",
  city: "Dallas",
  state: "Texas",
  country: "United States",
  latitude: 32.844776,
  longitude: -96.84766,
  tz: "America/Chicago",
  longestRunwayFt: null,
};

const destinationAirportFixture = {
  code: "SFO",
  name: "San Francisco International",
  city: "San Francisco",
  state: "California",
  country: "United States",
  latitude: 37.6213,
  longitude: -122.379,
  tz: "America/Los_Angeles",
  longestRunwayFt: null,
};

function appUrl(baseUrl, path = "") {
  const base = new URL(baseUrl);
  const mountPath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  return new URL(path.replace(/^\/+/, ""), `${base.origin}${mountPath}`).toString();
}

test("production-read preview starts signed out in Welcome and supports browser refresh", async ({ page, baseURL }) => {
  await page.goto(appUrl(baseURL));
  await expect(page.getByText("Get Started", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/splash$/);

  await page.getByText("Get Started", { exact: true }).click();
  await expect(page.getByText("Welcome to Bluebird", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Welcome to Bluebird", { exact: true })).toBeVisible();
});

async function installSyntheticLocalShellSession(page) {
  const localUser = {
    id: "stage1-readonly-preview-member",
    name: "Preview Member",
    phone: "+15555550199",
    firstName: "Preview",
    lastName: "Member",
    email: "preview-member@example.test",
    membershipTier: "plus",
    homeAirports: ["APF"],
    linePassCount: 0,
  };
  await page.addInitScript((user) => {
    localStorage.setItem("bluebird_token", "stage1-readonly-preview-session");
    localStorage.setItem("bluebird_user", JSON.stringify(user));
  }, localUser);
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: localUser }));
  await page.route("**/api/notifications", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/queue/status", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/flights/airports", (route) => route.fulfill({ json: [] }));
  const fulfillReadOnlyApi = (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") {
      return route.fulfill({ status: 405, json: { error: "Production requests are read-only in this test." } });
    }
    if (path === "/api/empty-legs") return route.fulfill({ json: [productionReadFlightFixture] });
    if (/^\/api\/empty-legs\/\d+$/.test(path)) return route.fulfill({ json: productionReadFlightFixture });
    if (path === "/api/plans") return route.fulfill({ json: publicPlansFixture });
    if (path === "/api/airports/search") return route.fulfill({ json: [airportFixture] });
    if (path === "/api/airports/cities") return route.fulfill({ json: [] });
    if (path === "/api/airports") return route.fulfill({ json: [airportFixture, destinationAirportFixture] });
    return route.fulfill({ status: 404, json: { error: "Unmocked production endpoint." } });
  };
  await page.route("https://bluebirdjets.com/api/**", fulfillReadOnlyApi);
  await page.route("https://main-api-development.example.test/api/**", fulfillReadOnlyApi);
}

function isQueueOrAccountStateRequest(requestUrl) {
  const path = new URL(requestUrl).pathname;
  return (
    /\/api\/(?:queue(?:\/|$)|trips(?:\/|$)|flights\/[^/]+\/my-status(?:\/|$))/.test(path) ||
    /\/api\/(?:me(?:\/|$)|membership(?:\/|$)|passengers(?:\/|$)|pets(?:\/|$))/.test(path) ||
    /\/api\/empty-legs\/\d+\/(?:queue(?:\/|$)|skip-line(?:\/|$)|winner(?:\/|$)|passengers(?:\/|$)|pets(?:\/|$))/.test(path)
  );
}

test("production flight ID reaches a read-only queue notice with no queue API calls", async ({ page, baseURL }) => {
  const blockedRequests = [];
  await installSyntheticLocalShellSession(page);
  page.on("request", (request) => {
    if (isQueueOrAccountStateRequest(request.url())) {
      blockedRequests.push(`${request.method()} ${request.url()}`);
    }
  });

  await page.goto(appUrl(baseURL, "discover"));
  const firstCard = page.locator('[data-testid^="production-flight-card-"]').first();
  await expect(firstCard).toBeVisible({ timeout: 60_000 });
  const testId = await firstCard.getAttribute("data-testid");
  const flightId = Number(testId?.replace("production-flight-card-", ""));
  expect(Number.isSafeInteger(flightId)).toBe(true);
  const search = page.getByPlaceholder("Search routes, airports, aircraft");
  await search.fill("DAL");
  await expect(firstCard).toBeVisible();

  await page.getByText("Map", { exact: true }).click();
  await expect(page.locator(".leaflet-container")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".leaflet-overlay-pane path.leaflet-interactive").first()).toBeVisible();
  await expect(search).toHaveValue("DAL");

  await page.getByText("List", { exact: true }).click();

  expect(flightId).toBeGreaterThan(0);
  await firstCard.click();
  await expect(page.getByTestId("production-queue-read-only-cta")).toBeVisible();
  const queueBlockers = page.getByTestId("production-queue-read-only-message");
  await expect(queueBlockers).toHaveText("Queue is temporarily unavailable. Please try again later.");
  await expect(queueBlockers).not.toContainText(/Main API|Clerk|JWT|contract|verification/i);
  await expect(page.getByTestId("flight-info-queue-count")).toHaveCount(0);
  await expect(page.getByTestId("flight-info-status")).toHaveText("Available");
  expect(new URL(page.url()).pathname).toMatch(new RegExp(`/flight/${flightId}$`));
  await page.goBack();
  await expect(page.locator(`[data-testid="production-flight-card-${flightId}"]`)).toBeVisible();
  await expect(search).toHaveValue("DAL");
  await page.locator(`[data-testid="production-flight-card-${flightId}"]`).click();
  await expect(page.getByTestId("production-queue-read-only-cta")).toBeVisible();
  await expect(page.getByText("Request to Join", { exact: true })).toHaveCount(0);
  await expect(page.getByText("WiFi", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Pets", { exact: true })).toHaveCount(0);
  await expect(page.getByText("25 kg per passenger", { exact: true })).toHaveCount(0);
  await expect(page.getByText("$2,000", { exact: true })).toHaveCount(0);
  await expect(page.getByText("$30,000", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Sunday, November 1 · Departs/)).toBeVisible();

  await page.getByTestId("production-queue-read-only-cta").click();
  await expect(page.getByTestId("production-read-only-notice")).toBeVisible();
  await expect(page.getByTestId("production-read-only-notice")).toContainText("Queue is temporarily unavailable. Please try again later.");
  await expect(page.getByTestId("production-read-only-notice")).not.toContainText(/Main API|Clerk|JWT|contract|verification/i);
  await expect(page.getByTestId("production-flight-id")).toHaveCount(0);

  await page.goto(appUrl(baseURL, `flight/${flightId}`));
  await expect(page.getByTestId("production-queue-read-only-cta")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("production-queue-read-only-cta")).toBeVisible();
  const directPage = await page.context().newPage();
  await installSyntheticLocalShellSession(directPage);
  await directPage.goto(appUrl(baseURL, `flight/${flightId}`));
  await expect(directPage.getByTestId("flight-detail-back")).toBeVisible();
  await directPage.getByTestId("flight-detail-back").click();
  await expect(directPage.getByPlaceholder("Search routes, airports, aircraft")).toBeVisible();
  await directPage.close();
  await page.goto(appUrl(baseURL, "flight/not-a-number"));
  await expect(page.getByText("Flight unavailable", { exact: true })).toBeVisible();

  const directQueueRoutes = [
    `queue/join?flightId=${flightId}`,
    `queue/intl-notice?flightId=${flightId}`,
    `queue/production-unavailable?flightId=${flightId}`,
    `queue/payment-review?flightId=${flightId}`,
    `queue/joined?flightId=${flightId}&position=7&totalInQueue=23&departureDate=2099-01-01&departureTime=12%3A00`,
    `queue/status?flightId=${flightId}&entryId=demo-entry`,
    `queue/pass?flightId=${flightId}&entryId=demo-entry&position=7`,
    `queue/buy-pass?flightId=${flightId}&entryId=demo-entry`,
    `flight/confirmed?flightId=${flightId}&passUsed=1`,
  ];

  for (const route of directQueueRoutes) {
    await page.goto(appUrl(baseURL, route));
    const notice = page.getByTestId("production-read-only-notice");
    await expect(notice).toBeVisible();
    const content = await notice.innerText();
    expect(content).not.toMatch(/QUEUE POSITION|pass balance|Use 1 Skip the Line Pass|You're confirmed|Queue closes in|authorization hold|payment successful|\$2,000|probability|chance to win/i);
    expect(content).not.toMatch(/\b(?:7|23)\b/);
  }

  expect(blockedRequests).toEqual([]);
});

test("production plans and configured public Airport Search remain read-only flows", async ({ page, baseURL }) => {
  const airportSearchRequests = [];
  const airportSearchResponses = [];
  const blockedRequests = [];
  await installSyntheticLocalShellSession(page);
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/airports/search") {
      airportSearchRequests.push(request);
    }
    if (isQueueOrAccountStateRequest(request.url())) {
      blockedRequests.push(`${request.method()} ${request.url()}`);
    }
  });
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/api/airports/search") {
      airportSearchResponses.push(response);
    }
  });

  await page.goto(appUrl(baseURL, "membership/plans"));
  await expect(page).toHaveURL(/\/membership\/plans$/);
  await expect(page.getByText("Plan features", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("5 Skip the Line Passes included", { exact: true })).toBeVisible();
  await expect(page.getByText("Membership purchases are currently unavailable.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Plan features", { exact: true }).first()).toBeVisible();

  await page.goto(appUrl(baseURL, "airport-picker"));
  const airportSearch = page.getByTestId("airport-search-input");
  await expect(airportSearch).toBeVisible({ timeout: 60_000 });
  await airportSearch.fill("Dallas");
  await expect.poll(() => airportSearchRequests.length, { timeout: 10_000 }).toBeGreaterThan(0);
  const airportSearchUrl = new URL(airportSearchRequests[0].url());
  // This test's Expo server selects the Development Main API fixture. The
  // production flight-read mode does not retarget airport search.
  expect(airportSearchUrl.origin).toBe("https://main-api-development.example.test");
  expect(airportSearchUrl.pathname).toBe("/api/airports/search");
  expect(airportSearchUrl.searchParams.get("q")).toBe("Dallas");
  await expect.poll(() => airportSearchResponses.length, { timeout: 30_000 }).toBeGreaterThan(0);
  expect(airportSearchResponses[0].status()).toBe(200);
  const airports = await airportSearchResponses[0].json();
  expect(airports).toEqual(expect.any(Array));
  expect(airports.length).toBeGreaterThan(0);
  expect(await airportSearchRequests[0].allHeaders()).not.toHaveProperty("authorization");
  expect(blockedRequests).toEqual([]);
});

test("production membership management stays unavailable without exposing setup details", async ({ page, baseURL }) => {
  const membershipRequests = [];
  await installSyntheticLocalShellSession(page);
  page.on("request", (request) => {
    if (/\/api\/membership(?:\/|$)/.test(new URL(request.url()).pathname)) {
      membershipRequests.push(`${request.method()} ${request.url()}`);
    }
  });

  await page.goto(appUrl(baseURL, "membership/manage"));
  const notice = page.getByTestId("production-membership-management-unavailable");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("We can’t manage your membership right now. Please try again later. No changes were made.");
  await expect(notice).not.toContainText(/Main API|Clerk|JWT|contract|token provider|preview/i);
  expect(membershipRequests).toEqual([]);
});

test("production My Trips, Trip Details, manifest and boarding pass stay unavailable without member-trip requests", async ({ page, baseURL }) => {
  const memberTripRequests = [];
  await installSyntheticLocalShellSession(page);
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (/\/api\/(?:trips(?:\/|$)|passengers(?:\/|$))/.test(path)) {
      memberTripRequests.push(`${request.method()} ${path}`);
    }
  });

  await page.goto(appUrl(baseURL, "trips"));
  await expect(page.getByTestId("production-trips-unavailable")).toBeVisible();
  await expect(page.getByTestId("production-trips-unavailable-title")).toHaveText("Trips unavailable");
  await expect(page.getByTestId("production-trips-unavailable")).not.toContainText(/Main API|Clerk|JWT|contract|verification/i);

  await page.goto(appUrl(baseURL, "trip/21623"));
  await expect(page.getByTestId("production-trip-details-unavailable")).toBeVisible();
  await expect(page.getByTestId("production-trip-details-unavailable-title")).toHaveText("Trip details unavailable");
  await expect(page.getByTestId("production-trip-details-unavailable")).not.toContainText("21623");
  await expect(page.getByTestId("production-trip-details-unavailable")).not.toContainText(/airport|aircraft|confirmed|fbo/i);
  await page.getByTestId("production-trip-details-unavailable-action").click();
  await expect(page).toHaveURL(/\/trips\/?$/);

  await page.goto(appUrl(baseURL, "trip/%40%40%40"));
  await expect(page.getByTestId("trip-availability-state-title")).toHaveText("Trip details unavailable");
  await expect(page.getByTestId("trip-availability-state-description")).toContainText("We couldn’t find this trip.");

  await page.goto(appUrl(baseURL, "trip/21623/passengers"));
  await expect(page.getByTestId("production-passenger-information-unavailable")).toBeVisible();
  await expect(page.getByTestId("production-passenger-information-unavailable")).toContainText("have not been loaded, saved, or submitted");
  await expect(page.getByTestId("production-passenger-information-unavailable")).not.toContainText(/TRAVELER|Primary traveler|Weight ·|Crate ·/i);

  await page.goto(appUrl(baseURL, "trip/21623/boarding-pass"));
  await expect(page.getByTestId("boarding-pass-unavailable")).toContainText("Boarding pass unavailable");
  await expect(page.getByTestId("boarding-pass-unavailable")).toContainText("No pass or QR code has been created");
  await expect(page.getByTestId("boarding-pass-unavailable")).toContainText("Apple Wallet is unavailable");

  await page.goto(appUrl(baseURL, "trip/%40%40%40/passengers"));
  await expect(page.getByTestId("trip-availability-state-title")).toHaveText("Passenger information unavailable");
  await expect(page.getByTestId("trip-availability-state-description")).toContainText("We couldn’t find this trip.");
  expect(memberTripRequests).toEqual([]);
});

test("production profile, membership and saved-passenger screens never fall back to demo account data", async ({ page, baseURL }) => {
  const authenticatedDataRequests = [];
  await installSyntheticLocalShellSession(page);
  page.on("request", (request) => {
    const url = new URL(request.url());
    const appMemberData =
      /\/api\/(?:me(?:\/|$)|membership(?:\/|$)|trips(?:\/|$)|passengers(?:\/|$)|pets(?:\/|$)|queue(?:\/|$)|notifications(?:\/|$))/.test(url.pathname) ||
      /\/api\/empty-legs\/\d+\/(?:queue(?:\/|$)|skip-line(?:\/|$)|winner(?:\/|$)|passengers(?:\/|$)|pets(?:\/|$))/.test(url.pathname);
    const productionAuthenticated =
      url.hostname === "bluebirdjets.com" &&
      /\/api\/(?:auth\/me|me(?:\/|$)|membership(?:\/|$)|trips(?:\/|$)|passengers(?:\/|$)|pets(?:\/|$)|queue(?:\/|$))/.test(url.pathname);
    if (appMemberData || productionAuthenticated) {
      authenticatedDataRequests.push(`${request.method()} ${url.hostname}${url.pathname}`);
    }
  });

  await page.goto(appUrl(baseURL, "profile"));
  await expect(page.getByTestId("production-profile-unavailable")).toBeVisible();
  await expect(page.getByText("Preview Member", { exact: true })).toHaveCount(0);

  await page.goto(appUrl(baseURL, "account/personal-info"));
  await expect(page.getByTestId("production-personal-info-unavailable")).toBeVisible();
  await page.goto(appUrl(baseURL, "account/passengers"));
  await expect(page.getByTestId("production-saved-passengers-unavailable")).toBeVisible();
  await page.goto(appUrl(baseURL, "membership"));
  await expect(page.getByTestId("production-membership-unavailable")).toBeVisible();
  await expect(page.getByTestId("production-membership-unavailable")).not.toContainText(/Main API|Clerk|JWT|contract|verification/i);
  await page.getByTestId("production-membership-unavailable-action").click();
  await expect(page).toHaveURL(/\/membership\/plans$/);
  await expect(page.getByText("Plan features", { exact: true }).first()).toBeVisible({ timeout: 60_000 });

  expect(authenticatedDataRequests).toEqual([]);
});
