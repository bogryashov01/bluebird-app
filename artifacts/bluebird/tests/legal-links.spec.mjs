import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LEGAL_PATH,
  legalScreenHref,
  legalScreenRequiresAuth,
  parseLegalTab,
} from '../lib/legalLinks.ts';

test('Terms of Service routes to the existing legal screen on the terms tab', () => {
  assert.deepEqual(legalScreenHref('terms'), {
    pathname: LEGAL_PATH,
    params: { tab: 'terms' },
  });
});

test('Privacy Policy routes to the existing legal screen on the privacy tab', () => {
  assert.deepEqual(legalScreenHref('privacy'), {
    pathname: LEGAL_PATH,
    params: { tab: 'privacy' },
  });
});

test('legal screen does not require authentication', () => {
  assert.equal(legalScreenRequiresAuth(), false);
  assert.equal(LEGAL_PATH.startsWith('/(tabs)'), false);
});

test('parseLegalTab maps query values and defaults to terms', () => {
  assert.equal(parseLegalTab('terms'), 'terms');
  assert.equal(parseLegalTab('privacy'), 'privacy');
  assert.equal(parseLegalTab(['privacy']), 'privacy');
  assert.equal(parseLegalTab(undefined), 'terms');
  assert.equal(parseLegalTab('other'), 'terms');
});
