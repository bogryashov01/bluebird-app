import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  ACCOUNT_DELETION_CONFIRMATION_WORD,
  ACCOUNT_DELETION_FLAG,
  ACCOUNT_DELETION_PATH,
  ACCOUNT_DELETION_STATUS_PATH,
  accountDeletionResultForReverification,
  createAccountDeletionClient,
  isAccountDeletionConfirmationValid,
  isAccountDeletionEligible,
  isAccountDeletionMutationEnabled,
  isAccountDeletionReverificationHint,
  parseAccountDeletionEligibility,
  parseAccountDeletionResponse,
  parseAccountDeletionStatus,
  presentAccountDeletionFailure,
} from '../scripts/.account-deletion.test.mjs';
import {
  attemptAccountDeletionPhoneReverification,
  prepareAccountDeletionPhoneReverification,
  selectPhoneCodeReverificationFactor,
} from '../scripts/.account-deletion-phone-reverification.test.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('account deletion mutations stay off until the release flag is exactly true', () => {
  assert.equal(ACCOUNT_DELETION_FLAG, 'EXPO_PUBLIC_BLUEBIRD_ACCOUNT_DELETION');
  assert.equal(ACCOUNT_DELETION_PATH, '/me/account-deletion');
  assert.equal(ACCOUNT_DELETION_STATUS_PATH, '/me/account-deletion/status');
  assert.equal(isAccountDeletionMutationEnabled({ flag: undefined, nativeAuthTest: false }), false);
  assert.equal(isAccountDeletionMutationEnabled({ flag: 'false', nativeAuthTest: false }), false);
  assert.equal(isAccountDeletionMutationEnabled({ flag: 'true', nativeAuthTest: true }), false);
  assert.equal(isAccountDeletionMutationEnabled({ flag: 'true', nativeAuthTest: false }), true);
});

test('GET eligibility matches enabled/blockers/membership acknowledgement contract', () => {
  assert.deepEqual(parseAccountDeletionEligibility({
    enabled: true,
    blockers: [],
    requiresMembershipCancellationAcknowledgement: false,
  }), {
    enabled: true,
    blockers: [],
    requiresMembershipCancellationAcknowledgement: false,
  });

  const blockedDespiteEnabled = parseAccountDeletionEligibility({
    enabled: true,
    blockers: [{ code: 'active_trip' }, 'retention_hold'],
    requiresMembershipCancellationAcknowledgement: true,
  });
  assert.equal(blockedDespiteEnabled.enabled, true);
  assert.deepEqual(blockedDespiteEnabled.blockers, [
    { code: 'active_trip' },
    { code: 'retention_hold' },
  ]);
  assert.equal(blockedDespiteEnabled.requiresMembershipCancellationAcknowledgement, true);
  assert.equal(isAccountDeletionEligible(blockedDespiteEnabled), false);

  assert.equal(isAccountDeletionEligible({
    enabled: true,
    blockers: [],
    requiresMembershipCancellationAcknowledgement: true,
  }), true);
  assert.equal(isAccountDeletionEligible({
    enabled: false,
    blockers: [],
    requiresMembershipCancellationAcknowledgement: false,
  }), false);

  assert.throws(() => parseAccountDeletionEligibility({
    enabled: true,
    blockers: [],
  }));
});

test('typed confirmation requires DELETE and POST/status parsers stay strict', () => {
  assert.equal(isAccountDeletionConfirmationValid('DELETE'), true);
  assert.equal(isAccountDeletionConfirmationValid(' delete '), true);
  assert.equal(isAccountDeletionConfirmationValid('DEL'), false);
  assert.equal(ACCOUNT_DELETION_CONFIRMATION_WORD, 'DELETE');

  assert.deepEqual(parseAccountDeletionResponse({ status: 'completed' }), { kind: 'completed' });
  assert.deepEqual(parseAccountDeletionResponse({
    status: 'pending',
    requestId: 'req_1',
    retryable: true,
    message: 'Still working.',
  }), {
    kind: 'pending',
    requestId: 'req_1',
    retryable: true,
    message: 'Still working.',
  });
  assert.deepEqual(parseAccountDeletionResponse({
    status: 'processing',
    requestId: 'req_2',
    retryable: false,
    supportMessage: 'Contact support.',
  }), {
    kind: 'pending',
    requestId: 'req_2',
    retryable: false,
    message: 'Contact support.',
  });
  assert.throws(() => parseAccountDeletionResponse({ status: 'ok' }));

  assert.deepEqual(parseAccountDeletionStatus({ status: 'not_requested' }), { kind: 'not_requested' });
  assert.deepEqual(parseAccountDeletionStatus({ status: 'completed' }), { kind: 'completed' });
  assert.deepEqual(parseAccountDeletionStatus({
    status: 'pending',
    requestId: 'req_status',
    retryable: false,
    message: 'Working.',
  }), {
    kind: 'pending',
    requestId: 'req_status',
    retryable: false,
    message: 'Working.',
  });
});

test('failure copy never claims the account was deleted', () => {
  for (const code of [
    'disabled',
    'unauthorized',
    'forbidden',
    'self_service_only',
    'invalid_body',
    'conflict',
    'blocked',
    'membership_ack_required',
    'locked',
    'network',
    'server',
    'unavailable',
    'configuration',
    'token',
    'invalid_response',
    'cancelled',
    'reverification_cancelled',
    'reverification_unavailable',
  ]) {
    const copy = presentAccountDeletionFailure({
      code,
      conflictCode: code === 'conflict' ? 'account_deletion_blocked' : null,
      retryable: code === 'unavailable',
    });
    assert.match(copy.body, /not deleted|not changed|remain|stay signed|not available/i);
    assert.doesNotMatch(copy.body, /has been deleted|account deleted successfully/i);
  }
});

test('disabled client never fetches account-deletion endpoints', async () => {
  let called = false;
  const client = createAccountDeletionClient({
    environment: 'production',
    baseUrl: 'https://bluebirdjets.com/api',
    enabled: false,
    nativeAuthTest: false,
    getAccessToken: async () => 'token',
    fetcher: async () => {
      called = true;
      throw new Error('fetch must not run');
    },
  });
  assert.equal(client.isMutationEnabled, false);
  assert.deepEqual(await client.deleteAccount({
    confirmation: 'DELETE',
    acknowledgeMembershipCancellation: false,
  }), { kind: 'disabled' });
  assert.deepEqual(await client.getEligibility(), { kind: 'disabled' });
  assert.deepEqual(await client.getStatus(), { kind: 'disabled' });
  assert.equal(called, false);
});

test('POST body sends only confirmation and acknowledgeMembershipCancellation', async () => {
  let body = null;
  const client = createAccountDeletionClient({
    environment: 'development',
    baseUrl: 'https://api.example.test/api',
    enabled: true,
    nativeAuthTest: false,
    getAccessToken: async () => 'clerk-token',
    fetcher: async (_url, init) => {
      body = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ status: 'completed' });
        },
        async json() {
          return { status: 'completed' };
        },
      };
    },
  });
  const result = await client.deleteAccount({
    confirmation: 'DELETE',
    acknowledgeMembershipCancellation: true,
  });
  assert.deepEqual(result, { kind: 'loaded', data: { kind: 'completed' } });
  assert.deepEqual(body, {
    confirmation: 'DELETE',
    acknowledgeMembershipCancellation: true,
  });
  assert.equal(Object.keys(body).length, 2);
});

test('mocked POST success, pending, auth, conflict, reverification, and service results stay typed', async () => {
  const responses = [
    {
      status: 200,
      body: { status: 'completed' },
      expected: {
        kind: 'loaded',
        data: { kind: 'completed' },
      },
    },
    {
      status: 202,
      body: {
        status: 'pending',
        requestId: 'del_9',
        retryable: false,
        message: 'Still working.',
      },
      expected: {
        kind: 'loaded',
        data: {
          kind: 'pending',
          requestId: 'del_9',
          retryable: false,
          message: 'Still working.',
        },
      },
    },
    {
      status: 400,
      body: { code: 'invalid_body' },
      expected: {
        kind: 'error',
        code: 'invalid_body',
        conflictCode: 'invalid_body',
        retryable: true,
      },
    },
    {
      status: 401,
      body: { code: 'unauthorized' },
      expected: {
        kind: 'error',
        code: 'unauthorized',
        conflictCode: null,
        retryable: false,
      },
    },
    {
      status: 403,
      body: { code: 'self_service_only' },
      expected: {
        kind: 'error',
        code: 'self_service_only',
        conflictCode: 'self_service_only',
        retryable: false,
      },
    },
    {
      status: 403,
      body: {
        clerk_error: {
          type: 'forbidden',
          reason: 'reverification-error',
          metadata: { reverification: 'strict' },
        },
      },
      expected: {
        kind: 'needs_reverification',
        hint: {
          clerk_error: {
            type: 'forbidden',
            reason: 'reverification-error',
            metadata: { reverification: 'strict' },
          },
        },
      },
    },
    {
      status: 409,
      body: { code: 'account_deletion_blocked' },
      expected: {
        kind: 'error',
        code: 'conflict',
        conflictCode: 'account_deletion_blocked',
        retryable: false,
      },
    },
    {
      status: 409,
      body: { code: 'membership_cancellation_confirmation_required' },
      expected: {
        kind: 'error',
        code: 'membership_ack_required',
        conflictCode: 'membership_cancellation_confirmation_required',
        retryable: true,
      },
    },
    {
      status: 503,
      body: { code: 'unavailable' },
      expected: {
        kind: 'error',
        code: 'unavailable',
        conflictCode: 'unavailable',
        retryable: true,
      },
    },
    {
      status: 404,
      body: { code: 'not_found' },
      expected: {
        kind: 'error',
        code: 'unavailable',
        conflictCode: 'not_found',
        retryable: false,
      },
    },
    {
      status: 501,
      body: { code: 'not_implemented' },
      expected: {
        kind: 'error',
        code: 'unavailable',
        conflictCode: 'not_implemented',
        retryable: false,
      },
    },
  ];

  for (const sample of responses) {
    const client = createAccountDeletionClient({
      environment: 'development',
      baseUrl: 'https://api.example.test/api',
      enabled: true,
      nativeAuthTest: false,
      getAccessToken: async () => 'clerk-token',
      fetcher: async (url, init) => {
        assert.equal(String(url), 'https://api.example.test/api/me/account-deletion');
        assert.equal(init.method, 'POST');
        assert.equal(init.credentials, 'omit');
        assert.match(init.headers.Authorization, /^Bearer clerk-token$/);
        const payload = JSON.parse(init.body);
        assert.deepEqual(payload, {
          confirmation: 'DELETE',
          acknowledgeMembershipCancellation: false,
        });
        return {
          ok: sample.status >= 200 && sample.status < 300,
          status: sample.status,
          async text() {
            return JSON.stringify(sample.body);
          },
          async json() {
            return sample.body;
          },
        };
      },
    });
    const result = await client.deleteAccount({
      confirmation: 'DELETE',
      acknowledgeMembershipCancellation: false,
    });
    assert.deepEqual(result, sample.expected);
  }
});

test('eligibility and status GETs use the finalized account-deletion contracts', async () => {
  const eligibilityClient = createAccountDeletionClient({
    environment: 'development',
    baseUrl: 'https://api.example.test/api',
    enabled: true,
    nativeAuthTest: false,
    getAccessToken: async () => 'clerk-token',
    fetcher: async (url, init) => {
      assert.equal(String(url), 'https://api.example.test/api/me/account-deletion');
      assert.equal(init.method, 'GET');
      assert.equal(init.body, undefined);
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            enabled: true,
            blockers: [],
            requiresMembershipCancellationAcknowledgement: true,
          });
        },
        async json() {
          return {
            enabled: true,
            blockers: [],
            requiresMembershipCancellationAcknowledgement: true,
          };
        },
      };
    },
  });
  assert.deepEqual(await eligibilityClient.getEligibility(), {
    kind: 'loaded',
    data: {
      enabled: true,
      blockers: [],
      requiresMembershipCancellationAcknowledgement: true,
    },
  });

  for (const sample of [
    {
      status: 423,
      body: { code: 'locked' },
      expected: { kind: 'error', code: 'locked', retryable: false },
    },
    {
      status: 503,
      body: { code: 'unavailable' },
      expected: { kind: 'error', code: 'unavailable', retryable: true },
    },
    {
      status: 404,
      body: { code: 'not_found' },
      expected: { kind: 'error', code: 'unavailable', retryable: false },
    },
  ]) {
    const client = createAccountDeletionClient({
      environment: 'development',
      baseUrl: 'https://api.example.test/api',
      enabled: true,
      nativeAuthTest: false,
      getAccessToken: async () => 'clerk-token',
      fetcher: async () => ({
        ok: false,
        status: sample.status,
        async text() {
          return JSON.stringify(sample.body);
        },
        async json() {
          return sample.body;
        },
      }),
    });
    assert.deepEqual(await client.getEligibility(), sample.expected);
  }

  const statusClient = createAccountDeletionClient({
    environment: 'development',
    baseUrl: 'https://api.example.test/api',
    enabled: true,
    nativeAuthTest: false,
    getAccessToken: async () => 'clerk-token',
    fetcher: async (url, init) => {
      assert.equal(String(url), 'https://api.example.test/api/me/account-deletion/status');
      assert.equal(init.method, 'GET');
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            status: 'pending',
            requestId: 'del_status',
            retryable: false,
            message: 'Working.',
          });
        },
        async json() {
          return {
            status: 'pending',
            requestId: 'del_status',
            retryable: false,
            message: 'Working.',
          };
        },
      };
    },
  });
  assert.deepEqual(await statusClient.getStatus(), {
    kind: 'loaded',
    data: {
      kind: 'pending',
      requestId: 'del_status',
      retryable: false,
      message: 'Working.',
    },
  });
});

test('reverification hint adapter returns the raw clerk_error for useReverification', () => {
  const hint = {
    clerk_error: {
      type: 'forbidden',
      reason: 'reverification-error',
      metadata: { reverification: 'strict' },
    },
  };
  assert.equal(isAccountDeletionReverificationHint(hint), true);
  assert.deepEqual(
    accountDeletionResultForReverification({ kind: 'needs_reverification', hint }),
    hint,
  );
  assert.deepEqual(
    accountDeletionResultForReverification({
      kind: 'loaded',
      data: { kind: 'completed' },
    }),
    {
      kind: 'loaded',
      data: { kind: 'completed' },
    },
  );
});

test('network failures stay retryable and do not look like success', async () => {
  const client = createAccountDeletionClient({
    environment: 'development',
    baseUrl: 'https://api.example.test/api',
    enabled: true,
    nativeAuthTest: false,
    getAccessToken: async () => 'clerk-token',
    fetcher: async () => {
      throw new TypeError('Failed to fetch');
    },
  });
  const result = await client.deleteAccount({
    confirmation: 'DELETE',
    acknowledgeMembershipCancellation: false,
  });
  assert.deepEqual(result, {
    kind: 'error',
    code: 'network',
    conflictCode: null,
    retryable: true,
  });
  const copy = presentAccountDeletionFailure(result);
  assert.equal(copy.canRetry, true);
});

test('phone OTP session reverification helpers prepare and attempt phone_code only', async () => {
  assert.deepEqual(selectPhoneCodeReverificationFactor([
    { strategy: 'password' },
    { strategy: 'phone_code', phoneNumberId: 'idn_phone', safeIdentifier: '+1••••0100' },
  ]), {
    strategy: 'phone_code',
    phoneNumberId: 'idn_phone',
    safeIdentifier: '+1••••0100',
  });

  const calls = [];
  const session = {
    async startVerification(params) {
      calls.push(['start', params]);
      return {
        status: 'needs_first_factor',
        supportedFirstFactors: [
          { strategy: 'phone_code', phoneNumberId: 'idn_phone', safeIdentifier: '+1••••0100' },
        ],
      };
    },
    async prepareFirstFactorVerification(params) {
      calls.push(['prepare-first', params]);
      return { status: 'needs_first_factor' };
    },
    async attemptFirstFactorVerification(params) {
      calls.push(['attempt-first', params]);
      return { status: 'complete' };
    },
  };

  const prepared = await prepareAccountDeletionPhoneReverification({
    session,
    level: 'first_factor',
  });
  assert.deepEqual(prepared, {
    kind: 'prepared',
    stage: 'first_factor',
    phoneNumberId: 'idn_phone',
    safeIdentifier: '+1••••0100',
  });

  const attempted = await attemptAccountDeletionPhoneReverification({
    session,
    stage: 'first_factor',
    code: '123456',
  });
  assert.deepEqual(attempted, { kind: 'complete' });
  assert.deepEqual(calls, [
    ['start', { level: 'first_factor' }],
    ['prepare-first', { strategy: 'phone_code', phoneNumberId: 'idn_phone' }],
    ['attempt-first', { strategy: 'phone_code', code: '123456' }],
  ]);
});

test('production-live-internal enables account deletion without disabling other live gates', () => {
  const eas = JSON.parse(readFileSync(resolve(projectRoot, 'eas.json'), 'utf8'));
  const live = eas.build['production-live-internal'].env;
  assert.equal(live.EXPO_PUBLIC_BLUEBIRD_ACCOUNT_DELETION, 'true');
  assert.equal(live.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST, 'false');
  assert.equal(live.EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH, 'true');
  assert.equal(live.EXPO_PUBLIC_BLUEBIRD_MEMBER_CONNECTIONS, 'true');
  assert.equal(live.EXPO_PUBLIC_BLUEBIRD_MEMBER_MESSAGES, 'true');
  assert.equal(live.EXPO_PUBLIC_BLUEBIRD_PUSH_REGISTRATION, 'true');
  assert.equal(live.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_QUEUE_MUTATIONS, 'true');
  assert.notEqual(
    eas.build['production-live-journey-internal'].env.EXPO_PUBLIC_BLUEBIRD_ACCOUNT_DELETION,
    'false',
  );
});

test('Profile opens Delete Account after Alert and the screen never deletes Clerk users locally', () => {
  const profile = readFileSync(resolve(projectRoot, 'app/(tabs)/profile/index.tsx'), 'utf8');
  const clerkProfile = profile
    .split("if (authMode === 'clerk') {")[1]
    ?.split('const initials')[0] ?? '';
  const screen = readFileSync(resolve(projectRoot, 'app/account/delete-account.tsx'), 'utf8');
  const layout = readFileSync(resolve(projectRoot, 'app/_layout.tsx'), 'utf8');
  const auth = readFileSync(resolve(projectRoot, 'context/AuthContext.tsx'), 'utf8');
  const client = readFileSync(resolve(projectRoot, 'lib/accountDeletion.ts'), 'utf8');
  const phoneHelper = readFileSync(resolve(projectRoot, 'lib/accountDeletionPhoneReverification.ts'), 'utf8');

  assert.match(screen, /eligibility\.code === 'unavailable'/);
  assert.match(screen, /setPhase\(\{ kind: 'unavailable' \}\)/);
  assert.match(client, /error\.status === 404/);

  assert.match(profile, /confirmOpenDeleteAccount/);
  assert.match(profile, /confirmDialog\(/);
  assert.match(clerkProfile, /confirmOpenDeleteAccount/);
  assert.match(clerkProfile, /label: 'Delete Account'/);
  assert.match(clerkProfile, /testID: 'clerk-delete-account'/);
  assert.match(profile, /router\.push\('\/account\/delete-account'/);
  assert.match(clerkProfile, /label: 'Sign Out'/);
  assert.ok(clerkProfile.indexOf("label: 'Sign Out'") < clerkProfile.indexOf("label: 'Delete Account'"));
  assert.match(layout, /name="account\/delete-account"/);
  assert.match(screen, /testID="delete-account-screen"/);
  assert.match(screen, /testID="delete-account-confirmation-input"/);
  assert.match(screen, /testID="delete-account-submit"/);
  assert.match(screen, /testID="delete-account-cancel"/);
  assert.match(screen, /testID="delete-account-membership-ack"/);
  assert.match(screen, /requiresMembershipAck/);
  assert.match(screen, /acknowledgeMembershipCancellation/);
  assert.match(screen, /useReverification/);
  assert.match(screen, /onNeedsReverification/);
  assert.match(screen, /skipCache:\s*true/);
  assert.match(screen, /AccountDeletionPhoneReverificationModal/);
  assert.match(screen, /isAccountDeletionMutationEnabled/);
  assert.match(screen, /await signOut\(\)/);
  assert.match(screen, /kind: 'completed'/);
  assert.ok(screen.indexOf("kind: 'completed'") < screen.indexOf('await signOut()'));
  // Regression: a sign-out failure after confirmed deletion must not fall into
  // submitDeletion's catch ("Your account was not deleted" + retry).
  const applyCompletedBlock = screen.slice(
    screen.indexOf('const applyCompleted = useCallback'),
    screen.indexOf('const loadEligibility = useCallback'),
  );
  assert.match(applyCompletedBlock, /try \{\s*await signOut\(\);\s*\} catch/);
  assert.match(applyCompletedBlock, /router\.replace\('\/\(auth\)\/welcome'\)/);
  assert.doesNotMatch(screen, /users\.deleteUser|deleteUser\(|clerk\.user\.delete|client\.users/);
  assert.doesNotMatch(client, /users\.deleteUser|deleteUser\(|clerk\.user\.delete/);
  assert.doesNotMatch(client, /method: 'DELETE'/);
  assert.match(client, /ACCOUNT_DELETION_FLAG/);
  assert.match(client, /method: 'POST'/);
  assert.match(client, /acknowledgeMembershipCancellation/);
  assert.match(client, /requiresMembershipCancellationAcknowledgement/);
  assert.match(client, /ACCOUNT_DELETION_PATH/);
  assert.match(client, /ACCOUNT_DELETION_STATUS_PATH/);
  assert.match(phoneHelper, /prepareFirstFactorVerification/);
  assert.match(phoneHelper, /attemptFirstFactorVerification/);
  assert.match(phoneHelper, /phone_code/);
  assert.match(auth, /await clerkSession\?\.signOut\(\)/);
});
