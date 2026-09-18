import { expect, test } from "@playwright/test";
import path from "node:path";

const user = {
  id: "profile-photo-user",
  name: "Profile Photo Member",
  email: "profile-photo@example.test",
  membershipTier: "plus",
  linePassCount: 0,
  homeAirports: ["BFI"],
};

const profile = {
  id: "profile-photo-profile",
  userId: user.id,
  firstName: "Profile",
  lastName: "Photo",
  industry: "",
  bio: "",
  linkedinUrl: null,
  instagramUrl: null,
  photoUrl: null,
  photoAssetPath: null,
  completed: false,
  missing: ["industry", "bio", "photo"],
};

test("profile photo picker uploads image bytes on web and previews the result", async ({ page }) => {
  const requests = [];
  const consoleErrors = [];
  let uploadAttempts = 0;

  await page.addInitScript(({ user }) => {
    localStorage.setItem("bluebird_token", "mobile-profile-photo-test-token");
    localStorage.setItem("bluebird_user", JSON.stringify(user));
  }, { user });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathName = url.pathname;

    if (pathName === "/api/auth/me") {
      return route.fulfill({ json: user });
    }
    if (request.method() === "GET" && pathName === "/api/networking/profile") {
      return route.fulfill({ json: profile });
    }
    if (request.method() === "GET" && pathName === "/api/queue/status") {
      return route.fulfill({ json: [] });
    }
    if (request.method() === "GET" && pathName === "/api/notifications") {
      return route.fulfill({ json: [] });
    }
    if (request.method() === "POST" && pathName === "/api/storage/uploads/request-url") {
      const metadata = request.postDataJSON();
      requests.push({ kind: "metadata", metadata });
      return route.fulfill({
        json: {
          uploadURL: "http://127.0.0.1:20105/mock-upload/profile-photo.jpg",
          objectPath: "/objects/uploads/profile-photo.jpg",
          name: metadata.name,
          size: metadata.size,
          contentType: metadata.contentType,
        },
      });
    }
    if (request.method() === "GET" && pathName === "/api/storage/objects/uploads/profile-photo.jpg") {
      return route.fulfill({
        status: 200,
        contentType: "image/jpeg",
        body: Buffer.from("profile photo preview"),
      });
    }
    return route.continue();
  });

  await page.route("http://127.0.0.1:20105/mock-upload/profile-photo.jpg", async (route) => {
    const request = route.request();
    uploadAttempts += 1;
    requests.push({
      kind: "upload",
      method: request.method(),
      contentType: request.headers()["content-type"],
      bodySize: request.postDataBuffer()?.length ?? 0,
    });
    return route.fulfill({ status: uploadAttempts === 1 ? 200 : 500 });
  });

  await page.goto("/account/personal-info");
  await expect(page.getByText("Add profile photo", { exact: true })).toBeVisible();

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByText("Add profile photo", { exact: true }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(path.resolve("../../attached_assets/BlueBird_Icon_RGB_1789739598047.jpg"));

  await expect(page.getByText("Change profile photo", { exact: true })).toBeVisible();
  await expect.poll(() => requests.find((request) => request.kind === "metadata")).toEqual(
    expect.objectContaining({
      metadata: expect.objectContaining({
        contentType: "image/jpeg",
        name: "BlueBird_Icon_RGB_1789739598047.jpg",
        size: 43465,
      }),
    }),
  );
  await expect.poll(() => requests.find((request) => request.kind === "upload")).toEqual(
    expect.objectContaining({
      method: "PUT",
      contentType: "image/jpeg",
      bodySize: 43465,
    }),
  );

  const fileChooserPromiseAfterFailure = page.waitForEvent("filechooser");
  await page.getByText("Change profile photo", { exact: true }).click();
  const fileChooserAfterFailure = await fileChooserPromiseAfterFailure;
  await fileChooserAfterFailure.setFiles(path.resolve("../../attached_assets/BlueBird_Icon_RGB_1789739598047.jpg"));
  await expect(page.getByText("Photo upload failed", { exact: true })).toBeVisible();
  await expect(page.getByText("Change profile photo", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "First name" })).toHaveValue("Profile");
  expect(consoleErrors.join("\n")).not.toContain("validatePath");
});