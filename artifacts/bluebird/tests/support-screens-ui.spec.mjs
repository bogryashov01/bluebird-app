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
        push: path => { window.lastRoute = path; window.navigateRoute?.(path, 'push'); },
        back: () => { window.lastRoute = 'back'; window.navigateRoute?.('', 'back'); },
        replace: path => { window.lastRoute = path; window.navigateRoute?.(path, 'replace'); },
        canGoBack: () => window.canGoBack === true || (window.routeStack?.length ?? 0) > 1,
      };
    `,
    "@expo/vector-icons": `
      import React from 'react';
      export const Feather = ({ name }) => React.createElement('span', { 'data-icon': name });
    `,
    "react-native-safe-area-context": `
      export const useSafeAreaInsets = () => ({ top: 59, bottom: 34, left: 0, right: 0 });
    `,
    "@/hooks/useColors": `
      export const useColors = () => ({
        offWhite: '#0A1128', surface: '#0D1636', muted: '#1A2744',
        textOnSurface: '#FFFFFF', primary: '#1259F2', primaryForeground: '#FFFFFF',
        mutedForegroundLight: 'rgba(255,255,255,0.55)', separator: 'rgba(255,255,255,0.08)',
        border: '#1E2D4F',
      });
    `,
  };
  const result = await build({
    stdin: {
      resolveDir: root,
      loader: "tsx",
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import HelpCenterScreen from './app/support/help-center';
        import LegalScreen from './app/support/legal';
        const root = createRoot(document.getElementById('root'));
        function Profile() {
          return <main data-testid="profile-screen">
            <button onClick={() => window.navigateRoute('/support/help-center', 'push')}>Open Help Center</button>
            <button onClick={() => window.navigateRoute('/support/legal', 'push')}>Open Legal</button>
          </main>;
        }
        function TestApp() {
          const [route, setRoute] = React.useState(window.routeStack?.[window.routeStack.length - 1] ?? '/profile');
          window.showRoute = (path, stack) => {
            window.routeStack = stack;
            setRoute(path);
          };
          window.navigateRoute = (path, action) => {
            const stack = window.routeStack ?? ['/profile'];
            if (action === 'push') stack.push(path);
            else if (action === 'back' && stack.length > 1) stack.pop();
            else if (action === 'replace') {
              if (stack.length) stack[stack.length - 1] = path;
              else stack.push(path);
            }
            window.showRoute(stack[stack.length - 1] ?? '/profile', stack);
          };
          if (route === '/support/help-center') return <HelpCenterScreen />;
          if (route === '/support/legal') return <LegalScreen />;
          return <Profile />;
        }
        window.mountProfile = () => {
          window.routeStack = ['/profile'];
          window.canGoBack = false;
          root.render(<TestApp />);
        };
        window.mountDirect = (path) => {
          window.canGoBack = false;
          window.showRoute(path, [path]);
        };
        window.mountProfile();
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    define: { "process.env.NODE_ENV": '"test"', __DEV__: "true" },
    alias: { "react-native": resolve(root, "node_modules/react-native-web") },
    plugins: [{
      name: "support-screen-mocks",
      setup(build) {
        build.onResolve({ filter: /^(expo-router|@expo\/vector-icons|react-native-safe-area-context)$/ }, args => ({
          path: args.path,
          namespace: "screen-mock",
        }));
        build.onResolve({ filter: /^@\// }, args => mocks[args.path]
          ? { path: args.path, namespace: "screen-mock" }
          : { path: [".tsx", ".ts", ".jsx", ".js"]
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

test("Profile opens Help Center and Legal, and back returns to Profile", async ({ page }) => {
  await page.getByRole("button", { name: "Open Help Center" }).click();
  await expect(page.getByTestId("help-center-screen")).toBeVisible();
  await expect(page.getByText("How can we help?", { exact: true })).toBeVisible();
  await expect(page.getByText("Find answers to common questions or get in touch with the Bluebird team.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Frequently Asked Questions" })).toBeVisible();
  await expect(page.getByText("Find answers to common questions about Bluebird.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Email Support" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Call Support" })).toBeVisible();
  await expect(page.getByText("(380) 249-9582", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Contact Us" })).toBeVisible();
  await page.getByTestId("help-center-back").click();
  await expect(page.getByTestId("profile-screen")).toBeVisible();

  await page.getByRole("button", { name: "Open Legal" }).click();
  await expect(page.getByTestId("legal-screen")).toBeVisible();
  await expect(page.getByRole("link", { name: "Terms of Service" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Privacy Policy" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Flight Policy" })).toBeVisible();
  await page.getByTestId("legal-back").click();
  await expect(page.getByTestId("profile-screen")).toBeVisible();
});

test("Help Center and Legal opened directly return to Profile", async ({ page }) => {
  await page.evaluate(() => window.mountDirect("/support/help-center"));
  await expect(page.getByTestId("help-center-screen")).toBeVisible();
  await page.getByTestId("help-center-back").click();
  await expect(page.getByTestId("profile-screen")).toBeVisible();
  expect(await page.evaluate(() => window.routeStack)).toEqual(["/(tabs)/profile"]);

  await page.evaluate(() => window.mountDirect("/support/legal"));
  await expect(page.getByTestId("legal-screen")).toBeVisible();
  await page.getByTestId("legal-back").click();
  await expect(page.getByTestId("profile-screen")).toBeVisible();
});

test("Help Center and Legal actions open only the confirmed destinations", async ({ page }) => {
  await page.evaluate(() => {
    window.openedUrls = [];
    window.open = (url) => {
      window.openedUrls.push(String(url));
      return null;
    };
  });
  await page.getByRole("button", { name: "Open Help Center" }).click();
  await page.getByRole("link", { name: "Frequently Asked Questions" }).click();
  await page.getByRole("link", { name: "Email Support" }).click();
  await page.getByRole("link", { name: "Contact Us" }).click();
  expect(await page.evaluate(() => window.openedUrls)).toEqual([
    "https://bluebirdjets.com/faq",
    "mailto:hello@bluebirdjets.com",
    "https://bluebirdjets.com/contact",
  ]);
  await expect(page.getByTestId("help-center-screen")).toBeVisible();
  await expect(page.getByTestId("help-center-open-error")).toHaveCount(0);

  await page.evaluate(() => { window.open = () => { throw new Error("browser unavailable"); }; });
  await page.getByRole("link", { name: "Frequently Asked Questions" }).click();
  await expect(page.getByTestId("help-center-open-error")).toHaveText("This link couldn’t be opened. Try again in a moment.");
  await expect(page.getByTestId("help-center-screen")).toBeVisible();

  await page.getByTestId("help-center-back").click();
  await page.evaluate(() => {
    window.openedUrls = [];
    window.open = (url) => {
      window.openedUrls.push(String(url));
      return null;
    };
  });
  await page.getByRole("button", { name: "Open Legal" }).click();
  await page.getByRole("link", { name: "Terms of Service" }).click();
  await page.getByRole("link", { name: "Privacy Policy" }).click();
  await page.getByRole("link", { name: "Flight Policy" }).click();
  expect(await page.evaluate(() => window.openedUrls)).toEqual([
    "https://bluebirdjets.com/terms",
    "https://bluebirdjets.com/privacy",
    "https://bluebirdjets.com/flight-policy",
  ]);
  await expect(page.getByTestId("legal-screen")).toBeVisible();
  await expect(page.getByText(/email was sent|call completed/i)).toHaveCount(0);
});
