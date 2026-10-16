import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "notification-preference-editor.spec.mjs",
  outputDir: "/tmp/bluebird-notification-preference-editor-results",
  reporter: "list",
  use: {
    viewport: { width: 400, height: 800 },
    launchOptions: { executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] },
  },
});
