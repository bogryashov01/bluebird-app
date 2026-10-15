import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canAccessClerkMemberScreens,
  clearClerkMemberCacheOnIdentityChange,
  createLegacyAuthTokenGetter,
  getClerkEntryState,
  isLegacyMemberQueryEnabled,
  shouldRedirectClerkRoute,
  shouldClearClerkMemberCache,
} from "../scripts/.clerk-auth-session.test.mjs";
import {
  customFetch,
  setAuthTokenGetter,
} from "../scripts/.custom-fetch.test.mjs";
import {
  CLERK_MEMBER_NAVIGATION_READINESS,
  PRODUCTION_AUTH_AVAILABILITY,
} from "../scripts/.production-auth-state.test.mjs";

test("central Clerk resolution states gate member screens and distinguish outcomes", () => {
  assert.equal(getClerkEntryState({ isLoaded: false, isSignedIn: undefined }), "loading");
  assert.equal(getClerkEntryState({ isLoaded: true, isSignedIn: false }), "signed-out");
  assert.equal(getClerkEntryState({ isLoaded: true, isSignedIn: true }), "member-pending");
  assert.equal(getClerkEntryState({
    isLoaded: true,
    isSignedIn: true,
    memberResolution: { status: "not_checked" },
  }), "member-not-checked");
  assert.equal(canAccessClerkMemberScreens({
    isLoaded: true,
    isSignedIn: true,
    memberResolution: { status: "not_checked" },
  }), false);
  assert.equal(
    getClerkEntryState({
      isLoaded: true,
      isSignedIn: true,
      memberResolution: { status: "unresolved", reason: "projection_only" },
    }),
    "member-unlinked",
  );
  assert.equal(
    getClerkEntryState({
      isLoaded: true,
      isSignedIn: true,
      memberResolution: { status: "registration_required" },
    }),
    "registration-required",
  );
  assert.equal(
    getClerkEntryState({
      isLoaded: true,
      isSignedIn: true,
      memberResolution: { status: "onboarding_required" },
    }),
    "onboarding-required",
  );
  assert.equal(
    getClerkEntryState({
      isLoaded: true,
      isSignedIn: true,
      memberResolution: { status: "error", reason: "backend" },
    }),
    "error",
  );
  assert.equal(
    canAccessClerkMemberScreens({
      isLoaded: true,
      isSignedIn: true,
      memberResolution: { status: "linked", memberId: "bluebird-member-1" },
    }),
    true,
  );
  assert.equal(
    canAccessClerkMemberScreens({ isLoaded: true, isSignedIn: true }),
    false,
  );
  assert.equal(shouldRedirectClerkRoute(["(tabs)", "discover"], false), true);
  assert.equal(shouldRedirectClerkRoute(["(tabs)", "profile"], false), true);
  assert.equal(shouldRedirectClerkRoute(["notifications"], false), true);
  assert.equal(shouldRedirectClerkRoute(["(auth)", "complete-registration"], false), true);
  assert.equal(shouldRedirectClerkRoute(["(auth)", "onboarding"], false), true);
  assert.equal(shouldRedirectClerkRoute(["account", "bluebird-profile"], false), false);
  assert.equal(shouldRedirectClerkRoute(["membership", "plans"], false), false);
  assert.equal(shouldRedirectClerkRoute(["membership", "join"], false), true);
  assert.equal(shouldRedirectClerkRoute(["account", "personal-info"], false), true);
  assert.equal(shouldRedirectClerkRoute(["(auth)", "welcome"], false), false);
  assert.equal(shouldRedirectClerkRoute(["(clerk-auth)", "sign-in"], false), false);
  assert.equal(shouldRedirectClerkRoute(["(clerk-auth)", "signed-in"], false), false);
  assert.equal(shouldRedirectClerkRoute(["(tabs)", "discover"], true), false);
});

test("member-data query gates require local demo mode and a legacy-auth member", () => {
  assert.equal(isLegacyMemberQueryEnabled({
    authMode: "clerk",
    localDemoFlow: true,
    hasLegacyUser: true,
  }), false);
  assert.equal(isLegacyMemberQueryEnabled({
    authMode: "legacy",
    localDemoFlow: false,
    hasLegacyUser: true,
  }), false);
  assert.equal(isLegacyMemberQueryEnabled({
    authMode: "legacy",
    localDemoFlow: true,
    hasLegacyUser: false,
  }), false);
  assert.equal(isLegacyMemberQueryEnabled({
    authMode: "legacy",
    localDemoFlow: true,
    hasLegacyUser: true,
  }), true);

  let authenticatedMemberRequests = 0;
  const clerkGateClosed = isLegacyMemberQueryEnabled({
    authMode: "clerk",
    localDemoFlow: true,
    hasLegacyUser: true,
  });
  for (const _path of ["/me/profile", "/membership", "/trips", "/notifications"]) {
    if (clerkGateClosed) authenticatedMemberRequests += 1;
  }
  assert.equal(authenticatedMemberRequests, 0);
});

test("identity changes and sign-out clear member cache; unchanged and loading states do not", () => {
  assert.equal(shouldClearClerkMemberCache(undefined, "clerk-user-a", true), true);
  assert.equal(shouldClearClerkMemberCache("clerk-user-a", "clerk-user-b", true), true);
  assert.equal(shouldClearClerkMemberCache("clerk-user-a", null, true), true);
  assert.equal(shouldClearClerkMemberCache("clerk-user-a", "clerk-user-a", true), false);
  assert.equal(shouldClearClerkMemberCache("clerk-user-a", null, false), false);

  let clearCalls = 0;
  const cache = { clear: () => { clearCalls += 1; } };
  assert.equal(clearClerkMemberCacheOnIdentityChange(cache, "clerk-user-a", "clerk-user-b", true), true);
  assert.equal(clearClerkMemberCacheOnIdentityChange(cache, "clerk-user-b", "clerk-user-b", true), false);
  assert.equal(clearCalls, 1);
});

test("Clerk mode never reads or returns a legacy Bluebird JWT", async () => {
  let storageReads = 0;
  const readStoredToken = async () => {
    storageReads += 1;
    return "legacy-demo-jwt";
  };
  assert.equal(await createLegacyAuthTokenGetter(true, readStoredToken)(), null);
  assert.equal(storageReads, 0);

  assert.equal(await createLegacyAuthTokenGetter(false, readStoredToken)(), "legacy-demo-jwt");
  assert.equal(storageReads, 1);
});

test("shared public API requests omit Authorization in Clerk mode", async () => {
  const previousFetch = globalThis.fetch;
  let requestHeaders;
  globalThis.fetch = async (_input, init) => {
    requestHeaders = new Headers(init?.headers);
    return new Response("[]", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  };

  try {
    setAuthTokenGetter(createLegacyAuthTokenGetter(true, async () => "legacy-demo-jwt"));
    await customFetch("/api/flights", { responseType: "text" });
    assert.equal(requestHeaders.has("authorization"), false);
  } finally {
    setAuthTokenGetter(null);
    globalThis.fetch = previousFetch;
  }
});

test("authenticated production calls remain unavailable until backend acceptance is confirmed", () => {
  assert.equal(PRODUCTION_AUTH_AVAILABILITY.status, "unavailable");
  assert.deepEqual(PRODUCTION_AUTH_AVAILABILITY.reasons, [
    "clerk_token_acceptance_unverified",
    "member_identity_mapping_unverified",
  ]);
  assert.deepEqual(CLERK_MEMBER_NAVIGATION_READINESS, {
    linkedMember: false,
    registration: false,
    onboarding: false,
  });
});
