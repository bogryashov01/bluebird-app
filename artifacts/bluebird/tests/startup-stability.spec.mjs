import { expect, test } from "@playwright/test";

const clerkAuthExpected = process.env.EXPO_PUBLIC_ENABLE_CLERK_AUTH === "true";
const clerkAuthEnabled = clerkAuthExpected &&
  /^pk_test_[A-Za-z0-9_-]{12,}$/.test(process.env.EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY ?? "");

const localUser = {
  id: "startup-preview-member",
  name: "Preview Member",
  phone: "+15555550199",
  email: "preview-member@example.test",
  membershipTier: "plus",
  linePassCount: 0,
  homeAirports: ["APF"],
  notificationChannel: "app",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const plansCatalog = {
  plans: [{
    tier: "base",
    name: "Base",
    priceUsd: 3995,
    cadence: "annual",
    priceLabel: "$3,995",
    cadenceLabel: "/ year",
    tagline: "The basics to start flying.",
    highlight: false,
  }, {
    tier: "plus",
    name: "Plus",
    priceUsd: 9995,
    cadence: "annual",
    priceLabel: "$9,995",
    cadenceLabel: "/ year",
    tagline: "Move up the queue with priority access.",
    highlight: true,
  }],
  features: [],
  cardFeatures: { base: [], plus: [] },
  signupsEnabled: true,
  charterEnabled: false,
  buyNowEnabled: false,
};

async function seedLocalSession(page, user = localUser, token = "local-demo-session") {
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem("bluebird_token", token);
    localStorage.setItem("bluebird_user", JSON.stringify(user));
  }, { token, user });
}

async function stubLocalApi(page, authResponse = { status: 200, body: localUser }) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/me") {
      return route.fulfill({ status: authResponse.status, json: authResponse.body });
    }
    if (path === "/api/networking/profile") {
      return route.fulfill({ status: 403, json: { error: "Membership required" } });
    }
    if (path === "/api/membership") {
      return route.fulfill({ json: { tier: "plus", linePassCount: 0, plans: [] } });
    }
    if (path === "/api/plans") return route.fulfill({ json: plansCatalog });
    if (request.method() !== "GET") return route.fulfill({ status: 204, body: "" });
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
}

test("phone sign-in screens have a working back destination when opened directly", async ({ page }) => {
  test.skip(clerkAuthExpected, "This case runs against the legacy phone sign-in flow.");

  await page.goto("/phone");
  await page.getByLabel("Back", { exact: true }).click();
  await expect(page).toHaveURL(/\/welcome$/);

  await page.goto("/verify-code?phone=%2B15555550199&referralCode=FRIEND");
  await page.getByLabel("Back to phone number", { exact: true }).click();
  await expect(page).toHaveURL(/\/phone\?referralCode=FRIEND$/);
  await expect(page.getByTestId("phone-input")).toBeVisible();
});

test("fresh signed-out startup reaches Welcome and Sign In, and refresh/back stay in auth flow", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Get Started", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/splash$/);

  await page.getByText("Get Started", { exact: true }).click();
  await expect(page.getByText("Welcome to Bluebird", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/welcome$/);

  await page.getByText("Continue with Phone", { exact: true }).click();
  await expect(page).toHaveURL(/\/phone$/);
  await page.goBack();
  await expect(page.getByText("Welcome to Bluebird", { exact: true })).toBeVisible();

  await page.goto("/welcome");
  await page.reload();
  await expect(page.getByText("Welcome to Bluebird", { exact: true })).toBeVisible();
  await expect(page.getByTestId("welcome-development-preview-entry")).toHaveCount(0);
  await expect(page.getByTestId("clerk-api-connection-test")).toHaveCount(0);
  await expect(page.getByTestId("main-bluebird-development-config")).toHaveCount(0);
});

test("empty browser storage keeps root reloads and direct Flights routes signed out", async ({ page }) => {
  const apiPaths = [];
  await page.route("**/api/**", async (route) => {
    apiPaths.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: [] });
  });

  for (const path of ["/", "/discover", "/trips"]) {
    await page.goto(path);
    await expect(page.getByText("Get Started", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/splash$/);
    await expect(page.getByText("Browse available empty legs", { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText("Get Started", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/splash$/);
  }

  expect(apiPaths).not.toContain("/api/empty-legs");
  expect(apiPaths).not.toContain("/api/flights");
  expect(await page.evaluate(() => localStorage.getItem("bluebird_token"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("bluebird_user"))).toBeNull();
});

test("disabled Clerk routes redirect to the unchanged demo sign-in flow without API calls", async ({ page }) => {
  test.skip(clerkAuthExpected, "This case runs against the Clerk-disabled Preview bundle.");
  const memberApiCalls = [];
  await page.route("**/api/**", async (route) => {
    memberApiCalls.push(route.request().url());
    return route.fulfill({ status: 204, body: "" });
  });

  await page.goto("/sign-in");
  await expect(page.getByText("Welcome to Bluebird", { exact: true })).toBeVisible();
  await expect(page.getByText("Continue with Phone", { exact: true })).toBeVisible();
  await expect(page.getByTestId("clerk-sign-in-entry")).toHaveCount(0);
  await expect(page.getByTestId("clerk-sign-up-entry")).toHaveCount(0);

  await page.goto("/sign-up");
  await expect(page.getByText("Welcome to Bluebird", { exact: true })).toBeVisible();
  expect(memberApiCalls).toEqual([]);
});

test("Clerk-enabled Welcome routes the phone journey into Clerk without starting authentication", async ({ page }) => {
  test.skip(!clerkAuthEnabled, "This case runs against the Clerk-enabled Preview bundle.");
  const authApiCalls = [];
  await page.route("**/api/**", async (route) => {
    authApiCalls.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 204, body: "" });
  });

  await page.goto("/welcome");
  await expect(page.getByText("Welcome to Bluebird", { exact: true })).toBeVisible();
  await expect(page.getByText("Continue with Phone", { exact: true })).toBeVisible();
  await expect(page.getByTestId("clerk-api-connection-test")).toHaveCount(0);
  await expect(page.getByTestId("main-bluebird-development-config")).toHaveCount(0);
  expect(authApiCalls).toEqual([]);

  await page.getByTestId("welcome-phone-entry").click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByText("Continue with your phone", { exact: true })).toBeVisible();
  await expect(page.getByTestId("clerk-phone-input")).toBeVisible();
  await expect(page.getByTestId("clerk-go-to-sign-up")).toHaveCount(0);
  await expect(page.getByTestId("clerk-development-preview-entry")).toHaveCount(0);
  expect(authApiCalls).toEqual([]);

  await page.goto("/sign-up");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByText("Continue with your phone", { exact: true })).toBeVisible();
  expect(authApiCalls).toEqual([]);

  await page.goto("/discover");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByText("Browse available empty legs", { exact: true })).toHaveCount(0);
  await page.goto("/development-preview");
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/queue/dev-preview");
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/membership/dev-preview");
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/flight/81001");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByText("Flight Details", { exact: false })).toHaveCount(0);
  expect(authApiCalls).toEqual([]);
});

test("requested Clerk with a missing key shows configuration errors instead of demo phone auth", async ({ page }) => {
  test.skip(!clerkAuthExpected || clerkAuthEnabled, "This case runs with Clerk explicitly requested and no valid Development key.");
  const apiCalls = [];
  await page.route("**/api/**", async (route) => {
    apiCalls.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 204, body: "" });
  });

  await page.goto("/welcome");
  await page.getByTestId("welcome-phone-entry").click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByTestId("clerk-configuration-error")).toHaveText(
    "Sign-in is temporarily unavailable. Please try again later.",
  );
  await expect(page.getByTestId("phone-input")).toHaveCount(0);
  await expect(page.getByTestId("verification-code-input")).toHaveCount(0);

  await page.goto("/sign-up");
  await expect(page.getByTestId("clerk-configuration-error")).toBeVisible();
  await expect(page.getByTestId("phone-input")).toHaveCount(0);
  expect(apiCalls).toEqual([]);
});

test("valid local demo session reaches Discover on startup, direct navigation, and refresh", async ({ page }) => {
  const retainedFocusWarnings = [];
  page.on("console", (message) => {
    if (/aria-hidden/i.test(message.text()) && /focus/i.test(message.text())) {
      retainedFocusWarnings.push(message.text());
    }
  });
  await seedLocalSession(page);
  await stubLocalApi(page);

  await page.goto("/");
  await expect(page.getByText(/Good (morning|afternoon|evening), Preview/)).toBeVisible();
  await expect(page).toHaveURL(/\/discover$/);
  for (const label of ["Discover", "Trips", "Membership", "Profile"]) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText("Connections", { exact: true })).toHaveCount(0);

  await page.goto("/discover");
  await expect(page.getByText("Browse available empty legs", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Good (morning|afternoon|evening), Preview/)).toBeVisible();

  await page.goto("/membership");
  const plansLink = page.getByText("Compare all plans", { exact: true });
  await expect(plansLink).toBeVisible();
  await plansLink.click();
  await expect(page).toHaveURL(/\/membership\/plans$/);
  await expect(page.getByRole("button", { name: "View Details" }).first()).toBeVisible();

  await page.goto("/profile");
  const personalInformation = page.getByText("Personal Information", { exact: true }).first();
  await expect(personalInformation).toBeVisible();
  await personalInformation.click();
  await expect(page).toHaveURL(/\/account\/personal-info$/);
  await expect(page.getByText("Personal Information", { exact: true }).last()).toBeVisible();
  await page.getByTestId("header-back").click();
  await expect(page).toHaveURL(/\/profile$/);
  for (const label of ["Discover", "Trips", "Membership", "Profile"]) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }
  expect(retainedFocusWarnings).toEqual([]);

  await page.getByText("Notification Settings", { exact: true }).click();
  await expect(page).toHaveURL(/\/notifications$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/profile$/);

  page.on("dialog", (dialog) => dialog.accept());
  await page.getByText("Sign Out", { exact: true }).click();
  await expect(page.getByText("Welcome to Bluebird", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("bluebird_token"))).toBeNull();
});

test("malformed cached session is cleared before it can open signed-in routes", async ({ page }) => {
  let authRequests = 0;
  await page.addInitScript(() => {
    localStorage.setItem("bluebird_token", "malformed-local-session");
    localStorage.setItem("bluebird_user", "{");
  });
  await page.route("**/api/auth/me", async (route) => {
    authRequests += 1;
    return route.abort("internetdisconnected");
  });

  await page.goto("/");
  await expect(page.getByText("Get Started", { exact: true })).toBeVisible();
  expect(authRequests).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem("bluebird_token"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("bluebird_user"))).toBeNull();
});

test("expired local session is cleared and returns to the signed-out flow", async ({ page }) => {
  await seedLocalSession(page, localUser, "expired-local-session");
  await stubLocalApi(page, { status: 401, body: { error: "Unauthorized" } });

  await page.goto("/discover");
  await expect(page.getByText("Get Started", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("bluebird_token"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("bluebird_user"))).toBeNull();
});

test("cached local session remains usable when auth validation does not respond", async ({ page }) => {
  test.setTimeout(20_000);
  await seedLocalSession(page);
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/me") {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      return route.fulfill({ json: localUser }).catch(() => {});
    }
    if (request.method() !== "GET") return route.fulfill({ status: 204, body: "" });
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

  await page.goto("/");
  await expect(page.getByText(/Good (morning|afternoon|evening), Preview/)).toBeVisible({ timeout: 9_500 });
  expect(await page.evaluate(() => localStorage.getItem("bluebird_token"))).toBe("local-demo-session");
});
