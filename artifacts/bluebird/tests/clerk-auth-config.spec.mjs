import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canAccessClerkAuthRoutes,
  getClerkAuthErrorMessage,
  getClerkAuthViewState,
  performClerkSignOut,
  resolveClerkAuthConfiguration,
  shouldMountClerkProvider,
} from "../scripts/.clerk-auth-config.test.mjs";

const validTestKey = "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k";

test("Clerk stays disabled unless the flag is exactly true and the public key is valid", () => {
  for (const flag of [undefined, "", "false", "TRUE", "1", true]) {
    const config = resolveClerkAuthConfiguration(flag, validTestKey);
    assert.equal(config.enabled, false);
    assert.equal(config.publishableKey, null);
    assert.equal(shouldMountClerkProvider(config), false);
    assert.equal(canAccessClerkAuthRoutes(config), false);
  }

  for (const key of [undefined, "", " ", "secret_key", "pk_test_short", "pk_live_###"]) {
    const config = resolveClerkAuthConfiguration("true", key);
    assert.equal(config.enabled, false);
    assert.equal(config.publishableKey, null);
    assert.equal(shouldMountClerkProvider(config), false);
    assert.equal(canAccessClerkAuthRoutes(config), false);
  }

  const enabled = resolveClerkAuthConfiguration("true", ` ${validTestKey} `);
  assert.deepEqual(enabled, { enabled: true, publishableKey: validTestKey });
  assert.equal(shouldMountClerkProvider(enabled), true);
  assert.equal(canAccessClerkAuthRoutes(enabled), true);
});

test("a key by itself never enables provider mounting or Clerk routes", () => {
  const config = resolveClerkAuthConfiguration(undefined, validTestKey);
  assert.equal(config.enabled, false);
  assert.equal(shouldMountClerkProvider(config), false);
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
