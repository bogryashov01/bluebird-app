import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  getBaseActiveMembershipFixture,
  isMembershipMockPreviewLocation,
  loadMembershipData,
  resolveMembershipDataMode,
} from "../scripts/.membership-data-mode.test.mjs";
import {
  createAuthenticatedProductionApiClient,
} from "../scripts/.production-auth-api.test.mjs";

process.env.EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT = "production";
process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL = "https://bluebirdjets.com/api";
process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY =
  "pk_live_Y2xlcmsuZXhhbXBsZS5jb20k";

const fixture = JSON.parse(readFileSync(
  new URL("../fixtures/production-membership-base-active.json", import.meta.url),
  "utf8",
));

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test("the local Base/Active fixture contains only fields from ProductionMembership", async () => {
  assert.deepEqual(Object.keys(fixture).sort(), [
    "cancelAtPeriodEnd",
    "isMember",
    "recentEvents",
    "status",
    "tier",
  ]);
  assert.deepEqual(fixture, {
    isMember: true,
    tier: "base",
    status: "active",
    cancelAtPeriodEnd: false,
    recentEvents: [],
  });

  const calls = [];
  const api = createAuthenticatedProductionApiClient({
    environment: "production",
    baseUrl: "https://bluebirdjets.com/api",
    tokenProvider: {
      environment: "production",
      getVerifiedAccessToken: async () => "test-only-verified-token",
    },
    fetcher: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(fixture);
    },
  });
  assert.deepEqual(await api.getMembership(), fixture);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://bluebirdjets.com/api/membership");
  assert.equal(calls[0].init.method, "GET");
});

test("mock mode reads the fixture without invoking a Production API reader", async () => {
  let productionReads = 0;
  const result = await loadMembershipData("mock", async () => {
    productionReads += 1;
    throw new Error("Mock mode must not call Production.");
  });
  assert.deepEqual(result, getBaseActiveMembershipFixture());
  assert.equal(productionReads, 0);
});

test("production mode delegates to the existing authenticated Membership API", async () => {
  const requests = [];
  let tokenReads = 0;
  const api = createAuthenticatedProductionApiClient({
    environment: "production",
    baseUrl: "https://bluebirdjets.com/api",
    tokenProvider: {
      environment: "production",
      getVerifiedAccessToken: async () => {
        tokenReads += 1;
        return "test-only-verified-token";
      },
    },
    fetcher: async (url, init) => {
      requests.push({ url, init });
      return jsonResponse(fixture);
    },
  });

  const result = await loadMembershipData("production", () => api.getMembership());
  assert.deepEqual(result, fixture);
  assert.equal(tokenReads, 1);
  assert.deepEqual(requests.map(({ url, init }) => `${init.method} ${url}`), [
    "GET https://bluebirdjets.com/api/membership",
  ]);
  assert.equal(requests[0].init.headers.Authorization, "Bearer test-only-verified-token");
});

test("mock mode is enabled only in development and the production default stays unchanged", () => {
  assert.deepEqual(resolveMembershipDataMode(undefined, true), {
    mode: "production",
    mockPreviewAllowed: false,
    error: null,
  });
  assert.deepEqual(resolveMembershipDataMode("production", true), {
    mode: "production",
    mockPreviewAllowed: false,
    error: null,
  });
  assert.deepEqual(resolveMembershipDataMode("mock", true), {
    mode: "mock",
    mockPreviewAllowed: true,
    error: null,
  });
  assert.deepEqual(resolveMembershipDataMode("mock", false), {
    mode: "production",
    mockPreviewAllowed: false,
    error: "Membership mock preview is available only in development.",
  });
  assert.equal(resolveMembershipDataMode("staging", true).mockPreviewAllowed, false);
});

test("only the dedicated Membership mock-preview route is isolated", () => {
  assert.equal(isMembershipMockPreviewLocation("/bluebird/membership/mock-preview", []), true);
  assert.equal(isMembershipMockPreviewLocation("/membership/mock-preview/plans", []), true);
  assert.equal(isMembershipMockPreviewLocation("/membership/index", ["(tabs)", "membership"]), false);
  assert.equal(isMembershipMockPreviewLocation("/somewhere/membership/other", []), false);
  assert.equal(
    isMembershipMockPreviewLocation("", ["membership", "mock-preview", "plans"]),
    true,
  );
});
