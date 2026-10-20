import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const artifactConfig = await readFile(
  new URL("../.replit-artifact/artifact.toml", import.meta.url),
  "utf8",
);

test("Production Preview is isolated from the existing Development launch", () => {
  assert.equal(
    packageJson.scripts.dev,
    "sh -c 'if [ -n \"$REPLIT_EXPO_SESSION_SECRET\" ]; then pnpm exec create-launch login --session \"$REPLIT_EXPO_SESSION_SECRET\" || true; fi' && BROWSER=none EXPO_PACKAGER_PROXY_URL=https://$REPLIT_EXPO_DEV_DOMAIN EXPO_PUBLIC_DOMAIN=$REPLIT_DEV_DOMAIN EXPO_PUBLIC_BLUEBIRD_FLIGHT_READ_MODE=local EXPO_PUBLIC_REPL_ID=$REPL_ID REACT_NATIVE_PACKAGER_HOSTNAME=$REPLIT_EXPO_DEV_DOMAIN pnpm exec expo start --dev-client --web --host lan --port $PORT",
  );
  assert.match(artifactConfig, /\[services\.development\]\s+run = "pnpm --filter @workspace\/bluebird run dev"/);
});

test("Production Preview selects production reads without changing the canonical API URL or enabling Clerk", () => {
  const command = packageJson.scripts["preview:production-web"];
  assert.ok(command);
  assert.match(command, /EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT=production/);
  assert.match(command, /EXPO_PUBLIC_BLUEBIRD_FLIGHT_READ_MODE=production/);
  assert.match(command, /expo start --no-dev --minify --web --localhost --port \$PORT/);
  assert.match(command, /env -u EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH/);
  assert.doesNotMatch(command, /EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL=/);
  assert.doesNotMatch(command, /EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH=true/);
  assert.doesNotMatch(command, /EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY=/);
});
