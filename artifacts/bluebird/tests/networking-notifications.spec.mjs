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
    expectedPath: "/connections",
    expectedView: "messages",
  },
  {
    name: "unknown notification",
    type: "system",
    data: {},
    expectedPath: "/connections",
    expectedView: "messages",
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
    await expect.poll(() => new URL(page.url()).pathname).toBe(testCase.expectedPath);
    if (testCase.expectedView) {
      await expect(page).toHaveURL(new RegExp(`[?&]view=${testCase.expectedView}(?:&|$)`));
      await expect(page.getByTestId("connections-view-messages")).toHaveAttribute("aria-selected", "true");
    }

    await page.unroute("**/api/**");
  }
});

test("connections hub switches views, includes quiet connections, and opens their thread", async ({ page }) => {
  await signIn(page);
  await page.route("**/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/auth/me") return route.fulfill({ json: user });
    if (pathname === "/api/notifications") return route.fulfill({ json: [] });
    if (pathname === "/api/queue/status") return route.fulfill({ json: [] });
    if (pathname === "/api/networking/connections") {
      return route.fulfill({
        json: [
          {
            id: "connection-1",
            member: { firstName: "Avery", lastName: "Chen", industry: "Design", bio: "Loves coastal travel." },
            lastMessage: {
              id: "message-1",
              senderId: "networking-notification-user",
              content: "Looking forward to the trip.",
              createdAt: "2026-09-20T12:00:00.000Z",
            },
          },
          {
            id: "connection-2",
            member: { firstName: "Jordan", lastName: "Lee", industry: "Technology", bio: "Based in Seattle." },
            lastMessage: null,
          },
        ],
      });
    }
    if (pathname === "/api/networking/requests/incoming") return route.fulfill({ json: [] });
    if (pathname === "/api/networking/connections/connection-2/messages") return route.fulfill({ json: [] });
    return route.continue();
  });

  await page.goto("/connections");
  await expect(page.getByText("Avery Chen", { exact: true })).toBeVisible();
  await expect(page.getByText("Loves coastal travel.", { exact: true })).toBeVisible();

  await page.getByTestId("connections-view-messages").click();
  await expect(page).toHaveURL(/\/connections\?view=messages$/);
  await expect(page.getByText("Looking forward to the trip.", { exact: true })).toBeVisible();
  await expect(page.getByText("No messages yet — say hello.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Open conversation with Jordan Lee" }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/networking/connections/connection-2");
  await expect(page.getByText("Start the conversation with a thoughtful introduction.")).toBeVisible();
});

test("accepting a request refreshes the connections hub when returning", async ({ page }) => {
  await signIn(page);
  let accepted = false;
  const acceptedConnection = {
    id: "connection-3",
    requestId: "request-3",
    memberAId: "networking-notification-user",
    memberBId: "riley-member",
    createdAt: "2026-09-22T12:00:00.000Z",
    member: {
      firstName: "Riley",
      lastName: "Park",
      photoUrl: null,
      photoAssetPath: null,
      industry: "Travel",
      bio: "Often flying out of Seattle.",
    },
    lastMessage: null,
  };

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === "/api/auth/me") return route.fulfill({ json: user });
    if (pathname === "/api/notifications") return route.fulfill({ json: [] });
    if (pathname === "/api/queue/status") return route.fulfill({ json: [] });
    if (request.method() === "GET" && pathname === "/api/networking/connections") {
      return route.fulfill({ json: accepted ? [acceptedConnection] : [] });
    }
    if (request.method() === "GET" && pathname === "/api/networking/requests/incoming") {
      return route.fulfill({
        json: accepted
          ? []
          : [{
              id: "request-3",
              flightId: "flight-3",
              requesterId: "riley-member",
              recipientId: user.id,
              message: "Let's connect.",
              status: "pending",
              createdAt: "2026-09-22T11:00:00.000Z",
              updatedAt: "2026-09-22T11:00:00.000Z",
              requester: { firstName: "Riley", lastName: "Park", industry: "Travel", bio: "Often flying out of Seattle." },
            }],
      });
    }
    if (request.method() === "POST" && pathname === "/api/networking/requests/request-3/decision") {
      accepted = true;
      return route.fulfill({ json: { status: "accepted", connection: { id: "connection-3" } } });
    }
    return route.continue();
  });

  await page.goto("/connections");
  await page.getByRole("button", { name: /Connection requests/ }).click();
  await expect(page.getByText("Riley", { exact: true })).toBeVisible();
  await page.getByText("Accept", { exact: true }).click();
  await expect(page.getByText("No new requests")).toBeVisible();

  await page.goBack();
  await expect(page.getByText("Riley Park", { exact: true })).toBeVisible();
});

test("profile connections and messages shortcuts open the matching hub view", async ({ page }) => {
  await signIn(page);
  await page.route("**/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/auth/me") return route.fulfill({ json: user });
    if (pathname === "/api/notifications" || pathname === "/api/queue/status") {
      return route.fulfill({ json: [] });
    }
    if (pathname === "/api/networking/connections" || pathname === "/api/networking/requests/incoming") {
      return route.fulfill({ json: [] });
    }
    return route.continue();
  });

  await page.goto("/profile");
  await page.getByText("members you’ve met", { exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/connections");
  await expect(page).toHaveURL(/[?&]view=connections(?:&|$)/);

  await page.getByRole("tab", { name: /Profile/ }).click();
  await expect(page.getByText("your recent conversations", { exact: true })).toBeVisible();
  await page.getByText("your recent conversations", { exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/connections");
  await expect(page).toHaveURL(/[?&]view=messages(?:&|$)/);
  await expect(page.getByTestId("connections-view-messages")).toHaveAttribute("aria-selected", "true");
});
