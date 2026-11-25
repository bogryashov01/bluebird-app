import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

const replitChromium = "/repl/tools/bin/chromium";

export default defineConfig({
  testDir: ".",
  testMatch: "clerk-notifications-screen.spec.mjs",
  outputDir: "/tmp/bluebird-clerk-notifications-screen-results",
  reporter: "list",
  use: {
    viewport: { width: 393, height: 844 },
    ...(existsSync(replitChromium) ? {} : { channel: "chrome" }),
    launchOptions: {
      ...(existsSync(replitChromium) ? { executablePath: replitChromium } : {}),
      args: ["--no-sandbox"],
    },
  },
});
