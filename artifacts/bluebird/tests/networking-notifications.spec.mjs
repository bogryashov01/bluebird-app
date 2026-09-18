import { expect, test } from "@playwright/test";

const user = {
  id: "networking-notification-user",
  name: "Networking Member",
  email: "networking@example.test",
  membershipTier: "plus",
  linePassCount: 0,
  homeAirports: ["BFI"],
};

const notificationCases = [
  {
    name: "request",
    type: "networking_request",
    data: { requestId: "request-1", flightId: "flight-1" },
    expectedPath: "/networking/requests",
  },
  {
    name: "accepted request",
    type: "networking_accepted",
    data: { requestId: "request-1", connectionId: "connection-1" },
    expectedPath: "/networking/connections/connection-1",
  },
  {
    name: "declined request",
    type: "networking_declined",
    data: { requestId: "request-1", flightId: "flight-1" },
    expectedPath: "/networking/requests",
  },
  {
    name: "new message",
    type: "networking_message",
    data: { connectionId: "connection-1" },
    expectedPath: "/networking/connections/connection-1",
  },
  {
    name: "incomplete accepted request",
    type: "networking_accepted",
    data: {},
    expectedPath: "/networking/connections",
  },
  {
    name: "unknown notification",
    type: "system",
    data: {},
    expectedPath: "/networking/connections",
  },
];

function notificationFor(testCase) {
  return {
    id: `notification-${testCase.name.replaceAll(" ", "-")}`,
    title: `Networking ${testCase.name}`,
    body: "Tap to open the networking destination.",
    type: testCase.type,
    data: testCase.data,
    read: false,
    createdAt: "2026-09-18T12:00:00.000Z",
  };
}

async function signIn(page) {
  await page.addInitScript(({ user }) => {
    localStorage.setItem("bluebird_token", "mobile-networking-notification-test-token");
    localStorage.setItem("bluebird_user", JSON.stringify(user));
  }, { user });
}

async function mockNetworkingNotificationApi(page, notification) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === "/api/auth/me") {
      return route.fulfill({ json: user });
    }
    if (request.method() === "GET" && path === "/api/notifications") {
      return route.fulfill({ json: [notification] });
    }
    if (request.method() === "GET" && path === "/api/queue/status") {
      return route.fulfill({ json: [] });
    }
    if (request.method() === "POST" && path.endsWith(`/api/notifications/${notification.id}/read`)) {
      return route.fulfill({ json: { ...notification, read: true } });
    }
    if (request.method() === "GET" && path === "/api/networking/requests/incoming") {
      return route.fulfill({ json: [] });
    }
    if (request.method() === "GET" && path === "/api/networking/connections") {
      return route.fulfill({ json: [] });
    }
    if (request.method() === "GET" && path === "/api/networking/connections/connection-1/messages") {
      return route.fulfill({ json: [] });
    }
    return route.continue();
  });
}

test("networking notification taps open their intended mobile destinations", async ({ page }) => {
  await signIn(page);

  for (const testCase of notificationCases) {
    const notification = notificationFor(testCase);
    await mockNetworkingNotificationApi(page, notification);
    await page.goto("/notifications");
    await expect(page.getByText(notification.title, { exact: true })).toBeVisible();

    await page.getByText(notification.title, { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${testCase.expectedPath.replaceAll("/", "\\/")}$`));

    await page.unroute("**/api/**");
  }
});