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
            }} />
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
  await expect(page.getByRole("radio", { name: "Arriving at favorites: Not set", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "Queue updates: email", exact: true }).click();
  await page.getByTestId("clerk-save-notification-preferences").click();
  await expect(page.getByText("Saving and refreshing…")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Queue updates: sms", exact: true })).toHaveAttribute("aria-disabled", "true");
  expect(await page.evaluate(() => window.submitted.queueUpdates)).toBe("email");
  await page.evaluate(() => window.acceptSave());
  await expect(page.getByTestId("clerk-edit-notification-preferences")).toBeVisible();
});

test("failed or unverified saves keep edits unsaved and require an explicit successful refresh", async ({ page }) => {
  await page.getByTestId("clerk-edit-notification-preferences").click();
  await page.getByTestId("clerk-save-notification-preferences").click();
  await page.evaluate(() => window.rejectSave());
  await expect(page.getByRole("alert")).toContainText("HTTP 403");
  await expect(page.getByRole("alert")).toContainText("No save is confirmed");
  await expect(page.getByTestId("clerk-save-notification-preferences")).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("button", { name: "Close editor and refresh", exact: true }).click();
  await expect(page.getByTestId("clerk-edit-notification-preferences")).toHaveAttribute("aria-disabled", "true");
  // A new server-refreshed projection remounts the editor in the actual screen.
  await page.evaluate(() => window.mountEditor({}, 2));
  await expect(page.getByTestId("clerk-edit-notification-preferences")).not.toHaveAttribute("aria-disabled", "true");
});

test("incomplete profile is explicitly read-only with no edit or save action", async ({ page }) => {
  await page.evaluate(() => window.mountEditor({ dob: null }, 2));
  await expect(page.getByText(/Read-only: a complete valid profile/)).toBeVisible();
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
  await page.getByRole("radio", { name: "Flight alert mode: specific", exact: true }).click();
  await expect(page.getByText("All flight alerts", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Home airport flights", { exact: true })).toBeVisible();
  await expect(page.getByText(/SMS requires existing consent/)).toBeVisible();
});
