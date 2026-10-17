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

  await page.goto("/trips");
  await expect(page.getByTestId("queue-preview-demo-label")).toHaveCount(0);
  expect(mutationRequests).toEqual([]);
});
