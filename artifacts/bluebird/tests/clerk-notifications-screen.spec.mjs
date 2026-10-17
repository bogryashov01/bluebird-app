import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(root, "../api-server/package.json"));
const { build } = require("esbuild");
let bundle;

test.beforeAll(async () => {
  const mocks = {
    "expo-router": `
      import React from 'react';
      export const router = {
        push: path => { window.lastRoute = path; },
        back: () => { window.lastRoute = 'back'; },
        replace: path => { window.lastRoute = path; },
        canGoBack: () => window.canGoBack,
      };
      export const useFocusEffect = effect => React.useEffect(effect, [effect]);
    `,
    "@workspace/api-client-react": `
      export const useListNotifications = () => ({});
      export const useMarkNotificationRead = () => ({});
      export const getListNotificationsQueryKey = () => ['notifications'];
      export const useUpdateMe = () => ({ mutate: () => {}, isPending: false });
    `,
    "@expo/vector-icons": `
      import React from 'react';
      export const Ionicons = ({ name }) => React.createElement('span', { 'data-icon': name }, '‹');
    `,
    "react-native-safe-area-context": `
      export const useSafeAreaInsets = () => ({ top: 59, bottom: 34, left: 0, right: 0 });
    `,
    "@/hooks/useColors": `
      export const useColors = () => ({
        offWhite: '#fafaf9', surface: '#fff', muted: '#f1f2f4',
        textOnSurface: '#172033', primary: '#2375e1', primaryForeground: '#fff',
        mutedForegroundLight: '#747b87', separator: '#e6e7e9', border: '#e0e2e5',
        destructive: '#b42318', foreground: '#172033', card: '#fff', mutedForeground: '#747b87',
      });
    `,
    "@/context/AuthContext": `
      export const useAuth = () => ({
        authMode: 'clerk',
        clerkMemberResolution: {
          status: 'profile_complete',
          clerkUserId: 'clerk-test-member',
          currentUser: { isAuthenticated: true },
        },
      });
    `,
    "@/lib/dormantClerkIntegration": `
      export const useClerkAuthSnapshot = () => ({
        isLoaded: true,
        isSignedIn: true,
        userId: 'clerk-test-member',
        getToken: async () => 'test-token',
      });
    `,
    "@/lib/mainBluebirdApiConfig": `
      export const getMainBluebirdApiConfigurationOrNull = () => ({
        environment: 'development',
        apiBaseUrl: 'https://api.example.test',
      });
    `,
    "@/lib/mainBluebirdApi": `
      export function createMainBluebirdApiIntegration() {
        return {
          authenticated: {
            getProfile: () => {
              window.profileGetCount += 1;
              if (window.failProfileReads) throw new Error('Private transport detail');
              if (window.holdProfileReads) return new Promise(resolve => {
                window.releaseProfileRead = () => resolve(window.testProfile);
              });
              return window.testProfile;
            },
            updateProfile: async data => {
              window.lastProfileUpdate = data;
              window.testProfile = { ...window.testProfile, ...data };
              return {};
            },
          },
        };
      }
    `,
    "@/lib/productionAuthApi": `
      export class ProductionAuthHttpError extends Error {
        constructor(status) { super('request failed'); this.status = status; }
      }
    `,
    "@/lib/notificationRoute": `
      export const NETWORKING_INBOX_ROUTE = '/networking/inbox';
      export const notificationRoute = () => null;
    `,
    "@/hooks/usePersistedState": `
      export const usePersistedState = (_key, initial) => [initial, () => {}, true];
    `,
  };
  const result = await build({
    stdin: {
      resolveDir: root,
      loader: "tsx",
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
        import NotificationsScreen from './app/notifications';
        import { getClerkNotificationPreferencesQueryKey } from './lib/clerkNotificationPreferences';
        const baseProfile = {
          firstName: 'Test', lastName: 'Member', dob: '1990-02-12', gender: 'female',
          homeAirportCode: 'TEB', homeAirportLabel: 'Teterboro Airport',
          favoriteAirportCodes: ['KJFK'], favoriteAirportLabels: ['JFK'],
          favoriteCityKeys: ['new-york'], favoriteCityLabels: ['New York'],
          email: 'member@example.test', emailLocked: false,
          phoneE164: '+12025550123', phoneCountry: 'US', phoneVerifiedAt: '2026-10-01',
          phoneVerificationRequired: false, smsConsent: true, smsConsentAt: '2026-09-01',
          smsConsentRevokedAt: null, signupChannel: 'email', weightLbs: null, isComplete: true,
          upgradeCreditBalances: { skipTheLine: 0, internationalPass: 0 },
          notificationPrefs: {
            mode: 'specific', allChannels: null, emptyLegHomeAirport: 'email',
            departingFavorite: 'both', arrivingFavorite: null, queueUpdates: 'both',
            winningNotifications: 'email',
          },
        };
        const root = createRoot(document.getElementById('root'));
        window.mountNotifications = (overrides = {}, failReads = false, canGoBack = false) => {
          window.testProfile = { ...baseProfile, ...overrides };
          window.profileGetCount = 0;
          window.failProfileReads = failReads;
          window.holdProfileReads = false;
          window.canGoBack = canGoBack;
          window.lastRoute = null;
          const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false, gcTime: 0 } },
          });
          window.currentQueryClient = queryClient;
          window.profileQueryKey = getClerkNotificationPreferencesQueryKey(
            'development',
            'https://api.example.test',
            'clerk-test-member',
          );
          root.render(
            <QueryClientProvider client={queryClient}>
              <NotificationsScreen />
            </QueryClientProvider>
          );
        };
        window.mountNotifications();
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    define: { "process.env.NODE_ENV": '"test"', __DEV__: "true" },
    alias: { "react-native": resolve(root, "node_modules/react-native-web") },
    plugins: [{
      name: "notification-screen-mocks",
      setup(build) {
        build.onResolve({ filter: /^(expo-router|@workspace\/api-client-react|@expo\/vector-icons|react-native-safe-area-context)$/ }, args => ({
          path: args.path,
          namespace: "screen-mock",
        }));
        build.onResolve({ filter: /^@\// }, args => mocks[args.path]
          ? { path: args.path, namespace: "screen-mock" }
          : { path: ['.tsx', '.ts', '.jsx', '.js']
              .map(extension => `${resolve(root, args.path.slice(2))}${extension}`)
              .find(path => existsSync(path)) });
        build.onLoad({ filter: /.*/, namespace: "screen-mock" }, args => ({
          contents: mocks[args.path],
          loader: "js",
          resolveDir: root,
        }));
      },
    }],
  });
  bundle = result.outputFiles[0].text;
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 844 });
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
});

test("loads the signed-in profile automatically and exposes mutually exclusive supported choices", async ({ page }) => {
  await expect(page.getByText("TEB", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.profileGetCount)).toBeGreaterThan(0);
  await expect(page.getByText("JFK", { exact: true })).toBeVisible();

  await page.getByTestId("clerk-edit-notification-preferences").click();
  const allMode = page.getByRole("radio", { name: "Flight alert mode: all", exact: true });
  const specificMode = page.getByRole("radio", { name: "Flight alert mode: specific", exact: true });
  await expect(specificMode).toHaveAttribute("aria-checked", "true");
  await expect(allMode).toHaveAttribute("aria-checked", "false");
  await page.getByRole("radio", { name: "Flight alert mode: all", exact: true }).click();
  await expect(allMode).toHaveAttribute("aria-checked", "true");
  await expect(specificMode).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("radio", { name: "All flight alerts: both", exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Queue Updates: both", exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Flight Confirmations: email", exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Queue Updates: off/ })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: /Flight Confirmations: off/ })).toHaveCount(0);
});

test("shows Choose airport for an unset home airport and opens the existing picker", async ({ page }) => {
  await page.evaluate(() => window.mountNotifications({
    homeAirportCode: null,
    homeAirportLabel: null,
  }));
  const chooseAirport = page.getByText("Choose airport", { exact: true });
  await expect(chooseAirport).toBeVisible();
  await chooseAirport.click();
  expect(await page.evaluate(() => window.lastRoute)).toBe("/airport-picker");
});

test("keeps cached profile values visible while refreshing them", async ({ page }) => {
  await expect(page.getByText("TEB", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.testProfile = {
      ...window.testProfile,
      homeAirportCode: 'KSFO',
      homeAirportLabel: 'San Francisco International',
    };
    window.holdProfileReads = true;
    window.currentQueryClient.setQueryData(window.profileQueryKey, window.testProfile);
    void window.currentQueryClient.invalidateQueries({ queryKey: window.profileQueryKey });
  });
  await expect(page.getByText("KSFO", { exact: true })).toBeVisible();
  await expect(page.getByTestId("clerk-notification-preferences-loading")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.profileGetCount)).toBeGreaterThan(0);
  await page.evaluate(() => window.releaseProfileRead());
});

test("keeps unsupported rows disabled, omits history and supports back navigation", async ({ page }) => {
  await expect(page.getByText("International Flights", { exact: true })).toBeVisible();
  await expect(page.getByText("Membership Updates", { exact: true })).toBeVisible();
  await expect(page.getByText("Notification history", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Push notifications", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("switch")).toHaveCount(0);
  await page.getByText("International Flights", { exact: true }).click();
  expect(await page.evaluate(() => window.lastRoute)).toBeNull();
  await page.getByRole("button", { name: "Back" }).click();
  expect(await page.evaluate(() => window.lastRoute)).toBe("/(tabs)/profile");
});

test("shows a concise error with retry after automatic loading fails", async ({ page }) => {
  await page.evaluate(() => window.mountNotifications({}, true));
  await expect(page.getByTestId("clerk-notification-preferences-error")).toBeVisible();
  await expect(page.getByText("Private transport detail", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  await page.evaluate(() => { window.failProfileReads = false; });
  await page.getByTestId("clerk-retry-notification-preferences").click();
  await expect(page.getByText("TEB", { exact: true })).toBeVisible();
});

test("fits the complete screen without horizontal overflow at common iPhone widths", async ({ page }) => {
  for (const width of [375, 393, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByText("TEB", { exact: true })).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
    await page.screenshot({
      path: `/tmp/bluebird-clerk-notifications-${width}.png`,
      fullPage: true,
    });
  }
});
