import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { getDevelopmentClerkWorkflowStatus } from '../scripts/.development-clerk-workflow.test.mjs';

const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
const previewCommand = packageJson.scripts['preview:expo-go'];
const developmentLauncher = await readFile(
  new URL('../scripts/dev-stage1-web.sh', import.meta.url),
  'utf8',
);
const replitConfig = await readFile(new URL('../../../.replit', import.meta.url), 'utf8');

const validDevelopmentEnvironment = {
  EXPO_PUBLIC_ENABLE_CLERK_AUTH: 'true',
  EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT: 'development',
  EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_BASE_URL: 'https://dev-api.example.test/api',
  EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY: 'pk_test_Y2xlcmsuZXhhbXBsZS5jb20k',
  EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_CLERK_ISSUER: 'https://clerk.example.com',
  EXPO_PUBLIC_BLUEBIRD_FULL_APP_DEMO: 'false',
};

test('the separate workflow accepts only a matching Development API and Clerk pair', () => {
  const status = getDevelopmentClerkWorkflowStatus(validDevelopmentEnvironment);
  assert.deepEqual(status, {
    ready: true,
    selectedEnvironment: 'development',
    developmentApi: 'configured',
    developmentClerk: 'configured',
    issuerMatch: 'matched',
    clerkAuth: 'enabled',
    fullAppDemo: 'disabled',
    blockers: [],
  });
});

test('Production selection, a Production API URL, or a live key cannot pass Development preflight', () => {
  const productionSelected = getDevelopmentClerkWorkflowStatus({
    ...validDevelopmentEnvironment,
    EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT: 'production',
  });
  assert.equal(productionSelected.ready, false);
  assert.equal(productionSelected.selectedEnvironment, 'not development');

  const productionApiPair = getDevelopmentClerkWorkflowStatus({
    ...validDevelopmentEnvironment,
    EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_BASE_URL: 'https://bluebirdjets.com/api',
  });
  assert.equal(productionApiPair.ready, false);
  assert.equal(productionApiPair.developmentApi, 'blocked');

  const productionClerkKey = getDevelopmentClerkWorkflowStatus({
    ...validDevelopmentEnvironment,
    EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY: 'pk_live_Y2xlcmsuZXhhbXBsZS5jb20k',
  });
  assert.equal(productionClerkKey.ready, false);
  assert.equal(productionClerkKey.developmentClerk, 'blocked');

  const productionOnlySettings = getDevelopmentClerkWorkflowStatus({
    EXPO_PUBLIC_ENABLE_CLERK_AUTH: 'true',
    EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT: 'development',
    EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL: 'https://bluebirdjets.com/api',
    EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY: 'pk_live_Y2xlcmsuZXhhbXBsZS5jb20k',
    EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH: 'true',
  });
  assert.equal(productionOnlySettings.ready, false);
  assert.equal(productionOnlySettings.developmentApi, 'blocked');
  assert.equal(productionOnlySettings.developmentClerk, 'blocked');
});

test('missing or mismatched Development issuer settings fail closed', () => {
  for (const issuer of [undefined, 'https://other.example.test']) {
    const status = getDevelopmentClerkWorkflowStatus({
      ...validDevelopmentEnvironment,
      EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_CLERK_ISSUER: issuer,
    });
    assert.equal(status.ready, false);
    assert.equal(status.issuerMatch, 'unverified');
  }
});

test('real Clerk auth must be enabled and Full App Demo must remain disabled', () => {
  const clerkDisabled = getDevelopmentClerkWorkflowStatus({
    ...validDevelopmentEnvironment,
    EXPO_PUBLIC_ENABLE_CLERK_AUTH: 'false',
  });
  assert.equal(clerkDisabled.ready, false);
  assert.equal(clerkDisabled.clerkAuth, 'disabled');

  const demoEnabled = getDevelopmentClerkWorkflowStatus({
    ...validDevelopmentEnvironment,
    EXPO_PUBLIC_BLUEBIRD_FULL_APP_DEMO: 'true',
  });
  assert.equal(demoEnabled.ready, false);
  assert.equal(demoEnabled.fullAppDemo, 'enabled');
});

test('safe preflight status never includes configured values or user data', () => {
  const sensitiveValues = [
    'pk_test_Y2xlcmsuZXhhbXBsZS5jb20k',
    'https://dev-api.example.test/api',
    'https://clerk.example.com',
    '+15555550123',
    'member@example.test',
  ];
  const status = getDevelopmentClerkWorkflowStatus({
    ...validDevelopmentEnvironment,
    EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_BASE_URL: sensitiveValues[1],
    EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY: sensitiveValues[0],
    EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_CLERK_ISSUER: sensitiveValues[2],
  });
  const serialized = JSON.stringify(status);
  for (const value of sensitiveValues) assert.equal(serialized.includes(value), false);
});

test('the demo launcher stays Clerk-disabled and the Development command is explicit', () => {
  assert.match(previewCommand, /EXPO_PUBLIC_ENABLE_CLERK_AUTH=false/);
  assert.match(previewCommand, /EXPO_PUBLIC_BLUEBIRD_FULL_APP_DEMO=true/);
  assert.match(developmentLauncher, /EXPO_PUBLIC_ENABLE_CLERK_AUTH=true/);
  assert.match(developmentLauncher, /EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT=development/);
  assert.match(developmentLauncher, /EXPO_PUBLIC_BLUEBIRD_FULL_APP_DEMO=false/);
  assert.match(developmentLauncher, /development-clerk-workflow\.ts/);
  assert.match(packageJson.scripts['dev:stage1-web'], /dev-stage1-web\.sh/);
  assert.match(developmentLauncher, /EXPO_PUBLIC_BLUEBIRD_FLIGHT_READ_MODE=local/);
  assert.match(
    replitConfig,
    /\[\[workflows\.workflow\]\]\s+name = "Bluebird Clerk Development Web"[\s\S]*?task = "shell\.exec"\s+args = "pnpm --filter @workspace\/bluebird run dev:stage1-web"\s+waitForPort = 5000/,
  );
});
