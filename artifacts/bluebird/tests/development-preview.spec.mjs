import { expect, test } from "@playwright/test";

test.setTimeout(120_000);

const clerkAuthEnabled =
  process.env.EXPO_PUBLIC_ENABLE_CLERK_AUTH === "true" &&
  /^pk_test_[A-Za-z0-9_-]{12,}$/.test(
    process.env.EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY ?? "",
  );

const DYNAMIC_PAGES = {
  discover: ["available", "empty", "loading", "api-error"],
  "flight-details": ["default"],
  trips: ["empty", "queued", "confirmed"],
  profile: ["complete", "missing-information"],
  notifications: ["off", "all", "specific"],
  "home-airport": ["default"],
  "payment-methods": ["default"],
};

test("signed-out developers can open every preview without auth or protected API traffic", async ({ page }) => {
  const apiRequests = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) {
      apiRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });

  await page.goto("/development-preview");
  await expect(page.getByTestId("development-preview-hub")).toBeVisible();
  await expect(page.getByText("DEMO / DEVELOPMENT PREVIEW", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => ({
    token: localStorage.getItem("bluebird_token"),
    user: localStorage.getItem("bluebird_user"),
  }))).toEqual({ token: null, user: null });

  for (const pageName of [
    "discover",
    "flight-details",
    "queue",
    "trips",
    "membership",
    "skip-line-pass",
    "profile",
    "notifications",
    "home-airport",
    "payment-methods",
  ]) {
    await page.goto("/development-preview");
    await page.getByTestId(`development-preview-open-${pageName}`).click();
    if (pageName === "queue") {
      await expect(page).toHaveURL(/\/queue\/dev-preview/);
      await expect(page.getByTestId("queue-preview-demo-label")).toContainText("DEMO / DEVELOPMENT PREVIEW");
    } else if (pageName === "membership") {
      await expect(page).toHaveURL(/\/membership\/dev-preview/);
      await expect(page.getByTestId("membership-demo-label")).toContainText("DEMO / DEVELOPMENT PREVIEW");
    } else if (pageName === "skip-line-pass") {
      await expect(page).toHaveURL(/\/queue\/dev-preview/);
      await expect(page.getByTestId("queue-preview-demo-label")).toContainText("DEMO / DEVELOPMENT PREVIEW");
      await expect(page.getByTestId("pass-preview-state-title")).toContainText("DEMO");
    } else {
      await expect(page).toHaveURL(new RegExp(`/development-preview/show\\?preview=${pageName}`));
      await expect(page.getByTestId("development-preview-demo-label")).toHaveText("DEMO / DEVELOPMENT PREVIEW");
      await expect(page.getByTestId(`development-preview-screen-${pageName}`)).toBeVisible();
    }
  }

  for (const [pageName, states] of Object.entries(DYNAMIC_PAGES)) {
    for (const state of states) {
      await page.goto(`/development-preview/show?preview=${pageName}&state=${state}`);
      await expect(page.getByTestId("development-preview-demo-label")).toHaveText("DEMO / DEVELOPMENT PREVIEW");
      await expect(page.getByTestId(`development-preview-screen-${pageName}`)).toBeVisible();
      await expect(page.getByTestId(`development-preview-state-${state}`)).toBeVisible();
    }
  }

  for (const state of ["not-joined", "waiting", "unavailable"]) {
    await page.goto(`/queue/dev-preview?state=${state}`);
    await expect(page.getByTestId("queue-preview-demo-label")).toContainText("DEMO / DEVELOPMENT PREVIEW");
    await expect(page.getByText(/· DEMO/).first()).toBeVisible();
  }
  for (const state of ["pass-non-member", "pass-no-pass", "pass-available", "pass-unavailable"]) {
    await page.goto(`/queue/dev-preview?state=${state}`);
    await expect(page.getByTestId("queue-preview-demo-label")).toContainText("DEMO / DEVELOPMENT PREVIEW");
    await expect(page.getByTestId("pass-preview-state-title")).toContainText("DEMO");
  }
  for (const state of ["non-member", "active-member", "loading", "api-error"]) {
    await page.goto(`/membership/dev-preview?state=${state}`);
    await expect(page.getByTestId("membership-demo-label")).toContainText("DEMO / DEVELOPMENT PREVIEW");
    await expect(page.getByTestId("membership-demo-state-title")).toContainText("DEMO");
  }

  expect(apiRequests).toEqual([]);
});

test("ordinary signed-out routes still follow the existing authentication flow", async ({ page }) => {
  test.skip(clerkAuthEnabled, "This case runs against the Clerk-disabled Preview bundle.");
  await page.goto("/discover");
  await expect(page.getByText("Get Started", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/splash$/);
});

test("direct Preview loads do not restore or change a cached local identity", async ({ page }) => {
  const cachedUser = {
    id: "preview-isolation-member",
    name: "Preview Isolation",
    membershipTier: "plus",
    homeAirports: ["DAL"],
  };
  const apiRequests = [];
  await page.addInitScript(({ user }) => {
    localStorage.setItem("bluebird_token", "preview-isolation-token");
    localStorage.setItem("bluebird_user", JSON.stringify(user));
  }, { user: cachedUser });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) {
      apiRequests.push(`${request.method()} ${url.pathname}`);
    }
  });

  await page.goto("/development-preview/show?preview=discover&state=empty");
  await expect(page.getByTestId("development-preview-screen-discover")).toBeVisible();
  expect(apiRequests).toEqual([]);
  expect(await page.evaluate(() => ({
    token: localStorage.getItem("bluebird_token"),
    user: localStorage.getItem("bluebird_user"),
  }))).toEqual({
    token: "preview-isolation-token",
    user: JSON.stringify(cachedUser),
  });
});

test("opening Preview from a signed-in app screen stops member API traffic", async ({ page }) => {
  const member = {
    id: "preview-transition-member",
    name: "Preview Transition",
    phone: "+15555550199",
    email: "preview-transition@example.test",
    membershipTier: "plus",
    linePassCount: 0,
    homeAirports: ["DAL"],
    notificationChannel: "app",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const apiRequests = [];
  await page.addInitScript(({ user }) => {
    localStorage.setItem("bluebird_token", "preview-transition-token");
    localStorage.setItem("bluebird_user", JSON.stringify(user));
  }, { user: member });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    apiRequests.push(`${request.method()} ${path}`);
    if (path === "/api/auth/me") {
      return route.fulfill({ status: 200, json: member });
    }
    if (request.method() !== "GET") {
      return route.fulfill({ status: 204, body: "" });
    }
    if (
      path === "/api/notifications" ||
      path === "/api/queue/status" ||
      path === "/api/flights/airports" ||
      path === "/api/flights" ||
      path === "/api/trips"
    ) {
      return route.fulfill({ json: [] });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto("/discover");
  await expect(page.getByTestId("discover-greeting")).toContainText(
    /Good (morning|afternoon|evening), Preview/,
  );
  await expect(page.getByTestId("discover-development-preview-entry")).toBeVisible();
  const requestCountBeforePreview = apiRequests.length;

  await page.getByTestId("discover-development-preview-entry").click();
  await expect(page.getByTestId("development-preview-hub")).toBeVisible();
  await page.getByTestId("development-preview-open-profile").click();
  await expect(page.getByTestId("development-preview-screen-profile")).toBeVisible();
  await page.waitForTimeout(250);

  expect(apiRequests.slice(requestCountBeforePreview)).toEqual([]);
});

test("Preview entry from Welcome survives route transitions and browser back", async ({ page }) => {
  const pageErrors = [];
  const apiRequests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) {
      apiRequests.push(`${request.method()} ${url.pathname}`);
    }
  });

  await page.goto("/welcome");
  await expect(page.getByText("Welcome to Bluebird", { exact: true })).toBeVisible();
  await page.getByTestId("welcome-development-preview-entry").click();
  await expect(page.getByTestId("development-preview-hub")).toBeVisible();
  expect(pageErrors).toEqual([]);
  expect(apiRequests).toEqual([]);

  await page.goBack();
  await expect(
    page.getByText(clerkAuthEnabled ? "Sign in to Bluebird" : "Welcome to Bluebird", { exact: true }),
  ).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("Clerk sign-in can open Preview and return without creating a session", async ({ page }) => {
  test.skip(!clerkAuthEnabled, "This case runs against the Clerk-enabled Preview bundle.");
  const pageErrors = [];
  const apiRequests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) {
      apiRequests.push(`${request.method()} ${url.pathname}`);
    }
  });

  await page.goto("/welcome");
  await expect(page.getByText("Welcome to Bluebird", { exact: true })).toBeVisible();
  await page.getByTestId("welcome-phone-entry").click();
  await expect(page.getByTestId("clerk-development-preview-entry")).toBeVisible();
  await page.getByTestId("clerk-development-preview-entry").click();
  await expect(page.getByTestId("development-preview-hub")).toBeVisible();
  expect(pageErrors).toEqual([]);
  expect(apiRequests).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("__clerk_client_jwt"))).toBeNull();

  await page.goBack();
  await expect(page.getByText("Sign in to Bluebird", { exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
