import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLERK_NEW_USER_JOURNEY_STEPS,
  getAvailableClerkMemberDestination,
  getClerkAuthRootDestination,
  getClerkMemberDestination,
  getClerkPostLoginJourney,
  getClerkPostLoginStatusMessage,
  getClerkResolutionForIdentity,
  isClerkMemberResolutionCurrent,
  mapAuthoritativeMemberDecision,
  resolveClerkMember as resolveClerkMemberInternal,
  shouldAutomaticallyResolveClerkMember,
} from "../scripts/.clerk-member-resolution.test.mjs";

const developmentConfiguration = {
  environment: "development",
  apiBaseUrl: "https://main-api-development.example.test/api",
  clerkPublishableKey: "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k",
};
process.env.EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT = "development";
process.env.EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_BASE_URL = developmentConfiguration.apiBaseUrl;
process.env.EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY = developmentConfiguration.clerkPublishableKey;
process.env.EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_CLERK_ISSUER = "https://clerk.example.com";
const resolveClerkMember = (options) => resolveClerkMemberInternal({
  configuration: developmentConfiguration,
  clerkUserId: "clerk-user-a",
  ...options,
});

const projection = {
  isAuthenticated: true,
  isAdmin: false,
  isConcierge: false,
  isMember: true,
  memberTier: "plus",
  email: "member@example.test",
  firstName: "Test",
  lastName: "Member",
  isProfileComplete: true,
  needsPlanDecision: false,
  needsSignupPhone: false,
  impersonation: null,
};

function makeSession(overrides = {}) {
  return {
    isLoaded: true,
    isSignedIn: true,
    getToken: async () => "mock-clerk-token",
    signOut: async () => {},
    ...overrides,
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test("one fresh authenticated GET /api/me resolves a complete profile without writes", async () => {
  let tokenCalls = 0;
  let fetchCalls = 0;
  let request;
  const result = await resolveClerkMember({
    session: makeSession({
      getToken: async () => {
        tokenCalls += 1;
        return "fresh-clerk-session-token";
      },
    }),
    fetcher: async (url, init) => {
      fetchCalls += 1;
      request = { url, init };
      return jsonResponse(projection);
    },
  });

  assert.deepEqual(result, {
    status: "profile_complete",
    clerkUserId: "clerk-user-a",
    currentUser: projection,
  });
  assert.equal(tokenCalls, 1);
  assert.equal(fetchCalls, 1);
  assert.equal(request.init.method, "GET");
  assert.equal(new URL(request.url).pathname, "/api/me");
  assert.equal(request.init.headers.Authorization, "Bearer fresh-clerk-session-token");
  assert.equal(request.init.credentials, "omit");
});

test("only authenticated profile booleans route, regardless of membership or plan decision", async () => {
  const completeNonmemberProjection = {
    ...projection,
    isMember: false,
    memberTier: null,
    needsPlanDecision: true,
  };
  const completeNonmember = await resolveClerkMember({
    session: makeSession(),
    fetcher: async () => jsonResponse(completeNonmemberProjection),
  });
  assert.deepEqual(completeNonmember, {
    status: "profile_complete",
    clerkUserId: "clerk-user-a",
    currentUser: completeNonmemberProjection,
  });
  assert.deepEqual(getClerkPostLoginJourney(completeNonmember, {
    registeredHome: false,
    linkedMember: false,
  }), { kind: "home", destination: "/(tabs)/discover" });

  const incompleteProjection = {
    ...projection,
    isProfileComplete: false,
    isMember: false,
  };
  const incomplete = await resolveClerkMember({
    session: makeSession(),
    fetcher: async () => jsonResponse(incompleteProjection),
  });
  assert.deepEqual(incomplete, {
    status: "profile_incomplete",
    clerkUserId: "clerk-user-a",
    currentUser: incompleteProjection,
  });
  assert.deepEqual(getClerkPostLoginJourney(incomplete, {
    registeredHome: true,
    linkedMember: true,
  }), {
    kind: "profile",
    destination: "/account/bluebird-profile",
  });
  assert.equal(getClerkAuthRootDestination({
    clerkSignedIn: true,
    resolution: incomplete,
    readiness: { registeredHome: true, linkedMember: true },
  }), "/account/bluebird-profile");
  assert.equal(getClerkAuthRootDestination({
    clerkSignedIn: true,
    resolution: completeNonmember,
    readiness: { registeredHome: false, linkedMember: false },
  }), "/(tabs)/discover");

  const unauthenticated = await resolveClerkMember({
    session: makeSession(),
    fetcher: async () => jsonResponse({
      ...projection,
      isAuthenticated: false,
      isProfileComplete: false,
      isMember: false,
      memberTier: null,
    }),
  });
  assert.deepEqual(unauthenticated, {
    status: "unresolved",
    reason: "unauthenticated",
  });
  assert.equal(getClerkAuthRootDestination({
    clerkSignedIn: true,
    resolution: unauthenticated,
    readiness: { registeredHome: true, linkedMember: true },
  }), "/(clerk-auth)/signed-in");

  assert.deepEqual(
    await resolveClerkMember({
      session: makeSession(),
      fetcher: async () => jsonResponse({ isAuthenticated: true }),
    }),
    { status: "error", reason: "invalid_response" },
  );

  assert.deepEqual(mapAuthoritativeMemberDecision(null), {
    status: "unresolved",
    reason: "missing_authoritative_decision",
  });
});

test("confirmed registered nonmembers reach Home independently of member-feature identity", () => {
  const registered = mapAuthoritativeMemberDecision({ status: "registered" });
  const registeredWithId = mapAuthoritativeMemberDecision({
    status: "registered",
    memberId: "member-123",
  });
  const closedReadiness = {
    registeredHome: false,
    linkedMember: false,
  };

  assert.deepEqual(registered, { status: "registered" });
  assert.deepEqual(registeredWithId, { status: "registered", memberId: "member-123" });
  assert.equal(getClerkMemberDestination(registered), "/(tabs)/discover");
  assert.equal(getAvailableClerkMemberDestination(registered, closedReadiness), null);
  assert.deepEqual(getClerkPostLoginJourney(registered, closedReadiness), {
    kind: "unverified",
    reason: "registered_home_not_ready",
  });

  const homeReady = { ...closedReadiness, registeredHome: true };
  assert.equal(getAvailableClerkMemberDestination(registered, homeReady), "/(tabs)/discover");
  assert.deepEqual(getClerkPostLoginJourney(registered, homeReady), {
    kind: "home",
    destination: "/(tabs)/discover",
  });
  assert.match(getClerkPostLoginStatusMessage(registered, closedReadiness), /Home is not enabled/);
  assert.equal(getClerkAuthRootDestination({
    clerkSignedIn: true,
    resolution: registered,
    readiness: homeReady,
  }), "/(tabs)/discover");
});

test("new users keep the required setup order and remain blocked until contracts exist", () => {
  const registration = mapAuthoritativeMemberDecision({ status: "registration_required" });
  const onboarding = mapAuthoritativeMemberDecision({ status: "onboarding_required" });
  assert.deepEqual(CLERK_NEW_USER_JOURNEY_STEPS, [
    "complete_profile",
    "airport_selection",
    "onboarding",
    "home",
  ]);
  assert.deepEqual(getClerkPostLoginJourney(registration, {
    registeredHome: true,
    linkedMember: true,
  }), {
    kind: "new_user_blocked",
    steps: CLERK_NEW_USER_JOURNEY_STEPS,
  });
  assert.match(
    getClerkPostLoginStatusMessage(registration, {
      registeredHome: true,
      linkedMember: true,
    }),
    /confirmed a new account/,
  );
  assert.deepEqual(getClerkPostLoginJourney(onboarding, {
    registeredHome: true,
    linkedMember: true,
  }), {
    kind: "unverified",
    reason: "onboarding_contract_not_ready",
  });
});

test("linked-member access remains separately gated and missing identity is unverified", () => {
  const linked = mapAuthoritativeMemberDecision({
    status: "registered",
    memberId: "member-123",
  });
  const registration = mapAuthoritativeMemberDecision({ status: "registration_required" });

  assert.deepEqual(registration, { status: "registration_required" });
  assert.equal(getClerkMemberDestination(linked), "/(tabs)/discover");
  const closedReadiness = {
    registeredHome: false,
    linkedMember: false,
  };
  for (const decision of [linked, registration]) {
    assert.equal(getAvailableClerkMemberDestination(decision, closedReadiness), null);
  }
  const approvedReadiness = {
    registeredHome: true,
    linkedMember: true,
  };
  assert.equal(getAvailableClerkMemberDestination(linked, approvedReadiness), "/(tabs)/discover");
  assert.equal(getAvailableClerkMemberDestination(registration, approvedReadiness), null);
  assert.equal(
    getClerkMemberDestination({ status: "unresolved", reason: "projection_only" }),
    null,
  );
  for (const pending of [
    { status: "unresolved", reason: "projection_only" },
    { status: "unresolved", reason: "missing_authoritative_decision" },
    { status: "error", reason: "backend" },
    { status: "error", reason: "unauthorized" },
    { status: "resolving" },
    { status: "signed_out" },
  ]) {
    assert.equal(getAvailableClerkMemberDestination(pending, approvedReadiness), null);
  }
  assert.deepEqual(
    mapAuthoritativeMemberDecision({ status: "registered", memberId: "  " }),
    { status: "unresolved", reason: "missing_authoritative_decision" },
  );
});

test("restored Clerk sessions stay on the signed-in route while member verification is pending", () => {
  const closedReadiness = { registeredHome: false, linkedMember: false };
  assert.equal(getClerkAuthRootDestination({
    clerkSignedIn: true,
    resolution: { status: "not_checked" },
    readiness: closedReadiness,
  }), "/(clerk-auth)/signed-in");
  assert.equal(getClerkAuthRootDestination({
    clerkSignedIn: true,
    resolution: { status: "linked", memberId: "member-1" },
    readiness: closedReadiness,
  }), "/(clerk-auth)/signed-in");
  assert.equal(getClerkAuthRootDestination({
    clerkSignedIn: true,
    resolution: { status: "linked", memberId: "member-1" },
    readiness: { ...closedReadiness, linkedMember: true },
  }), "/(tabs)/discover");
  assert.equal(getClerkAuthRootDestination({
    clerkSignedIn: false,
    resolution: { status: "signed_out" },
    readiness: closedReadiness,
  }), "/(auth)/splash");
});

test("unloaded and signed-out sessions make no API request", async () => {
  let requests = 0;
  const fetcher = async () => {
    requests += 1;
    return jsonResponse(projection);
  };

  assert.deepEqual(
    await resolveClerkMember({ session: makeSession({ isLoaded: false }), fetcher }),
    { status: "resolving", clerkUserId: "clerk-user-a" },
  );
  assert.deepEqual(
    await resolveClerkMember({ session: makeSession({ isSignedIn: false }), fetcher }),
    { status: "signed_out" },
  );
  assert.equal(requests, 0);
});

test("member resolution runs only for a loaded signed-in Clerk session", () => {
  assert.equal(shouldAutomaticallyResolveClerkMember({
    isClerkMode: true,
    isLoaded: true,
    isSignedIn: true,
  }), true);
  assert.equal(shouldAutomaticallyResolveClerkMember({
    isClerkMode: true,
    isLoaded: true,
    isSignedIn: false,
  }), false);
  assert.equal(shouldAutomaticallyResolveClerkMember({
    isDevelopment: true,
    isClerkMode: true,
    isLoaded: false,
    isSignedIn: true,
  }), false);
  assert.equal(shouldAutomaticallyResolveClerkMember({
    isClerkMode: true,
    isLoaded: true,
    isSignedIn: true,
  }), true);
  assert.equal(shouldAutomaticallyResolveClerkMember({
    isClerkMode: false,
    isLoaded: true,
    isSignedIn: true,
  }), false);
});

test("resolution from an earlier identity cannot navigate after an account change or sign-out", () => {
  const result = { status: "profile_complete", clerkUserId: "clerk-user-a" };
  assert.deepEqual(getClerkResolutionForIdentity(result, "clerk-user-b"), {
    status: "resolving",
    clerkUserId: "clerk-user-b",
  });
  assert.deepEqual(getClerkResolutionForIdentity(result, null), { status: "signed_out" });
  assert.deepEqual(getClerkResolutionForIdentity({
    status: "profile_incomplete",
    clerkUserId: "clerk-user-a",
  }, "clerk-user-b"), {
    status: "resolving",
    clerkUserId: "clerk-user-b",
  });
  assert.equal(isClerkMemberResolutionCurrent({
    requestedClerkUserId: "clerk-user-a",
    currentClerkUserId: "clerk-user-b",
    aborted: false,
  }), false);
  assert.equal(isClerkMemberResolutionCurrent({
    requestedClerkUserId: "clerk-user-a",
    currentClerkUserId: "clerk-user-a",
    aborted: true,
  }), false);
  assert.equal(isClerkMemberResolutionCurrent({
    requestedClerkUserId: "clerk-user-a",
    currentClerkUserId: "clerk-user-a",
    aborted: false,
  }), true);
});

test("unauthorized, network, backend, malformed, and cancelled requests remain errors", async () => {
  const cases = [
    { fetcher: async () => jsonResponse({}, 401), reason: "unauthorized" },
    { fetcher: async () => { throw new Error("offline"); }, reason: "network" },
    { fetcher: async () => jsonResponse({}, 503), reason: "backend" },
    { fetcher: async () => jsonResponse({ isAuthenticated: "yes" }), reason: "invalid_response" },
  ];

  for (const { fetcher, reason } of cases) {
    const result = await resolveClerkMember({ session: makeSession(), fetcher });
    assert.deepEqual(result, { status: "error", reason });
    assert.match(getClerkPostLoginStatusMessage(result, {
      registeredHome: true,
      linkedMember: true,
    }), /could not verify/);
  }

  const cancelled = new AbortController();
  cancelled.abort();
  assert.deepEqual(
    await resolveClerkMember({
      session: makeSession(),
      signal: cancelled.signal,
      fetcher: async () => jsonResponse(projection),
    }),
    { status: "error", reason: "cancelled" },
  );
});

test("Clerk token provider failures never fall back to legacy tokens", async () => {
  const result = await resolveClerkMember({
    session: makeSession({
      getToken: async () => { throw new Error("Clerk token unavailable"); },
    }),
    fetcher: async () => {
      throw new Error("fetch must not run without a token");
    },
  });
  assert.deepEqual(result, { status: "error", reason: "token" });
});
