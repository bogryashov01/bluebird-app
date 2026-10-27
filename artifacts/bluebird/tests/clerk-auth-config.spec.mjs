import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canAccessClerkAuthRoutes,
  getClerkAuthErrorMessage,
  getClerkAuthViewState,
  getProductionAuthPreflightStatus,
  performClerkSignOut,
  resolveClerkAuthConfiguration,
  resolveClerkAuthConfigurationFromEnvironment,
  resolveRuntimeClerkAuthConfiguration,
  shouldShowClerkConfigurationError,
  shouldMountClerkProvider,
} from "../scripts/.clerk-auth-config.test.mjs";

const validTestKey = "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k";
const validProductionKey = "pk_live_Y2xlcmsuZXhhbXBsZS5jb20k";

test("Clerk stays disabled unless the flag is exactly true and the public key is valid", () => {
  for (const flag of [undefined, "", "false", "TRUE", "1", true]) {
    const config = resolveClerkAuthConfiguration(flag, validTestKey, true);
    assert.equal(config.enabled, false);
    assert.equal(config.publishableKey, null);
    assert.equal(shouldMountClerkProvider(config), false);
    assert.equal(canAccessClerkAuthRoutes(config), false);
  }

  for (const key of [undefined, "", " ", "secret_key", "pk_test_short", "pk_live_###"]) {
    const config = resolveClerkAuthConfiguration("true", key, true);
    assert.equal(config.enabled, false);
    assert.equal(config.publishableKey, null);
    assert.equal(shouldMountClerkProvider(config), false);
    assert.equal(canAccessClerkAuthRoutes(config), false);
  }

  const enabled = resolveClerkAuthConfiguration("true", ` ${validTestKey} `, true);
  assert.deepEqual(enabled, {
    authExpected: true,
    enabled: true,
    environment: "development",
    publishableKey: validTestKey,
    configurationError: null,
  });
  assert.equal(shouldMountClerkProvider(enabled), true);
  assert.equal(canAccessClerkAuthRoutes(enabled), true);
  assert.equal(shouldShowClerkConfigurationError(enabled), false);
});

test("requested Development Clerk auth fails explicitly without accepting the legacy key", () => {
  for (const publishableKey of [undefined, "", "pk_live_Y2xlcmsuZXhhbXBsZS5jb20k", "invalid"]) {
    const config = resolveClerkAuthConfiguration("true", publishableKey, true);
    assert.equal(config.authExpected, true);
    assert.equal(config.enabled, false);
    assert.equal(config.publishableKey, null);
    assert.match(config.configurationError, /EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY/);
    assert.equal(shouldShowClerkConfigurationError(config), true);
    assert.equal(shouldMountClerkProvider(config), false);
    assert.equal(canAccessClerkAuthRoutes(config), false);
  }

  const legacyOnly = resolveClerkAuthConfigurationFromEnvironment({
    EXPO_PUBLIC_ENABLE_CLERK_AUTH: "true",
    EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: validTestKey,
  }, true);
  assert.equal(legacyOnly.authExpected, true);
  assert.equal(legacyOnly.enabled, false);
  assert.equal(legacyOnly.publishableKey, null);
  assert.equal(shouldShowClerkConfigurationError(legacyOnly), true);
});

test("Development Clerk auth is independent of Main API issuer readiness", () => {
  const config = resolveClerkAuthConfigurationFromEnvironment({
    EXPO_PUBLIC_ENABLE_CLERK_AUTH: "true",
    EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY: validTestKey,
    EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT: "development",
    EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_BASE_URL: "",
    EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_CLERK_ISSUER: "https://unverified.example.test",
  }, true);
  assert.deepEqual(config, {
    authExpected: true,
    enabled: true,
    environment: "development",
    publishableKey: validTestKey,
    configurationError: null,
  });
  assert.equal(shouldMountClerkProvider(config), true);
  assert.equal(canAccessClerkAuthRoutes(config), true);

  const configWithoutFlag = resolveClerkAuthConfiguration(undefined, validTestKey, true);
  assert.equal(configWithoutFlag.authExpected, false);
  assert.equal(configWithoutFlag.enabled, false);
  assert.equal(configWithoutFlag.configurationError, null);
  assert.equal(shouldMountClerkProvider(configWithoutFlag), false);
});

test("Production Clerk remains blocked until explicit approval and an exact matching API/issuer pair", () => {
  const production = {
    EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT: "production",
    EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL: "https://bluebirdjets.com/api",
    EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY: "pk_live_Y2xlcmsuZXhhbXBsZS5jb20k",
    EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_CLERK_ISSUER: "https://clerk.example.com",
    EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH: "true",
  };

  for (const approvalFlag of [undefined, "false"]) {
    const missingApproval = resolveClerkAuthConfigurationFromEnvironment({
      ...production,
      EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH: approvalFlag,
    });
    assert.equal(missingApproval.authExpected, true);
    assert.equal(missingApproval.enabled, false);
    assert.equal(missingApproval.publishableKey, null);
    assert.match(missingApproval.configurationError, /owners approve/);
    assert.equal(shouldMountClerkProvider(missingApproval), false);
    assert.equal(canAccessClerkAuthRoutes(missingApproval), false);
  }

  for (const invalid of [
    { ...production, EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL: undefined },
    { ...production, EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY: undefined },
    { ...production, EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY: "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k" },
    { ...production, EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_CLERK_ISSUER: undefined },
    { ...production, EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_CLERK_ISSUER: "https://other.example.com" },
    { ...production, EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT: "development" },
  ]) {
    const config = resolveClerkAuthConfigurationFromEnvironment(invalid);
    assert.equal(config.authExpected, true);
    assert.equal(config.enabled, false);
    assert.equal(config.publishableKey, null);
    assert.ok(config.configurationError);
    assert.equal(shouldMountClerkProvider(config), false);
    assert.equal(canAccessClerkAuthRoutes(config), false);
  }

  const enabled = resolveClerkAuthConfigurationFromEnvironment(production);
  assert.deepEqual(enabled, {
    authExpected: true,
    enabled: true,
    environment: "production",
    publishableKey: production.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY,
    configurationError: null,
  });
  assert.equal(shouldMountClerkProvider(enabled), true);
  assert.equal(canAccessClerkAuthRoutes(enabled), true);
});

test("an opted-in development client selects Production Clerk and never falls back", () => {
  const productionDebug = {
    EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_DEBUG: "true",
    EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT: "production",
    EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL: "https://bluebirdjets.com/api",
    EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY: validProductionKey,
    EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_CLERK_ISSUER: "https://clerk.example.com",
    EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH: "true",
    EXPO_PUBLIC_ENABLE_CLERK_AUTH: "false",
    EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY: validTestKey,
    EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: validTestKey,
  };

  const selected = resolveRuntimeClerkAuthConfiguration(productionDebug, true);
  assert.deepEqual(selected, {
    authExpected: true,
    enabled: true,
    environment: "production",
    publishableKey: validProductionKey,
    configurationError: null,
  });

  for (const invalid of [
    { ...productionDebug, EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH: "false" },
    { ...productionDebug, EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL: undefined },
    { ...productionDebug, EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY: undefined },
    { ...productionDebug, EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY: validTestKey },
    { ...productionDebug, EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_CLERK_ISSUER: undefined },
    { ...productionDebug, EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_CLERK_ISSUER: "https://other.example.com" },
    { ...productionDebug, EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT: "development" },
  ]) {
    const blocked = resolveRuntimeClerkAuthConfiguration(invalid, true);
    assert.equal(blocked.authExpected, true);
    assert.equal(blocked.enabled, false);
    assert.equal(blocked.environment, null);
    assert.equal(blocked.publishableKey, null);
    assert.ok(blocked.configurationError);
  }

  const noProfileMarker = resolveRuntimeClerkAuthConfiguration({
    EXPO_PUBLIC_ENABLE_CLERK_AUTH: "true",
    EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT: "development",
    EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY: validTestKey,
  }, true);
  assert.equal(noProfileMarker.environment, "development");
  assert.equal(noProfileMarker.publishableKey, validTestKey);
});

test("Production builds block legacy fallback when the API environment selector is missing", () => {
  const config = resolveClerkAuthConfigurationFromEnvironment({
    EXPO_PUBLIC_ENABLE_CLERK_AUTH: "true",
    EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY: validTestKey,
    EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: validTestKey,
  });
  assert.equal(config.authExpected, true);
  assert.equal(config.enabled, false);
  assert.equal(config.environment, null);
  assert.match(config.configurationError, /must select production/);
});

test("Production preflight reports only sanitized statuses and keeps absent approval blocked", () => {
  const local = {
    EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT: "production",
    EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL: "https://bluebirdjets.com/api",
    EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY: "pk_live_Y2xlcmsuZXhhbXBsZS5jb20k",
    EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_CLERK_ISSUER: "https://clerk.example.com",
  };
  const result = getProductionAuthPreflightStatus(local);
  assert.deepEqual(result, {
    selectedEnvironment: "selected",
    productionApiUrl: "configured",
    productionClerkKey: "configured",
    productionIssuer: "configured",
    productionKeyFormat: "pk_live valid",
    issuerHostParity: "matched",
    issuerOwnerVerification: "not verifiable from Mobile configuration",
    approvalGate: "disabled",
    mobileLogin: "blocked",
  });
  assert.doesNotMatch(
    JSON.stringify(result),
    /https:\/\/bluebirdjets\.com|Y2xlcmsuZXhhbXBsZS5jb20k|clerk\.example\.com/i,
  );
});

test("Production preflight distinguishes malformed values and issuer mismatch", () => {
  const result = getProductionAuthPreflightStatus({
    EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT: "development",
    EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL: "https://other.example.test/api",
    EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY: "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k",
    EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_CLERK_ISSUER: "https://other.example.test",
    EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH: "true",
  });
  assert.equal(result.selectedEnvironment, "not selected");
  assert.equal(result.productionApiUrl, "invalid");
  assert.equal(result.productionClerkKey, "invalid");
  assert.equal(result.productionKeyFormat, "invalid");
  assert.equal(result.productionIssuer, "configured");
  assert.equal(result.issuerHostParity, "not verifiable");
  assert.equal(result.mobileLogin, "blocked");
});

test("Clerk migration is disabled outside Development and rejects live keys", () => {
  assert.equal(resolveClerkAuthConfiguration("true", validTestKey, false).enabled, false);
  assert.equal(
    resolveClerkAuthConfiguration("true", "pk_live_Y2xlcmsuZXhhbXBsZS5jb20k", true).enabled,
    false,
  );
});

test("Clerk auth view states distinguish loading, errors, signed-out, and signed-in", () => {
  assert.equal(getClerkAuthViewState({ isLoaded: false, isSignedIn: undefined }), "loading");
  assert.equal(getClerkAuthViewState({ isLoaded: true, isSignedIn: false }), "signed-out");
  assert.equal(getClerkAuthViewState({ isLoaded: true, isSignedIn: undefined }), "signed-out");
  assert.equal(getClerkAuthViewState({ isLoaded: true, isSignedIn: true }), "signed-in");
  assert.equal(
    getClerkAuthViewState({
      isLoaded: true,
      isSignedIn: false,
      error: new Error("mock Clerk error"),
    }),
    "error",
  );
});

test("sign-out invokes only the injected Clerk action and reports failures without API requests", async () => {
  let clerkSignOutCalls = 0;
  let fetchCalls = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("unexpected network request");
  };
  try {
    const success = await performClerkSignOut(async () => {
      clerkSignOutCalls += 1;
    });
    assert.deepEqual(success, { ok: true });

    const failure = await performClerkSignOut(async () => {
      clerkSignOutCalls += 1;
      throw new Error("mock sign-out failure");
    });
    assert.deepEqual(failure, {
      ok: false,
      message: "Clerk authentication could not be completed. Please try again.",
    });
    assert.equal(clerkSignOutCalls, 2);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("unknown error shapes get a safe message and are not logged or rethrown", async () => {
  assert.equal(
    getClerkAuthErrorMessage({ code: "mock_error" }),
    "Clerk authentication could not be completed. Please try again.",
  );
  assert.deepEqual(await performClerkSignOut(async () => { throw { code: "mock_error" }; }), {
    ok: false,
    message: "Clerk authentication could not be completed. Please try again.",
  });
});
