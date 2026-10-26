import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  createAuthenticatedProductionApiClient,
} from '../scripts/.production-auth-api.test.mjs';
import {
  isNativeProductionAuthTestRequestAllowed,
} from '../scripts/.native-auth-test-policy.test.mjs';
import {
  customFetch,
  setAuthTokenGetter,
  setBaseUrl,
  setRequestGuard,
} from '../scripts/.api-client-custom-fetch.test.mjs';

const production = {
  EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT: 'production',
  EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL: 'https://bluebirdjets.com/api',
  EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY: 'pk_live_Y2xlcmsuZXhhbXBsZS5jb20k',
};

const currentUser = {
  isAuthenticated: true,
  isAdmin: false,
  isConcierge: false,
  isMember: false,
  memberTier: null,
  isProfileComplete: false,
  needsPlanDecision: false,
  needsSignupPhone: false,
};

test('the restricted request policy allows only the exact read-only Production /api/me request', () => {
  for (const request of [
    ['https://bluebirdjets.com/api/me', 'GET'],
    ['/api/me', 'get'],
  ]) {
    assert.equal(isNativeProductionAuthTestRequestAllowed(...request), true);
  }

  for (const request of [
    ['https://bluebirdjets.com/api/me', 'POST'],
    ['https://bluebirdjets.com/api/me', 'PUT'],
    ['https://bluebirdjets.com/api/me', 'DELETE'],
    ['https://bluebirdjets.com/api/me/profile', 'GET'],
    ['https://bluebirdjets.com/api/trips', 'GET'],
    ['https://bluebirdjets.com/api/empty-legs/42/queue', 'GET'],
    ['https://bluebirdjets.com/api/me?expand=profile', 'GET'],
    ['https://preview.bluebirdjets.com/api/me', 'GET'],
    ['https://bluebirdjets.com.evil.example/api/me', 'GET'],
    ['/api/me#fragment', 'GET'],
    ['not a URL', 'GET'],
  ]) {
    assert.equal(isNativeProductionAuthTestRequestAllowed(...request), false);
  }
});

test('the Production authenticated API permits /api/me and blocks all other reads and writes before fetch', async () => {
  const previousEnvironment = {
    apiEnvironment: process.env.EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT,
    apiUrl: process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL,
    clerkKey: process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY,
    nativeTest: process.env.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST,
  };
  Object.assign(process.env, production, {
    EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST: 'true',
  });

  const requests = [];
  const client = createAuthenticatedProductionApiClient({
    environment: 'production',
    baseUrl: production.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL,
    tokenProvider: {
      environment: 'production',
      getVerifiedAccessToken: async () => 'test-session-token',
    },
    fetcher: async (url, init) => {
      requests.push({
        url: String(url),
        method: init.method,
        authorization: new Headers(init.headers).get('authorization'),
      });
      return {
        ok: true,
        status: 200,
        json: async () => currentUser,
      };
    },
  });

  try {
    assert.equal((await client.getMe()).isAuthenticated, true);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0], {
      url: 'https://bluebirdjets.com/api/me',
      method: 'GET',
      authorization: 'Bearer test-session-token',
    });
    await assert.rejects(client.getProfile(), /permits only GET \/api\/me/);
    await assert.rejects(client.listTrips(), /permits only GET \/api\/me/);
    await assert.rejects(client.getPhoneVerificationStatus('+15555550123'), /permits only GET \/api\/me/);
    await assert.rejects(client.updateProfile({
      firstName: 'Test',
      lastName: 'Member',
      dob: '1990-01-01',
      gender: 'male',
      homeAirportCode: 'JFK',
      favoriteCityKeys: ['new-york'],
    }), /permits only GET \/api\/me/);
    await assert.rejects(client.joinEmptyLegQueue(42), /permits only GET \/api\/me/);
    await assert.rejects(client.skipLine(42), /permits only GET \/api\/me/);
    await assert.rejects(client.previewMembershipPricing({ tier: 'base' }), /permits only GET \/api\/me/);
    assert.equal(requests.length, 1, 'blocked API calls must not reach fetch');
  } finally {
    const restore = (name, value) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore('EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT', previousEnvironment.apiEnvironment);
    restore('EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL', previousEnvironment.apiUrl);
    restore('EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY', previousEnvironment.clerkKey);
    restore('EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST', previousEnvironment.nativeTest);
  }
});

test('the generated API client guard rejects legacy and mutating calls before token lookup or fetch', async () => {
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  let tokenReads = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify(currentUser), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  setBaseUrl('https://bluebirdjets.com');
  setRequestGuard(isNativeProductionAuthTestRequestAllowed);
  setAuthTokenGetter(async () => {
    tokenReads += 1;
    return 'test-session-token';
  });

  try {
    await customFetch('/api/me', { method: 'GET' });
    assert.equal(fetchCalls, 1);
    assert.equal(tokenReads, 1);

    await assert.rejects(
      customFetch('/api/me/profile', { method: 'GET' }),
      /does not allow the requested API operation/,
    );
    await assert.rejects(
      customFetch('/api/queue/join', { method: 'POST' }),
      /does not allow the requested API operation/,
    );
    await assert.rejects(
      customFetch('https://preview.bluebirdjets.com/api/me', { method: 'GET' }),
      /does not allow the requested API operation/,
    );
    assert.equal(fetchCalls, 1);
    assert.equal(tokenReads, 1, 'blocked operations must not retrieve a bearer token');
  } finally {
    setRequestGuard(null);
    setAuthTokenGetter(null);
    setBaseUrl(null);
    globalThis.fetch = previousFetch;
  }
});

test('EAS TestFlight profile is Production-only and keeps the existing approval gate external', async () => {
  const eas = JSON.parse(await readFile(new URL('../eas.json', import.meta.url), 'utf8'));
  const app = JSON.parse(await readFile(new URL('../app.json', import.meta.url), 'utf8')).expo;
  const layoutSource = await readFile(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
  const profile = eas.build['production-auth-test'];

  assert.equal(profile.extends, 'production');
  assert.equal(profile.environment, 'production');
  assert.equal(profile.distribution, 'store');
  assert.deepEqual(profile.env, {
    EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT: 'production',
    EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST: 'true',
    EXPO_PUBLIC_ENABLE_CLERK_AUTH: 'false',
    EXPO_PUBLIC_BLUEBIRD_FULL_APP_DEMO: 'false',
    EXPO_PUBLIC_BLUEBIRD_FLIGHT_READ_MODE: 'production',
    EXPO_PUBLIC_BLUEBIRD_MEMBERSHIP_DATA_MODE: 'production',
  });
  for (const forbiddenOverride of [
    'EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH',
    'EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL',
    'EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY',
    'EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_CLERK_ISSUER',
    'EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_BASE_URL',
    'EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY',
    'EXPO_PUBLIC_DOMAIN',
  ]) {
    assert.equal(Object.hasOwn(profile.env, forbiddenOverride), false);
  }

  assert.equal(app.version, '1.0.0');
  assert.equal(app.ios.bundleIdentifier, 'com.bluebirdjets.app');
  assert.equal(app.ios.buildNumber, '1', 'do not guess or advance an unverified uploaded build number');
  assert.match(layoutSource, /setBaseUrl\('https:\/\/bluebirdjets\.com'\)/);
  assert.match(layoutSource, /setRequestGuard\(isNativeProductionAuthTestRequestAllowed\)/);
  assert.match(layoutSource, /!isNativeProductionAuthTestEnabled\(\) && process\.env\.EXPO_PUBLIC_DOMAIN/);
});

test('the native Clerk provider uses Clerk token caching and does not embed a Clerk secret', async () => {
  const providerSource = await readFile(
    new URL('../lib/dormantClerkIntegration.tsx', import.meta.url),
    'utf8',
  );
  const tokenSource = await readFile(
    new URL('../lib/clerkProductionTokenProvider.ts', import.meta.url),
    'utf8',
  );

  assert.match(providerSource, /@clerk\/expo\/token-cache/);
  assert.match(providerSource, /<ClerkProvider publishableKey=\{publishableKey\} tokenCache=\{tokenCache\}>/);
  assert.match(providerSource, /getToken: auth\.getToken/);
  assert.match(tokenSource, /const token = await session\.getToken\(\)/);
  assert.match(providerSource, /\}, configuration\.environment\)/);
  assert.doesNotMatch(
    `${providerSource}\n${tokenSource}`,
    /sk_(?:test|live)_[A-Za-z0-9_-]+/,
  );
});
