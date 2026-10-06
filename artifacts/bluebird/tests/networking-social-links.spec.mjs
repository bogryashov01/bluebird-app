import { expect, test } from "@playwright/test";

const user = {
  id: "social-link-viewer",
  name: "Social Link Viewer",
  email: "viewer@example.test",
  membershipTier: "plus",
  linePassCount: 0,
  homeAirports: ["BFI"],
};

test("social links are usable only while a connection is accepted", async ({ page }) => {
  let accepted = false;
  await page.context().route("https://www.facebook.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<title>Facebook profile</title>" }));
  await page.addInitScript(({ user }) => {
    localStorage.setItem("bluebird_token", "social-link-viewer-token");
    localStorage.setItem("bluebird_user", JSON.stringify(user));
  }, { user });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/auth/me") return route.fulfill({ json: user });
    if (pathname === "/api/queue/status" || pathname === "/api/notifications") {
      return route.fulfill({ json: [] });
    }
    if (pathname === "/api/networking/connections/connection-social/messages") {
      return route.fulfill({ json: [] });
    }
    if (pathname === "/api/networking/connections") {
      return route.fulfill({
        json: accepted ? [{
          id: "connection-social",
          member: {
            firstName: "Pat", lastName: "Flyer", industry: "Aviation", bio: "Pilot",
            linkedinUrl: "https://www.linkedin.com/in/pat",
            facebookUrl: "https://www.facebook.com/pat",
            instagramUrl: "https://www.instagram.com/pat",
          },
          lastMessage: null,
        }] : [],
      });
    }
    return route.continue();
  });

  await page.goto("/networking/connections/connection-social");
  await expect(page.getByText("Start the conversation with a thoughtful introduction.")).toBeVisible();
  await expect(page.getByText("Facebook", { exact: true })).toHaveCount(0);
  accepted = true;
  await page.reload();
  for (const platform of ["LinkedIn", "Facebook", "Instagram"]) {
    await expect(page.getByTestId(`connection-${platform.toLowerCase()}-link`)).toBeVisible();
  }
  const popupPromise = page.waitForEvent("popup");
  await page.getByTestId("connection-facebook-link").click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/^https:\/\/www\.facebook\.com\/pat/);
  await popup.close();
  accepted = false;
  await page.reload();
  await expect(page.getByText("Facebook", { exact: true })).toHaveCount(0);
});