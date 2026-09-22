import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getApiBaseUrl,
  productionApiUrlRejection,
  ProductionApiUrlError,
} from '../lib/apiBaseUrl.ts';

function dev(env) {
  return getApiBaseUrl({ isDevelopment: true, env });
}

function prod(env) {
  return getApiBaseUrl({ isDevelopment: false, env });
}

test('development allows localhost', () => {
  assert.equal(dev({ EXPO_PUBLIC_API_URL: 'http://localhost:8080' }), 'http://localhost:8080');
});

test('development allows 127.0.0.1', () => {
  assert.equal(dev({ EXPO_PUBLIC_API_URL: 'http://127.0.0.1:8080' }), 'http://127.0.0.1:8080');
});

test('development allows a LAN IP', () => {
  assert.equal(dev({ EXPO_PUBLIC_API_URL: 'http://192.168.1.24:8080' }), 'http://192.168.1.24:8080');
});

test('development allows a Replit preview origin', () => {
  assert.equal(
    dev({ EXPO_PUBLIC_DOMAIN: 'example.replit.dev' }),
    'https://example.replit.dev',
  );
});

test('development returns null when no API URL is configured', () => {
  assert.equal(dev({}), null);
});

test('production rejects a missing URL', () => {
  assert.throws(() => prod({}), ProductionApiUrlError);
  assert.throws(() => prod({ EXPO_PUBLIC_API_URL: '' }), ProductionApiUrlError);
  assert.throws(() => prod({ EXPO_PUBLIC_API_URL: '   ' }), ProductionApiUrlError);
  assert.equal(productionApiUrlRejection(null), 'missing');
});

test('production rejects localhost', () => {
  assert.throws(
    () => prod({ EXPO_PUBLIC_API_URL: 'http://localhost:8080' }),
    ProductionApiUrlError,
  );
  assert.equal(productionApiUrlRejection('http://localhost:8080'), 'localhost is not allowed');
  assert.equal(productionApiUrlRejection('https://localhost'), 'localhost is not allowed');
});

test('production rejects 127.0.0.1', () => {
  assert.throws(
    () => prod({ EXPO_PUBLIC_API_URL: 'https://127.0.0.1' }),
    ProductionApiUrlError,
  );
  assert.equal(productionApiUrlRejection('https://127.0.0.1'), 'localhost is not allowed');
});

test('production rejects a private LAN IP', () => {
  assert.throws(
    () => prod({ EXPO_PUBLIC_API_URL: 'https://192.168.1.24' }),
    ProductionApiUrlError,
  );
  assert.equal(productionApiUrlRejection('https://10.0.0.8'), 'private/LAN address is not allowed');
  assert.equal(productionApiUrlRejection('https://172.16.0.2'), 'private/LAN address is not allowed');
});

test('production rejects a Replit origin', () => {
  assert.throws(
    () => prod({ EXPO_PUBLIC_API_URL: 'https://bluebird.replit.dev' }),
    ProductionApiUrlError,
  );
  assert.equal(
    productionApiUrlRejection('https://app.replit.app'),
    'Replit development host is not allowed',
  );
  assert.equal(
    productionApiUrlRejection('https://foo.repl.co'),
    'Replit development host is not allowed',
  );
});

test('production rejects an HTTP public origin', () => {
  assert.throws(
    () => prod({ EXPO_PUBLIC_API_URL: 'http://api.example.com' }),
    ProductionApiUrlError,
  );
  assert.equal(productionApiUrlRejection('http://api.example.com'), 'https is required');
});

test('production accepts a valid HTTPS public origin', () => {
  assert.equal(
    prod({ EXPO_PUBLIC_API_URL: 'https://api.example.com/' }),
    'https://api.example.com',
  );
  assert.equal(productionApiUrlRejection('https://api.example.com'), null);
});

test('production rejects ::1 and .local hosts', () => {
  assert.equal(productionApiUrlRejection('https://[::1]'), 'localhost is not allowed');
  assert.equal(productionApiUrlRejection('https://macbook.local'), '.local hostname is not allowed');
});

test('production error message does not invent an API URL', () => {
  try {
    prod({});
    assert.fail('expected throw');
  } catch (error) {
    assert.equal(error.name, 'ProductionApiUrlError');
    assert.match(error.message, /Production API URL is not configured correctly/);
    assert.equal(error.message.includes('http://localhost'), false);
  }
});
