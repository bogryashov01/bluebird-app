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

const profileWithExistingPhoto = {
  ...profile,
  photoUrl: "/api/storage/objects/uploads/current-profile-photo.jpg",
  photoAssetPath: "/objects/uploads/current-profile-photo.jpg",
};

async function setupProfilePhotoPage(page, profileData = profile) {
  const requests = [];
  let uploadAttempts = 0;

  await page.addInitScript(({ user }) => {
    localStorage.setItem("bluebird_token", "mobile-profile-photo-test-token");
    localStorage.setItem("bluebird_user", JSON.stringify(user));
  }, { user });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathName = url.pathname;

    if (pathName === "/api/auth/me") {
      return route.fulfill({ json: user });
    }
    if (request.method() === "GET" && pathName === "/api/networking/profile") {
      return route.fulfill({ json: profileData });
    }
    if (request.method() === "GET" && pathName === "/api/queue/status") {
      return route.fulfill({ json: [] });
    }
    if (request.method() === "GET" && pathName === "/api/notifications") {
      return route.fulfill({ json: [] });
    }
    if (
      request.method() === "GET" &&
      ["/api/storage/objects/uploads/current-profile-photo.jpg", "/api/storage/objects/uploads/profile-photo.jpg"]
        .includes(pathName)
    ) {
      return route.fulfill({
        status: 200,
        contentType: "image/jpeg",
        body: Buffer.from("profile photo preview"),
      });
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
  return { requests };
}

test("profile photo picker uploads image bytes on web and previews the result", async ({ page }) => {
  const consoleErrors = [];
  const { requests } = await setupProfilePhotoPage(page);

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

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

test("profile photo picker rejects unsupported formats before requesting storage", async ({ page }) => {
  const { requests } = await setupProfilePhotoPage(page, profileWithExistingPhoto);
  const firstName = page.getByRole("textbox", { name: "First name" });
  const bio = page.getByPlaceholder("What would you enjoy talking about?");

  await expect(page.getByText("Change profile photo", { exact: true })).toBeVisible();
  await firstName.fill("Edited");
  await bio.fill("An edited profile bio");

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByText("Change profile photo", { exact: true }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: "profile.gif",
    mimeType: "image/gif",
    buffer: Buffer.from("unsupported profile photo"),
  });

  await expect(page.getByText("Choose a JPEG, PNG, or WebP profile photo.", { exact: true })).toBeVisible();
  await expect(page.getByText("Change profile photo", { exact: true })).toBeVisible();
  await expect(firstName).toHaveValue("Edited");
  await expect(bio).toHaveValue("An edited profile bio");
  expect(requests.filter((request) => request.kind === "metadata")).toHaveLength(0);
  expect(requests.filter((request) => request.kind === "upload")).toHaveLength(0);
});


test("profile photo picker rejects oversized images before requesting storage", async ({ page }) => {
  const { requests } = await setupProfilePhotoPage(page, profileWithExistingPhoto);
  const firstName = page.getByRole("textbox", { name: "First name" });
  const bio = page.getByPlaceholder("What would you enjoy talking about?");

  await expect(page.getByText("Change profile photo", { exact: true })).toBeVisible();
  await firstName.fill("Edited");
  await bio.fill("An edited profile bio");

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByText("Change profile photo", { exact: true }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: "profile-too-large.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.alloc(1_500_001),
  });

  await expect(page.getByText("Profile photos must be smaller than 1.5 MB.", { exact: true })).toBeVisible();
  await expect(page.getByText("Change profile photo", { exact: true })).toBeVisible();
  await expect(firstName).toHaveValue("Edited");
  await expect(bio).toHaveValue("An edited profile bio");
  expect(requests.filter((request) => request.kind === "metadata")).toHaveLength(0);
  expect(requests.filter((request) => request.kind === "upload")).toHaveLength(0);
});