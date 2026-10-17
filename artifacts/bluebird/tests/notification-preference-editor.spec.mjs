import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(root, "../api-server/package.json"));
const { build } = require("esbuild");
let bundle;

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      resolveDir: root, loader: "tsx",
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { NotificationPreferenceEditor } from './components/NotificationPreferenceEditor';
        const root = createRoot(document.getElementById('root'));
        const profile = {
          firstName: 'Test', lastName: 'Member', dob: '1990-02-12', gender: 'female',
          homeAirportCode: 'KJFK', favoriteCityKeys: ['new-york'], email: 'member@example.test',
          emailLocked: false, phoneE164: '+12025550123', phoneVerifiedAt: '2026-10-01',
          phoneVerificationRequired: false, smsConsent: true, weightLbs: null, isComplete: true,
          notificationPrefs: { mode: 'specific', allChannels: null, emptyLegHomeAirport: 'email',
            departingFavorite: 'sms', arrivingFavorite: null, queueUpdates: 'both', winningNotifications: 'email' },
        };
        window.mountEditor = (overrides = {}, version = 1) => root.render(
          <NotificationPreferenceEditor key={version} profile={{...profile, ...overrides}}
            disabled={false} onSave={prefs => {
              window.submitted = prefs;
              return new Promise((resolve, reject) => {
                window.acceptSave = resolve;
                window.rejectSave = () => reject(new Error('HTTP 403'));
              });
            }} onRefresh={async () => { window.refreshRequested = true; }} />
        );
        window.mountEditor();
      `,
    },
    bundle: true, write: false, format: "iife",
    define: { "process.env.NODE_ENV": '"test"', __DEV__: "true" },
    alias: { "react-native": resolve(root, "node_modules/react-native-web") },
    plugins: [{
      name: "test-theme",
      setup(build) {
        build.onResolve({ filter: /^@\/hooks\/useColors$/ }, () => ({ path: "theme", namespace: "test-theme" }));
        build.onLoad({ filter: /.*/, namespace: "test-theme" }, () => ({
          contents: `export const useColors = () => ({
            mutedForegroundLight: '#666', primary: '#123', primaryForeground: '#fff',
            surface: '#fff', textOnSurface: '#123', border: '#ddd', destructive: '#a00',
          });`,
        }));
      },
    }],
  });
  bundle = result.outputFiles[0].text;
});

test.beforeEach(async ({ page }) => {
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
});

test("edits only documented categories, disables controls while pending and closes only after acceptance", async ({ page }) => {
  await page.getByTestId("clerk-edit-notification-preferences").click();
  await expect(page.getByText("Home airport flights", { exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Arriving at favorite airports: email", exact: true })).toHaveAttribute("aria-checked", "false");
  await page.getByRole("radio", { name: "Queue Updates: email", exact: true }).click();
  await page.getByTestId("clerk-save-notification-preferences").click();
  await expect(page.getByText("Saving…")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Queue Updates: sms", exact: true })).toHaveAttribute("aria-disabled", "true");
  expect(await page.evaluate(() => window.submitted.queueUpdates)).toBe("email");
  await page.evaluate(() => window.acceptSave());
  await expect(page.getByTestId("clerk-edit-notification-preferences")).toBeVisible();
});

test("failed or unverified saves keep edits unsaved and require an explicit successful refresh", async ({ page }) => {
  await page.getByTestId("clerk-edit-notification-preferences").click();
  await page.getByTestId("clerk-save-notification-preferences").click();
  await page.evaluate(() => window.rejectSave());
  await expect(page.getByRole("alert")).toContainText("Couldn’t verify your changes");
  await expect(page.getByRole("alert")).not.toContainText("HTTP 403");
  await expect(page.getByTestId("clerk-save-notification-preferences")).toHaveAttribute("aria-disabled", "true");
  await page.getByTestId("clerk-refresh-notification-preferences-after-save").click();
  expect(await page.evaluate(() => window.refreshRequested)).toBe(true);
  // A new server-refreshed projection remounts the editor in the actual screen.
  await page.evaluate(() => window.mountEditor({}, 2));
  await expect(page.getByTestId("clerk-edit-notification-preferences")).not.toHaveAttribute("aria-disabled", "true");
});

test("incomplete profile is explicitly read-only with no edit or save action", async ({ page }) => {
  await page.evaluate(() => window.mountEditor({ dob: null }, 2));
  await expect(page.getByText("Complete your profile to edit these preferences.")).toBeVisible();
  await expect(page.getByTestId("clerk-edit-notification-preferences")).toHaveCount(0);
  await expect(page.getByTestId("clerk-save-notification-preferences")).toHaveCount(0);
});

test("mode changes expose only applicable categories and cannot grant SMS consent", async ({ page }) => {
  await page.evaluate(() => window.mountEditor({
    smsConsent: false,
    notificationPrefs: { mode: 'off', allChannels: null, emptyLegHomeAirport: null,
      departingFavorite: null, arrivingFavorite: null, queueUpdates: 'email', winningNotifications: 'email' },
  }, 2));
  await page.getByTestId("clerk-edit-notification-preferences").click();
  await expect(page.getByText("Home airport flights", { exact: true })).toHaveCount(0);
  await page.getByRole("radio", { name: "Flight alert mode: all", exact: true }).click();
  await expect(page.getByText("All flight alerts", { exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "All flight alerts: sms", exact: true })).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("radio", { name: "All flight alerts: email", exact: true }).click();
  await page.getByRole("radio", { name: "Flight alert mode: specific", exact: true }).click();
  await expect(page.getByText("All flight alerts", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Home airport flights", { exact: true })).toBeVisible();
  await expect(page.getByText("SMS requires consent and a verified phone number.").first()).toBeVisible();
});

test("SMS eligibility explains missing consent, phone, and verification without making SMS selectable", async ({ page }) => {
  const emailOnly = {
    mode: 'off',
    allChannels: null,
    emptyLegHomeAirport: null,
    departingFavorite: null,
    arrivingFavorite: null,
    queueUpdates: 'email',
    winningNotifications: 'email',
  };
  const cases = [
    {
      profile: {
        smsConsent: false,
        phoneE164: '+12025550123',
        phoneVerifiedAt: '2026-10-01',
        phoneVerificationRequired: false,
      },
      expected: "SMS requires consent and a verified phone number.",
    },
    {
      profile: {
        smsConsent: true,
        phoneE164: null,
        phoneVerifiedAt: null,
        phoneVerificationRequired: false,
      },
      expected: "SMS requires consent and a verified phone number.",
    },
    {
      profile: {
        smsConsent: true,
        phoneE164: '+12025550123',
        phoneVerifiedAt: null,
        phoneVerificationRequired: true,
      },
      expected: "SMS requires consent and a verified phone number.",
    },
  ];
  for (let index = 0; index < cases.length; index++) {
    const { profile, expected } = cases[index];
    await page.evaluate((props) => window.mountEditor(props, Date.now()), {
      ...profile,
      notificationPrefs: emailOnly,
    });
    await expect(page.getByText(expected).first()).toBeVisible();
    await page.getByTestId("clerk-edit-notification-preferences").click();
    await expect(page.getByRole("radio", { name: "Queue Updates: sms", exact: true }))
      .toHaveAttribute("aria-disabled", "true");
  }
});

test("an ineligible saved SMS preference can be changed to Email without granting consent", async ({ page }) => {
  await page.evaluate(() => window.mountEditor({
    smsConsent: false,
    notificationPrefs: {
      mode: 'specific',
      allChannels: null,
      emptyLegHomeAirport: 'sms',
      departingFavorite: 'sms',
      arrivingFavorite: null,
      queueUpdates: 'both',
      winningNotifications: 'sms',
    },
  }, 904));
  await expect(page.getByTestId("clerk-edit-notification-preferences")).toBeVisible();
  await page.getByTestId("clerk-edit-notification-preferences").click();
  await expect(page.getByRole("radio", { name: "Home airport flights: sms", exact: true }))
    .toHaveAttribute("aria-disabled", "true");
  await page.getByRole("radio", { name: "Home airport flights: email", exact: true }).click();
  await page.getByRole("radio", { name: "Departing from favorite airports: email", exact: true }).click();
  await page.getByRole("radio", { name: "Queue Updates: email", exact: true }).click();
  await page.getByRole("radio", { name: "Flight Confirmations: email", exact: true }).click();
  await page.getByTestId("clerk-save-notification-preferences").click();
  expect(await page.evaluate(() => window.submitted)).toMatchObject({
    mode: 'specific',
    emptyLegHomeAirport: 'email',
    departingFavorite: 'email',
    queueUpdates: 'email',
    winningNotifications: 'email',
  });
  await page.evaluate(() => window.acceptSave());
  await expect(page.getByTestId("clerk-edit-notification-preferences")).toBeVisible();
});

test("notification editor fits common phone widths", async ({ page }) => {
  for (const width of [375, 393, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate((version) => window.mountEditor({}, version), width);
    await page.getByTestId("clerk-edit-notification-preferences").click();
    await expect(page.getByText("Flight Confirmations", { exact: true })).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
    await page.screenshot({
      path: `/tmp/bluebird-notification-editor-${width}.png`,
      fullPage: true,
    });
  }
});
