import { defineConfig, devices } from "@playwright/test";

const port = 20106;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: ".",
  testMatch: "membership-mock-preview.spec.mjs",
  timeout: 45_000,
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
    command: `CI=1 EXPO_NO_TELEMETRY=1 EXPO_PUBLIC_ENABLE_CLERK_AUTH=false EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT=development EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_BASE_URL=https://main-api-development.example.test/api EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY=pk_test_Y2xlcmsuZXhhbXBsZS5jb20k EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_CLERK_ISSUER=https://clerk.example.com EXPO_PUBLIC_BLUEBIRD_FLIGHT_READ_MODE=local EXPO_PUBLIC_BLUEBIRD_MEMBERSHIP_DATA_MODE=mock pnpm exec expo start --web --localhost --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
