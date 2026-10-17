import { expect, test } from "@playwright/test";

test("signed-out development can open the isolated membership DEMO preview without Main API requests", async ({ page }) => {
  const apiRequests = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) apiRequests.push(`${request.method()} ${url.pathname}`);
  });

  await page.goto("/membership/dev-preview?state=active-member");
  await expect(page.getByTestId("membership-demo-label")).toContainText("DEMO");
  await expect(page.getByTestId("membership-demo-state-title")).toContainText("Plus member");
  expect(apiRequests).toEqual([]);
});
