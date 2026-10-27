import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  resolveRuntimeClerkAuthConfiguration,
} from '../scripts/.clerk-auth-config.test.mjs';
import {
  resolveFullAppDemoConfiguration,
} from '../scripts/.full-app-demo.test.mjs';

const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
const expoGoCommand = packageJson.scripts['preview:expo-go'];
const productionVariables = [
  'EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL',
  'EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY',
  'EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_CLERK_ISSUER',
  'EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH',
];
const fakeValues = {
  EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL: 'https://bluebirdjets.com/api',
  EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY: 'pk_live_test-value-must-not-print',
  EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_CLERK_ISSUER: 'https://clerk.example.test',
  EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH: 'true',
};

test('the Production debug Metro launcher is opt-in and preserves normal Expo startup', async () => {
  const normalDev = packageJson.scripts.dev;
  assert.match(normalDev, /BLUEBIRD_PRODUCTION_CLERK_DEBUG/);
  assert.match(normalDev, /sh scripts\/dev-production-clerk-debug\.sh/);
  assert.match(normalDev, /EXPO_PUBLIC_BLUEBIRD_FLIGHT_READ_MODE=local/);
  assert.equal(normalDev.includes('EXPO_PUBLIC_DOMAIN='), true);
  assert.match(
    expoGoCommand,
    /^if \[ "\$BLUEBIRD_PRODUCTION_CLERK_DEBUG" = "true" \]; then sh scripts\/dev-production-clerk-debug\.sh; else /,
  );
  assert.match(expoGoCommand, /pnpm exec expo start --go --web --host lan --port \$PORT; fi$/);

  const debugScript = await readFile(
    new URL('../scripts/dev-production-clerk-debug.sh', import.meta.url),
    'utf8',
  );
  assert.match(debugScript, /EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_DEBUG=true/);
  assert.match(debugScript, /EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST=true/);
  assert.match(debugScript, /EXPO_PUBLIC_BLUEBIRD_FULL_APP_DEMO=false/);
  assert.match(debugScript, /env -u EXPO_PUBLIC_DOMAIN/);
  assert.match(debugScript, /--host lan/);
  assert.match(debugScript, /--tunnel/);
});

test('the Production debug runtime ignores a demo request even in development mode', () => {
  assert.deepEqual(
    resolveFullAppDemoConfiguration('true', true, true),
    { enabled: false },
  );
  const configuration = resolveRuntimeClerkAuthConfiguration({
    EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_DEBUG: 'true',
    EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT: 'production',
    EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL: fakeValues.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL,
    EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY: fakeValues.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY,
    EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_CLERK_ISSUER: fakeValues.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_CLERK_ISSUER,
    EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH: 'false',
  }, true);
  assert.equal(configuration.enabled, false);
  assert.equal(configuration.environment, null);
});

test('Metro preflight reports only presence and blocks missing required Production inputs', async () => {
  const script = new URL('../scripts/production-clerk-debug-preflight.mjs', import.meta.url);
  const completeEnv = { ...process.env, ...fakeValues };
  delete completeEnv.EXPO_PUBLIC_DOMAIN;
  const complete = spawnSync(process.execPath, [script.pathname], {
    encoding: 'utf8',
    env: completeEnv,
  });
  assert.equal(complete.status, 0, complete.stderr);
  for (const name of productionVariables) {
    assert.match(complete.stdout, new RegExp(`"${name}": "present"`));
  }
  assert.match(complete.stdout, /"legacyDomain": "not configured/);
  assert.match(complete.stdout, /"remoteEasProductionVariables": "inaccessible here"/);
  assert.match(complete.stdout, /"easBuildBlockers": \[/);
  assert.match(complete.stdout, /authorized owner verification is required before a build/);
  for (const value of Object.values(fakeValues)) {
    assert.equal(complete.stdout.includes(value), false);
  }

  const incompleteEnv = { ...completeEnv };
  delete incompleteEnv.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY;
  const incomplete = spawnSync(process.execPath, [script.pathname], {
    encoding: 'utf8',
    env: incompleteEnv,
  });
  assert.equal(incomplete.status, 1);
  assert.match(incomplete.stdout, /EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY/);
  assert.equal(
    incomplete.stdout.includes(fakeValues.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY),
    false,
  );
});
