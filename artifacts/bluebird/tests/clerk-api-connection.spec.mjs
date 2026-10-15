import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getClerkApiConnectionFailureGuidance,
  isClerkApiConnectionTestVisible,
  runClerkApiConnectionTest,
} from "../scripts/.clerk-api-connection.test.mjs";
import { createAuthenticatedProductionApiClient } from "../scripts/.clerk-api-connection.test.mjs";

const currentUser = {
  isAuthenticated: true,
  isAdmin: true,
  isConcierge: false,
  isMember: true,
  memberTier: "plus",
  email: "private.person@example.test",
  firstName: "Private",
  lastName: "Person",
  isProfileComplete: true,
  needsPlanDecision: false,
  needsSignupPhone: false,
  impersonation: null,
};

function makeResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function makeClient({ tokenProvider, fetcher, timeoutMs }) {
  return createAuthenticatedProductionApiClient({
    tokenProvider,
    fetcher,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

function confirmedOptions(overrides = {}) {
  return {
    isDevelopment: true,
    isLoaded: true,
    isSignedIn: true,
    confirm: async () => true,
    createApiClient: () => makeClient({
      tokenProvider: { getVerifiedAccessToken: async () => "fresh-test-token" },
      fetcher: async () => makeResponse(currentUser),
    }),
    ...overrides,
  };
}

test("test button visibility requires Development plus a loaded signed-in session", () => {
  assert.equal(isClerkApiConnectionTestVisible({
    isDevelopment: true,
    isLoaded: true,
    isSignedIn: true,
  }), true);
  for (const input of [
    { isDevelopment: false, isLoaded: true, isSignedIn: true },
    { isDevelopment: true, isLoaded: false, isSignedIn: true },
    { isDevelopment: true, isLoaded: true, isSignedIn: false },
    { isDevelopment: true, isLoaded: true, isSignedIn: undefined },
  ]) {
    assert.equal(isClerkApiConnectionTestVisible(input), false);
  }
});

test("ambiguous browser transport guidance lists possibilities without claiming a cause", () => {
  const guidance = getClerkApiConnectionFailureGuidance("browser transport (ambiguous)");
  assert.match(guidance.join(" "), /did not expose why Fetch failed/);
  assert.match(guidance.join(" "), /may be CORS\/preflight, DNS, TLS, or another network failure/);
  assert.match(guidance.join(" "), /DevTools Network and Console/);
  assert.match(guidance.join(" "), /Do not share Authorization headers or response contents/);
  assert.equal(getClerkApiConnectionFailureGuidance("HTTP"), null);
  assert.doesNotMatch(JSON.stringify(guidance), /private-token|response body|raw exception/i);
});

test("gated or cancelled test creates no client, reads no token, and sends no request", async () => {
  let confirmations = 0;
  let clientCreations = 0;
  let tokenReads = 0;
  let requests = 0;
  const options = {
    ...confirmedOptions({
      confirm: async () => {
        confirmations += 1;
        return false;
      },
      createApiClient: () => {
        clientCreations += 1;
        return makeClient({
          tokenProvider: { getVerifiedAccessToken: async () => { tokenReads += 1; return "mock-token"; } },
          fetcher: async () => { requests += 1; return makeResponse(currentUser); },
        });
      },
    }),
  };

  assert.equal(await runClerkApiConnectionTest(options), null);
  assert.equal(confirmations, 1);
  assert.equal(clientCreations, 0);
  assert.equal(tokenReads, 0);
  assert.equal(requests, 0);

  for (const gate of [
    { isDevelopment: false, isLoaded: true, isSignedIn: true },
    { isDevelopment: true, isLoaded: false, isSignedIn: true },
    { isDevelopment: true, isLoaded: true, isSignedIn: false },
  ]) {
    assert.equal(await runClerkApiConnectionTest({ ...options, ...gate }), null);
  }
  assert.equal(confirmations, 1);
  assert.equal(clientCreations, 0);
  assert.equal(tokenReads, 0);
  assert.equal(requests, 0);
});

test("confirmation happens before a single production request and uses one fresh token", async () => {
  const order = [];
  const requests = [];
  let tokenReads = 0;
  const result = await runClerkApiConnectionTest(confirmedOptions({
    confirm: async (title, message, label) => {
      order.push("confirm");
      assert.equal(title, "Test Bluebird API Connection");
      assert.match(message, /one authenticated GET request to the production Bluebird API/);
      assert.match(message, /cross-origin.*Authorization.*OPTIONS CORS preflight/);
      assert.equal(label, "Send request");
      assert.equal(tokenReads, 0);
      assert.equal(requests.length, 0);
      return true;
    },
    createApiClient: () => {
      order.push("client");
      return makeClient({
        tokenProvider: {
          getVerifiedAccessToken: async () => {
            tokenReads += 1;
            return `fresh-clerk-token-${tokenReads}`;
          },
        },
        fetcher: async (url, init) => {
          requests.push({ url, init });
          return makeResponse(currentUser);
        },
      });
    },
  }));

  assert.deepEqual(order, ["confirm", "client"]);
  assert.equal(tokenReads, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://bluebirdjets.com/api/me");
  assert.equal(requests[0].init.method, "GET");
  assert.equal(requests[0].init.headers.Authorization, "Bearer fresh-clerk-token-1");
  assert.deepEqual(result, {
    httpStatus: 200,
    authenticationAccepted: true,
    isAuthenticated: true,
    isMember: true,
    isProfileComplete: true,
    schemaStatus: "valid",
    failureCategory: null,
  });
  assert.doesNotMatch(JSON.stringify(result), /token|example|Private|Person|plus|admin/i);
});

test("HTTP status, invalid JSON, and invalid schema remain distinct and sanitized", async () => {
  for (const [status, expectedAccepted] of [[401, false], [403, null], [503, null]]) {
    const result = await runClerkApiConnectionTest(confirmedOptions({
      createApiClient: () => makeClient({
        tokenProvider: { getVerifiedAccessToken: async () => "private-token" },
        fetcher: async () => makeResponse({ message: "private response content" }, status),
      }),
    }));
    assert.deepEqual(result, {
      httpStatus: status,
      authenticationAccepted: expectedAccepted,
      isAuthenticated: null,
      isMember: null,
      isProfileComplete: null,
      schemaStatus: "not checked",
      failureCategory: "HTTP",
    });
    assert.doesNotMatch(JSON.stringify(result), /private|token|message/i);
  }

  const invalidSchema = await runClerkApiConnectionTest(confirmedOptions({
    createApiClient: () => makeClient({
      tokenProvider: { getVerifiedAccessToken: async () => "private-token" },
      fetcher: async () => makeResponse({ isAuthenticated: "yes", secret: "private" }),
    }),
  }));
  assert.deepEqual(invalidSchema, {
    httpStatus: 200,
    authenticationAccepted: null,
    isAuthenticated: null,
    isMember: null,
    isProfileComplete: null,
    schemaStatus: "invalid",
    failureCategory: "invalid schema",
  });
  assert.doesNotMatch(JSON.stringify(invalidSchema), /private|secret|token/i);

  const invalidJson = await runClerkApiConnectionTest(confirmedOptions({
    createApiClient: () => makeClient({
      tokenProvider: { getVerifiedAccessToken: async () => "private-token" },
      fetcher: async () => ({
        ok: true,
        status: 200,
        json: async () => { throw new Error("private response body"); },
      }),
    }),
  }));
  assert.deepEqual(invalidJson, {
    httpStatus: 200,
    authenticationAccepted: null,
    isAuthenticated: null,
    isMember: null,
    isProfileComplete: null,
    schemaStatus: "not checked",
    failureCategory: "invalid JSON",
  });
  assert.doesNotMatch(JSON.stringify(invalidJson), /private|token|response body/i);
});

test("ambiguous browser transport, timeout, and token failures are sanitized and never retried", async () => {
  const cases = [
    {
      category: "browser transport (ambiguous)",
      tokenProvider: { getVerifiedAccessToken: async () => "mock-token" },
      fetcher: async () => { throw new Error("private token and email in network error"); },
    },
    {
      category: "token",
      tokenProvider: { getVerifiedAccessToken: async () => { throw new Error("private token"); } },
      fetcher: async () => { throw new Error("must not fetch without token"); },
    },
    {
      category: "timeout",
      tokenProvider: { getVerifiedAccessToken: async () => "mock-token" },
      fetcher: async () => new Promise(() => {}),
      timeoutMs: 1,
    },
  ];

  for (const { category, timeoutMs, ...options } of cases) {
    let requests = 0;
    const result = await runClerkApiConnectionTest(confirmedOptions({
      createApiClient: () => makeClient({
        ...options,
        timeoutMs,
        fetcher: async (...args) => {
          requests += 1;
          return options.fetcher(...args);
        },
      }),
    }));
    assert.equal(requests, category === "token" ? 0 : 1);
    assert.equal(result.failureCategory, category);
    assert.equal(result.httpStatus, null);
    assert.equal(result.schemaStatus, "not checked");
    assert.doesNotMatch(JSON.stringify(result), /private|email|mock-token|must not fetch/i);
  }
});
