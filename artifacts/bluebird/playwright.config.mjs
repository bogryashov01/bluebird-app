import { defineConfig, devices } from "@playwright/test";

const stage1PreviewUrl = process.env.BLUEBIRD_STAGE1_PREVIEW_URL;
const flightReadMode =
  process.env.EXPO_PUBLIC_BLUEBIRD_FLIGHT_READ_MODE === "production" ? "production" : "local";

export default defineConfig({
  testDir: "./tests",
  timeout: 45_000,
  fullyParallel: false,
  reporter: process.env.CI ? "line" : "list",
  use: {
    ...devices["iPhone 13"],
    baseURL: stage1PreviewUrl ?? "http://127.0.0.1:20105",
    browserName: "chromium",
    launchOptions: {
      executablePath: "/repl/tools/bin/chromium",
      args: ["--no-sandbox"],
    },
    trace: "retain-on-failure",
  },
  webServer: stage1PreviewUrl
    ? undefined
    : {
        command: `CI=1 EXPO_NO_TELEMETRY=1 EXPO_PUBLIC_BLUEBIRD_FLIGHT_READ_MODE=${flightReadMode} pnpm exec expo start --web --localhost --port 20105`,
        url: "http://127.0.0.1:20105",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});