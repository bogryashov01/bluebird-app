import assert from 'node:assert/strict';
import test from 'node:test';
import { selectProfilePhoto } from '../lib/profile-photo-selection.ts';

const selected = { uri: 'file:///photo.jpg', mimeType: 'image/jpeg', fileSize: 120 };
const granted = { granted: true, status: 'granted', canAskAgain: true };

for (const [source, platform] of [['camera', 'ios'], ['library', 'android']]) {
  test(`${platform} ${source} requests permission then returns the chosen photo`, async () => {
    const calls = [];
    const result = await selectProfilePhoto(source, {
      platform,
      permission: null,
      async requestPermission() { calls.push('permission'); return granted; },
      async launch() { calls.push('picker'); return { canceled: false, assets: [selected] }; },
    });
    assert.deepEqual(calls, ['permission', 'picker']);
    assert.deepEqual(result, { kind: 'selected', asset: selected });
  });
}

test('denied permission does not launch camera or alter the selected photo', async () => {
  let launched = false;
  const denied = { granted: false, status: 'denied', canAskAgain: false };
  const result = await selectProfilePhoto('camera', {
    platform: 'android',
    permission: denied,
    async requestPermission() { return denied; },
    async launch() { launched = true; return { canceled: false, assets: [selected] }; },
  });
  assert.deepEqual(result, { kind: 'denied', permission: denied });
  assert.equal(launched, false);
});

test('cancelling a picker does not select or upload a replacement', async () => {
  const result = await selectProfilePhoto('library', {
    platform: 'ios',
    permission: granted,
    async requestPermission() { throw new Error('already granted'); },
    async launch() { return { canceled: true, assets: null }; },
  });
  assert.deepEqual(result, { kind: 'cancelled' });
});

test('web camera fails explicitly without requesting permissions or opening picker', async () => {
  await assert.rejects(
    selectProfilePhoto('camera', {
      platform: 'web',
      permission: null,
      async requestPermission() { throw new Error('unexpected permission request'); },
      async launch() { throw new Error('unexpected picker'); },
    }),
    /only available in the mobile app/,
  );
});