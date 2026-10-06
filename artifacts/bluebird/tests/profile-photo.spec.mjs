import { expect, test } from "@playwright/test";
import path from "node:path";

const user = {
  id: "profile-photo-user",
  name: "Profile Photo Member",
  email: "profile-photo@example.test",
  membershipTier: "plus",
  linePassCount: 0,
  homeAirports: ["BFI"],
  photoAssetPath: null,
  photoUrl: null,
};
const accountWithExistingPhoto = {
  ...user,
  photoAssetPath: "/objects/uploads/current-profile-photo.jpg",
  photoUrl: "/api/storage/objects/uploads/current-profile-photo.jpg",
};

const profile = {
  id: "profile-photo-profile",
  userId: user.id,
  firstName: "Profile",
  lastName: "Photo",
  industry: "",
  bio: "",
  linkedinUrl: null,
  facebookUrl: null,
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

async function setupProfilePhotoPage(page, profileData = profile, accountData = user) {
  const requests = [];
  let uploadAttempts = 0;
  let currentAccount = accountData;
  let currentProfile = profileData;

  await page.addInitScript(({ user }) => {
    localStorage.setItem("bluebird_token", "mobile-profile-photo-test-token");
    localStorage.setItem("bluebird_user", JSON.stringify(user));
  }, { user: accountData });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathName = url.pathname;

    if (request.method() === "PATCH" && pathName === "/api/auth/me") {
      const body = request.postDataJSON();
      requests.push({ kind: "account-update", body });
      currentAccount = {
        ...currentAccount,
        ...body,
        photoUrl: body.photoAssetPath
          ? `/api/storage${body.photoAssetPath}`
          : body.photoAssetPath === null ? null : currentAccount.photoUrl,
      };
      return route.fulfill({ json: currentAccount });
    }
    if (pathName === "/api/auth/me") {
      return route.fulfill({ json: currentAccount });
    }
    if (request.method() === "GET" && pathName === "/api/networking/profile") {
      return route.fulfill({ json: currentProfile });
    }
    if (request.method() === "PATCH" && pathName === "/api/networking/profile") {
      const body = request.postDataJSON();
      requests.push({ kind: "networking-update", body });
      currentProfile = { ...currentProfile, ...body };
      const missing = ["firstName", "lastName", "industry", "bio"]
        .filter((key) => !currentProfile[key]?.trim());
      if (!currentAccount.photoAssetPath && !currentAccount.photoUrl) missing.push("photo");
      currentProfile = { ...currentProfile, completed: missing.length === 0, missing };
      return route.fulfill({ json: currentProfile });
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
  await page.getByRole("button", { name: "Choose from library" }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(path.resolve("../../attached_assets/BlueBird_Icon_RGB_1789739598047.jpg"));

  await expect(page.getByText("Replace profile photo", { exact: true })).toBeVisible();
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
  await expect.poll(() => requests.find((request) => request.kind === "account-update")).toEqual({
    kind: "account-update",
    body: { photoAssetPath: "/objects/uploads/profile-photo.jpg" },
  });

  const fileChooserPromiseAfterFailure = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose from library" }).click();
  const fileChooserAfterFailure = await fileChooserPromiseAfterFailure;
  await fileChooserAfterFailure.setFiles(path.resolve("../../attached_assets/BlueBird_Icon_RGB_1789739598047.jpg"));
  await expect(page.getByText("Photo upload failed", { exact: true })).toBeVisible();
  await expect(page.getByText("Replace profile photo", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "First name" })).toHaveValue("Profile");
  expect(consoleErrors.join("\n")).not.toContain("validatePath");
});

test("profile photo picker rejects unsupported formats before requesting storage", async ({ page }) => {
  const { requests } = await setupProfilePhotoPage(page, profileWithExistingPhoto, accountWithExistingPhoto);
  const firstName = page.getByRole("textbox", { name: "First name" });
  const bio = page.getByPlaceholder("What would you enjoy talking about?");

  await expect(page.getByText("Replace profile photo", { exact: true })).toBeVisible();
  await firstName.fill("Edited");
  await bio.fill("An edited profile bio");

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose from library" }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: "profile.gif",
    mimeType: "image/gif",
    buffer: Buffer.from("unsupported profile photo"),
  });

  await expect(page.getByText("Choose a JPEG, PNG, or WebP profile photo.", { exact: true })).toBeVisible();
  await expect(page.getByText("Replace profile photo", { exact: true })).toBeVisible();
  await expect(firstName).toHaveValue("Edited");
  await expect(bio).toHaveValue("An edited profile bio");
  expect(requests.filter((request) => request.kind === "metadata")).toHaveLength(0);
  expect(requests.filter((request) => request.kind === "upload")).toHaveLength(0);
});


test("profile photo picker rejects oversized images before requesting storage", async ({ page }) => {
  const { requests } = await setupProfilePhotoPage(page, profileWithExistingPhoto, accountWithExistingPhoto);
  const firstName = page.getByRole("textbox", { name: "First name" });
  const bio = page.getByPlaceholder("What would you enjoy talking about?");

  await expect(page.getByText("Replace profile photo", { exact: true })).toBeVisible();
  await firstName.fill("Edited");
  await bio.fill("An edited profile bio");

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose from library" }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: "profile-too-large.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.alloc(1_500_001),
  });

  await expect(page.getByText("Profile photos must be smaller than 1.5 MB.", { exact: true })).toBeVisible();
  await expect(page.getByText("Replace profile photo", { exact: true })).toBeVisible();
  await expect(firstName).toHaveValue("Edited");
  await expect(bio).toHaveValue("An edited profile bio");
  expect(requests.filter((request) => request.kind === "metadata")).toHaveLength(0);
  expect(requests.filter((request) => request.kind === "upload")).toHaveLength(0);
});

test("social links save, reopen, edit and clear independently of account details", async ({ page }) => {
  const { requests } = await setupProfilePhotoPage(page, profileWithExistingPhoto, accountWithExistingPhoto);
  const linkedin = page.getByPlaceholder("https://www.linkedin.com/in/you");
  const facebook = page.getByPlaceholder("https://www.facebook.com/you");
  const instagram = page.getByPlaceholder("https://www.instagram.com/you");
  await expect(facebook).toBeVisible();
  await linkedin.fill("https://www.linkedin.com/in/member");
  await facebook.fill("not a URL");
  await instagram.fill("https://www.instagram.com/member");
  await page.getByText("Save profile", { exact: true }).click();
  await expect(page.getByText("Enter a valid http(s) URL for Facebook, or leave it blank.")).toBeVisible();
  await expect(linkedin).toHaveValue("https://www.linkedin.com/in/member");
  expect(requests.filter(({ kind }) => kind === "networking-update")).toHaveLength(0);

  await page.getByPlaceholder("Your name").fill("Edited account name");
  await page.getByText("Save changes", { exact: true }).click();
  await expect.poll(() => requests.some(({ kind }) => kind === "account-update")).toBe(true);
  await expect(facebook).toHaveValue("not a URL");

  await facebook.fill("https://www.facebook.com/member");
  await page.getByText("Save profile", { exact: true }).click();
  await expect(page.getByText("Saved across your devices.")).toBeVisible();
  await expect.poll(() => requests.filter(({ kind }) => kind === "networking-update").at(-1)?.body).toEqual(
    expect.objectContaining({
      linkedinUrl: "https://www.linkedin.com/in/member",
      facebookUrl: "https://www.facebook.com/member",
      instagramUrl: "https://www.instagram.com/member",
    }),
  );
  await page.reload();
  await expect(facebook).toHaveValue("https://www.facebook.com/member");
  await facebook.fill("https://www.facebook.com/edited");
  await linkedin.clear();
  await instagram.clear();
  await page.getByText("Save profile", { exact: true }).click();
  await expect.poll(() => requests.filter(({ kind }) => kind === "networking-update").at(-1)?.body).toEqual(
    expect.objectContaining({ linkedinUrl: null, facebookUrl: "https://www.facebook.com/edited", instagramUrl: null }),
  );
  await page.reload();
  await expect(linkedin).toHaveValue("");
  await expect(facebook).toHaveValue("https://www.facebook.com/edited");
  await expect(instagram).toHaveValue("");
});
test("members can remove an optional account photo with a standalone null patch", async ({ page }) => {
  const { requests } = await setupProfilePhotoPage(page, profileWithExistingPhoto, accountWithExistingPhoto);
  await page.getByRole("button", { name: "Remove profile photo" }).click();
  await expect.poll(() => requests.find((request) => request.kind === "account-update")).toEqual({
    kind: "account-update",
    body: { photoAssetPath: null },
  });
  await expect(page.getByText("Add profile photo", { exact: true })).toBeVisible();
});

test("networking text can be saved before an optional account photo is added", async ({ page }) => {
  const { requests } = await setupProfilePhotoPage(page);
  await page.getByRole("textbox", { name: "First name" }).fill("Edited");
  await page.getByRole("textbox", { name: "Last name" }).fill("Member");
  await page.getByPlaceholder("e.g. Venture capital").fill("Aviation");
  await page.getByPlaceholder("What would you enjoy talking about?").fill("Happy to talk about travel.");
  await page.getByText("Save profile", { exact: true }).click();

  await expect.poll(() => requests.find((request) => request.kind === "networking-update")).toEqual({
    kind: "networking-update",
    body: {
      firstName: "Edited",
      lastName: "Member",
      industry: "Aviation",
      bio: "Happy to talk about travel.",
      linkedinUrl: null,
      facebookUrl: null,
      instagramUrl: null,
    },
  });
  expect(requests.filter((request) => request.kind === "account-update")).toHaveLength(0);
  await expect(page.getByText("Still needed: photo", { exact: true })).toBeVisible();
});

test("web camera is unavailable without touching an existing photo or edits", async ({ page }) => {
  const { requests } = await setupProfilePhotoPage(page, profileWithExistingPhoto, accountWithExistingPhoto);
  await page.getByPlaceholder("Your name").fill("Edited account name");
  await page.getByRole("button", { name: "Take photo" }).click();
  await expect(page.getByText("Taking a photo is only available in the mobile app. Choose from your library instead.")).toBeVisible();
  await expect(page.getByText("Replace profile photo", { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("Your name")).toHaveValue("Edited account name");
  expect(requests.filter((request) => request.kind === "account-update")).toHaveLength(0);
});

test("a non-member can remove their account photo without access to networking", async ({ page }) => {
  const { requests } = await setupProfilePhotoPage(page, profileWithExistingPhoto, {
    ...accountWithExistingPhoto,
    membershipTier: "none",
  });
  await expect(page.getByText("Networking is for members")).toBeVisible();
  await page.getByRole("button", { name: "Remove profile photo" }).click();
  await expect.poll(() => requests.filter((request) => request.kind === "account-update")).toEqual([
    { kind: "account-update", body: { photoAssetPath: null } },
  ]);
  await expect(page.getByText("Add profile photo", { exact: true })).toBeVisible();
});
