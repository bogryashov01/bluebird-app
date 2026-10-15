import assert from "node:assert/strict";
import { test } from "node:test";
import { createAuthenticatedProductionApiClient } from "../scripts/.production-auth-api.test.mjs";
import {
  createClerkProductionTokenProvider,
  getClerkPublishableKey,
} from "../scripts/.clerk-production-token-provider.test.mjs";

process.env.EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT = "production";
process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL = "https://bluebirdjets.com/api";
process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY = "pk_live_Y2xlcmsuZXhhbXBsZS5jb20k";

function makeSession(overrides = {}) {
  return {
    isLoaded: true,
    isSignedIn: true,
    getToken: async () => "mock-clerk-session-token",
    signOut: async () => {},
    ...overrides,
  };
}

function makeSource(session) {
  return { getCurrentSession: () => session };
}

test("missing and blank public key are reported as unconfigured", () => {
  const previous = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
  try {
    delete process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
    assert.equal(getClerkPublishableKey(), null);
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = "   ";
    assert.equal(getClerkPublishableKey(), null);
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = "mock-publishable-value";
    assert.equal(getClerkPublishableKey(), "mock-publishable-value");
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
    else process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = previous;
  }
});

test("unloaded or signed-out Clerk sessions return null without requesting a token", async () => {
  for (const session of [
    makeSession({ isLoaded: false }),
    makeSession({ isSignedIn: false }),
    makeSession({ isSignedIn: undefined }),
  ]) {
    let reads = 0;
    session.getToken = async () => {
      reads += 1;
      return "must-not-be-read";
    };
    const provider = createClerkProductionTokenProvider(makeSource(session), "production");
    assert.equal(await provider.getVerifiedAccessToken(), null);
    assert.equal(reads, 0);
  }
});

test("each token request asks Clerk again and observes refreshed sessions", async () => {
  let currentToken = "mock-clerk-token-v1";
  let reads = 0;
  const session = makeSession({
    getToken: async () => {
      reads += 1;
      return currentToken;
    },
  });
  const provider = createClerkProductionTokenProvider(makeSource(session), "production");

  assert.equal(await provider.getVerifiedAccessToken(), "mock-clerk-token-v1");
  currentToken = "mock-clerk-token-v2";
  assert.equal(await provider.getVerifiedAccessToken(), "mock-clerk-token-v2");
  assert.equal(reads, 2);
});

test("sign-out cleanup delegates to Clerk's session signOut", async () => {
  let cleanups = 0;
  const provider = createClerkProductionTokenProvider(makeSource(makeSession({
    signOut: async () => {
      cleanups += 1;
    },
  })), "production");

  await provider.clearClerkSession();
  assert.equal(cleanups, 1);
});

test("demo JWT is never used as a fallback when Clerk has no session token", async () => {
  const demoTokenInUnrelatedStorage = "local-demo-session";
  const provider = createClerkProductionTokenProvider(makeSource(makeSession({
    getToken: async () => null,
  })), "production");

  assert.notEqual(await provider.getVerifiedAccessToken(), demoTokenInUnrelatedStorage);
  assert.equal(await provider.getVerifiedAccessToken(), null);
});

test("production API authorization uses the Clerk adapter and only the mocked fetcher", async () => {
  let requests = 0;
  let authorization;
  const tokenProvider = createClerkProductionTokenProvider(makeSource(makeSession({
    getToken: async () => "mock-clerk-api-token",
  })), "production");
  const client = createAuthenticatedProductionApiClient({
    environment: "production",
    baseUrl: "https://bluebirdjets.com/api",
    tokenProvider,
    fetcher: async (_url, init) => {
      requests += 1;
      authorization = init.headers.Authorization;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          isAuthenticated: false,
          isAdmin: false,
          isConcierge: false,
          isMember: false,
          memberTier: null,
          isProfileComplete: false,
          needsPlanDecision: false,
          needsSignupPhone: false,
          impersonation: null,
        }),
      };
    },
  });

  const result = await client.getMe();
  assert.equal(result.isAuthenticated, false);
  assert.equal(requests, 1);
  assert.equal(authorization, "Bearer mock-clerk-api-token");
});
