import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  createAuthenticatedProductionApiClient,
} from '../scripts/.production-auth-api.test.mjs';
import {
  isNativeProductionAuthTestRequestAllowed,
  shouldShowNativeAuthStartupDiagnostics,
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

const profile = {
  firstName: 'Test',
  lastName: 'Member',
  dob: '1990-02-12',
  gender: 'female',
  homeAirportCode: 'KJFK',
  homeAirportLabel: null,
  favoriteAirportCodes: ['KJFK'],
  favoriteAirportLabels: ['New York JFK'],
  favoriteCityKeys: ['new-york'],
  favoriteCityLabels: ['New York'],
  email: 'member@example.test',
  emailLocked: false,
  phoneE164: null,
  phoneCountry: null,
  phoneVerifiedAt: null,
  phoneVerificationRequired: false,
  smsConsent: false,
  smsConsentAt: null,
  smsConsentRevokedAt: null,
  signupChannel: 'email',
  upgradeCreditBalances: { skipTheLine: 0, internationalPass: 0 },
  weightLbs: null,
  isComplete: true,
  notificationPrefs: {
    mode: 'off',
    allChannels: null,
    emptyLegHomeAirport: null,
    departingFavorite: null,
    arrivingFavorite: null,
    queueUpdates: 'email',
    winningNotifications: 'email',
  },
};

test('the restricted request policy allows the native auth-test reads and blocks everything else', () => {
  const airportLookup = `https://bluebirdjets.com/api/airports?${new URLSearchParams({ codes: 'SEA,DAL' }).toString()}`;
  for (const request of [
    ['https://bluebirdjets.com/api/me', 'GET'],
    ['/api/me', 'get'],
    ['https://bluebirdjets.com/api/me/profile', 'GET'],
    ['/api/me/profile', 'GET'],
    ['https://bluebirdjets.com/api/empty-legs', 'GET'],
    ['/api/empty-legs', 'GET'],
    ['https://bluebirdjets.com/api/empty-legs/123', 'GET'],
    ['/api/empty-legs/9007199254740991', 'GET'],
    ['https://bluebirdjets.com/api/empty-legs/42/queue', 'GET'],
    ['/api/empty-legs/9007199254740991/queue', 'GET'],
    [airportLookup, 'GET'],
    ['/api/airports?codes=KJFK', 'GET'],
    ['https://bluebirdjets.com/api/trips', 'GET'],
    ['/api/trips', 'GET'],
    ['https://bluebirdjets.com/api/me/referrals', 'GET'],
    ['/api/me/referrals', 'GET'],
  ]) {
    assert.equal(isNativeProductionAuthTestRequestAllowed(...request), true, request.join(' '));
  }

  const blocked = [];
  for (const path of ['/api/me', '/api/me/profile', '/api/empty-legs', '/api/empty-legs/123', '/api/airports', '/api/trips', '/api/me/referrals']) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      blocked.push([`https://bluebirdjets.com${path}`, method]);
    }
    blocked.push(
      [`https://bluebirdjets.com${path}/`, 'GET'],
      [`https://bluebirdjets.com${path}#fragment`, 'GET'],
      [`http://bluebirdjets.com${path}`, 'GET'],
    );
  }
  for (const path of ['/api/me', '/api/me/profile', '/api/empty-legs', '/api/empty-legs/123', '/api/trips', '/api/me/referrals']) {
    blocked.push([`https://bluebirdjets.com${path}?expand=1`, 'GET']);
  }
  const tooManyCodes = Array.from({ length: 201 }, (_, index) => `A${String(index).padStart(2, '0')}`).join(',');
  blocked.push(
    ['https://bluebirdjets.com/api/empty-legs/0', 'GET'],
    ['https://bluebirdjets.com/api/empty-legs/0123', 'GET'],
    ['https://bluebirdjets.com/api/empty-legs/-1', 'GET'],
    ['https://bluebirdjets.com/api/empty-legs/1.5', 'GET'],
    ['https://bluebirdjets.com/api/empty-legs/9007199254740993', 'GET'],
    ['https://bluebirdjets.com/api/empty-legs/42/queue/', 'GET'],
    ['https://bluebirdjets.com/api/empty-legs/42/queue?expand=1', 'GET'],
    ['https://bluebirdjets.com/api/empty-legs/42/queue#fragment', 'GET'],
    ['https://bluebirdjets.com/api/empty-legs/42/queue/extra', 'GET'],
    ['https://bluebirdjets.com/api/empty-legs/42/queue', 'POST'],
    ['https://bluebirdjets.com/api/empty-legs/42/queue', 'PUT'],
    ['https://bluebirdjets.com/api/empty-legs/42/queue', 'PATCH'],
    ['https://bluebirdjets.com/api/empty-legs/42/queue', 'DELETE'],
    ['https://bluebirdjets.com/api/empty-legs/0/queue', 'GET'],
    ['https://bluebirdjets.com/api/empty-legs/0123/queue', 'GET'],
    ['https://bluebirdjets.com/api/empty-legs/-1/queue', 'GET'],
    ['https://bluebirdjets.com/api/empty-legs/1.5/queue', 'GET'],
    ['https://bluebirdjets.com/api/empty-legs/9007199254740993/queue', 'GET'],
    ['http://bluebirdjets.com/api/empty-legs/42/queue', 'GET'],
    ['https://preview.bluebirdjets.com/api/empty-legs/42/queue', 'GET'],
    ['https://bluebirdjets.com/api/empty-legs/42/skip-line', 'GET'],
    ['https://bluebirdjets.com/api/empty-legs/42/skip-line', 'POST'],
    ['https://bluebirdjets.com/api/empty-legs/42/winner/confirm', 'POST'],
    ['https://bluebirdjets.com/api/empty-legs/42/winner/decline', 'POST'],
    ['https://bluebirdjets.com/api/empty-legs/42/passengers', 'GET'],
    ['https://bluebirdjets.com/api/empty-legs/42/pets', 'POST'],
    ['https://bluebirdjets.com/api/airports', 'GET'],
    ['https://bluebirdjets.com/api/airports?codes=', 'GET'],
    ['https://bluebirdjets.com/api/airports?codes=SEA,SEA', 'GET'],
    ['https://bluebirdjets.com/api/airports?codes=sea', 'GET'],
    ['https://bluebirdjets.com/api/airports?codes=S', 'GET'],
    ['https://bluebirdjets.com/api/airports?codes=ABCDEFGHIJKLM', 'GET'],
    [`https://bluebirdjets.com/api/airports?codes=${tooManyCodes}`, 'GET'],
    ['https://bluebirdjets.com/api/airports?codes=SEA&extra=1', 'GET'],
    ['https://bluebirdjets.com/api/airports/search?q=SEA', 'GET'],
    ['https://bluebirdjets.com/api/airports/cities', 'GET'],
    ['https://bluebirdjets.com/api/trips/1', 'GET'],
    ['https://bluebirdjets.com/api/trips/1/cancel', 'GET'],
    ['https://bluebirdjets.com/api/me/referrals/extra', 'GET'],
    ['https://bluebirdjets.com/api/me/invite-code', 'GET'],
    ['https://bluebirdjets.com/api/invites/validate', 'GET'],
    ['https://bluebirdjets.com/api/invites/validate', 'POST'],
    ['https://bluebirdjets.com/api/membership/preview-pricing', 'GET'],
    ['https://bluebirdjets.com/api/membership/preview-pricing', 'POST'],
    ['https://preview.bluebirdjets.com/api/trips', 'GET'],
    ['https://bluebirdjets.com/api/membership', 'GET'],
    ['https://preview.bluebirdjets.com/api/me', 'GET'],
    ['https://preview.bluebirdjets.com/api/empty-legs/123', 'GET'],
    ['https://bluebirdjets.com.evil.example/api/me', 'GET'],
    ['https://bluebirdjets.com/api/me?expand=profile', 'GET'],
    ['/api/me#fragment', 'GET'],
    ['/api/empty-legs/123#fragment', 'GET'],
    ['not a URL', 'GET'],
  );
  for (const request of blocked) {
    assert.equal(isNativeProductionAuthTestRequestAllowed(...request), false, request.join(' '));
  }
});

test('startup diagnostics are limited to release iOS Production auth-test builds', () => {
  const allowed = {
    platformOS: 'ios',
    nativeAuthTestEnabled: true,
    apiEnvironment: 'production',
    developmentBuild: false,
  };
  assert.equal(shouldShowNativeAuthStartupDiagnostics(allowed), true);
  assert.equal(shouldShowNativeAuthStartupDiagnostics({ ...allowed, platformOS: 'android' }), false);
  assert.equal(shouldShowNativeAuthStartupDiagnostics({ ...allowed, platformOS: 'web' }), false);
  assert.equal(shouldShowNativeAuthStartupDiagnostics({ ...allowed, nativeAuthTestEnabled: false }), false);
  assert.equal(shouldShowNativeAuthStartupDiagnostics({ ...allowed, apiEnvironment: 'development' }), false);
  assert.equal(shouldShowNativeAuthStartupDiagnostics({ ...allowed, developmentBuild: true }), false);
});

test('the Production authenticated API permits /api/me, /api/me/profile, and /api/trips and blocks other reads and writes before fetch', async () => {
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
        cookie: new Headers(init.headers).get('cookie'),
        credentials: init.credentials,
      });
      const pathname = new URL(String(url)).pathname;
      const referralAccount = {
        code: 'PERSONAL_CODE',
        shareUrl: 'https://bluebirdjets.com/invite/PERSONAL_CODE',
        successfulReferrals: 1,
        creditEarnedCents: 100000,
        creditAppliedCents: 0,
        creditBalanceCents: 100000,
      };
      const body = pathname === '/api/me/profile'
        ? profile
        : pathname === '/api/trips'
          ? { current: [], past: [] }
          : pathname === '/api/me/referrals'
            ? referralAccount
            : pathname === '/api/empty-legs/42/queue'
              ? [{ position: 2, initials: 'AB', tier: 'base', hasLineSkip: false, isViewer: true }]
              : currentUser;
      return {
        ok: true,
        status: 200,
        json: async () => body,
      };
    },
  });

  try {
    assert.equal((await client.getMe()).isAuthenticated, true);
    assert.equal((await client.getProfile()).firstName, 'Test');
    assert.deepEqual(await client.listTrips(), { current: [], past: [] });
    assert.deepEqual(await client.getReferrals(), {
      code: 'PERSONAL_CODE',
      inviteUrl: 'https://bluebirdjets.com/invite/PERSONAL_CODE',
      statistics: {
        friendsActivated: 1,
        creditEarnedCents: 100000,
        creditAppliedCents: 0,
        balanceCents: 100000,
      },
    });
    assert.deepEqual(await client.getEmptyLegQueue(42), [{
      position: 2,
      initials: 'AB',
      tier: 'base',
      hasLineSkip: false,
      isViewer: true,
    }]);
    assert.equal(requests.length, 5);
    assert.deepEqual(requests[0], {
      url: 'https://bluebirdjets.com/api/me',
      method: 'GET',
      authorization: 'Bearer test-session-token',
      cookie: null,
      credentials: 'omit',
    });
    assert.deepEqual(requests[1], {
      url: 'https://bluebirdjets.com/api/me/profile',
      method: 'GET',
      authorization: 'Bearer test-session-token',
      cookie: null,
      credentials: 'omit',
    });
    assert.deepEqual(requests[2], {
      url: 'https://bluebirdjets.com/api/trips',
      method: 'GET',
      authorization: 'Bearer test-session-token',
      cookie: null,
      credentials: 'omit',
    });
    assert.deepEqual(requests[3], {
      url: 'https://bluebirdjets.com/api/me/referrals',
      method: 'GET',
      authorization: 'Bearer test-session-token',
      cookie: null,
      credentials: 'omit',
    });
    assert.deepEqual(requests[4], {
      url: 'https://bluebirdjets.com/api/empty-legs/42/queue',
      method: 'GET',
      authorization: 'Bearer test-session-token',
      cookie: null,
      credentials: 'omit',
    });
    await assert.rejects(client.getInviteCode(), /permits only GET \/api\/me/);
    await assert.rejects(client.validateInvite({ code: 'BB-FRIEND2' }), /permits only GET \/api\/me/);
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
    await assert.rejects(client.leaveEmptyLegQueue(42), /permits only GET \/api\/me/);
    await assert.rejects(client.skipLine(42), /permits only GET \/api\/me/);
    await assert.rejects(client.confirmEmptyLegWinner(42), /permits only GET \/api\/me/);
    await assert.rejects(client.declineEmptyLegWinner(42), /permits only GET \/api\/me/);
    await assert.rejects(client.previewMembershipPricing({ tier: 'base' }), /permits only GET \/api\/me/);
    await assert.rejects(client.getMembership(), /permits only GET \/api\/me/);
    assert.equal(requests.length, 5, 'blocked API calls must not reach fetch');
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
    await customFetch('/api/me/profile', { method: 'GET' });
    await customFetch('/api/empty-legs', { method: 'GET' });
    await customFetch('/api/empty-legs/123', { method: 'GET' });
    await customFetch('/api/empty-legs/42/queue', { method: 'GET' });
    await customFetch(`/api/airports?${new URLSearchParams({ codes: 'SEA,DAL' }).toString()}`, { method: 'GET' });
    await customFetch('/api/trips', { method: 'GET' });
    await customFetch('/api/me/referrals', { method: 'GET' });
    assert.equal(fetchCalls, 8);
    assert.equal(tokenReads, 8);

    for (const path of ['/api/me', '/api/me/profile', '/api/empty-legs', '/api/empty-legs/123', '/api/trips', '/api/me/referrals']) {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        await assert.rejects(
          customFetch(`https://bluebirdjets.com${path}`, { method }),
          /does not allow the requested API operation/,
        );
      }
      await assert.rejects(
        customFetch(`https://bluebirdjets.com${path}/`, { method: 'GET' }),
        /does not allow the requested API operation/,
      );
      await assert.rejects(
        customFetch(`https://bluebirdjets.com${path}?expand=1`, { method: 'GET' }),
        /does not allow the requested API operation/,
      );
      await assert.rejects(
        customFetch(`http://bluebirdjets.com${path}`, { method: 'GET' }),
        /does not allow the requested API operation/,
      );
    }
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      await assert.rejects(
        customFetch('https://bluebirdjets.com/api/airports?codes=SEA', { method }),
        /does not allow the requested API operation/,
      );
    }
    await assert.rejects(
      customFetch('/api/queue/join', { method: 'POST' }),
      /does not allow the requested API operation/,
    );
    await assert.rejects(
      customFetch('https://bluebirdjets.com/api/empty-legs/0123', { method: 'GET' }),
      /does not allow the requested API operation/,
    );
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      await assert.rejects(
        customFetch('https://bluebirdjets.com/api/empty-legs/42/queue', { method }),
        /does not allow the requested API operation/,
      );
    }
    await assert.rejects(
      customFetch('https://bluebirdjets.com/api/empty-legs/42/queue?expand=1', { method: 'GET' }),
      /does not allow the requested API operation/,
    );
    await assert.rejects(
      customFetch('https://bluebirdjets.com/api/empty-legs/42/queue/extra', { method: 'GET' }),
      /does not allow the requested API operation/,
    );
    await assert.rejects(
      customFetch('https://bluebirdjets.com/api/empty-legs/0/queue', { method: 'GET' }),
      /does not allow the requested API operation/,
    );
    await assert.rejects(
      customFetch('https://bluebirdjets.com/api/empty-legs/42/skip-line', { method: 'POST' }),
      /does not allow the requested API operation/,
    );
    await assert.rejects(
      customFetch('https://bluebirdjets.com/api/airports', { method: 'GET' }),
      /does not allow the requested API operation/,
    );
    await assert.rejects(
      customFetch('https://bluebirdjets.com/api/airports/search?q=SEA', { method: 'GET' }),
      /does not allow the requested API operation/,
    );
    await assert.rejects(
      customFetch('https://bluebirdjets.com/api/trips/1', { method: 'GET' }),
      /does not allow the requested API operation/,
    );
    await assert.rejects(
      customFetch('https://bluebirdjets.com/api/trips/1/cancel', { method: 'POST' }),
      /does not allow the requested API operation/,
    );
    await assert.rejects(
      customFetch('https://bluebirdjets.com/api/me/referrals/extra', { method: 'GET' }),
      /does not allow the requested API operation/,
    );
    await assert.rejects(
      customFetch('https://bluebirdjets.com/api/me/referrals?expand=1', { method: 'GET' }),
      /does not allow the requested API operation/,
    );
    await assert.rejects(
      customFetch('https://bluebirdjets.com/api/me/referrals#fragment', { method: 'GET' }),
      /does not allow the requested API operation/,
    );
    await assert.rejects(
      customFetch('https://bluebirdjets.com/api/me/invite-code', { method: 'GET' }),
      /does not allow the requested API operation/,
    );
    await assert.rejects(
      customFetch('https://bluebirdjets.com/api/invites/validate', { method: 'POST' }),
      /does not allow the requested API operation/,
    );
    await assert.rejects(
      customFetch('https://bluebirdjets.com/api/membership/preview-pricing', { method: 'POST' }),
      /does not allow the requested API operation/,
    );
    await assert.rejects(
      customFetch('https://bluebirdjets.com/api/membership', { method: 'GET' }),
      /does not allow the requested API operation/,
    );
    await assert.rejects(
      customFetch('https://bluebirdjets.com/api/me#fragment', { method: 'GET' }),
      /does not allow the requested API operation/,
    );
    await assert.rejects(
      customFetch('https://preview.bluebirdjets.com/api/empty-legs/123', { method: 'GET' }),
      /does not allow the requested API operation/,
    );
    assert.equal(fetchCalls, 8);
    assert.equal(tokenReads, 8, 'blocked operations must not retrieve a bearer token');
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

  assert.deepEqual(eas.build.production, {
    environment: 'production',
    distribution: 'store',
    pnpm: '10.26.1',
  });
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

test('the Production Clerk debug EAS profile is isolated and preserves all Production gates', async () => {
  const eas = JSON.parse(await readFile(new URL('../eas.json', import.meta.url), 'utf8'));
  const profile = eas.build['production-clerk-debug'];

  assert.equal(profile.extends, 'production');
  assert.equal(profile.developmentClient, true);
  assert.equal(profile.distribution, 'internal');
  assert.equal(profile.environment, 'production');
  assert.deepEqual(profile.env, {
    EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT: 'production',
    EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_DEBUG: 'true',
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
