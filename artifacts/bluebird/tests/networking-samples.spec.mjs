import { expect, test } from "@playwright/test";

const API_BASE = (process.env.API_BASE
  ?? (process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}/api`
    : "http://localhost:8080/api")).replace(/\/+$/, "");
const DEMO_MEMBER_PHONE = "+15555550100";
const SAMPLE_REQUEST_IDS = [
  "networking-sample-request-casey",
  "networking-sample-request-morgan",
  "networking-sample-request-taylor",
];

test.setTimeout(120_000);

async function apiRequest(path, { method = "GET", token, body } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    json: await response.json().catch(() => null),
  };
}

async function getDemoSession() {
  const response = await fetch(
    `${API_BASE}/dev/autologin?phone=${encodeURIComponent(DEMO_MEMBER_PHONE)}&redirect=/`,
    { redirect: "manual" },
  );
  if (response.status === 302) {
    const location = response.headers.get("location") ?? "";
    const code = location ? new URL(location).searchParams.get("code") : null;
    const exchanged = code ? await apiRequest(`/dev/exchange/${code}`) : null;
    return {
      token: exchanged?.json?.token,
      user: exchanged?.json?.user ? JSON.parse(exchanged.json.user) : null,
    };
  }

  if (response.status === 200) {
    const html = await response.text();
    const values = new Map();
    for (const match of html.matchAll(
      /localStorage\.setItem\('([^']+)',("(?:\\.|[^"])*")\);/g,
    )) {
      values.set(match[1], JSON.parse(match[2]));
    }
    return {
      token: values.get("bluebird_token"),
      user: values.has("bluebird_user") ? JSON.parse(values.get("bluebird_user")) : null,
    };
  }
  throw new Error(`Demo sign-in failed with HTTP ${response.status}`);
}

test("development networking samples use the real API-backed connection flows", async ({ page }) => {
  const session = await getDemoSession();
  expect(session.token).toBeTruthy();
  expect(session.user?.id).toBeTruthy();

  const initialRestore = await apiRequest("/dev/networking-samples/restore", {
    method: "POST",
  });
  expect(initialRestore.status).toBe(200);

  await page.addInitScript(({ token, user }) => {
    localStorage.setItem("bluebird_token", token);
    localStorage.setItem("bluebird_user", JSON.stringify(user));
  }, session);
  await page.route("**/api/**", (route) => {
    const requestUrl = new URL(route.request().url());
    const apiPath = requestUrl.pathname.replace(/^\/api(?=\/|$)/, "");
    return route.continue({
      url: `${API_BASE}${apiPath}${requestUrl.search}`,
    });
  });

  await page.goto("/connections");
  await expect(page.getByText("DEVELOPMENT ONLY", { exact: true })).toBeVisible();
  await expect(page.getByTestId("restore-networking-samples")).toBeVisible();
  await expect(page.getByTestId("connection-requests-link")).toBeVisible();

  await page.getByTestId("connections-view-messages").click();
  await expect(page.getByText("Yes, looking forward to it. Thanks for reaching out!", { exact: true })).toBeVisible();
  await expect(page.getByText("No messages yet — say hello.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Open conversation with Riley Patel" }).click();
  await expect(page.getByText("Hi! Are you also flying to New York next week?", { exact: true })).toBeVisible();
  await expect(page.getByText("Yes, looking forward to it. Thanks for reaching out!", { exact: true }).last()).toBeVisible();
  await page.getByPlaceholder("Write a message").fill("Sent from the sample conversation screen.");
  await page.getByText("Send", { exact: true }).click();
  await expect(page.getByText("Sent from the sample conversation screen.", { exact: true })).toBeVisible();

  await page.goBack();
  await page.getByRole("button", { name: "Open conversation with Jordan Lee" }).click();
  await expect(page.getByText("Start the conversation with a thoughtful introduction.")).toBeVisible();

  await page.goto("/networking/requests");
  for (const id of SAMPLE_REQUEST_IDS) {
    await expect(page.getByTestId(`request-${id}`)).toBeVisible();
  }
  await page.getByTestId(`request-${SAMPLE_REQUEST_IDS[0]}`).getByText("Accept", { exact: true }).click();
  await expect(page.getByTestId(`request-${SAMPLE_REQUEST_IDS[0]}`)).toHaveCount(0);
  await page.getByTestId(`request-${SAMPLE_REQUEST_IDS[1]}`).getByText("Decline", { exact: true }).click();
  await expect(page.getByTestId(`request-${SAMPLE_REQUEST_IDS[1]}`)).toHaveCount(0);
  await page.getByTestId(`request-${SAMPLE_REQUEST_IDS[2]}`).getByText("Remove", { exact: true }).click();
  await expect(page.getByText("No new requests")).toBeVisible();

  await page.goto("/connections");
  await page.getByTestId("restore-networking-samples").click();
  await expect(page.getByTestId("networking-sample-restore-feedback")).toHaveText(
    "Sample networking data restored.",
  );
  await page.goto("/networking/requests");
  for (const id of SAMPLE_REQUEST_IDS) {
    await expect(page.getByTestId(`request-${id}`)).toBeVisible();
  }
});
