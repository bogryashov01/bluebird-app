import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const removedRoutes = [
  "app/development-preview/index.tsx",
  "app/development-preview/[screen].tsx",
  "app/development-preview/show.tsx",
  "app/queue/dev-preview.tsx",
  "app/membership/dev-preview.tsx",
  "lib/developmentPreview.ts",
  "lib/queueDevelopmentPreview.ts",
  "lib/membershipDevelopmentPreview.ts",
];
const preservedScreens = [
  "app/(tabs)/discover/index.tsx",
  "app/flight/[id].tsx",
  "app/queue/join.tsx",
  "app/queue/status.tsx",
  "app/(tabs)/trips/index.tsx",
  "app/(tabs)/membership/index.tsx",
  "app/flight/skip-line-pass.tsx",
  "app/(tabs)/profile/index.tsx",
  "app/notifications.tsx",
  "app/airport-picker.tsx",
  "app/account/payment-methods.tsx",
];

for (const route of removedRoutes) {
  assert.equal(existsSync(resolve(projectRoot, route)), false, `${route} should be removed`);
}
for (const screen of preservedScreens) {
  assert.equal(existsSync(resolve(projectRoot, screen)), true, `${screen} should remain available`);
}

const normalAppFiles = [
  "app/_layout.tsx",
  "app/(auth)/welcome.tsx",
  "app/(clerk-auth)/sign-in.tsx",
  "app/(tabs)/discover/index.tsx",
  "app/(tabs)/membership/index.tsx",
  "app/flight/skip-line-pass.tsx",
  "context/AuthContext.tsx",
];

for (const file of normalAppFiles) {
  const source = readFileSync(resolve(projectRoot, file), "utf8");
  assert.doesNotMatch(
    source,
    /development-preview|dev-preview|Development Preview|previewOnly|queueDevelopmentPreview|membershipDevelopmentPreview/,
    `${file} should not expose or branch around the normal app for the deleted preview`,
  );
}
