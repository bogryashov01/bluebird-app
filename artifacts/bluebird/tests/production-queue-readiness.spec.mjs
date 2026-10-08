import { expect, test } from "@playwright/test";

test.setTimeout(120_000);

function appUrl(baseUrl, path = "") {
  const base = new URL(baseUrl);
  const mountPath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  return new URL(path.replace(/^\/+/, ""), `${base.origin}${mountPath}`).toString();
}

async function installSyntheticLocalShellSession(page) {
  const localUser = {
    id: "stage1-readonly-preview-member",
    firstName: "Preview",
    lastName: "Member",
    email: "preview-member@example.test",
    phone: "+15555550199",
    membershipTier: "plus",
    homeAirports: ["APF"],
    linePassCount: 0,
  };
  await page.addInitScript((user) => {
    localStorage.setItem("bluebird_token", "stage1-readonly-preview-session");
    localStorage.setItem("bluebird_user", JSON.stringify(user));
  }, localUser);
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: localUser }));
}

function isQueueOrAccountStateRequest(requestUrl) {
  const path = new URL(requestUrl).pathname;
  return (
    /\/api\/(?:queue(?:\/|$)|trips(?:\/|$)|flights\/[^/]+\/my-status(?:\/|$))/.test(path) ||
    /\/api\/empty-legs\/\d+\/(?:queue(?:\/|$)|skip-line(?:\/|$)|winner(?:\/|$))/.test(path)
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

  await page.getByText("Map", { exact: true }).click();
  await expect(page.locator(".leaflet-container")).toBeVisible({ timeout: 60_000 });
  await page.getByText("List", { exact: true }).click();

  const testId = await firstCard.getAttribute("data-testid");
  const flightId = Number(testId?.replace("production-flight-card-", ""));
  expect(Number.isSafeInteger(flightId)).toBe(true);
  expect(flightId).toBeGreaterThan(0);

  await firstCard.click();
  await expect(page.getByTestId("production-queue-read-only-cta")).toBeVisible();
  expect(new URL(page.url()).pathname).toMatch(new RegExp(`/flight/${flightId}$`));

  await page.getByTestId("production-queue-read-only-cta").click();
  await expect(page.getByTestId("production-read-only-notice")).toBeVisible();
  await expect(page.getByTestId("production-flight-id")).toHaveText(`Production flight ID: ${flightId}`);

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

test("production plans and Airport Search remain public read-only flows", async ({ page, baseURL }) => {
  const airportSearchResponses = [];
  const blockedRequests = [];
  await installSyntheticLocalShellSession(page);
  page.on("request", (request) => {
    if (isQueueOrAccountStateRequest(request.url())) {
      blockedRequests.push(`${request.method()} ${request.url()}`);
    }
  });
  page.on("response", (response) => {
    if (/^https:\/\/bluebirdjets\.com\/api\/airports\/search(?:\?|$)/.test(response.url())) {
      airportSearchResponses.push(response);
    }
  });

  await page.goto(appUrl(baseURL, "membership/plans"));
  await expect(page.getByText("Plan features", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("5 Skip the Line Passes included", { exact: true })).toBeVisible();
  await expect(page.getByText("Membership purchases are currently unavailable.")).toBeVisible();

  await page.goto(appUrl(baseURL, "airport-picker"));
  const airportSearch = page.getByTestId("airport-search-input");
  await expect(airportSearch).toBeVisible({ timeout: 60_000 });
  await airportSearch.fill("Dallas");
  await expect.poll(() => airportSearchResponses.length, { timeout: 30_000 }).toBeGreaterThan(0);
  expect(airportSearchResponses[0].status()).toBe(200);
  const airports = await airportSearchResponses[0].json();
  expect(airports).toEqual(expect.any(Array));
  expect(airports.length).toBeGreaterThan(0);
  expect(blockedRequests).toEqual([]);
});
