import { expect, test } from "@playwright/test";

test("DEMO queue previews show isolated fixture states and never submit a queue mutation", async ({ page }) => {
  const mutationRequests = [];
  const demoUser = {
    id: "queue-preview-member",
    name: "Queue Preview Member",
    email: "queue-preview@example.test",
    membershipTier: "plus",
    linePassCount: 0,
    homeAirports: ["DAL"],
  };
  await page.addInitScript((user) => {
    localStorage.setItem("bluebird_token", "queue-preview-local-session");
    localStorage.setItem("bluebird_user", JSON.stringify(user));
  }, demoUser);
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me") return route.fulfill({ json: demoUser });
    if (
      path === "/api/notifications" ||
      path === "/api/queue/status" ||
      path === "/api/trips" ||
      path === "/api/flights"
    ) {
      return route.fulfill({ json: [] });
    }
    return route.continue();
  });
  page.on("request", (request) => {
    if (
      request.method() !== "GET" &&
      /\/api\/(?:queue(?:\/|$)|empty-legs\/\d+\/(?:queue|skip-line|winner)(?:\/|$))/.test(
        new URL(request.url()).pathname,
      )
    ) {
      mutationRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });

  await page.goto("/discover");
  await expect(page.getByTestId("discover-queue-demo-preview")).toBeVisible();
  await expect(page.getByText("DAL → SFO", { exact: true })).toHaveCount(0);
  await page.getByTestId("discover-queue-demo-preview").click();
  await expect(page.getByTestId("queue-preview-demo-label")).toHaveText("DEMO PREVIEW · NOT A REAL QUEUE");
  await expect(page.getByText("Queue eligible · simulated", { exact: true })).toBeVisible();
  await expect(page.getByText(/does not check account or membership state/i)).toBeVisible();

  await page.getByText("Preview join loading", { exact: true }).click();
  await expect(page.getByText("Joining queue…", { exact: true })).toBeVisible();
  await expect(page.getByText(/does not send a request/i)).toBeVisible();
  await page.getByText("Preview confirmed response", { exact: true }).click();
  await expect(page.getByText("You're in the queue", { exact: true })).toBeVisible();
  await expect(page.getByText(/simulated response · not a real queue entry/i)).toBeVisible();
  await page.getByText("Preview waiting status", { exact: true }).click();
  await expect(page.getByText("Waiting · DEMO", { exact: true })).toBeVisible();

  for (const state of ["unavailable", "selected", "winner"]) {
    await page.getByTestId(`queue-preview-state-${state}`).click();
    await expect(page.getByTestId("queue-preview-demo-label")).toBeVisible();
    if (state === "unavailable") {
      await expect(page.getByText("Flight unavailable", { exact: true })).toBeVisible();
    } else {
      await expect(page.getByText(new RegExp(`${state} · simulated`, "i"))).toBeVisible();
    }
  }

  for (const state of [
    "pass-no-pass",
    "pass-unavailable",
    "pass-available",
    "pass-loading",
    "pass-success",
    "pass-failure",
  ]) {
    await page.getByTestId(`queue-preview-state-${state}`).click();
    await expect(page.getByTestId("queue-preview-demo-label")).toHaveText("DEMO — NOT A REAL BOOKING");
    await expect(page.getByText(/· DEMO/).first()).toBeVisible();
  }

  await page.getByTestId("queue-preview-state-pass-available").click();
  const startRedemption = page.getByTestId("pass-preview-start-redemption");
  await startRedemption.evaluate((element) => {
    element.click();
    element.click();
  });
  await expect(page.getByTestId("pass-preview-state-title")).toHaveText("Redemption loading · DEMO");
  await expect(page.getByText(/No API request or pass use occurs/)).toBeVisible();
  await page.getByText("Preview simulated success", { exact: true }).click();
  await expect(page.getByTestId("pass-preview-demo-booking-label")).toHaveText("DEMO — NOT A REAL BOOKING");
  await expect(page.getByText("DAL → SFO · Citation Latitude · Saturday, November 7 at 10:00 AM", { exact: true })).toBeVisible();
  await expect(page.getByText(/No trip, queue entry, identity, membership, or pass balance was created or changed/)).toBeVisible();

  await page.getByTestId("queue-preview-state-pass-failure").click();
  await expect(page.getByTestId("pass-preview-state-title")).toHaveText("Simulated booking failure · DEMO");
  await expect(page.getByText(/No booking, pass use, or API request occurred/)).toBeVisible();

  await page.goto("/trips");
  await expect(page.getByTestId("queue-preview-demo-label")).toHaveCount(0);
  expect(mutationRequests).toEqual([]);
});
