import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const artifactConfig = await readFile(
  new URL("../.replit-artifact/artifact.toml", import.meta.url),
  "utf8",
);

test("Selected Production Preview preserves the separate Development launch", () => {
  assert.equal(
    packageJson.scripts.dev,
    "sh -c 'if [ -n \"$REPLIT_EXPO_SESSION_SECRET\" ]; then pnpm exec create-launch login --session \"$REPLIT_EXPO_SESSION_SECRET\" || true; fi' && BROWSER=none EXPO_PACKAGER_PROXY_URL=https://$REPLIT_EXPO_DEV_DOMAIN EXPO_PUBLIC_DOMAIN=$REPLIT_DEV_DOMAIN EXPO_PUBLIC_BLUEBIRD_FLIGHT_READ_MODE=local EXPO_PUBLIC_REPL_ID=$REPL_ID REACT_NATIVE_PACKAGER_HOSTNAME=$REPLIT_EXPO_DEV_DOMAIN pnpm exec expo start --dev-client --web --host lan --port $PORT",
  );
  assert.match(artifactConfig, /\[services\.development\]\s+run = "pnpm --filter @workspace\/bluebird run preview:production-web"/);
});

test("Production Preview inherits the Production Clerk gate without setting or removing it", () => {
  const command = packageJson.scripts["preview:production-web"];
  assert.ok(command);
  assert.doesNotMatch(command, /env -u EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH/);
  assert.doesNotMatch(command, /EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH=/);
});

test("Production Preview passes the caller's approval flag to its Expo command unchanged", async () => {
  const command = packageJson.scripts["preview:production-web"];
  const tempDirectory = await mkdtemp(join(tmpdir(), "bluebird-production-preview-"));
  const fakeBinDirectory = join(tempDirectory, "bin");
  const fakePnpmPath = join(fakeBinDirectory, "pnpm");
  await mkdir(fakeBinDirectory);
  await writeFile(
    fakePnpmPath,
    '#!/bin/sh\nprintf "%s" "${EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH-<unset>}"\n',
  );
  await chmod(fakePnpmPath, 0o755);

  try {
    for (const [flag, expected] of [
      ["true", "true"],
      ["false", "false"],
      [undefined, "<unset>"],
    ]) {
      const environment = {
        ...process.env,
        PATH: `${fakeBinDirectory}:${process.env.PATH ?? ""}`,
        PORT: "43127",
      };
      if (flag === undefined) {
        delete environment.EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH;
      } else {
        environment.EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH = flag;
      }
      const result = spawnSync("sh", ["-c", command], {
        encoding: "utf8",
        env: environment,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, expected);
    }
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("Production Preview retains production API reads and the current production web bundle options", () => {
  const command = packageJson.scripts["preview:production-web"];
  assert.ok(command);
  assert.match(command, /EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT=production/);
  assert.match(command, /EXPO_PUBLIC_BLUEBIRD_FLIGHT_READ_MODE=production/);
  assert.match(command, /expo start --no-dev --minify --web --localhost --port \$PORT/);
  assert.doesNotMatch(command, /EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL=/);
  assert.doesNotMatch(command, /EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY=/);
});
