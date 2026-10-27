import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  CLERK_STARTUP_TIMEOUT_MS,
  getClerkStartupFailureReason,
  getClerkStartupState,
  getNextClerkStartupAttempt,
  logClerkStartupDiagnostic,
  sanitizeClerkStartupError,
  startClerkStartupTimeout,
} from '../scripts/.clerk-startup.test.mjs';
import {
  resolveClerkAuthConfigurationFromEnvironment,
  shouldShowClerkConfigurationError,
} from '../scripts/.clerk-auth-config.test.mjs';

test('successful Clerk readiness releases the existing auth routing path', () => {
  assert.equal(getClerkStartupState({
    authExpected: true,
    configurationValid: true,
    providerMounted: true,
    isLoaded: true,
    timedOut: false,
  }), 'ready');
  assert.equal(getClerkStartupState({
    authExpected: false,
    configurationValid: false,
    providerMounted: false,
    isLoaded: false,
    timedOut: false,
  }), 'ready', 'ordinary legacy mode retains its existing routing behavior');
});

test('Production Clerk startup is bounded at about fifteen seconds', () => {
  assert.equal(CLERK_STARTUP_TIMEOUT_MS, 15_000);
  const input = {
    authExpected: true,
    configurationValid: true,
    providerMounted: true,
    isLoaded: false,
  };
  assert.equal(getClerkStartupState({ ...input, timedOut: false }), 'loading');
  assert.equal(getClerkStartupState({ ...input, timedOut: true }), 'failed');
  assert.equal(getClerkStartupFailureReason({
    configurationValid: true,
    providerMounted: true,
    timedOut: true,
  }), 'initialization_timeout');
});

test('the timeout callback fires and can be canceled for a completed attempt', async () => {
  let fired = false;
  const cancelTimeout = startClerkStartupTimeout(() => { fired = true; }, 5);
  assert.equal(fired, false);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fired, true);
  cancelTimeout();

  let canceledCallbackFired = false;
  const cancelPendingTimeout = startClerkStartupTimeout(
    () => { canceledCallbackFired = true; },
    10,
  );
  cancelPendingTimeout();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(canceledCallbackFired, false);
});

test('Retry starts a new provider attempt and readiness can recover', () => {
  const currentAttempt = 2;
  const retryAttempt = getNextClerkStartupAttempt(currentAttempt);
  assert.equal(retryAttempt, 3);
  assert.equal(getClerkStartupState({
    authExpected: true,
    configurationValid: true,
    providerMounted: true,
    isLoaded: false,
    timedOut: false,
  }), 'loading');
  assert.equal(getClerkStartupState({
    authExpected: true,
    configurationValid: true,
    providerMounted: true,
    isLoaded: true,
    timedOut: false,
  }), 'ready');
});

test('a missing provider is failed, not a successful signed-out session', () => {
  assert.equal(getClerkStartupState({
    authExpected: true,
    configurationValid: true,
    providerMounted: false,
    isLoaded: false,
    timedOut: false,
  }), 'failed');
  assert.equal(getClerkStartupFailureReason({
    configurationValid: true,
    providerMounted: false,
    timedOut: false,
  }), 'provider_missing');
});

test('invalid Production configuration remains blocked', () => {
  const configuration = resolveClerkAuthConfigurationFromEnvironment({
    EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT: 'production',
    EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL: 'https://bluebirdjets.com/api',
    EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY: 'pk_live_Y2xlcmsuZXhhbXBsZS5jb20k',
    EXPO_PUBLIC_BLUEBIRD_API_CLERK_ISSUER: 'https://wrong.example.com',
    EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH: 'true',
  });
  assert.equal(configuration.authExpected, true);
  assert.equal(configuration.enabled, false);
  assert.equal(configuration.publishableKey, null);
  assert.equal(shouldShowClerkConfigurationError(configuration), true);
  assert.equal(getClerkStartupFailureReason({
    configurationValid: false,
    providerMounted: false,
    timedOut: false,
  }), 'configuration_invalid');
  assert.equal(getClerkStartupState({
    authExpected: true,
    configurationValid: false,
    providerMounted: false,
    isLoaded: false,
    timedOut: false,
  }), 'failed');
});

test('startup diagnostics allow only safe fields and broad sanitized error categories', () => {
  const secretValues = [
    'pk_live_secret-value',
    'session_token_secret',
    '+15555550123',
    'member@example.test',
  ];
  const rawError = new Error(secretValues.join(' '));
  assert.equal(sanitizeClerkStartupError(rawError), 'unknown');

  const logLines = [];
  const events = [
    'production_mode',
    'provider_mount',
    'initialization_start',
    'readiness_change',
    'timeout',
    'initialization_error',
  ];
  const previousInfo = console.info;
  const previousWarn = console.warn;
  console.info = (...values) => logLines.push(values);
  console.warn = (...values) => logLines.push(values);
  try {
    for (const event of events) {
      logClerkStartupDiagnostic({
        event,
        production: true,
        attempt: 1,
        providerMounted: true,
        ...(event === 'readiness_change' ? { isLoaded: true } : {}),
        ...(event === 'initialization_error'
          ? { errorCategory: sanitizeClerkStartupError(rawError) }
          : {}),
      });
    }
  } finally {
    console.info = previousInfo;
    console.warn = previousWarn;
  }

  const serialized = JSON.stringify(logLines);
  for (const secret of secretValues) assert.equal(serialized.includes(secret), false);
  assert.match(serialized, /"production":true/);
  assert.match(serialized, /"errorCategory":"unknown"/);
  for (const event of events) assert.ok(serialized.includes(`"event":"${event}"`));
});

test('the live auth layout remounts Clerk on Retry and keeps startup on the phone sign-in route', async () => {
  const index = await readFile(new URL('../app/index.tsx', import.meta.url), 'utf8');
  const layout = await readFile(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
  const auth = await readFile(new URL('../context/AuthContext.tsx', import.meta.url), 'utf8');
  const provider = await readFile(new URL('../lib/dormantClerkIntegration.tsx', import.meta.url), 'utf8');
  const panel = await readFile(new URL('../components/ClerkAuthPanel.tsx', import.meta.url), 'utf8');
  const startupView = await readFile(new URL('../components/ClerkStartupStateView.tsx', import.meta.url), 'utf8');

  assert.match(layout, /<DormantClerkProvider[\s\S]*key=\{clerkStartupAttempt\}[\s\S]*attempt=\{clerkStartupAttempt\}/);
  assert.doesNotMatch(layout, /clerkStartupState === 'failed'/);
  assert.match(index, /if \(authMode === 'clerk'\)[\s\S]*clerkStartupState !== 'ready' \|\| !clerkSignedIn[\s\S]*Redirect href="\/\(clerk-auth\)\/sign-in"/);
  assert.match(index, /if \(isLoading\)/);
  assert.match(auth, /useState<ClerkStartupState>\(\(\) =>\s*getClerkStartupState/);
  assert.match(auth, /onRetryClerkStartup\(\)/);
  assert.match(auth, /if \(!production\) return;\s*return startClerkStartupTimeout/);
  assert.match(provider, /value=\{false\}/);
  assert.match(provider, /event: 'provider_mount'/);
  assert.match(provider, /errorCategory: sanitizeClerkStartupError\(error\)/);
  assert.match(provider, /<ClerkStartupStateView\s+state="failed"\s+onRetry=/);
  assert.match(panel, /isSignedIn !== true/);
  assert.match(panel, /testID="clerk-auth-loading"/);
  assert.match(panel, /startupFailed \? \(/);
  assert.match(panel, /const authResourcesReady = isLoaded && resourcesLoaded && !startupFailed/);
  assert.match(panel, /editable=\{authResourcesReady\}/);
  assert.match(panel, /onPress=\{onRetryStartup\}/);
  assert.match(startupView, /editable=\{false\}/);
  assert.match(startupView, /accessibilityState=\{\{ disabled: true \}\}/);
  assert.match(startupView, /testID="clerk-startup-error"/);
  assert.match(startupView, /testID="clerk-startup-retry"/);
});
