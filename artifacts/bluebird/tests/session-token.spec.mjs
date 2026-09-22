import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TOKEN_KEY,
  readSessionTokenFrom,
  writeSessionTokenTo,
  clearSessionTokenFrom,
} from '../lib/sessionTokenStore.ts';

const USER_KEY = 'bluebird_user';
const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.native-test-token';
const USER_JSON = JSON.stringify({ id: 'demo-member', name: 'Demo Member' });

function createMemoryStore(isNative) {
  const secure = new Map();
  const legacy = new Map();
  const calls = [];
  return {
    isNative,
    secure,
    legacy,
    calls,
    async getSecureItem(key) {
      calls.push(`getSecure:${key}`);
      return secure.get(key) ?? null;
    },
    async setSecureItem(key, value) {
      calls.push(`setSecure:${key}`);
      secure.set(key, value);
    },
    async deleteSecureItem(key) {
      calls.push(`deleteSecure:${key}`);
      secure.delete(key);
    },
    async getLegacyItem(key) {
      calls.push(`getLegacy:${key}`);
      return legacy.get(key) ?? null;
    },
    async setLegacyItem(key, value) {
      calls.push(`setLegacy:${key}`);
      legacy.set(key, value);
    },
    async deleteLegacyItem(key) {
      calls.push(`deleteLegacy:${key}`);
      legacy.delete(key);
    },
  };
}

test('native secure token write stores the JWT in SecureStore only', async () => {
  const store = createMemoryStore(true);
  store.legacy.set(TOKEN_KEY, 'stale-asyncstorage-jwt');
  store.legacy.set(USER_KEY, USER_JSON);

  await writeSessionTokenTo(store, JWT);

  assert.equal(store.secure.get(TOKEN_KEY), JWT);
  assert.equal(store.legacy.get(TOKEN_KEY), undefined);
  assert.equal(store.legacy.get(USER_KEY), USER_JSON);
  assert.equal(store.calls.includes(`setLegacy:${TOKEN_KEY}`), false);
});

test('native secure token read returns the SecureStore JWT', async () => {
  const store = createMemoryStore(true);
  store.secure.set(TOKEN_KEY, JWT);
  store.legacy.set(USER_KEY, USER_JSON);

  const token = await readSessionTokenFrom(store);

  assert.equal(token, JWT);
  assert.equal(store.legacy.get(USER_KEY), USER_JSON);
});

test('legacy AsyncStorage token migrates into SecureStore', async () => {
  const store = createMemoryStore(true);
  store.legacy.set(TOKEN_KEY, JWT);
  store.legacy.set(USER_KEY, USER_JSON);

  const token = await readSessionTokenFrom(store);

  assert.equal(token, JWT);
  assert.equal(store.secure.get(TOKEN_KEY), JWT);
  assert.equal(store.legacy.get(TOKEN_KEY), undefined);
  assert.equal(store.legacy.get(USER_KEY), USER_JSON);
});

test('legacy token is removed after a verified SecureStore migration', async () => {
  const store = createMemoryStore(true);
  store.legacy.set(TOKEN_KEY, JWT);

  await readSessionTokenFrom(store);

  assert.equal(store.legacy.has(TOKEN_KEY), false);
  assert.equal(store.calls.filter((call) => call === `deleteLegacy:${TOKEN_KEY}`).length, 1);
});

test('logout clear removes the native SecureStore token and leftover AsyncStorage JWT', async () => {
  const store = createMemoryStore(true);
  store.secure.set(TOKEN_KEY, JWT);
  store.legacy.set(TOKEN_KEY, 'stale-legacy-jwt');
  store.legacy.set(USER_KEY, USER_JSON);

  await clearSessionTokenFrom(store);

  assert.equal(store.secure.get(TOKEN_KEY), undefined);
  assert.equal(store.legacy.get(TOKEN_KEY), undefined);
  assert.equal(store.legacy.get(USER_KEY), USER_JSON);
});

test('cached user key is not written or deleted by token storage helpers', async () => {
  const store = createMemoryStore(true);
  store.legacy.set(USER_KEY, USER_JSON);

  await writeSessionTokenTo(store, JWT);
  await readSessionTokenFrom(store);
  await clearSessionTokenFrom(store);

  assert.equal(store.legacy.get(USER_KEY), USER_JSON);
  assert.equal(store.calls.some((call) => call.endsWith(`:${USER_KEY}`)), false);
});

test('web auth writes and reads the JWT through AsyncStorage / localStorage', async () => {
  const store = createMemoryStore(false);

  await writeSessionTokenTo(store, JWT);
  const token = await readSessionTokenFrom(store);

  assert.equal(token, JWT);
  assert.equal(store.legacy.get(TOKEN_KEY), JWT);
  assert.equal(store.secure.size, 0);
  assert.equal(store.calls.some((call) => call.startsWith('setSecure')), false);
  assert.equal(store.calls.some((call) => call.startsWith('getSecure')), false);
});

test('web logout removes the localStorage JWT and leaves cached user state alone', async () => {
  const store = createMemoryStore(false);
  store.legacy.set(TOKEN_KEY, JWT);
  store.legacy.set(USER_KEY, USER_JSON);

  await clearSessionTokenFrom(store);

  assert.equal(store.legacy.get(TOKEN_KEY), undefined);
  assert.equal(store.legacy.get(USER_KEY), USER_JSON);
  assert.equal(store.calls.some((call) => call.startsWith('deleteSecure')), false);
});

test('native SecureStore write failure does not copy the JWT into AsyncStorage', async () => {
  const store = createMemoryStore(true);
  store.setSecureItem = async () => {
    throw new Error('keychain unavailable');
  };

  await assert.rejects(() => writeSessionTokenTo(store, JWT), /keychain unavailable/);
  assert.equal(store.legacy.get(TOKEN_KEY), undefined);
  assert.equal(store.calls.includes(`setLegacy:${TOKEN_KEY}`), false);
});

test('failed migration leaves the legacy token in place and does not duplicate it', async () => {
  const store = createMemoryStore(true);
  store.legacy.set(TOKEN_KEY, JWT);
  store.setSecureItem = async () => {
    throw new Error('keychain unavailable');
  };

  await assert.rejects(() => readSessionTokenFrom(store), /keychain unavailable/);
  assert.equal(store.legacy.get(TOKEN_KEY), JWT);
  assert.equal(store.secure.get(TOKEN_KEY), undefined);
  assert.equal(store.calls.includes(`setLegacy:${TOKEN_KEY}`), false);
});

test('diagnostics never include the JWT', async () => {
  const logs = [];
  const store = createMemoryStore(true);
  store.legacy.set(TOKEN_KEY, JWT);
  store.log = (message, extra) => {
    logs.push({ message, extra });
  };

  await readSessionTokenFrom(store);

  const serialized = JSON.stringify(logs);
  assert.equal(serialized.includes(JWT), false);
  assert.equal(logs.some((entry) => entry.message.includes('migrated')), true);
});
