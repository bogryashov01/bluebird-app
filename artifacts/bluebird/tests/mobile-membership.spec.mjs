import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  MOBILE_MEMBERSHIP_READS_ENABLED,
  areMobileMembershipReadsEnabled,
  loadPreparedMobileMembership,
  mobileMembershipUrl,
  parseMobileMembership,
  parseMobileMembershipPlans,
  readMobileMembership,
} from '../scripts/.mobile-membership.test.mjs';
import { presentClerkMembershipDesign } from '../scripts/.clerk-membership-design.test.mjs';
import { isNativeProductionAuthTestRequestAllowed } from '../scripts/.mobile-membership-policy.test.mjs';

const apiBaseUrl = 'https://bluebirdjets.com/api';
const membershipUrl = 'https://bluebirdjets.com/api/mobile/membership';
const plansUrl = 'https://bluebirdjets.com/api/mobile/plans';

const nonMember = {
  isMember: false,
  tier: null,
  status: null,
  startedAt: null,
  currentPeriodEnd: null,
  paymentStatus: null,
  cancelAtPeriodEnd: false,
  scheduledTierChange: null,
  recentEvents: [],
  skipTheLinePasses: null,
};

const member = {
  isMember: true,
  tier: 'base',
  status: 'active',
  startedAt: '2026-01-15T00:00:00.000Z',
  currentPeriodEnd: '2027-01-15T00:00:00.000Z',
  paymentStatus: 'succeeded',
  cancelAtPeriodEnd: false,
  scheduledTierChange: null,
  recentEvents: [
    { id: 4, eventType: 'activated', occurredAt: '2026-01-15T00:00:00.000Z' },
  ],
  skipTheLinePasses: 2,
};

const plans = {
  plans: [
    {
      tier: 'base',
      name: 'Base',
      priceUsd: 5000,
      cadence: 'year',
      priceLabel: '$5,000',
      cadenceLabel: 'per year',
      tagline: 'Member access',
      highlight: false,
    },
  ],
  features: [{ label: 'Member flights', base: true }],
  cardFeatures: { base: ['Member flights'] },
};

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test('mobile membership reads stay disabled and off the native auth allowlist', async () => {
  assert.equal(MOBILE_MEMBERSHIP_READS_ENABLED, false);
  assert.equal(areMobileMembershipReadsEnabled(), false);
  assert.equal(isNativeProductionAuthTestRequestAllowed(membershipUrl, 'GET'), false);
  assert.equal(isNativeProductionAuthTestRequestAllowed(plansUrl, 'GET'), false);
  assert.equal(isNativeProductionAuthTestRequestAllowed('https://bluebirdjets.com/api/membership', 'GET'), false);
  assert.equal(isNativeProductionAuthTestRequestAllowed('https://bluebirdjets.com/api/plans', 'GET'), false);
  assert.equal(isNativeProductionAuthTestRequestAllowed(`${membershipUrl}?expand=1`, 'GET'), false);
  assert.equal(isNativeProductionAuthTestRequestAllowed(membershipUrl, 'POST'), false);

  const policy = await readFile(new URL('../lib/nativeAuthTestPolicy.ts', import.meta.url), 'utf8');
  assert.equal(policy.includes('/api/mobile/membership'), false);
  assert.equal(policy.includes('/api/mobile/plans'), false);
  assert.equal(policy.includes("'/api/membership'"), false);
  assert.equal(policy.includes("'/api/plans'"), false);
});

test('the prepared membership load does not touch the token provider or the network', async () => {
  let tokenReads = 0;
  let fetches = 0;
  const result = await loadPreparedMobileMembership({
    apiBaseUrl,
    readsEnabled: true,
    getAccessToken: async () => {
      tokenReads += 1;
      return 'session-token';
    },
    fetcher: async () => {
      fetches += 1;
      throw new Error('production request');
    },
  });
  assert.deepEqual(result, { kind: 'unavailable' });
  assert.equal(tokenReads, 0);
  assert.equal(fetches, 0);
});

test('explicit mobile reads still do not reach production while native auth test is enabled', async () => {
  const previous = process.env.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST;
  process.env.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST = 'true';
  let tokenReads = 0;
  let fetches = 0;
  try {
    const result = await readMobileMembership({
      apiBaseUrl,
      readsEnabled: true,
      getAccessToken: async () => {
        tokenReads += 1;
        return 'session-token';
      },
      fetcher: async () => {
        fetches += 1;
        throw new Error('production request');
      },
    });
    assert.deepEqual(result, { kind: 'unavailable' });
    assert.equal(tokenReads, 0);
    assert.equal(fetches, 0);
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST;
    else process.env.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST = previous;
  }
});

test('the safe membership and plan contracts reject payment data and settings', () => {
  assert.equal(mobileMembershipUrl(apiBaseUrl, '/mobile/membership'), membershipUrl);
  assert.equal(mobileMembershipUrl(apiBaseUrl, '/mobile/plans'), plansUrl);
  assert.throws(() => mobileMembershipUrl(apiBaseUrl, '/membership'), /path/);
  assert.throws(() => mobileMembershipUrl(apiBaseUrl, '/plans'), /path/);
  assert.throws(() => mobileMembershipUrl('http://bluebirdjets.com/api', '/mobile/membership'), /apiBaseUrl/);

  const parsedMember = parseMobileMembership(member);
  assert.equal(parsedMember.isMember, true);
  assert.equal(parsedMember.tier, 'base');
  assert.equal(parsedMember.skipTheLinePasses, 2);
  assert.equal(Object.hasOwn(parsedMember, 'paymentMethod'), false);
  assert.deepEqual(parseMobileMembership(nonMember), nonMember);

  const parsedPlans = parseMobileMembershipPlans(plans);
  assert.equal(parsedPlans.plans[0].name, 'Base');
  assert.equal(Object.hasOwn(parsedPlans, 'availability'), false);
  assert.deepEqual(parsedPlans.cardFeatures.base, ['Member flights']);

  assert.throws(
    () => parseMobileMembership({ ...member, paymentMethod: { brand: 'visa', last4: '4242' } }),
    /paymentMethod/,
  );
  assert.throws(
    () => parseMobileMembership({ ...member, lastPaidAmountCents: 500000 }),
    /lastPaidAmountCents/,
  );
  assert.throws(
    () => parseMobileMembership({ ...member, metaPurchase: { eventId: 'evt', currency: 'usd' } }),
    /metaPurchase/,
  );
  assert.throws(
    () => parseMobileMembership({ ...nonMember, skipTheLinePasses: 1 }),
    /nonMember/,
  );
  assert.throws(
    () => parseMobileMembership({
      ...member,
      recentEvents: [{ id: 1, eventType: 'epd_webhook_received', occurredAt: '2026-01-15T00:00:00.000Z' }],
    }),
    /eventType/,
  );
  assert.throws(
    () => parseMobileMembershipPlans({ ...plans, signupsEnabled: true, charterEnabled: true, buyNowEnabled: true }),
    /signupsEnabled/,
  );
  assert.throws(
    () => parseMobileMembershipPlans({ ...plans, availability: { signupsEnabled: false } }),
    /availability/,
  );
});

test('an explicitly enabled reader uses only the future GETs and a Clerk bearer token', async () => {
  const previous = process.env.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST;
  delete process.env.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST;
  const requests = [];
  try {
    const result = await readMobileMembership({
      apiBaseUrl,
      readsEnabled: true,
      getAccessToken: async () => 'clerk-session-token',
      fetcher: async (url, init) => {
        const headers = new Headers(init.headers);
        requests.push({
          url: String(url),
          method: init.method,
          credentials: init.credentials,
          authorization: headers.get('authorization'),
          accept: headers.get('accept'),
          contentType: headers.get('content-type'),
        });
        const pathname = new URL(String(url)).pathname;
        if (pathname === '/api/mobile/membership') return jsonResponse(200, nonMember);
        if (pathname === '/api/mobile/plans') return jsonResponse(200, plans);
        throw new Error(`unexpected ${pathname}`);
      },
    });
    assert.equal(result.kind, 'loaded');
    assert.equal(result.membership.isMember, false);
    assert.equal(result.plans.plans.length, 1);
    assert.deepEqual(requests, [
      {
        url: membershipUrl,
        method: 'GET',
        credentials: 'omit',
        authorization: 'Bearer clerk-session-token',
        accept: 'application/json',
        contentType: null,
      },
      {
        url: plansUrl,
        method: 'GET',
        credentials: 'omit',
        authorization: null,
        accept: 'application/json',
        contentType: null,
      },
    ]);
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST;
    else process.env.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST = previous;
  }
});

test('membership failures stay fail-closed and do not continue into plan or payment calls', async () => {
  const previous = process.env.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST;
  delete process.env.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST;
  try {
    const unauthorized = [];
    const missingToken = await readMobileMembership({
      apiBaseUrl,
      readsEnabled: true,
      getAccessToken: async () => null,
      fetcher: async () => {
        unauthorized.push('fetch');
        return jsonResponse(200, member);
      },
    });
    assert.deepEqual(missingToken, { kind: 'not_authenticated' });
    assert.deepEqual(unauthorized, []);

    const paths = [];
    const rejected = await readMobileMembership({
      apiBaseUrl,
      readsEnabled: true,
      getAccessToken: async () => 'clerk-session-token',
      fetcher: async (url) => {
        paths.push(new URL(String(url)).pathname);
        return jsonResponse(401, { message: 'unauthorized' });
      },
    });
    assert.deepEqual(rejected, { kind: 'not_authenticated' });
    assert.deepEqual(paths, ['/api/mobile/membership']);

    const unsafe = await readMobileMembership({
      apiBaseUrl,
      readsEnabled: true,
      getAccessToken: async () => 'clerk-session-token',
      fetcher: async (url) => {
        const pathname = new URL(String(url)).pathname;
        if (pathname === '/api/mobile/membership') {
          return jsonResponse(200, { ...member, paymentMethod: { last4: '4242' } });
        }
        return jsonResponse(200, plans);
      },
    });
    assert.deepEqual(unsafe, { kind: 'error', code: 'schema' });
    assert.equal(JSON.stringify(unsafe).includes('4242'), false);

    let planFetches = 0;
    const plansRejected = await readMobileMembership({
      apiBaseUrl,
      readsEnabled: true,
      getAccessToken: async () => 'clerk-session-token',
      fetcher: async (url) => {
        const pathname = new URL(String(url)).pathname;
        if (pathname === '/api/mobile/membership') return jsonResponse(200, member);
        planFetches += 1;
        return jsonResponse(200, { ...plans, availability: { signupsEnabled: true } });
      },
    });
    assert.equal(plansRejected.kind, 'loaded');
    assert.equal(plansRejected.membership.tier, 'base');
    assert.equal(plansRejected.plans, null);
    assert.equal(planFetches, 1);
    assert.equal(JSON.stringify(plansRejected).includes('signupsEnabled'), false);
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST;
    else process.env.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST = previous;
  }
});

test('the Clerk membership design uses verified fields and leaves unknown statistics unavailable', () => {
  const unverified = presentClerkMembershipDesign({ membership: null });
  assert.equal(unverified.displayName, 'Name unavailable');
  assert.equal(unverified.tierBadge, 'Membership unverified');
  assert.equal(unverified.flightsFlown, 'Unavailable');
  assert.equal(unverified.totalSaved, 'Unavailable');
  assert.equal(unverified.skipTheLinePasses, 'Unavailable');
  assert.equal(unverified.referralBalance, 'Unavailable');
  assert.equal(unverified.usageLabel, 'Unavailable');
  assert.equal(unverified.usageProgress, 0);
  assert.equal(unverified.upgradeTitle, 'Upgrade');
  assert.equal(unverified.upgradeBody, 'Membership purchases are unavailable.');
  assert.match(unverified.statusNote, /unavailable until it can be verified/);
  const rendered = JSON.stringify(unverified);
  for (const forbidden of ['Alex Rivera', '86,400', '86400', '$450', '14 / 20', 'Upgrade Now']) {
    assert.equal(rendered.includes(forbidden), false, forbidden);
  }

  const named = presentClerkMembershipDesign({
    verifiedFirstName: '  Jordan ',
    verifiedLastName: ' Lee ',
    membership: null,
  });
  assert.equal(named.displayName, 'Jordan Lee');

  const baseMember = presentClerkMembershipDesign({
    verifiedFirstName: 'Jordan',
    verifiedLastName: 'Lee',
    membership: member,
  });
  assert.equal(baseMember.tierBadge, 'Base Member');
  assert.equal(baseMember.skipTheLinePasses, '2');
  assert.equal(baseMember.flightsFlown, 'Unavailable');
  assert.equal(baseMember.totalSaved, 'Unavailable');
  assert.equal(baseMember.referralBalance, 'Unavailable');
  assert.equal(baseMember.usageProgress, 0);
  assert.equal(baseMember.upgradeTitle, 'Base → Plus');
  assert.equal(baseMember.statusNote, null);

  const confirmedNonMember = presentClerkMembershipDesign({ membership: nonMember });
  assert.equal(confirmedNonMember.tierBadge, 'Not a member yet');
  assert.equal(confirmedNonMember.skipTheLinePasses, 'Unavailable');
  assert.equal(confirmedNonMember.upgradeTitle, 'Upgrade');
});

test('the Clerk membership screen keeps the original layout without prototype data or new requests', async () => {
  const source = await readFile(new URL('../app/(tabs)/membership/index.tsx', import.meta.url), 'utf8');
  const clerkBranch = source.indexOf("if (authMode === 'clerk')");
  const demoOverview = source.indexOf('getFullAppDemoMemberOverview()');
  assert.ok(clerkBranch > 0);
  assert.ok(demoOverview > clerkBranch);
  assert.equal(source.includes('loadPreparedMobileMembership'), true);
  assert.equal(source.includes('presentClerkMembershipDesign'), true);
  assert.equal(source.includes('loadClerkBluebirdMembership'), false);
  assert.equal(source.includes('getProfile'), false);
  assert.equal(source.includes('fetchProductionMembershipPlans'), false);
  assert.equal(source.includes("authMode !== 'clerk'"), true);
  assert.equal(source.includes('Bluebird could not load your membership details.'), true);
  const clerkSource = source.slice(clerkBranch, demoOverview);
  for (const label of [
    'Flights Flown',
    'Total Saved',
    'Skip the Line Passes',
    'Referral Balance',
    "This Year's Usage",
    'UPGRADE',
    'AI Concierge',
    'Referral Program',
    'Payment Methods',
  ]) {
    assert.equal(clerkSource.includes(label), true, label);
  }
  for (const forbidden of [
    'Alex Rivera',
    '86,400',
    '$450',
    '14 / 20',
    'Upgrade Now',
    'getFullAppDemoMemberOverview',
    'Sample membership',
    '/api/membership',
    '/api/plans',
    '/upgrade/',
    'useGetMembership',
    'previewMembershipPricing',
  ]) {
    assert.equal(clerkSource.includes(forbidden), false, forbidden);
  }
  assert.equal(clerkSource.includes("router.push('/concierge'"), true);
  assert.equal(clerkSource.includes("router.push('/referral'"), true);
  assert.equal(clerkSource.includes("router.push('/account/payment-methods'"), true);
});
