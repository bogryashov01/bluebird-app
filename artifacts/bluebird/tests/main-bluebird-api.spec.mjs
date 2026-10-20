import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createMainBluebirdApiIntegration,
  getMainBluebirdApiConnectionState,
  getMainBluebirdIntegrationState,
  mainBluebirdAuthenticatedQueryKey,
} from "../scripts/.main-bluebird-api.test.mjs";
import {
  getMainBluebirdApiConfiguration,
  getMainBluebirdDevelopmentDiagnosticStatus,
  resolveMainBluebirdApiConfiguration,
  MainBluebirdApiConfigurationError,
} from "../scripts/.main-bluebird-api.test.mjs";

process.env.EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT = "development";
process.env.EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_BASE_URL = "https://8acaa348-10ff-41b3-9d85-c6b4986aa35a-00-2o2pl95c9l6gv.worf.replit.dev/api";
process.env.EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY = "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k";
process.env.EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_CLERK_ISSUER = "https://clerk.example.com";
process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL = "https://bluebirdjets.com/api";
process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY = "pk_live_Y2xlcmsuZXhhbXBsZS5jb20k";

const development = resolveMainBluebirdApiConfiguration({
  environment: "development",
  developmentApiBaseUrl: "https://8acaa348-10ff-41b3-9d85-c6b4986aa35a-00-2o2pl95c9l6gv.worf.replit.dev/api/",
  developmentClerkPublishableKey: "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k",
});
const production = resolveMainBluebirdApiConfiguration({
  environment: "production",
  productionApiBaseUrl: "https://bluebirdjets.com/api",
  productionClerkPublishableKey: "pk_live_Y2xlcmsuZXhhbXBsZS5jb20k",
});

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function tokenProvider(environment, readToken = async () => "fresh-clerk-token") {
  return { environment, getVerifiedAccessToken: readToken };
}

test("the explicit selector resolves matching Development and Production API/Clerk pairs", () => {
  assert.deepEqual(development, {
    environment: "development",
    apiBaseUrl: "https://8acaa348-10ff-41b3-9d85-c6b4986aa35a-00-2o2pl95c9l6gv.worf.replit.dev/api",
    clerkPublishableKey: "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k",
  });
  assert.equal(production.apiBaseUrl, "https://bluebirdjets.com/api");
  assert.equal(getMainBluebirdApiConfiguration().environment, "development");
  assert.equal(
    getMainBluebirdApiConfiguration().apiBaseUrl,
    "https://8acaa348-10ff-41b3-9d85-c6b4986aa35a-00-2o2pl95c9l6gv.worf.replit.dev/api",
  );

  for (const invalid of [
    { environment: undefined },
    { environment: "staging" },
    {
      environment: "development",
      developmentApiBaseUrl: "https://8acaa348-10ff-41b3-9d85-c6b4986aa35a-00-2o2pl95c9l6gv.worf.replit.dev/api",
    },
    {
      environment: "development",
      developmentApiBaseUrl: "https://bluebirdjets.com/api",
      developmentClerkPublishableKey: "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k",
    },
    {
      environment: "development",
      developmentApiBaseUrl: "http://8acaa348-10ff-41b3-9d85-c6b4986aa35a-00-2o2pl95c9l6gv.worf.replit.dev/api",
      developmentClerkPublishableKey: "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k",
    },
    {
      environment: "development",
      developmentApiBaseUrl: "https://8acaa348-10ff-41b3-9d85-c6b4986aa35a-00-2o2pl95c9l6gv.worf.replit.dev/api",
      developmentClerkPublishableKey: "pk_live_Y2xlcmsuZXhhbXBsZS5jb20k",
    },
    {
      environment: "production",
      productionApiBaseUrl: "https://other.example.test/api",
      productionClerkPublishableKey: "pk_live_Y2xlcmsuZXhhbXBsZS5jb20k",
    },
    {
      environment: "production",
      productionApiBaseUrl: "https://bluebird-preview.replit.dev/api",
      productionClerkPublishableKey: "pk_live_Y2xlcmsuZXhhbXBsZS5jb20k",
    },
    {
      environment: "production",
      productionApiBaseUrl: "https://bluebirdjets.com/api",
      productionClerkPublishableKey: "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k",
    },
  ]) {
    assert.throws(
      () => resolveMainBluebirdApiConfiguration(invalid),
      MainBluebirdApiConfigurationError,
    );
  }
});

test("configuration never infers a selected pair or falls back to legacy values", () => {
  const variableNames = [
    "EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT",
    "EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_BASE_URL",
    "EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL",
    "EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY",
    "EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_CLERK_ISSUER",
    "EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY",
    "EXPO_PUBLIC_DOMAIN",
    "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY",
  ];
  const previous = Object.fromEntries(variableNames.map((name) => [name, process.env[name]]));
  try {
    for (const name of variableNames) delete process.env[name];
    process.env.EXPO_PUBLIC_DOMAIN = "legacy-api.example.test";
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k";
    assert.throws(() => getMainBluebirdApiConfiguration(), MainBluebirdApiConfigurationError);
    process.env.EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT = "development";
    assert.throws(() => getMainBluebirdApiConfiguration(), MainBluebirdApiConfigurationError);
    process.env.EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT = "production";
    assert.throws(() => getMainBluebirdApiConfiguration(), MainBluebirdApiConfigurationError);
  } finally {
    for (const name of variableNames) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test("the configured Production pair stays inactive while Development is selected", () => {
  let tokenReads = 0;
  let requests = 0;
  assert.equal(getMainBluebirdApiConfiguration().environment, "development");
  assert.equal(production.apiBaseUrl, "https://bluebirdjets.com/api");
  assert.throws(() => createMainBluebirdApiIntegration({
    configuration: production,
    tokenProvider: tokenProvider("production", async () => {
      tokenReads += 1;
      return "production-token-must-not-be-read";
    }),
    fetcher: async () => {
      requests += 1;
      return jsonResponse({});
    },
  }), MainBluebirdApiConfigurationError);
  assert.equal(tokenReads, 0);
  assert.equal(requests, 0);
  assert.equal(getMainBluebirdApiConfiguration().environment, "development");
});

test("Development diagnostics report only safe status and require a matching API issuer", () => {
  const valid = {
    EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT: "development",
    EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_BASE_URL: "https://main-api-development.example.test/api",
    EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY: "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k",
    EXPO_PUBLIC_ENABLE_CLERK_AUTH: "true",
    EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_CLERK_ISSUER: "https://clerk.example.com",
  };
  const ready = getMainBluebirdDevelopmentDiagnosticStatus(valid);
  assert.equal(ready.developmentConfigurationValid, true);
  assert.equal(ready.clerkAuthEnabled, true);
  assert.equal(ready.clerkInstanceMatchVerified, true);
  assert.equal(ready.canTest, true);

  const missing = getMainBluebirdDevelopmentDiagnosticStatus({
    ...valid,
    EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_BASE_URL: "",
    EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY: "",
    EXPO_PUBLIC_ENABLE_CLERK_AUTH: "false",
    EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_CLERK_ISSUER: "",
  });
  assert.equal(missing.canTest, false);
  assert.equal(missing.developmentConfigurationValid, false);
  assert.equal(missing.clerkAuthEnabled, false);
  assert.equal(missing.clerkInstanceMatchVerified, false);
  assert.match(missing.missingPrerequisites.join(" "), /EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_BASE_URL/);
  assert.match(missing.missingPrerequisites.join(" "), /EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY/);
  assert.match(missing.missingPrerequisites.join(" "), /EXPO_PUBLIC_ENABLE_CLERK_AUTH/);
  assert.match(missing.missingPrerequisites.join(" "), /EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_CLERK_ISSUER/);

  const mismatch = getMainBluebirdDevelopmentDiagnosticStatus({
    ...valid,
    EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_CLERK_ISSUER: "https://other-clerk.example.com",
  });
  assert.equal(mismatch.clerkInstanceMatchVerified, false);
  assert.equal(mismatch.canTest, false);
  assert.match(mismatch.missingPrerequisites.join(" "), /does not match/);

  const safeReport = JSON.stringify([ready, missing, mismatch]);
  assert.doesNotMatch(safeReport, /main-api-development\.example\.test|pk_test_|clerk\.example\.com|other-clerk/i);
  for (const name of [
    "EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT",
    "EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_BASE_URL",
    "EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY",
    "EXPO_PUBLIC_ENABLE_CLERK_AUTH",
    "EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_CLERK_ISSUER",
  ]) assert.match(safeReport, new RegExp(name));
});

test("construction is inert, uses the selected API, and sends only a fresh Clerk bearer token", async () => {
  let tokenReads = 0;
  const requests = [];
  const api = createMainBluebirdApiIntegration({
    configuration: development,
    tokenProvider: tokenProvider("development", async () => {
      tokenReads += 1;
      return `clerk-token-${tokenReads}`;
    }),
    fetcher: async (url, init) => {
      requests.push({ url, init });
      return jsonResponse({
        isAuthenticated: true,
        isAdmin: false,
        isConcierge: false,
        isMember: true,
        memberTier: "plus",
        email: "private@example.test",
        firstName: "Private",
        lastName: "Member",
        isProfileComplete: true,
        needsPlanDecision: false,
        needsSignupPhone: false,
        impersonation: null,
      });
    },
  });

  assert.equal(tokenReads, 0);
  assert.equal(requests.length, 0);
  assert.equal(api.environment, "development");
  const result = await api.checkApiAuthentication();
  assert.deepEqual(result, {
    api: "authenticated",
    memberIdentity: { status: "unresolved", reason: "projection_only" },
  });
  assert.equal(tokenReads, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://8acaa348-10ff-41b3-9d85-c6b4986aa35a-00-2o2pl95c9l6gv.worf.replit.dev/api/me");
  assert.equal(requests[0].init.method, "GET");
  assert.deepEqual(Object.keys(requests[0].init.headers).sort(), ["Accept", "Authorization"]);
  assert.equal(requests[0].init.headers.Authorization, "Bearer clerk-token-1");
  assert.equal(requests[0].init.credentials, "omit");
  assert.equal(requests[0].init.headers.Cookie, undefined);

  await api.authenticated.getMe();
  assert.equal(requests[1].init.headers.Authorization, "Bearer clerk-token-2");
  assert.equal(tokenReads, 2);
});

test("Clerk trip list uses only the selected environment's bearer-authenticated GET /trips", async () => {
  const requests = [];
  const api = createMainBluebirdApiIntegration({
    configuration: development,
    tokenProvider: tokenProvider("development", async () => "fresh-trip-list-token"),
    fetcher: async (url, init) => {
      requests.push({ url, init });
      return jsonResponse({ current: [], past: [] });
    },
  });

  assert.deepEqual(await api.authenticated.listTrips(), { current: [], past: [] });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `${development.apiBaseUrl}/trips`);
  assert.equal(requests[0].init.method, "GET");
  assert.deepEqual(Object.keys(requests[0].init.headers).sort(), ["Accept", "Authorization"]);
  assert.equal(requests[0].init.headers.Authorization, "Bearer fresh-trip-list-token");
  assert.equal(requests[0].init.credentials, "omit");
  assert.equal(requests[0].init.body, undefined);
});

test("unverified or mismatched Development issuer blocks API clients before token reads or requests", async () => {
  const originalIssuer = process.env.EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_CLERK_ISSUER;
  let tokenReads = 0;
  let requests = 0;
  try {
    for (const issuer of [undefined, "https://other-clerk.example.test"]) {
      if (issuer === undefined) delete process.env.EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_CLERK_ISSUER;
      else process.env.EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_CLERK_ISSUER = issuer;

      assert.throws(() => createMainBluebirdApiIntegration({
        configuration: development,
        tokenProvider: tokenProvider("development", async () => {
          tokenReads += 1;
          return "must-not-be-read";
        }),
        fetcher: async () => {
          requests += 1;
          return jsonResponse({});
        },
      }), /configuration is invalid/i);
    }
  } finally {
    if (originalIssuer === undefined) delete process.env.EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_CLERK_ISSUER;
    else process.env.EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_CLERK_ISSUER = originalIssuer;
  }
  assert.equal(tokenReads, 0);
  assert.equal(requests, 0);
});

test("environment mismatch is rejected before any token acquisition or request", () => {
  let tokenReads = 0;
  let requests = 0;
  assert.throws(() => createMainBluebirdApiIntegration({
    configuration: development,
    tokenProvider: tokenProvider("production", async () => {
      tokenReads += 1;
      return "wrong-environment-token";
    }),
    fetcher: async () => {
      requests += 1;
      return jsonResponse({});
    },
  }), MainBluebirdApiConfigurationError);
  assert.equal(tokenReads, 0);
  assert.equal(requests, 0);

  const previous = {
    environment: process.env.EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT,
    api: process.env.EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_BASE_URL,
    key: process.env.EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY,
    productionApi: process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL,
    productionKey: process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY,
  };
  try {
    process.env.EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT = "production";
    process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL = "https://bluebirdjets.com/api";
    process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY = "pk_live_Y2xlcmsuZXhhbXBsZS5jb20k";
    assert.throws(() => createMainBluebirdApiIntegration({
      configuration: development,
      tokenProvider: tokenProvider("development", async () => {
        tokenReads += 1;
        return "wrong-selected-environment-token";
      }),
      fetcher: async () => {
        requests += 1;
        return jsonResponse({});
      },
    }), MainBluebirdApiConfigurationError);
    assert.equal(tokenReads, 0);
    assert.equal(requests, 0);
  } finally {
    const restore = (name, value) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore("EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT", previous.environment);
    restore("EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_BASE_URL", previous.api);
    restore("EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY", previous.key);
    restore("EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL", previous.productionApi);
    restore("EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY", previous.productionKey);
  }
});

test("public read adapters use the configured environment and remain inert until called", async () => {
  const requests = [];
  const api = createMainBluebirdApiIntegration({
    configuration: development,
    tokenProvider: tokenProvider("development"),
    fetcher: async (url, init) => {
      requests.push({ url, init });
      return jsonResponse([]);
    },
  });
  assert.equal(requests.length, 0);
  assert.deepEqual(await api.public.searchAirports("test"), []);
  assert.equal(requests[0].url, "https://8acaa348-10ff-41b3-9d85-c6b4986aa35a-00-2o2pl95c9l6gv.worf.replit.dev/api/airports/search?q=test");
  assert.equal(requests[0].init.headers.Authorization, undefined);
});

test("API authorization, availability, and unresolved member identity remain separate", async () => {
  for (const [status, expected] of [
    [401, "unauthorized"],
    [503, "unavailable"],
  ]) {
    const api = createMainBluebirdApiIntegration({
      configuration: development,
      tokenProvider: tokenProvider("development"),
      fetcher: async () => jsonResponse({}, status),
    });
    const result = await api.checkApiAuthentication();
    assert.equal(result.api, expected);
    assert.equal(result.memberIdentity.status, "unresolved");
  }

  assert.equal(getMainBluebirdApiConnectionState(new Error("offline")), "unavailable");
  const unsignedProjectionApi = createMainBluebirdApiIntegration({
    configuration: development,
    tokenProvider: tokenProvider("development"),
    fetcher: async () => jsonResponse({
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
  });
  assert.deepEqual(await unsignedProjectionApi.checkApiAuthentication(), {
    api: "not_authenticated",
    memberIdentity: { status: "unresolved", reason: "projection_only" },
  });
  assert.deepEqual(getMainBluebirdIntegrationState({
    configurationAvailable: true,
    clerkLoaded: false,
    clerkSignedIn: undefined,
  }), {
    clerk: "loading",
    api: "unchecked",
    memberIdentity: { status: "unresolved", reason: "not_checked" },
  });
  assert.deepEqual(getMainBluebirdIntegrationState({
    configurationAvailable: true,
    clerkLoaded: true,
    clerkSignedIn: true,
    apiState: "authenticated",
    receivedProjection: true,
  }), {
    clerk: "signed_in",
    api: "authenticated",
    memberIdentity: { status: "unresolved", reason: "projection_only" },
  });
  assert.equal(getMainBluebirdIntegrationState({
    configurationAvailable: false,
    clerkLoaded: true,
    clerkSignedIn: true,
  }).api, "unavailable");
});

test("authenticated cache keys isolate both accounts and API environments", () => {
  const devAccountA = mainBluebirdAuthenticatedQueryKey("development", "member-a", "trips");
  const devAccountB = mainBluebirdAuthenticatedQueryKey("development", "member-b", "trips");
  const prodAccountA = mainBluebirdAuthenticatedQueryKey("production", "member-a", "trips");
  assert.notDeepEqual(devAccountA, devAccountB);
  assert.notDeepEqual(devAccountA, prodAccountA);
  assert.throws(() => mainBluebirdAuthenticatedQueryKey("development", "  ", "trips"), /member ID/i);
});
