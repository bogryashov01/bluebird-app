import { expect, test } from "@playwright/test";

test("full-app demo navigates locally without production requests or writes", async ({ page }) => {
  const apiRequests = [];
  const writes = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const method = request.method();
    if (url.pathname.includes("/api/") || url.hostname === "bluebirdjets.com") {
      apiRequests.push(`${method} ${url.origin}${url.pathname}`);
    }
    if (method !== "GET" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      writes.push(`${method} ${url.origin}${url.pathname}`);
    }
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.includes("/api/") || url.hostname === "bluebirdjets.com") {
      return route.fulfill({ status: 451, json: { error: "API access is disabled in the local demo test." } });
    }
    return route.continue();
  });

  await page.goto("/");
  await expect(page.getByTestId("full-app-demo-banner")).toContainText("DEMO MODE");
  await expect(page.getByTestId("full-app-demo-flight-empty")).toContainText("Local demo");
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
  await expect(page.getByTestId("full-app-demo-flight-empty")).toBeVisible();
  await expect(page.getByTestId("full-app-demo-banner")).toBeVisible();

  await page.getByRole("tab", { name: /Trips/ }).click();
  await expect(page.getByTestId("full-app-demo-trips-empty")).toContainText("not connected");
  await expect(page.getByTestId("full-app-demo-banner")).toBeVisible();

  await page.goto("/concierge");
  await expect(page.getByTestId("full-app-demo-denied")).toContainText("Demo unavailable");
  await page.goto("/demo/concierge");
  await expect(page.getByTestId("full-app-demo-denied")).toContainText("Demo unavailable");

  expect(apiRequests).toEqual([]);
  expect(writes).toEqual([]);
});
