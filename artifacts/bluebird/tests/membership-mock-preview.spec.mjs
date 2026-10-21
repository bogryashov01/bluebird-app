import { expect, test } from "@playwright/test";

const publicPlans = {
  plans: [
    {
      tier: "base",
      name: "Base",
      priceUsd: 3995,
      cadence: "annual",
      priceLabel: "$3,995",
      cadenceLabel: "/ year",
      tagline: "Public Base plan.",
      highlight: false,
    },
  ],
  features: [],
  cardFeatures: { base: [] },
  signupsEnabled: false,
  charterEnabled: false,
  buyNowEnabled: false,
};

test("direct Membership preview is isolated, labeled, and navigates only to public plans", async ({ page }) => {
  const apiRequests = [];
  const protectedRequests = [];
  const writes = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path.endsWith("/api/plans") && request.method() === "GET") {
      apiRequests.push(`${request.method()} ${path}`);
      return route.fulfill({ status: 200, json: publicPlans });
    }
    if (path.includes("/api/")) {
      apiRequests.push(`${request.method()} ${path}`);
      protectedRequests.push(`${request.method()} ${path}`);
      return route.fulfill({ status: 403, json: { error: "Protected endpoint must not be called." } });
    }
    if (request.method() !== "GET") {
      writes.push(`${request.method()} ${path}`);
      return route.fulfill({ status: 405, json: { error: "Unexpected write." } });
    }
    return route.continue();
  });

  await page.goto("/membership/mock-preview");
  await expect(page.getByTestId("membership-mock-preview")).toBeVisible();
  await expect(page.getByTestId("membership-mock-data-badge")).toHaveText("MOCK DATA");
  await expect(page.getByTestId("membership-mock-preview")).toContainText("Base");
  await expect(page.getByTestId("membership-mock-status")).toHaveText("Active");
  await expect(page.getByTestId("membership-mock-detail-status")).toHaveText("Active");

  await page.getByTestId("membership-mock-preview-plans").click();
  await expect(page).toHaveURL(/\/membership\/mock-preview\/plans$/);
  await expect(page.getByTestId("membership-mock-public-plans")).toContainText("PUBLIC CATALOG");
  await expect(page.getByTestId("membership-mock-plan-base")).toContainText("$3,995 / year");
  await page.getByTestId("membership-mock-preview-back").click();
  await expect(page).toHaveURL(/\/membership\/mock-preview$/);
  await expect(page.getByTestId("membership-mock-data-badge").last()).toBeVisible();

  expect(apiRequests).toEqual(["GET /api/plans"]);
  expect(protectedRequests).toEqual([]);
  expect(writes).toEqual([]);
});
