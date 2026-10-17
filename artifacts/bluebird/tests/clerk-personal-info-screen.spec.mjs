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
        canGoBack: () => window.canGoBack,
        back: () => { window.lastRoute = 'back'; },
        replace: path => { window.lastRoute = path; },
        push: path => { window.lastRoute = path; },
      };
      export const Redirect = () => null;
      export const Stack = { Screen: () => null };
    `,
    "@expo/vector-icons": `
      import React from 'react';
      export const Ionicons = ({ name }) => React.createElement('span', { 'data-icon': name }, name);
    `,
    "expo-image-picker": `
      export const useCameraPermissions = () => [null, async () => ({ granted: false })];
      export const useMediaLibraryPermissions = () => [null, async () => ({ granted: false })];
      export const launchCameraAsync = async () => ({ canceled: true, assets: [] });
      export const launchImageLibraryAsync = async () => ({ canceled: true, assets: [] });
      export const MediaTypeOptions = { Images: 'images' };
    `,
    "expo-file-system": `export class File { constructor(uri) { this.uri = uri; } }`,
    "expo/fetch": `export const fetch = globalThis.fetch;`,
    "react-native-safe-area-context": `export const useSafeAreaInsets = () => ({ top: 59, bottom: 34, left: 0, right: 0 });`,
    "@/components/KeyboardAwareScrollViewCompat": `
      import React from 'react';
      import { ScrollView } from 'react-native';
      export const KeyboardAwareScrollViewCompat = props => React.createElement(ScrollView, props);
    `,
    "@workspace/api-client-react": `
      export const useGetNetworkingProfile = () => ({ data: undefined, isLoading: false, isError: false, refetch: async () => ({}) });
      export const useRequestUploadUrl = () => ({ mutateAsync: async () => ({}) });
      export const useUpdateMe = () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false });
      export const useUpdateNetworkingProfile = () => ({ mutate: () => {}, isPending: false });
    `,
    "@tanstack/react-query": `export const useQueryClient = () => ({ invalidateQueries: async () => {} });`,
    "@/context/AuthContext": `
      export const useAuth = () => ({
        user: null, updateUser: () => {}, authMode: 'clerk',
      });
    `,
    "@/hooks/useColors": `
      export const useColors = () => ({
        offWhite: '#fafaf9', surface: '#fff', muted: '#f1f2f4',
        textOnSurface: '#172033', primary: '#2375e1', primaryForeground: '#fff',
        mutedForegroundLight: '#747b87', separator: '#e6e7e9', border: '#e0e2e5',
        destructive: '#b42318', success: '#16803c', foreground: '#172033',
        input: '#fff', mutedForeground: '#747b87', background: '#fafaf9',
      });
    `,
    "@/lib/profile-photo-upload": `export const uploadProfilePhoto = async () => ({ objectPath: '' });`,
    "@/lib/profile-photo-selection": `export const selectProfilePhoto = async () => ({ kind: 'cancelled' });`,
    "@/lib/productionFlights": `export const isLocalFlightReadMode = () => false;`,
    "@/components/ProductionAuthenticatedUnavailableNotice": `export const ProductionAuthenticatedUnavailableNotice = () => null;`,
    "@/lib/dormantClerkIntegration": `
      export const useClerkAuthSnapshot = () => ({
        isLoaded: true, isSignedIn: true, userId: 'clerk-member-a',
        getToken: async () => 'test-token',
      });
    `,
    "@/lib/mainBluebirdApiConfig": `
      export const getMainBluebirdApiConfigurationOrNull = () => ({
        environment: 'development', apiBaseUrl: 'https://api.example.test',
      });
    `,
    "@/lib/mainBluebirdApi": `
      export function createMainBluebirdApiIntegration() {
        return {
          authenticated: {
            getMe: async () => ({ isAuthenticated: true }),
            getProfile: async () => {
              window.profileReadCount += 1;
              if (window.failReads) throw Object.assign(new Error('Private transport detail'), { code: 'network' });
              if (window.holdReads) return new Promise(resolve => {
                window.releaseProfileRead = () => resolve(window.testProfile);
              });
              return window.testProfile;
            },
            updateProfile: async data => {
              window.lastProfileUpdate = data;
              return { isAuthenticated: true };
            },
          },
        };
      }
    `,
  };

  const result = await build({
    stdin: {
      resolveDir: root,
      loader: "tsx",
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import PersonalInfoScreen from './app/account/personal-info';
        const baseProfile = {
          firstName: 'Avery', lastName: 'Passenger', dob: '1985-04-03', gender: 'female',
          homeAirportCode: 'SFO', homeAirportLabel: 'San Francisco International',
          favoriteAirportCodes: ['KSFO'], favoriteAirportLabels: ['SFO'],
          favoriteCityKeys: ['san-francisco'], favoriteCityLabels: ['San Francisco'],
          phoneE164: '+14155550123', phoneCountry: 'US', phoneVerifiedAt: '2026-10-01',
          phoneVerificationRequired: false,
          notificationPrefs: {
            mode: 'specific', allChannels: null, emptyLegHomeAirport: 'email',
            departingFavorite: 'both', arrivingFavorite: null, queueUpdates: 'both',
            winningNotifications: 'email',
          },
          smsConsent: true, smsConsentAt: '2026-09-01', smsConsentRevokedAt: null,
          email: 'avery@example.test', emailLocked: true, signupChannel: 'email',
          isComplete: true, upgradeCreditBalances: { skipTheLine: 0, internationalPass: 0 },
          weightLbs: 142,
        };
        let root = createRoot(document.getElementById('root'));
        window.mountPersonalInfo = ({ failReads = false, holdReads = false, canGoBack = false } = {}) => {
          root.unmount();
          root = createRoot(document.getElementById('root'));
          window.testProfile = { ...baseProfile };
          window.failReads = failReads;
          window.holdReads = holdReads;
          window.profileReadCount = 0;
          window.lastProfileUpdate = null;
          window.lastRoute = null;
          window.canGoBack = canGoBack;
          root.render(<PersonalInfoScreen />);
        };
        window.mountPersonalInfo();
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    loader: { ".png": "dataurl" },
    define: { "process.env.NODE_ENV": '"test"', __DEV__: "true" },
    alias: { "react-native": resolve(root, "node_modules/react-native-web") },
    plugins: [{
      name: "personal-info-screen-mocks",
      setup(build) {
        build.onResolve({
          filter: /^(expo-router|@expo\/vector-icons|expo-image-picker|expo-file-system|expo\/fetch|react-native-safe-area-context|@workspace\/api-client-react|@tanstack\/react-query)$/,
        }, args => ({ path: args.path, namespace: "screen-mock" }));
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

test("shows authenticated values, compact groups, read-only cues, and calendar DOB", async ({ page }) => {
  const firstNameBox = await page.getByTestId("clerk-personal-info-first-name").boundingBox();
  expect(firstNameBox?.height).toBeGreaterThanOrEqual(48);
  expect(firstNameBox?.height).toBeLessThanOrEqual(52);
  expect(await page.getByTestId("clerk-personal-info-first-name").evaluate(el => getComputedStyle(el).borderRadius)).toBe("12px");
  await expect(page.getByTestId("clerk-personal-info-first-name")).toHaveValue("Avery");
  await expect(page.getByTestId("clerk-personal-info-last-name")).toHaveValue("Passenger");
  await expect(page.getByTestId("clerk-personal-info-dob")).toHaveValue("April 3, 1985");
  await expect(page.getByLabel("Email, read only")).toContainText("avery@example.test");
  await expect(page.getByLabel("Phone, read only")).toContainText("+14155550123");
  await expect(page.getByText("Verified phone number")).toBeVisible();
  await expect(page.getByText("San Francisco International")).toBeVisible();
  await expect(page.getByText("Personal details", { exact: true })).toBeVisible();
  await expect(page.getByText("Contact", { exact: true })).toBeVisible();
  await expect(page.getByText("Travel preferences", { exact: true })).toBeVisible();

  const dob = page.getByTestId("clerk-personal-info-dob");
  await dob.focus();
  await expect(dob).toHaveValue("1985-04-03");
  await dob.blur();
  await expect(dob).toHaveValue("April 3, 1985");
  expect(await page.evaluate(() => window.profileReadCount)).toBeGreaterThan(0);
});

test("saves only on request and preserves the date and unrelated settings", async ({ page }) => {
  await expect(page.getByTestId("clerk-personal-info-first-name")).toHaveValue("Avery");
  await page.getByTestId("clerk-personal-info-first-name").fill("Avery Updated");
  await page.getByTestId("clerk-personal-info-save").click();
  await expect(page.getByTestId("clerk-personal-info-save-success")).toBeVisible();

  const request = await page.evaluate(() => window.lastProfileUpdate);
  expect(request.firstName).toBe("Avery Updated");
  expect(request.dob).toBe("1985-04-03");
  expect(request.homeAirportCode).toBe("SFO");
  expect(request.favoriteCityKeys).toEqual(["san-francisco"]);
  expect(request).not.toHaveProperty("notificationPrefs");
  expect(request).not.toHaveProperty("smsConsent");
  expect(request).not.toHaveProperty("email");
  expect(request).not.toHaveProperty("phoneE164");
});

test("loads with the Bluebird mark, retries clearly, and keeps back navigation", async ({ page }) => {
  await page.evaluate(() => window.mountPersonalInfo({ holdReads: true, canGoBack: true }));
  await expect(page.locator('[data-testid="clerk-personal-info"] img')).toBeVisible();
  await expect(page.getByText("Loading your profile", { exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    window.holdReads = false;
    window.releaseProfileRead();
  });
  await expect(page.getByTestId("clerk-personal-info-first-name")).toHaveValue("Avery");

  await page.evaluate(() => window.mountPersonalInfo({ failReads: true, canGoBack: true }));
  await expect(page.getByTestId("clerk-personal-info-retry")).toBeVisible();
  await expect(page.getByText("Private transport detail", { exact: false })).toHaveCount(0);
  await page.evaluate(() => { window.failReads = false; });
  await page.getByTestId("clerk-personal-info-retry").click();
  await expect(page.getByTestId("clerk-personal-info-first-name")).toHaveValue("Avery");
  await page.getByTestId("clerk-personal-info-back").click();
  expect(await page.evaluate(() => window.lastRoute)).toBe("back");
});

test("fits 375, 393, and 430 pixel widths and keeps focused fields reachable", async ({ page }) => {
  await expect(page.getByTestId("clerk-personal-info-first-name")).toHaveValue("Avery");
  for (const width of [375, 393, 430]) {
    await page.setViewportSize({ width, height: 700 });
    await page.getByTestId("clerk-personal-info-weight").focus();
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
      focused: document.activeElement?.getAttribute("data-testid"),
      fieldBottom: document.activeElement?.getBoundingClientRect().bottom,
      viewportHeight: window.innerHeight,
    }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
    expect(dimensions.focused).toBe("clerk-personal-info-weight");
    expect(dimensions.fieldBottom).toBeLessThanOrEqual(dimensions.viewportHeight);
  }
  await page.setViewportSize({ width: 375, height: 480 });
  await page.getByTestId("clerk-personal-info-first-name").fill("Avery Updated");
  const saveButton = page.getByTestId("clerk-personal-info-save");
  await saveButton.scrollIntoViewIfNeeded();
  const saveDimensions = await saveButton.boundingBox();
  expect(saveDimensions).not.toBeNull();
  expect(saveDimensions.y).toBeGreaterThanOrEqual(0);
  expect(saveDimensions.y + saveDimensions.height).toBeLessThanOrEqual(480);
});
