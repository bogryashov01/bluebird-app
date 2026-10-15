import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getClerkApiConnectionFailureGuidance,
  isClerkApiConnectionTestVisible,
  runClerkApiConnectionTest,
} from "../scripts/.clerk-api-connection.test.mjs";
import { createAuthenticatedProductionApiClient } from "../scripts/.clerk-api-connection.test.mjs";
const DEVELOPMENT_API_ME = "https://main-api-development.example.test/api/me";
const DEVELOPMENT_CONFIGURATION = {
  environment: "development",
  apiBaseUrl: "https://main-api-development.example.test/api",
  clerkPublishableKey: "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k",
};
process.env.EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT = "development";
process.env.EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_BASE_URL = "https://main-api-development.example.test/api";
process.env.EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY = "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k";

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

function makeClient({ tokenProvider, fetcher, timeoutMs, baseUrl, diagnostic }) {
  return createAuthenticatedProductionApiClient({
    tokenProvider: { environment: "development", ...tokenProvider },
    environment: "development",
    baseUrl: baseUrl ?? "https://main-api-development.example.test/api",
    fetcher,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(diagnostic === undefined ? {} : { diagnostic }),
  });
}

function confirmedOptions(overrides = {}) {
  return {
    isDevelopment: true,
    environment: "development",
    configuration: DEVELOPMENT_CONFIGURATION,
    configurationValid: true,
    clerkInstanceMatchVerified: true,
    clerkAuthEnabled: true,
    isLoaded: true,
    isSignedIn: true,
    confirm: async () => true,
    createApiClient: (diagnostic) => makeClient({
      tokenProvider: { getVerifiedAccessToken: async () => "fresh-test-token" },
      fetcher: async () => makeResponse(currentUser),
      diagnostic,
    }),
    ...overrides,
  };
}

test("test button visibility requires valid Development config, issuer match, Clerk auth, and sign-in", () => {
  assert.equal(isClerkApiConnectionTestVisible({
    isDevelopment: true,
    environment: "development",
    configurationValid: true,
    clerkInstanceMatchVerified: true,
    clerkAuthEnabled: true,
    isLoaded: true,
    isSignedIn: true,
  }), true);
  for (const input of [
    { isDevelopment: false, environment: "development", configurationValid: true, clerkInstanceMatchVerified: true, clerkAuthEnabled: true, isLoaded: true, isSignedIn: true },
    { isDevelopment: true, environment: "production", configurationValid: true, clerkInstanceMatchVerified: true, clerkAuthEnabled: true, isLoaded: true, isSignedIn: true },
    { isDevelopment: true, environment: "development", configurationValid: false, clerkInstanceMatchVerified: true, clerkAuthEnabled: true, isLoaded: true, isSignedIn: true },
    { isDevelopment: true, environment: "development", configurationValid: true, clerkInstanceMatchVerified: false, clerkAuthEnabled: true, isLoaded: true, isSignedIn: true },
    { isDevelopment: true, environment: "development", configurationValid: true, clerkInstanceMatchVerified: true, clerkAuthEnabled: false, isLoaded: true, isSignedIn: true },
    { isDevelopment: true, environment: "development", configurationValid: true, clerkInstanceMatchVerified: true, clerkAuthEnabled: true, isLoaded: false, isSignedIn: true },
    { isDevelopment: true, environment: "development", configurationValid: true, clerkInstanceMatchVerified: true, clerkAuthEnabled: true, isLoaded: true, isSignedIn: false },
    { isDevelopment: true, environment: "development", configurationValid: true, clerkInstanceMatchVerified: true, clerkAuthEnabled: true, isLoaded: true, isSignedIn: undefined },
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
  assert.match(getClerkApiConnectionFailureGuidance("URL/configuration").join(" "), /no request was sent/);
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
      createApiClient: (diagnostic) => {
        clientCreations += 1;
        return makeClient({
          tokenProvider: { getVerifiedAccessToken: async () => { tokenReads += 1; return "mock-token"; } },
          fetcher: async () => { requests += 1; return makeResponse(currentUser); },
          diagnostic,
        });
      },
    }),
  };

  const declined = await runClerkApiConnectionTest(options);
  assert.equal(declined.environment, "development");
  assert.equal(declined.clerkSessionExists, true);
  assert.equal(declined.tokenObtained, null);
  assert.equal(declined.apiResponseReceived, false);
  assert.equal(declined.stages.find((stage) => stage.name === "confirmation").status, "declined");
  assert.equal(declined.stages.find((stage) => stage.name === "client").status, "not reached");
  assert.equal(confirmations, 1);
  assert.equal(clientCreations, 0);
  assert.equal(tokenReads, 0);
  assert.equal(requests, 0);

  for (const gate of [
    { isDevelopment: false, environment: "development", isLoaded: true, isSignedIn: true },
    { isDevelopment: true, environment: "production", isLoaded: true, isSignedIn: true },
    { configurationValid: false },
    { clerkInstanceMatchVerified: false },
    { clerkAuthEnabled: false },
    { isDevelopment: true, environment: "development", isLoaded: false, isSignedIn: true },
    { isDevelopment: true, environment: "development", isLoaded: true, isSignedIn: false },
  ]) {
    assert.equal(await runClerkApiConnectionTest({ ...options, ...gate }), null);
  }
  assert.equal(confirmations, 1);
  assert.equal(clientCreations, 0);
  assert.equal(tokenReads, 0);
  assert.equal(requests, 0);
});

test("confirmation happens before a single configured Development request and uses one fresh token", async () => {
  const order = [];
  const stageEvents = [];
  const requests = [];
  let tokenReads = 0;
  const result = await runClerkApiConnectionTest(confirmedOptions({
    confirm: async (title, message, label) => {
      order.push("confirm");
      assert.equal(title, "Test Bluebird API Connection");
      assert.match(message, /one authenticated GET request to the configured Bluebird Development API/);
      assert.equal(label, "Send request");
      assert.equal(tokenReads, 0);
      assert.equal(requests.length, 0);
      return true;
    },
    createApiClient: (diagnostic) => {
      order.push("client");
      return makeClient({
        tokenProvider: {
          getVerifiedAccessToken: async () => {
            tokenReads += 1;
            return `fresh-clerk-token-${tokenReads}`;
          },
        },
        diagnostic,
        fetcher: async (url, init) => {
          requests.push({ url, init });
          return makeResponse(currentUser);
        },
      });
    },
    onStages: (stages) => {
      const current = stages.filter((stage) => stage.status !== "not reached").at(-1);
      if (current) stageEvents.push(`${current.name}:${current.status}`);
    },
  }));

  assert.deepEqual(order, ["confirm", "client"]);
  assert.equal(tokenReads, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, DEVELOPMENT_API_ME);
  assert.equal(requests[0].init.method, "GET");
  assert.equal(requests[0].init.headers.Authorization, "Bearer fresh-clerk-token-1");
  assert.deepEqual(Object.keys(requests[0].init.headers).sort(), ["Accept", "Authorization"]);
  assert.equal(requests[0].init.credentials, "omit");
  assert.equal(requests[0].init.headers.Cookie, undefined);
  assert.deepEqual(stageEvents, [
    "button:clicked",
    "confirmation:waiting",
    "confirmation:accepted",
    "client:waiting",
    "client:initialized",
    "token:obtained",
    "fetch:initiated",
    "fetch:completed",
  ]);
  assert.deepEqual(result, {
    environment: "development",
    clerkSessionExists: true,
    tokenObtained: true,
    httpStatus: 200,
    apiResponseReceived: true,
    authenticationAccepted: true,
    failureCategory: null,
    stages: [
      { name: "button", status: "clicked" },
      { name: "confirmation", status: "accepted" },
      { name: "client", status: "initialized" },
      { name: "token", status: "obtained", tokenObtained: true },
      { name: "fetch", status: "completed" },
    ],
  });
  assert.doesNotMatch(JSON.stringify(result), /fresh-clerk-token|example|Private|Person|plus|admin|Authorization/i);
});

test("HTTP status, invalid JSON, and invalid schema remain distinct and sanitized", async () => {
  for (const [status, expectedAccepted] of [[401, false], [403, null], [503, null]]) {
    const result = await runClerkApiConnectionTest(confirmedOptions({
      createApiClient: (diagnostic) => makeClient({
        tokenProvider: { getVerifiedAccessToken: async () => "private-token" },
        fetcher: async () => makeResponse({ message: "private response content" }, status),
        diagnostic,
      }),
    }));
    assert.equal(result.httpStatus, status);
    assert.equal(result.apiResponseReceived, true);
    assert.equal(result.authenticationAccepted, expectedAccepted);
    assert.equal(result.failureCategory, "HTTP");
    assert.equal(result.stages.find((stage) => stage.name === "fetch").status, "completed");
    assert.doesNotMatch(JSON.stringify(result), /private response|private-token|Authorization|message/i);
  }

  const invalidSchema = await runClerkApiConnectionTest(confirmedOptions({
    createApiClient: (diagnostic) => makeClient({
      tokenProvider: { getVerifiedAccessToken: async () => "private-token" },
      fetcher: async () => makeResponse({ isAuthenticated: "yes", secret: "private" }),
      diagnostic,
    }),
  }));
  assert.equal(invalidSchema.httpStatus, 200);
  assert.equal(invalidSchema.apiResponseReceived, true);
  assert.equal(invalidSchema.failureCategory, "invalid schema");
  assert.doesNotMatch(JSON.stringify(invalidSchema), /private|secret|Authorization/i);

  const invalidJson = await runClerkApiConnectionTest(confirmedOptions({
    createApiClient: (diagnostic) => makeClient({
      tokenProvider: { getVerifiedAccessToken: async () => "private-token" },
      fetcher: async () => ({
        ok: true,
        status: 200,
        json: async () => { throw new Error("private response body"); },
      }),
      diagnostic,
    }),
  }));
  assert.equal(invalidJson.httpStatus, 200);
  assert.equal(invalidJson.apiResponseReceived, true);
  assert.equal(invalidJson.failureCategory, "invalid JSON");
  assert.doesNotMatch(JSON.stringify(invalidJson), /private|response body|Authorization/i);
});

test("guest-shaped HTTP 200 is a received API response, not a Bluebird member identity", async () => {
  const result = await runClerkApiConnectionTest(confirmedOptions({
    createApiClient: (diagnostic) => makeClient({
      tokenProvider: { getVerifiedAccessToken: async () => "private-token" },
      fetcher: async () => makeResponse({
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
      diagnostic,
    }),
  }));
  assert.equal(result.environment, "development");
  assert.equal(result.clerkSessionExists, true);
  assert.equal(result.tokenObtained, true);
  assert.equal(result.httpStatus, 200);
  assert.equal(result.apiResponseReceived, true);
  assert.equal(result.authenticationAccepted, false);
  assert.equal(result.memberIdentity, undefined);
  assert.doesNotMatch(JSON.stringify(result), /isMember|isProfileComplete|memberTier|private-token/i);
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
      createApiClient: (diagnostic) => makeClient({
        ...options,
        timeoutMs,
        diagnostic,
        fetcher: async (...args) => {
          requests += 1;
          return options.fetcher(...args);
        },
      }),
    }));
    assert.equal(requests, category === "token" ? 0 : 1);
    assert.equal(result.failureCategory, category);
    assert.equal(result.httpStatus, null);
    assert.equal(result.apiResponseReceived, false);
    assert.doesNotMatch(JSON.stringify(result), /private|email|mock-token|must not fetch/i);
  }
});

test("failed token acquisition is a boolean-only stage and prevents Fetch", async () => {
  let requests = 0;
  const result = await runClerkApiConnectionTest(confirmedOptions({
    createApiClient: (diagnostic) => makeClient({
      tokenProvider: { getVerifiedAccessToken: async () => { throw new Error("private-token@example.test"); } },
      fetcher: async () => { requests += 1; return makeResponse(currentUser); },
      diagnostic,
    }),
  }));
  assert.equal(requests, 0);
  assert.equal(result.failureCategory, "token");
  assert.equal(result.tokenObtained, false);
  assert.equal(result.apiResponseReceived, false);
  assert.deepEqual(result.stages.find((stage) => stage.name === "token"), {
    name: "token",
    status: "failed",
    tokenObtained: false,
  });
  assert.equal(result.stages.find((stage) => stage.name === "fetch").status, "not reached");
  assert.doesNotMatch(JSON.stringify(result), /private-token|example\.test|Authorization/i);
});

test("incorrect API URL fails closed with a sanitized configuration outcome", async () => {
  let requests = 0;
  const result = await runClerkApiConnectionTest(confirmedOptions({
    createApiClient: (diagnostic) => makeClient({
      baseUrl: "https://wrong.example.test/api",
      tokenProvider: { getVerifiedAccessToken: async () => "private-token" },
      fetcher: async () => { requests += 1; return makeResponse(currentUser); },
      diagnostic,
    }),
  }));
  assert.equal(requests, 0);
  assert.equal(result.failureCategory, "URL/configuration");
  assert.equal(result.tokenObtained, null);
  assert.equal(result.apiResponseReceived, false);
  assert.equal(result.stages.find((stage) => stage.name === "client").status, "failed");
  assert.equal(result.stages.find((stage) => stage.name === "token").status, "not reached");
  assert.equal(result.stages.find((stage) => stage.name === "fetch").status, "not reached");
  assert.doesNotMatch(JSON.stringify(result), /wrong\.example|private-token|Authorization/i);
});

test("the diagnostic rejects a Production API configuration before confirmation or token access", async () => {
  let confirmations = 0;
  let clients = 0;
  let tokenReads = 0;
  let requests = 0;
  const result = await runClerkApiConnectionTest(confirmedOptions({
    configuration: {
      ...DEVELOPMENT_CONFIGURATION,
      apiBaseUrl: "https://bluebirdjets.com/api",
    },
    confirm: async () => { confirmations += 1; return true; },
    createApiClient: () => {
      clients += 1;
      return makeClient({
        tokenProvider: { getVerifiedAccessToken: async () => { tokenReads += 1; return "private-token"; } },
        fetcher: async () => { requests += 1; return makeResponse(currentUser); },
      });
    },
  }));
  assert.equal(result.failureCategory, "URL/configuration");
  assert.equal(result.httpStatus, null);
  assert.equal(result.apiResponseReceived, false);
  assert.equal(confirmations, 0);
  assert.equal(clients, 0);
  assert.equal(tokenReads, 0);
  assert.equal(requests, 0);
  assert.doesNotMatch(JSON.stringify(result), /bluebirdjets\.com|private-token/i);
});

test("Fetch rejection is marked failed and remains an ambiguous browser transport failure", async () => {
  let requests = 0;
  const result = await runClerkApiConnectionTest(confirmedOptions({
    createApiClient: (diagnostic) => makeClient({
      tokenProvider: { getVerifiedAccessToken: async () => "private-token" },
      fetcher: async () => { requests += 1; throw new Error("private-token phone 555-0100"); },
      diagnostic,
    }),
  }));
  assert.equal(requests, 1);
  assert.equal(result.failureCategory, "browser transport (ambiguous)");
  assert.equal(result.stages.find((stage) => stage.name === "fetch").status, "failed");
  assert.doesNotMatch(JSON.stringify(result), /private-token|555-0100|Authorization/i);
});

test("confirmation and API client setup exceptions are sanitized before any request", async () => {
  let requests = 0;
  const confirmationFailure = await runClerkApiConnectionTest(confirmedOptions({
    confirm: async () => { throw new Error("private confirmation detail"); },
    createApiClient: () => { throw new Error("client should not initialize"); },
  }));
  assert.equal(confirmationFailure.failureCategory, "confirmation");
  assert.equal(confirmationFailure.stages.find((stage) => stage.name === "confirmation").status, "failed");

  const clientFailure = await runClerkApiConnectionTest(confirmedOptions({
    createApiClient: () => { throw new Error("private setup detail"); },
  }));
  assert.equal(clientFailure.failureCategory, "client setup");
  assert.equal(clientFailure.stages.find((stage) => stage.name === "client").status, "failed");
  assert.equal(requests, 0);
  assert.doesNotMatch(JSON.stringify([confirmationFailure, clientFailure]), /private confirmation|private setup|client should not/i);
});
