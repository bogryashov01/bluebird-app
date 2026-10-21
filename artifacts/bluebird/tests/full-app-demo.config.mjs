import { defineConfig, devices } from "@playwright/test";

const port = 20107;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: ".",
  testMatch: "full-app-demo.spec.mjs",
  timeout: 60_000,
  fullyParallel: false,
  reporter: process.env.CI ? "line" : "list",
  use: {
    ...devices["iPhone 13"],
    baseURL,
    browserName: "chromium",
    launchOptions: {
      executablePath: "/repl/tools/bin/chromium",
      args: ["--no-sandbox"],
    },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `CI=1 EXPO_NO_TELEMETRY=1 EXPO_PUBLIC_ENABLE_CLERK_AUTH=false EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT=production EXPO_PUBLIC_BLUEBIRD_FLIGHT_READ_MODE=local EXPO_PUBLIC_BLUEBIRD_MEMBERSHIP_DATA_MODE=mock EXPO_PUBLIC_BLUEBIRD_FULL_APP_DEMO=true EXPO_PUBLIC_DOMAIN=127.0.0.1 pnpm exec expo start --web --localhost --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
