import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const replitChromium = "/repl/tools/bin/chromium";

export default defineConfig({
  testDir: "./tests",
  timeout: 45_000,
  fullyParallel: false,
  reporter: process.env.CI ? "line" : "list",
  use: {
    ...devices["iPhone 13"],
    baseURL: "http://127.0.0.1:20105",
    browserName: "chromium",
    launchOptions: existsSync(replitChromium)
      ? { executablePath: replitChromium, args: ["--no-sandbox"] }
      : { args: ["--no-sandbox"] },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "CI=1 EXPO_NO_TELEMETRY=1 pnpm exec expo start --web --localhost --port 20105",
    url: "http://127.0.0.1:20105",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});