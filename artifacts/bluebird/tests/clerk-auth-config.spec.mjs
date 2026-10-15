import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canAccessClerkAuthRoutes,
  getClerkAuthErrorMessage,
  getClerkAuthViewState,
  performClerkSignOut,
  resolveClerkAuthConfiguration,
  resolveClerkAuthConfigurationFromEnvironment,
  shouldMountClerkProvider,
} from "../scripts/.clerk-auth-config.test.mjs";

const validTestKey = "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k";

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
  assert.deepEqual(enabled, { enabled: true, publishableKey: validTestKey });
  assert.equal(shouldMountClerkProvider(enabled), true);
  assert.equal(canAccessClerkAuthRoutes(enabled), true);
});

test("Development Clerk auth is independent of Main API issuer readiness", () => {
  const config = resolveClerkAuthConfigurationFromEnvironment({
    EXPO_PUBLIC_ENABLE_CLERK_AUTH: "true",
    EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY: validTestKey,
    EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT: "development",
    EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_BASE_URL: "",
    EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_CLERK_ISSUER: "https://unverified.example.test",
  }, true);
  assert.deepEqual(config, { enabled: true, publishableKey: validTestKey });
  assert.equal(shouldMountClerkProvider(config), true);
  assert.equal(canAccessClerkAuthRoutes(config), true);

  const configWithoutFlag = resolveClerkAuthConfiguration(undefined, validTestKey, true);
  assert.equal(configWithoutFlag.enabled, false);
  assert.equal(shouldMountClerkProvider(configWithoutFlag), false);
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
