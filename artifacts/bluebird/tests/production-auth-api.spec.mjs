import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAuthenticatedProductionApiClient,
  PRODUCTION_ME_PATH,
} from "../scripts/.production-auth-api.test.mjs";

const token = "test-production-token-never-log";
const accountFields = {
  isAdmin: false,
  isConcierge: true,
  isMember: true,
  memberTier: "concierge",
  isProfileComplete: true,
  needsPlanDecision: false,
  needsSignupPhone: false,
};

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test("the client is inert until getMe is explicitly invoked", async () => {
  let tokenReads = 0;
  let requests = 0;
  const client = createAuthenticatedProductionApiClient({
    getToken: async () => {
      tokenReads += 1;
      return token;
    },
    fetcher: async () => {
      requests += 1;
      return jsonResponse({ isAuthenticated: true, ...accountFields });
    },
  });

  assert.equal(tokenReads, 0);
  assert.equal(requests, 0);
  assert.equal(typeof client.getMe, "function");

  const result = await client.getMe();
  assert.equal(result.status, "authenticated");
  assert.equal(tokenReads, 1);
  assert.equal(requests, 1);
});

test("getMe sends only a Bearer token to the validated production /api/me URL", async () => {
  let request;
  const client = createAuthenticatedProductionApiClient({
    getToken: async () => token,
    fetcher: async (url, init) => {
      request = { url, init };
      return jsonResponse({ isAuthenticated: true, ...accountFields, email: "ignored@example.test" });
    },
  });

  const result = await client.getMe();
  assert.equal(PRODUCTION_ME_PATH, "/me");
  assert.equal(request.url, "https://bluebirdjets.com/api/me");
  assert.equal(request.init.method, "GET");
  assert.equal(request.init.headers.Authorization, `Bearer ${token}`);
  assert.equal(request.init.headers.Accept, "application/json");
  assert.equal(request.init.credentials, "omit");
  assert.equal(request.init.headers.Cookie, undefined);
  assert.deepEqual(result, { status: "authenticated", account: accountFields });
});

test("invalid production API URLs are rejected before token access or fetch", () => {
  for (const baseUrl of [
    "http://bluebirdjets.com/api",
    "https://untrusted.example/api",
    "https://bluebirdjets.com/other",
    "https://bluebirdjets.com/api?debug=1",
    "https://bluebirdjets.com/api#fragment",
    "https://user:password@bluebirdjets.com/api",
  ]) {
    assert.throws(
      () =>
        createAuthenticatedProductionApiClient({
          getToken: async () => token,
          baseUrl,
          fetcher: async () => jsonResponse({ isAuthenticated: true }),
        }),
      /production flight API/i,
    );
  }
});

test("a missing token is signed out and does not call /api/me", async () => {
  let requests = 0;
  const client = createAuthenticatedProductionApiClient({
    getToken: async () => null,
    fetcher: async () => {
      requests += 1;
      return jsonResponse({ isAuthenticated: true });
    },
  });

  assert.deepEqual(await client.getMe(), { status: "backend_signed_out" });
  assert.equal(requests, 0);
});

test("HTTP 200 with isAuthenticated false is signed out", async () => {
  const client = createAuthenticatedProductionApiClient({
    getToken: async () => token,
    fetcher: async () => jsonResponse({ isAuthenticated: false }),
  });

  assert.deepEqual(await client.getMe(), { status: "backend_signed_out" });
});

test("HTTP 401 identifies an expired session", async () => {
  const client = createAuthenticatedProductionApiClient({
    getToken: async () => token,
    fetcher: async () => jsonResponse({ error: "unauthorized" }, 401),
  });

  assert.deepEqual(await client.getMe(), { status: "session_expired" });
});

test("network errors are sanitized and never expose or log the token", async () => {
  const logged = [];
  const methods = ["debug", "info", "log", "warn", "error"];
  const original = Object.fromEntries(methods.map((method) => [method, console[method]]));
  for (const method of methods) {
    console[method] = (...args) => logged.push(args.join(" "));
  }

  let result;
  try {
    const client = createAuthenticatedProductionApiClient({
      getToken: async () => token,
      fetcher: async () => {
        throw new Error(`request failed for ${token}`);
      },
    });
    result = await client.getMe();
  } finally {
    for (const method of methods) console[method] = original[method];
  }

  assert.deepEqual(result, { status: "network_error", reason: "network" });
  assert.equal(JSON.stringify(result).includes(token), false);
  assert.deepEqual(logged, []);
});

test("a stalled request becomes a timeout state", async () => {
  const client = createAuthenticatedProductionApiClient({
    getToken: async () => token,
    timeoutMs: 5,
    fetcher: async () => new Promise(() => {}),
  });

  assert.deepEqual(await client.getMe(), {
    status: "network_error",
    reason: "timeout",
  });
});

test("invalid JSON and invalid authentication/account fields are rejected", async () => {
  const invalidJsonClient = createAuthenticatedProductionApiClient({
    getToken: async () => token,
    fetcher: async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("invalid JSON");
      },
    }),
  });
  assert.deepEqual(await invalidJsonClient.getMe(), {
    status: "network_error",
    reason: "invalid_response",
  });

  for (const body of [
    null,
    [],
    {},
    { isAuthenticated: "true" },
    { isAuthenticated: true, isAdmin: "yes" },
    { isAuthenticated: true, memberTier: 42 },
  ]) {
    const client = createAuthenticatedProductionApiClient({
      getToken: async () => token,
      fetcher: async () => jsonResponse(body),
    });
    assert.deepEqual(await client.getMe(), {
      status: "network_error",
      reason: "invalid_response",
    });
  }
});

test("token-provider failures do not trigger an authenticated request", async () => {
  let requests = 0;
  const client = createAuthenticatedProductionApiClient({
    getToken: async () => {
      throw new Error(`token-provider failure: ${token}`);
    },
    fetcher: async () => {
      requests += 1;
      return jsonResponse({ isAuthenticated: true });
    },
  });

  assert.deepEqual(await client.getMe(), {
    status: "network_error",
    reason: "token",
  });
  assert.equal(requests, 0);
});
