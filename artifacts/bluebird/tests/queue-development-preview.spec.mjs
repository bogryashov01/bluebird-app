import { expect, test } from "@playwright/test";

test("Queue and Skip the Line Pass previews stay fixture-only and expose requested states", async ({ page }) => {
  const apiRequests = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) {
      apiRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });

  await page.goto("/development-preview");
  await expect(page.getByTestId("development-preview-hub")).toBeVisible();
  await page.getByTestId("development-preview-open-queue").click();
  await expect(page.getByTestId("queue-preview-demo-label")).toContainText("DEMO / DEVELOPMENT PREVIEW");
  for (const state of ["not-joined", "waiting", "unavailable"]) {
    await page.getByTestId(`queue-preview-state-${state}`).click();
    await expect(page.getByTestId("queue-preview-demo-label")).toContainText("DEMO / DEVELOPMENT PREVIEW");
    await expect(page.getByText(/· DEMO/).first()).toBeVisible();
  }

  await page.getByTestId("queue-preview-hub").click();
  await page.locator('[data-testid="development-preview-open-skip-line-pass"]:visible').click();
  for (const state of ["pass-non-member", "pass-no-pass", "pass-available", "pass-unavailable"]) {
    await page.getByTestId(`queue-preview-state-${state}`).click();
    await expect(page.getByTestId("queue-preview-demo-label")).toContainText("DEMO / DEVELOPMENT PREVIEW");
    await expect(page.getByTestId("pass-preview-state-title")).toContainText("DEMO");
  }
  await expect(page.getByRole("button", { name: /simulate pass|preview simulated success/i })).toHaveCount(0);
  expect(apiRequests).toEqual([]);
});
