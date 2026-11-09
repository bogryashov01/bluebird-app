import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  ACCOUNT_DELETION_CONFIRMATION_WORD,
  ACCOUNT_DELETION_FLAG,
  ACCOUNT_DELETION_PATH,
  createAccountDeletionClient,
  isAccountDeletionConfirmationValid,
  isAccountDeletionMutationEnabled,
  parseAccountDeletionResponse,
  presentAccountDeletionFailure,
} from '../scripts/.account-deletion.test.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('account deletion mutations stay off until the release flag is exactly true', () => {
  assert.equal(ACCOUNT_DELETION_FLAG, 'EXPO_PUBLIC_BLUEBIRD_ACCOUNT_DELETION');
  assert.equal(ACCOUNT_DELETION_PATH, '/me/account');
  assert.equal(isAccountDeletionMutationEnabled({ flag: undefined, nativeAuthTest: false }), false);
  assert.equal(isAccountDeletionMutationEnabled({ flag: 'false', nativeAuthTest: false }), false);
  assert.equal(isAccountDeletionMutationEnabled({ flag: 'true', nativeAuthTest: true }), false);
  assert.equal(isAccountDeletionMutationEnabled({ flag: 'true', nativeAuthTest: false }), true);
});

test('typed confirmation requires DELETE and response parsing stays strict', () => {
  assert.equal(isAccountDeletionConfirmationValid('DELETE'), true);
  assert.equal(isAccountDeletionConfirmationValid(' delete '), true);
  assert.equal(isAccountDeletionConfirmationValid('delete'), true);
  assert.equal(isAccountDeletionConfirmationValid('DEL'), false);
  assert.equal(ACCOUNT_DELETION_CONFIRMATION_WORD, 'DELETE');

  assert.deepEqual(parseAccountDeletionResponse({
    status: 'deleted',
    deletedAt: '2026-11-06T12:00:00.000Z',
  }), {
    kind: 'deleted',
    deletedAt: '2026-11-06T12:00:00.000Z',
  });
  assert.deepEqual(parseAccountDeletionResponse({
    status: 'pending',
    deletionId: 'del_1',
  }), {
    kind: 'pending',
    deletionId: 'del_1',
    message: 'Your account deletion is still processing. You stay signed in until it finishes.',
  });
  assert.throws(() => parseAccountDeletionResponse({ status: 'ok' }));
});

test('failure copy never claims the account was deleted', () => {
  for (const code of [
    'disabled',
    'unauthorized',
    'forbidden',
    'conflict',
    'network',
    'server',
    'configuration',
    'token',
    'invalid_response',
    'cancelled',
  ]) {
    const copy = presentAccountDeletionFailure({ code, conflictCode: code === 'conflict' ? 'active_trip' : null });
    assert.match(copy.body, /not deleted|not changed|remain|stay signed|not available/i);
    assert.doesNotMatch(copy.body, /has been deleted|account deleted successfully/i);
  }
});

test('disabled client never fetches DELETE /me/account', async () => {
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
  const result = await client.deleteAccount({ confirmation: 'DELETE' });
  assert.deepEqual(result, { kind: 'disabled' });
  assert.equal(called, false);
});

test('mocked success, pending, auth, conflict, and server results stay typed', async () => {
  const responses = [
    {
      status: 200,
      body: { status: 'deleted', deletedAt: '2026-11-06T12:00:00.000Z' },
      expected: {
        kind: 'loaded',
        data: { kind: 'deleted', deletedAt: '2026-11-06T12:00:00.000Z' },
      },
    },
    {
      status: 202,
      body: { status: 'pending', deletionId: 'del_9', message: 'Still working.' },
      expected: {
        kind: 'loaded',
        data: { kind: 'pending', deletionId: 'del_9', message: 'Still working.' },
      },
    },
    {
      status: 401,
      body: { code: 'unauthorized' },
      expected: { kind: 'error', code: 'unauthorized', conflictCode: null },
    },
    {
      status: 403,
      body: { code: 'forbidden' },
      expected: { kind: 'error', code: 'forbidden', conflictCode: null },
    },
    {
      status: 409,
      body: { code: 'active_trip' },
      expected: { kind: 'error', code: 'conflict', conflictCode: 'active_trip' },
    },
    {
      status: 503,
      body: { code: 'unavailable' },
      expected: { kind: 'error', code: 'server', conflictCode: null },
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
        assert.equal(String(url), 'https://api.example.test/api/me/account');
        assert.equal(init.method, 'DELETE');
        assert.equal(init.credentials, 'omit');
        assert.match(init.headers.Authorization, /^Bearer clerk-token$/);
        assert.equal(JSON.parse(init.body).confirmation, 'DELETE');
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
    const result = await client.deleteAccount({ confirmation: 'DELETE' });
    assert.deepEqual(result, sample.expected);
  }
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
  const result = await client.deleteAccount({ confirmation: 'DELETE' });
  assert.deepEqual(result, { kind: 'error', code: 'network', conflictCode: null });
  const copy = presentAccountDeletionFailure(result);
  assert.equal(copy.canRetry, true);
});

test('Profile opens Delete Account and the screen never deletes Clerk users locally', () => {
  const profile = readFileSync(resolve(projectRoot, 'app/(tabs)/profile/index.tsx'), 'utf8');
  const clerkProfile = profile
    .split("if (authMode === 'clerk') {")[1]
    ?.split('const initials')[0] ?? '';
  const screen = readFileSync(resolve(projectRoot, 'app/account/delete-account.tsx'), 'utf8');
  const layout = readFileSync(resolve(projectRoot, 'app/_layout.tsx'), 'utf8');
  const auth = readFileSync(resolve(projectRoot, 'context/AuthContext.tsx'), 'utf8');
  const client = readFileSync(resolve(projectRoot, 'lib/accountDeletion.ts'), 'utf8');

  assert.match(clerkProfile, /isAccountDeletionMutationEnabled/);
  assert.match(clerkProfile, /accountDeletionEnabled \? \[/);
  assert.match(clerkProfile, /label: 'Delete Account'/);
  assert.match(clerkProfile, /testID: 'clerk-delete-account'/);
  assert.match(clerkProfile, /router\.push\('\/account\/delete-account'/);
  assert.match(clerkProfile, /label: 'Sign Out'/);
  assert.match(layout, /name="account\/delete-account"/);
  assert.match(screen, /testID="delete-account-screen"/);
  assert.match(screen, /testID="delete-account-confirmation-input"/);
  assert.match(screen, /testID="delete-account-submit"/);
  assert.match(screen, /testID="delete-account-cancel"/);
  assert.match(screen, /isAccountDeletionMutationEnabled/);
  assert.match(screen, /await signOut\(\)/);
  assert.match(screen, /setPhase\(\{ kind: 'deleted' \}\)/);
  assert.ok(screen.indexOf("setPhase({ kind: 'deleted' })") < screen.indexOf('await signOut()'));
  assert.doesNotMatch(screen, /users\.deleteUser|deleteUser\(|clerk\.user\.delete|client\.users/);
  assert.doesNotMatch(client, /users\.deleteUser|deleteUser\(|clerk\.user\.delete/);
  assert.match(client, /ACCOUNT_DELETION_FLAG/);
  assert.match(client, /method: 'DELETE'/);
  assert.match(auth, /await clerkSession\?\.signOut\(\)/);
});
