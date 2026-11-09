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
import { membershipDashboardPhase, presentClerkMembershipDesign, presentMembershipDashboard } from '../scripts/.clerk-membership-design.test.mjs';
import {
  ProductionAuthHttpError,
  ProductionAuthNetworkError,
  ProductionAuthSchemaError,
  adaptProductionMembershipForDashboard,
  areProductionMembershipDashboardReadsEnabled,
  classifyMembershipReadError,
  clearDashboardMembershipCache,
  loadDashboardProductionMembership,
  logMembershipDashboardDiagnostic,
  logMembershipDashboardPresentation,
  logMembershipNormalizedFields,
  membershipDiagnostic,
  membershipNormalizedFieldRecord,
  readApprovedDashboardMembership,
  readFreshDashboardMembership,
  readFreshSkipTheLinePasses,
  readSkipTheLineBalance,
  rememberDashboardMembership,
  rememberSkipTheLinePasses,
  loadDashboardSkipTheLinePasses,
  retainDashboardMembershipForAccount,
  shouldDisplayDashboardMembership,
} from '../scripts/.membership-dashboard-read.test.mjs';
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
  assert.equal(isNativeProductionAuthTestRequestAllowed('https://bluebirdjets.com/api/membership', 'GET'), true);
  assert.equal(isNativeProductionAuthTestRequestAllowed('https://bluebirdjets.com/api/membership', 'POST'), false);
  assert.equal(isNativeProductionAuthTestRequestAllowed('https://bluebirdjets.com/api/membership', 'PUT'), false);
  assert.equal(isNativeProductionAuthTestRequestAllowed('https://bluebirdjets.com/api/membership', 'PATCH'), false);
  assert.equal(isNativeProductionAuthTestRequestAllowed('https://bluebirdjets.com/api/membership', 'DELETE'), false);
  assert.equal(isNativeProductionAuthTestRequestAllowed('https://bluebirdjets.com/api/membership?expand=1', 'GET'), false);
  assert.equal(isNativeProductionAuthTestRequestAllowed('https://bluebirdjets.com/api/plans', 'GET'), false);
  assert.equal(isNativeProductionAuthTestRequestAllowed(`${membershipUrl}?expand=1`, 'GET'), false);
  assert.equal(isNativeProductionAuthTestRequestAllowed(membershipUrl, 'POST'), false);

  const policy = await readFile(new URL('../lib/nativeAuthTestPolicy.ts', import.meta.url), 'utf8');
  assert.equal(policy.includes('/api/mobile/membership'), false);
  assert.equal(policy.includes('/api/mobile/plans'), false);
  assert.equal(policy.includes("'/api/membership'"), true);
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
  assert.equal(unverified.tierBadge, 'Membership status unavailable');
  assert.deepEqual(unverified.metrics, []);
  assert.equal(unverified.upgradeBody, 'Membership purchases are not available in the app.');
  assert.match(unverified.statusNote, /after Bluebird confirms them/);
  const rendered = JSON.stringify(unverified);
  for (const forbidden of ['Alex Rivera', '86,400', '86400', '$450', '14 / 20', 'Upgrade Now', 'Base Member']) {
    assert.equal(rendered.includes(forbidden), false, forbidden);
  }

  const named = presentClerkMembershipDesign({
    verifiedFirstName: '  Jordan ',
    verifiedLastName: ' Lee ',
    membership: null,
  });
  assert.equal(named.displayName, 'Jordan Lee');

  const accountMember = presentClerkMembershipDesign({
    verifiedFirstName: 'Jordan',
    verifiedLastName: 'Lee',
    membership: null,
    account: { resolved: true, isMember: true, memberTier: 'base' },
  });
  assert.equal(accountMember.displayName, 'Jordan Lee');
  assert.equal(accountMember.tierBadge, 'Base Member');
  assert.deepEqual(accountMember.metrics, []);
  assert.equal(accountMember.upgradeBody, 'Membership purchases are not available in the app.');
  assert.match(accountMember.statusNote, /after Bluebird confirms them/);

  const baseMember = presentClerkMembershipDesign({
    verifiedFirstName: 'Jordan',
    verifiedLastName: 'Lee',
    membership: member,
    account: { resolved: true, isMember: true, memberTier: 'base' },
  });
  assert.equal(baseMember.tierBadge, 'Base Member');
  assert.deepEqual(baseMember.metrics, [{ label: 'Skip the Line Passes', value: '2' }]);
  assert.equal(baseMember.statusNote, null);
  assert.equal(JSON.stringify(baseMember).includes('86,400'), false);

  const conflict = presentClerkMembershipDesign({
    membership: member,
    account: { resolved: true, isMember: true, memberTier: 'plus' },
  });
  assert.equal(conflict.tierBadge, 'Membership status unavailable');
  assert.deepEqual(conflict.metrics, []);
  assert.match(conflict.statusNote, /do not match/);

  const confirmedNonMember = presentClerkMembershipDesign({ membership: nonMember });
  assert.equal(confirmedNonMember.tierBadge, 'Not a member yet');
  assert.deepEqual(confirmedNonMember.metrics, []);
  assert.equal(confirmedNonMember.statusNote, null);

  const accountNonMember = presentClerkMembershipDesign({
    membership: null,
    account: { resolved: true, isMember: false, memberTier: null },
  });
  assert.equal(accountNonMember.tierBadge, 'Not a member');
  assert.deepEqual(accountNonMember.metrics, []);
  assert.equal(accountNonMember.statusNote, null);
});

test('the membership dashboard shows a verified tier and leaves unknown statistics blank', () => {
  const signedOut = presentMembershipDashboard({
    signedIn: false,
    verifiedFirstName: 'Jordan',
    verifiedLastName: 'Lee',
    membership: member,
    referralBalanceCents: 150000,
  });
  assert.equal(signedOut.displayName, 'Name unavailable');
  assert.equal(signedOut.tierBadge, 'Sign in required');
  assert.equal(signedOut.upgrade, null);
  assert.equal(signedOut.annualUsage, null);
  assert.equal(signedOut.metrics.every((metric) => metric.available === false), true);

  const unverifiedAccount = presentMembershipDashboard({
    signedIn: true,
    verifiedFirstName: 'Jordan',
    verifiedLastName: 'Lee',
    membership: null,
    account: { resolved: true, isMember: true, memberTier: 'base' },
  });
  assert.equal(unverifiedAccount.displayName, 'Jordan Lee');
  assert.equal(unverifiedAccount.tierBadge, 'Membership status unavailable');
  assert.equal(unverifiedAccount.upgrade, null);
  assert.match(unverifiedAccount.statusNote, /not confirmed/);
  assert.equal(unverifiedAccount.metrics.find((metric) => metric.label === 'Flights Flown').value, '\u2014');
  assert.equal(unverifiedAccount.metrics.find((metric) => metric.label === 'Total Saved').available, false);

  const baseMember = presentMembershipDashboard({
    signedIn: true,
    verifiedFirstName: 'Jordan',
    verifiedLastName: 'Lee',
    membership: member,
    account: { resolved: true, isMember: true, memberTier: 'base' },
  });
  assert.equal(baseMember.tierBadge, 'Base Member');
  assert.equal(baseMember.upgrade.paymentEnabled, false);
  assert.equal(baseMember.upgrade.buttonLabel, 'Upgrade available soon');
  assert.equal(baseMember.upgrade.title, 'Base → Plus');
  assert.equal(baseMember.annualUsage, null);
  assert.equal(baseMember.metrics.find((metric) => metric.label === 'Skip the Line Passes').value, '2');
  assert.equal(baseMember.metrics.find((metric) => metric.label === 'Referral Balance').available, false);
  assert.equal(JSON.stringify(baseMember).includes('14 / 20'), false);

  const plusMember = presentMembershipDashboard({
    signedIn: true,
    membership: { ...member, tier: 'plus' },
    account: { resolved: true, isMember: true, memberTier: 'plus' },
    referralBalanceCents: 25000,
  });
  assert.equal(plusMember.tierBadge, 'Plus Member');
  assert.equal(plusMember.upgrade, null);
  assert.equal(plusMember.metrics.find((metric) => metric.label === 'Referral Balance').value, '$250.00');

  const missing = presentMembershipDashboard({ signedIn: true, membership: nonMember });
  assert.equal(missing.tierBadge, 'Not a member yet');
  assert.equal(missing.upgrade, null);

  const pending = presentMembershipDashboard({
    signedIn: true,
    membership: { ...member, status: 'pending_payment', paymentStatus: 'pending' },
    account: { resolved: true, isMember: true, memberTier: 'base' },
  });
  assert.equal(pending.tierBadge, 'Payment pending');
  assert.equal(pending.upgrade, null);

  const inactive = presentMembershipDashboard({
    signedIn: true,
    membership: { ...member, status: 'canceled' },
  });
  assert.equal(inactive.tierBadge, 'Membership inactive');
  assert.equal(inactive.upgrade, null);

  const expired = presentMembershipDashboard({
    signedIn: true,
    membership: { ...member, status: 'expired' },
  });
  assert.equal(expired.tierBadge, 'Membership expired');
  assert.equal(expired.upgrade, null);

  const unpaid = presentMembershipDashboard({
    signedIn: true,
    membership: { ...member, paymentStatus: 'failed' },
  });
  assert.equal(unpaid.tierBadge, 'Base Member');
  assert.equal(unpaid.statusLine, 'Active Membership');
  assert.equal(unpaid.paymentLine, 'Payment failed');
  assert.equal(unpaid.upgrade.paymentEnabled, false);

  const switched = presentMembershipDashboard({
    signedIn: true,
    membership: member,
    account: { resolved: true, isMember: true, memberTier: 'plus' },
  });
  assert.equal(switched.tierBadge, 'Membership status unavailable');
  assert.equal(switched.upgrade, null);
  assert.equal(switched.metrics.every((metric) => metric.available === false), true);

  const zeroPasses = presentMembershipDashboard({
    signedIn: true,
    membership: { ...member, skipTheLinePasses: 0 },
    account: { resolved: true, isMember: true, memberTier: 'base' },
  });
  assert.equal(zeroPasses.metrics.find((metric) => metric.label === 'Skip the Line Passes').value, '0');
});

test('the production membership adapter feeds the dashboard without card data or invented credits', async () => {
  assert.equal(areProductionMembershipDashboardReadsEnabled(), true);

  const card = {
    brand: 'visa',
    last4: '4242',
    expMonth: '12',
    expYear: '2030',
    billingName: 'Jordan Lee',
    billingAddress: {
      line1: '1 Main',
      city: 'Miami',
      region: 'FL',
      postalCode: '33101',
      country: 'US',
    },
  };
  const productionBase = {
    isMember: true,
    tier: 'base',
    status: 'active',
    paymentStatus: 'succeeded',
    cancelAtPeriodEnd: false,
    startedAt: '2026-01-15T00:00:00.000Z',
    currentPeriodEnd: '2027-01-15T00:00:00.000Z',
    recentEvents: [{ id: 4, eventType: 'activated', occurredAt: '2026-01-15T00:00:00.000Z' }],
    paymentMethod: card,
    lastPaidAmountCents: 500000,
    upgradeCreditBalances: { skipTheLine: 4 },
  };
  const account = { resolved: true, isMember: true, memberTier: 'base' };

  const base = adaptProductionMembershipForDashboard(productionBase);
  assert.equal(base.tier, 'base');
  assert.equal(base.skipTheLinePasses, null);
  assert.equal(Object.hasOwn(base, 'paymentMethod'), false);
  assert.equal(JSON.stringify(base).includes('4242'), false);
  assert.equal(JSON.stringify(base).includes('lastPaidAmountCents'), false);
  const baseDashboard = presentMembershipDashboard({
    signedIn: true,
    membership: base,
    account,
  });
  assert.equal(baseDashboard.tierBadge, 'Base Member');
  assert.equal(baseDashboard.statusLine, 'Active Membership');
  assert.equal(baseDashboard.paymentLine, 'Payment confirmed');
  assert.equal(baseDashboard.periodLine, 'Current period ends Jan 15, 2027');
  assert.equal(baseDashboard.statusNote, null);
  assert.equal(baseDashboard.upgrade.paymentEnabled, false);
  assert.equal(baseDashboard.metrics.find((metric) => metric.label === 'Skip the Line Passes').available, false);
  assert.equal(baseDashboard.metrics.find((metric) => metric.label === 'Flights Flown').available, false);
  assert.equal(baseDashboard.metrics.find((metric) => metric.label === 'Total Saved').available, false);
  assert.equal(baseDashboard.annualUsage, null);

  const plus = presentMembershipDashboard({
    signedIn: true,
    membership: adaptProductionMembershipForDashboard({ ...productionBase, tier: 'plus' }),
    account: { resolved: true, isMember: true, memberTier: 'plus' },
  });
  assert.equal(plus.tierBadge, 'Plus Member');
  assert.equal(plus.statusLine, 'Active Membership');
  assert.equal(plus.paymentLine, 'Payment confirmed');
  assert.equal(plus.periodLine, 'Current period ends Jan 15, 2027');
  assert.equal(plus.upgrade, null);

  const pending = presentMembershipDashboard({
    signedIn: true,
    membership: adaptProductionMembershipForDashboard({
      ...productionBase,
      status: 'pending_payment',
      paymentStatus: 'pending',
    }),
    account,
  });
  assert.equal(pending.tierBadge, 'Payment pending');
  assert.equal(pending.upgrade, null);

  const failed = presentMembershipDashboard({
    signedIn: true,
    membership: adaptProductionMembershipForDashboard({ ...productionBase, paymentStatus: 'failed' }),
    account,
  });
  assert.equal(failed.tierBadge, 'Base Member');
  assert.equal(failed.paymentLine, 'Payment failed');
  assert.equal(failed.upgrade.paymentEnabled, false);

  const unpaidActive = presentMembershipDashboard({
    signedIn: true,
    membership: adaptProductionMembershipForDashboard({ ...productionBase, paymentStatus: 'none' }),
    account,
  });
  assert.equal(unpaidActive.tierBadge, 'Base Member');
  assert.equal(unpaidActive.statusLine, 'Active Membership');
  assert.equal(unpaidActive.paymentLine, 'Payment not confirmed');
  assert.equal(unpaidActive.upgrade.paymentEnabled, false);

  const expired = presentMembershipDashboard({
    signedIn: true,
    membership: adaptProductionMembershipForDashboard({ ...productionBase, status: 'expired' }),
    account,
  });
  assert.equal(expired.tierBadge, 'Membership expired');
  assert.equal(expired.upgrade, null);

  const canceled = presentMembershipDashboard({
    signedIn: true,
    membership: adaptProductionMembershipForDashboard({ ...productionBase, status: 'canceled' }),
    account,
  });
  assert.equal(canceled.tierBadge, 'Membership inactive');
  assert.equal(canceled.upgrade, null);

  const missingStatus = { ...productionBase };
  delete missingStatus.status;
  const withoutStatus = presentMembershipDashboard({
    signedIn: true,
    membership: adaptProductionMembershipForDashboard(missingStatus),
    account,
  });
  assert.equal(withoutStatus.tierBadge, 'Membership status unavailable');
  assert.equal(withoutStatus.upgrade, null);

  const missingPayment = { ...productionBase };
  delete missingPayment.paymentStatus;
  const withoutPayment = presentMembershipDashboard({
    signedIn: true,
    membership: adaptProductionMembershipForDashboard(missingPayment),
    account,
  });
  assert.equal(withoutPayment.tierBadge, 'Base Member');
  assert.equal(withoutPayment.paymentLine, null);
  assert.equal(withoutPayment.statusLine, 'Active Membership');
  assert.equal(adaptProductionMembershipForDashboard({ ...productionBase, paymentStatus: 'manual' }), null);
  assert.equal(adaptProductionMembershipForDashboard({ ...productionBase, paymentStatus: 'comped' }), null);
  assert.equal(adaptProductionMembershipForDashboard({ ...productionBase, status: null, paymentStatus: 'succeeded' }).status, null);

  assert.equal(adaptProductionMembershipForDashboard({ ...productionBase, tier: 'family' }), null);
  assert.equal(adaptProductionMembershipForDashboard({ ...productionBase, isMember: false, tier: 'base' }), null);
  assert.equal(adaptProductionMembershipForDashboard({ isMember: true, tier: 'base' }), null);
  const invalidRead = await readApprovedDashboardMembership({
    readMembership: async () => ({ ...productionBase, paymentStatus: 'charged' }),
  });
  assert.deepEqual(invalidRead, { kind: 'invalid' });

  assert.equal(shouldDisplayDashboardMembership({
    signedIn: true,
    membershipClerkUserId: 'user-a',
    activeClerkUserId: 'user-b',
  }), false);
  assert.equal(shouldDisplayDashboardMembership({
    signedIn: false,
    membershipClerkUserId: 'user-a',
    activeClerkUserId: 'user-a',
  }), false);
  const signedOut = presentMembershipDashboard({
    signedIn: false,
    membership: base,
    account,
  });
  assert.equal(signedOut.tierBadge, 'Sign in required');
  assert.equal(signedOut.upgrade, null);

  const missing = presentMembershipDashboard({
    signedIn: true,
    membership: adaptProductionMembershipForDashboard({
      isMember: false,
      tier: null,
      cancelAtPeriodEnd: false,
      recentEvents: [],
      paymentMethod: card,
    }),
  });
  assert.equal(missing.tierBadge, 'Not a member yet');
  assert.equal(missing.upgrade, null);
  assert.equal(missing.statusLine, null);

  assert.equal(adaptProductionMembershipForDashboard({
    ...productionBase,
    currentPeriodEnd: 20270115,
  }), null);
  assert.equal(JSON.stringify(base).includes('internalNote'), false);
  assert.equal(JSON.stringify(adaptProductionMembershipForDashboard({
    ...productionBase,
    internalNote: 'do not show',
    conciergeOnly: true,
  })).includes('internalNote'), false);

  const networkFailure = await readApprovedDashboardMembership({
    readMembership: async () => {
      throw new ProductionAuthNetworkError();
    },
  });
  assert.deepEqual(networkFailure, { kind: 'error', code: 'network' });
  const serverFailure = await readApprovedDashboardMembership({
    readMembership: async () => {
      throw new ProductionAuthHttpError(500, null);
    },
  });
  assert.deepEqual(serverFailure, { kind: 'error', code: 'unavailable' });
  const schemaFailure = await readApprovedDashboardMembership({
    readMembership: async () => {
      throw new ProductionAuthSchemaError('membership.tier');
    },
  });
  assert.deepEqual(schemaFailure, { kind: 'invalid' });

  clearDashboardMembershipCache();
  rememberDashboardMembership({
    environment: 'production',
    apiBaseUrl: 'https://bluebirdjets.com/api',
    clerkUserId: 'user-a',
    membership: base,
    loadedAt: 1_000,
  });
  assert.equal(readFreshDashboardMembership({
    environment: 'production',
    apiBaseUrl: 'https://bluebirdjets.com/api',
    clerkUserId: 'user-b',
    now: 1_000,
  }), null);
  assert.equal(readFreshDashboardMembership({
    environment: 'production',
    apiBaseUrl: 'https://bluebirdjets.com/api',
    clerkUserId: 'user-a',
    now: 1_000,
  }).tier, 'base');
  clearDashboardMembershipCache();
  assert.equal(readFreshDashboardMembership({
    environment: 'production',
    apiBaseUrl: 'https://bluebirdjets.com/api',
    clerkUserId: 'user-a',
    now: 1_000,
  }), null);

  const previousAuthTest = process.env.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST;
  const previousEnvironment = process.env.EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT;
  const previousApi = process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL;
  const previousKey = process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY;
  const previousFetch = globalThis.fetch;
  process.env.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST = 'true';
  process.env.EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT = 'production';
  process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL = 'https://bluebirdjets.com/api';
  process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY = 'pk_live_Y2xlcmsuZXhhbXBsZS5jb20k';
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({
      url: String(url),
      method: init?.method,
      authorization: new Headers(init?.headers).get('authorization'),
      credentials: init?.credentials,
    });
    const tier = requests.length === 1 ? 'base' : 'plus';
    return {
      ok: true,
      status: 200,
      json: async () => ({
        isMember: true,
        tier,
        status: 'active',
        paymentStatus: 'none',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: '2027-01-15T00:00:00.000Z',
        recentEvents: [],
      }),
    };
  };
  let tokenReads = 0;
  try {
    assert.equal(areProductionMembershipDashboardReadsEnabled(), true);
    const configuration = {
      environment: 'production',
      apiBaseUrl: 'https://bluebirdjets.com/api',
      clerkPublishableKey: 'pk_live_Y2xlcmsuZXhhbXBsZS5jb20k',
    };
    const base = await loadDashboardProductionMembership({
      configuration,
      getAccessToken: async () => {
        tokenReads += 1;
        return 'session-token';
      },
    });
    assert.equal(base.kind, 'loaded');
    assert.equal(base.membership.tier, 'base');
    assert.equal(base.membership.status, 'active');
    assert.equal(base.membership.paymentStatus, 'none');
    assert.equal(presentMembershipDashboard({
      signedIn: true,
      membership: base.membership,
      account: { resolved: true, isMember: true, memberTier: 'base' },
    }).tierBadge, 'Base Member');
    const plus = await loadDashboardProductionMembership({
      configuration,
      getAccessToken: async () => {
        tokenReads += 1;
        return 'session-token';
      },
    });
    assert.equal(plus.kind, 'loaded');
    assert.equal(plus.membership.tier, 'plus');
    assert.equal(presentMembershipDashboard({
      signedIn: true,
      membership: plus.membership,
      account: { resolved: true, isMember: true, memberTier: 'plus' },
    }).tierBadge, 'Plus Member');
    assert.equal(requests.length, 2);
    assert.deepEqual(requests, [
      {
        url: 'https://bluebirdjets.com/api/membership',
        method: 'GET',
        authorization: 'Bearer session-token',
        credentials: 'omit',
      },
      {
        url: 'https://bluebirdjets.com/api/membership',
        method: 'GET',
        authorization: 'Bearer session-token',
        credentials: 'omit',
      },
    ]);
    const beforeBlocked = requests.length;
    const missingToken = await loadDashboardProductionMembership({
      configuration,
      getAccessToken: async () => null,
    });
    assert.equal(missingToken.kind, 'not_authenticated');
    assert.equal(requests.length, beforeBlocked);
  } finally {
    globalThis.fetch = previousFetch;
    const restore = (name, value) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore('EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST', previousAuthTest);
    restore('EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT', previousEnvironment);
    restore('EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL', previousApi);
    restore('EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY', previousKey);
  }

  const reader = await readFile(new URL('../lib/membershipDashboardRead.ts', import.meta.url), 'utf8');
  assert.equal(reader.includes('api.getMembership'), true);
  assert.equal(reader.includes('api.getProfile'), true);
  assert.equal(reader.includes('isNativeProductionAuthTestEnabled'), true);
  assert.equal(reader.includes('/mobile/membership'), false);
  assert.equal(reader.includes('/mobile/plans'), false);
  assert.equal(reader.includes('loadPreparedMobileMembership'), false);
  assert.equal(reader.includes('api.getMembership'), true);
  const screen = await readFile(new URL('../app/(tabs)/membership/index.tsx', import.meta.url), 'utf8');
  assert.equal(screen.includes('/api/mobile/membership'), false);
  assert.equal(screen.includes('/api/mobile/plans'), false);
  assert.equal(screen.includes('readApprovedDashboardMembership'), false);
  assert.equal(screen.includes('loadPreparedMobileMembership'), false);
  const policy = await readFile(new URL('../lib/nativeAuthTestPolicy.ts', import.meta.url), 'utf8');
  assert.equal(policy.includes("'/api/membership'"), true);
});

test('the Clerk membership screen keeps the original layout without prototype data or new requests', async () => {
  const source = await readFile(new URL('../app/(tabs)/membership/index.tsx', import.meta.url), 'utf8');
  const clerkBranch = source.indexOf("if (authMode === 'clerk')");
  const demoOverview = source.indexOf('getFullAppDemoMemberOverview()');
  assert.ok(clerkBranch > 0);
  assert.ok(demoOverview > clerkBranch);
  assert.equal(source.includes('loadDashboardProductionMembership'), true);
  assert.equal(source.includes('loadDashboardSkipTheLinePasses'), true);
  assert.equal(source.includes('logMembershipDashboardPresentation'), true);
  assert.ok(source.indexOf('rememberDashboardMembership({') > source.indexOf("loaded.kind === 'invalid'"));
  assert.ok(source.indexOf('rememberDashboardMembership({') > source.indexOf("loaded.kind === 'error'"));
  assert.ok(source.indexOf('rememberDashboardMembership({') > source.indexOf("loaded.kind === 'unavailable'"));
  assert.equal(source.includes('readFreshDashboardMembership'), true);
  assert.equal(source.includes('clearDashboardMembershipCache'), true);
  assert.equal(source.includes('shouldDisplayDashboardMembership'), true);
  assert.equal(source.includes('loadPreparedMobileMembership'), false);
  assert.equal(source.includes('loadClerkBluebirdMembership'), false);
  assert.equal(source.includes('getProfile'), false);
  assert.equal(source.includes('fetchProductionMembershipPlans'), false);
  assert.equal(source.includes("authMode !== 'clerk'"), true);
  assert.equal(source.includes('Bluebird could not load your membership details.'), true);
  const clerkSource = source.slice(clerkBranch, demoOverview);
  assert.equal(clerkSource.includes('presentMembershipDashboard'), true);
  assert.equal(clerkSource.includes('logMembershipDashboardPresentation'), true);
  assert.equal(clerkSource.includes('logMembershipNormalizedFields'), true);
  assert.equal(clerkSource.includes('design.metrics'), true);
  assert.equal(clerkSource.includes('design.upgrade'), false);
  assert.equal(clerkSource.includes('membership-upgrade-soon'), false);
  assert.equal(clerkSource.includes('clerk-membership-upgrade'), false);
  assert.equal(clerkSource.includes('design.statusLine'), false);
  assert.equal(clerkSource.includes('design.paymentLine'), false);
  assert.equal(clerkSource.includes('design.periodLine'), false);
  assert.equal(clerkSource.includes('accessibilityState={{ disabled: true }}'), false);
  assert.equal(clerkSource.includes("color: '#0A1128'"), false);
  assert.equal(source.includes("upgradeBtnText, { color: colors.textOnSurface }"), true);
  assert.equal(clerkSource.includes('getReferrals'), false);
  assert.equal(clerkSource.includes('listTrips'), false);
  for (const label of [
    'AI Concierge',
    'Not available yet',
    'Referral Program',
    'Payment Methods',
    'design.metrics',
    'design.statusNote',
    'membership-settings',
    'memberTier: completedAccount.memberTier',
  ]) {
    assert.equal(clerkSource.includes(label), true, label);
  }
  for (const removed of [
    'Plans',
    'Membership purchases are not available in the app.',
    "This Year's Usage",
    '14 / 20',
    'usageProgress',
    'Upgrade Now',
  ]) {
    assert.equal(clerkSource.includes(removed), false, removed);
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

  const profile = await readFile(new URL('../app/(tabs)/profile/index.tsx', import.meta.url), 'utf8');
  const profileBranch = profile.split("if (authMode === 'clerk') {")[1]?.split('const initials')[0] ?? '';
  assert.equal(profileBranch.includes('presentClerkMembershipDesign'), true);
  assert.equal(profileBranch.includes('membership: null'), true);
  assert.equal(profileBranch.includes('memberTier: memberProjection.memberTier'), true);
  for (const row of [
    'Personal Information',
    'Connect Contacts',
    'Payment Methods',
    'Delete Account',
    'Notification Settings',
    'Appearance',
    'Help Center',
    'Legal',
    'Sign Out',
    "router.push('/account/contacts'",
    "router.push('/account/delete-account'",
    "router.push('/concierge'",
    "router.push('/support/help-center'",
    "router.push('/support/legal'",
  ]) {
    assert.equal(profileBranch.includes(row), true, row);
  }
  assert.equal(profileBranch.includes('Unavailable for this account'), false);
  assert.equal(profileBranch.includes('/api/membership'), false);
});

test('active membership stays visible when payment is not succeeded, and credit cache stays account scoped', async () => {
  const activeBase = {
    isMember: true,
    tier: 'base',
    status: 'active',
    paymentStatus: 'none',
    currentPeriodEnd: '2027-01-15T00:00:00.000Z',
    skipTheLinePasses: null,
  };
  const baseNone = presentMembershipDashboard({
    signedIn: true,
    membership: activeBase,
    account: { resolved: true, isMember: true, memberTier: 'base' },
  });
  assert.equal(baseNone.tierBadge, 'Base Member');
  assert.equal(baseNone.statusLine, 'Active Membership');
  assert.equal(baseNone.paymentLine, 'Payment not confirmed');
  assert.equal(baseNone.periodLine, 'Current period ends Jan 15, 2027');
  assert.equal(baseNone.metrics.find((metric) => metric.label === 'Flights Flown').available, false);
  assert.equal(baseNone.metrics.find((metric) => metric.label === 'Total Saved').available, false);

  const plusNone = presentMembershipDashboard({
    signedIn: true,
    membership: { ...activeBase, tier: 'plus', paymentStatus: 'none' },
    account: { resolved: true, isMember: true, memberTier: 'plus' },
  });
  assert.equal(plusNone.tierBadge, 'Plus Member');
  assert.equal(plusNone.paymentLine, 'Payment not confirmed');
  assert.equal(plusNone.upgrade, null);

  const failed = presentMembershipDashboard({
    signedIn: true,
    membership: { ...activeBase, paymentStatus: 'failed' },
  });
  assert.equal(failed.tierBadge, 'Base Member');
  assert.equal(failed.paymentLine, 'Payment failed');

  const pendingPayment = presentMembershipDashboard({
    signedIn: true,
    membership: { ...activeBase, paymentStatus: 'pending' },
  });
  assert.equal(pendingPayment.tierBadge, 'Base Member');
  assert.equal(pendingPayment.paymentLine, 'Payment pending');

  const inactive = presentMembershipDashboard({
    signedIn: true,
    membership: { ...activeBase, status: 'canceled' },
  });
  assert.equal(inactive.tierBadge, 'Membership inactive');
  assert.equal(inactive.statusLine, null);
  assert.equal(inactive.paymentLine, null);

  const zeroPasses = presentMembershipDashboard({
    signedIn: true,
    membership: { ...activeBase, skipTheLinePasses: 0 },
  });
  assert.equal(zeroPasses.metrics.find((metric) => metric.label === 'Skip the Line Passes').value, '0');
  assert.equal(zeroPasses.metrics.find((metric) => metric.label === 'Skip the Line Passes').available, true);

  assert.deepEqual(readSkipTheLineBalance({ upgradeCreditBalances: { skipTheLine: 0, internationalPass: 1 } }), {
    known: true,
    count: 0,
  });
  assert.equal(readSkipTheLineBalance({ upgradeCreditBalances: { skipTheLine: 1.5 } }).known, false);
  assert.equal(readSkipTheLineBalance({ firstName: 'Ada' }).known, false);

  let tokenReads = 0;
  const cached = await loadDashboardSkipTheLinePasses({
    configuration: {
      environment: 'production',
      apiBaseUrl: 'https://bluebirdjets.com/api',
      clerkPublishableKey: 'pk_live_example',
    },
    cachedProfiles: [{ upgradeCreditBalances: { skipTheLine: 0, internationalPass: 3 } }],
    getAccessToken: async () => {
      tokenReads += 1;
      return 'mock-only-token-never-log';
    },
  });
  assert.deepEqual(cached, { kind: 'loaded', count: 0 });
  assert.equal(tokenReads, 0);

  clearDashboardMembershipCache();
  rememberSkipTheLinePasses({
    environment: 'production',
    apiBaseUrl: 'https://bluebirdjets.com/api',
    clerkUserId: 'user-a',
    count: 0,
    loadedAt: 1_000,
  });
  retainDashboardMembershipForAccount('user-b');
  assert.equal(readFreshSkipTheLinePasses({
    environment: 'production',
    apiBaseUrl: 'https://bluebirdjets.com/api',
    clerkUserId: 'user-a',
    now: 1_000,
  }), null);
  rememberSkipTheLinePasses({
    environment: 'production',
    apiBaseUrl: 'https://bluebirdjets.com/api',
    clerkUserId: 'user-b',
    count: 2,
    loadedAt: 1_000,
  });
  clearDashboardMembershipCache();
  assert.equal(readFreshSkipTheLinePasses({
    environment: 'production',
    apiBaseUrl: 'https://bluebirdjets.com/api',
    clerkUserId: 'user-b',
    now: 1_000,
  }), null);

  const previousAuthTest = process.env.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST;
  process.env.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST = 'true';
  try {
    const blocked = await loadDashboardSkipTheLinePasses({
      configuration: {
        environment: 'production',
        apiBaseUrl: 'https://bluebirdjets.com/api',
        clerkPublishableKey: 'pk_live_example',
      },
      getAccessToken: async () => {
        tokenReads += 1;
        return 'mock-only-token-never-log';
      },
    });
    assert.deepEqual(blocked, { kind: 'unavailable' });
    assert.equal(tokenReads, 0);
  } finally {
    if (previousAuthTest === undefined) delete process.env.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST;
    else process.env.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST = previousAuthTest;
  }
});

test('normalized membership fields log only the four allowlisted values', () => {
  const activeUnpaid = adaptProductionMembershipForDashboard({
    isMember: true,
    tier: 'plus',
    status: 'active',
    paymentStatus: 'none',
    cancelAtPeriodEnd: false,
    currentPeriodEnd: '2027-01-15T00:00:00.000Z',
  });
  const fields = membershipNormalizedFieldRecord(activeUnpaid);
  assert.deepEqual(fields, {
    isMember: 'true',
    tier: 'plus',
    status: 'active',
    paymentStatus: 'none',
  });
  const rejected = membershipNormalizedFieldRecord({
    isMember: true,
    tier: 'family',
    status: 'complimentary',
    paymentStatus: 'manual',
  });
  assert.deepEqual(rejected, {
    isMember: 'true',
    tier: 'rejected',
    status: 'rejected',
    paymentStatus: 'rejected',
  });
  assert.equal(JSON.stringify(rejected).includes('family'), false);
  assert.equal(JSON.stringify(rejected).includes('complimentary'), false);
  assert.equal(JSON.stringify(rejected).includes('manual'), false);

  const logs = [];
  const original = console.info;
  console.info = (...args) => {
    logs.push(args.map((part) => String(part)).join(' '));
  };
  const previousDev = globalThis.__DEV__;
  globalThis.__DEV__ = true;
  try {
    logMembershipNormalizedFields(activeUnpaid);
    logMembershipNormalizedFields({
      ...activeUnpaid,
      paymentStatus: '1 Main St',
    });
  } finally {
    console.info = original;
    if (previousDev === undefined) delete globalThis.__DEV__;
    else globalThis.__DEV__ = previousDev;
  }
  assert.deepEqual(logs, [
    '[bluebird-membership-fields] isMember=true tier=plus status=active paymentStatus=none',
    '[bluebird-membership-fields] isMember=true tier=plus status=active paymentStatus=rejected',
  ]);
  assert.equal(logs.join('\n').includes('Main St'), false);
  assert.equal(logs.join('\n').includes('Authorization'), false);
});

test('membership diagnostics record the request outcome without secrets or a cached failure', async () => {
  const schemaField = membershipDiagnostic({
    requestAttempted: true,
    environment: 'production',
    failure: 'schema',
    tokenAvailable: true,
    httpStatus: 200,
    parseSucceeded: false,
    schemaField: 'membership.recentEvents[0].eventType',
    presentation: 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
    loadKind: 'error',
  });
  assert.equal(schemaField.schemaField, 'membership.recentEvents[0].eventType');
  assert.equal(schemaField.presentation, null);
  assert.equal(schemaField.tokenAvailable, true);
  assert.equal(JSON.stringify(schemaField).includes('eyJ'), false);
  assert.equal(JSON.stringify(schemaField).includes('payload'), false);

  const hiddenAddress = membershipDiagnostic({
    requestAttempted: true,
    environment: 'production',
    failure: 'schema',
    schemaField: '1 Main St',
    presentation: 'Payment not confirmed',
  });
  assert.equal(hiddenAddress.schemaField, null);
  assert.equal(hiddenAddress.presentation, 'Payment not confirmed');
  assert.equal(JSON.stringify(hiddenAddress).includes('Main St'), false);

  const classified = classifyMembershipReadError(new ProductionAuthSchemaError('membership.paymentStatus'));
  assert.equal(classified.failure, 'schema');
  assert.equal(classified.schemaField, 'membership.paymentStatus');
  assert.deepEqual(classified.result, { kind: 'invalid' });
  const http = classifyMembershipReadError(new ProductionAuthHttpError(500, { card: '4242' }));
  assert.equal(http.failure, 'http');
  assert.equal(http.httpStatus, 500);
  assert.deepEqual(http.result, { kind: 'error', code: 'unavailable' });
  assert.equal(JSON.stringify(http).includes('4242'), false);

  clearDashboardMembershipCache();
  let tokenReads = 0;
  const blocked = await loadDashboardProductionMembership({
    configuration: null,
    getAccessToken: async () => {
      tokenReads += 1;
      return 'mock-only-token-never-log';
    },
  });
  assert.deepEqual(blocked, { kind: 'unavailable' });
  assert.equal(tokenReads, 0);
  assert.equal(readFreshDashboardMembership({
    environment: 'production',
    apiBaseUrl: 'https://bluebirdjets.com/api',
    clerkUserId: 'user-a',
    now: Date.now(),
  }), null);

  const logs = [];
  const original = console.info;
  console.info = (...args) => {
    logs.push(args.map((part) => String(part)).join(' '));
  };
  const previousDev = globalThis.__DEV__;
  globalThis.__DEV__ = true;
  try {
    logMembershipDashboardDiagnostic(membershipDiagnostic({
      requestAttempted: true,
      environment: 'production',
      failure: 'http',
      httpStatus: 503,
      tokenAvailable: true,
      presentation: 'Membership status unavailable',
    }));
    retainDashboardMembershipForAccount('user-b');
    logMembershipDashboardPresentation('loaded', 'Base Member');
  } finally {
    console.info = original;
    clearDashboardMembershipCache();
    if (previousDev === undefined) delete globalThis.__DEV__;
    else globalThis.__DEV__ = previousDev;
  }
  assert.equal(logs.some((line) => line.includes('httpStatus=503')), true);
  const isolated = logs.at(-1);
  assert.equal(isolated.includes('requestAttempted=false'), true);
  assert.equal(isolated.includes('httpStatus=none'), true);
  assert.equal(isolated.includes('presentation=Base Member'), true);
  assert.equal(isolated.includes('503'), false);
  assert.equal(logs.join('\n').includes('Authorization'), false);
  assert.equal(logs.join('\n').includes('mock-only-token'), false);
});

test('membership waits to load, then separates an empty account from an error', () => {
  assert.equal(membershipDashboardPhase({
    sessionLoaded: false,
    signedIn: false,
    load: 'not_authenticated',
  }), 'loading');
  assert.equal(membershipDashboardPhase({
    sessionLoaded: true,
    signedIn: true,
    load: 'loading',
  }), 'loading');
  assert.equal(membershipDashboardPhase({
    sessionLoaded: true,
    signedIn: true,
    load: 'unavailable',
  }), 'empty');
  assert.equal(membershipDashboardPhase({
    sessionLoaded: true,
    signedIn: true,
    load: 'error',
  }), 'error');
  assert.equal(membershipDashboardPhase({
    sessionLoaded: true,
    signedIn: false,
    load: 'not_authenticated',
  }), 'signed-out');
  assert.equal(membershipDashboardPhase({
    sessionLoaded: true,
    signedIn: true,
    load: 'loaded',
  }), 'ready');
});
