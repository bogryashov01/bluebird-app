import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "support-screens-ui.spec.mjs",
  outputDir: "/tmp/bluebird-support-screens-results",
  reporter: "list",
  use: {
    viewport: { width: 393, height: 844 },
    launchOptions: { executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] },
  },
});
