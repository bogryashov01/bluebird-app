import { expect, test } from "@playwright/test";

test.setTimeout(120_000);

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
  await page.goto("/discover");
  await expect(page.getByText("Get Started", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/splash$/);
});
