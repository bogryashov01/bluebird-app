import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getAvailableClerkMemberDestination,
  getClerkMemberDestination,
  mapAuthoritativeMemberDecision,
  resolveClerkMember,
} from "../scripts/.clerk-member-resolution.test.mjs";

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

test("fresh Clerk token resolves /api/me, but a positive projection stays unresolved", async () => {
  let tokenCalls = 0;
  let request;
  const result = await resolveClerkMember({
    session: makeSession({
      getToken: async () => {
        tokenCalls += 1;
        return "fresh-clerk-session-token";
      },
    }),
    fetcher: async (url, init) => {
      request = { url, init };
      return jsonResponse(projection);
    },
  });

  assert.deepEqual(result, { status: "unresolved", reason: "projection_only" });
  assert.equal(tokenCalls, 1);
  assert.equal(new URL(request.url).pathname, "/api/me");
  assert.equal(request.init.headers.Authorization, "Bearer fresh-clerk-session-token");
  assert.equal(request.init.credentials, "omit");
});

test("negative or anonymous /api/me projections never imply registration is required", async () => {
  for (const currentUser of [
    { ...projection, isAuthenticated: false, isMember: false, memberTier: null },
    { ...projection, isMember: false, memberTier: null },
    { ...projection, isAuthenticated: false },
    {
      ...projection,
      isProfileComplete: false,
      email: "same@example.test",
      phoneE164: "+15555550123",
    },
  ]) {
    const result = await resolveClerkMember({
      session: makeSession(),
      fetcher: async () => jsonResponse(currentUser),
    });
    assert.deepEqual(result, { status: "unresolved", reason: "projection_only" });
  }

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

test("explicit semantic decisions map to existing destinations without inventing wire fields", () => {
  const linked = mapAuthoritativeMemberDecision({ status: "linked", memberId: "member-123" });
  const registration = mapAuthoritativeMemberDecision({ status: "registration_required" });
  const onboarding = mapAuthoritativeMemberDecision({ status: "onboarding_required" });

  assert.deepEqual(linked, { status: "linked", memberId: "member-123" });
  assert.deepEqual(registration, { status: "registration_required" });
  assert.deepEqual(onboarding, { status: "onboarding_required" });
  assert.equal(getClerkMemberDestination(linked), "/(tabs)/discover");
  assert.equal(getClerkMemberDestination(registration), "/(auth)/complete-registration");
  assert.equal(getClerkMemberDestination(onboarding), "/(auth)/onboarding");
  const closedReadiness = {
    linkedMember: false,
    registration: false,
    onboarding: false,
  };
  for (const decision of [linked, registration, onboarding]) {
    assert.equal(getAvailableClerkMemberDestination(decision, closedReadiness), null);
  }
  const approvedReadiness = {
    linkedMember: true,
    registration: true,
    onboarding: true,
  };
  assert.equal(getAvailableClerkMemberDestination(linked, approvedReadiness), "/(tabs)/discover");
  assert.equal(
    getAvailableClerkMemberDestination(registration, approvedReadiness),
    "/(auth)/complete-registration",
  );
  assert.equal(
    getAvailableClerkMemberDestination(onboarding, approvedReadiness),
    "/(auth)/onboarding",
  );
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
    mapAuthoritativeMemberDecision({ status: "linked", memberId: "  " }),
    { status: "unresolved", reason: "missing_authoritative_decision" },
  );
});

test("unloaded and signed-out sessions make no API request", async () => {
  let requests = 0;
  const fetcher = async () => {
    requests += 1;
    return jsonResponse(projection);
  };

  assert.deepEqual(
    await resolveClerkMember({ session: makeSession({ isLoaded: false }), fetcher }),
    { status: "resolving", clerkUserId: undefined },
  );
  assert.deepEqual(
    await resolveClerkMember({ session: makeSession({ isSignedIn: false }), fetcher }),
    { status: "signed_out" },
  );
  assert.equal(requests, 0);
});

test("unauthorized, network, backend, malformed, and cancelled requests remain errors", async () => {
  const cases = [
    { fetcher: async () => jsonResponse({}, 401), reason: "unauthorized" },
    { fetcher: async () => { throw new Error("offline"); }, reason: "network" },
    { fetcher: async () => jsonResponse({}, 503), reason: "backend" },
    { fetcher: async () => jsonResponse({ isAuthenticated: "yes" }), reason: "invalid_response" },
  ];

  for (const { fetcher, reason } of cases) {
    assert.deepEqual(
      await resolveClerkMember({ session: makeSession(), fetcher }),
      { status: "error", reason },
    );
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
