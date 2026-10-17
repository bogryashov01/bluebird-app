import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "clerk-notifications-screen.spec.mjs",
  outputDir: "/tmp/bluebird-clerk-notifications-screen-results",
  reporter: "list",
  use: {
    viewport: { width: 393, height: 844 },
    launchOptions: { executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] },
  },
});
