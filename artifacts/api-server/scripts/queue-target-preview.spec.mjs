import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  evaluateQueueTargetPreview,
  isQueueTargetReference,
  presentQueueTargetPreview,
} from './.queue-target-preview.test.mjs';

const reference = '8f99b61f-5c0b-44e9-93bf-55fbb2a0b925';
const eligible = {
  authenticated: true,
  activeMembership: true,
  reference,
  viewerPosition: 2,
  referenceMatchesCurrentLeader: true,
  leaderStillFirst: true,
  incomingAllowed: true,
  blocked: false,
  isSelf: false,
};

test('queue target references must be opaque UUIDs', () => {
  assert.equal(isQueueTargetReference(reference), true);
  assert.equal(isQueueTargetReference(reference.toUpperCase()), true);
  assert.equal(isQueueTargetReference('not-a-uuid'), false);
  assert.equal(isQueueTargetReference('user_abc'), false);
  assert.equal(isQueueTargetReference(null), false);
});

test('an eligible member below first can preview the current leader', () => {
  assert.deepEqual(evaluateQueueTargetPreview(eligible), { ok: true });
  assert.deepEqual(evaluateQueueTargetPreview({ ...eligible, viewerPosition: 3 }), { ok: true });
});

test('authentication and membership are required before a name is returned', () => {
  assert.deepEqual(evaluateQueueTargetPreview({ ...eligible, authenticated: false }), {
    ok: false,
    status: 401,
    code: 'unauthorized',
  });
  assert.deepEqual(evaluateQueueTargetPreview({ ...eligible, activeMembership: false }), {
    ok: false,
    status: 403,
    code: 'active_membership_required',
  });
  assert.deepEqual(evaluateQueueTargetPreview({ ...eligible, reference: 'bad' }), {
    ok: false,
    status: 400,
    code: 'invalid_body',
  });
});

test('privacy, blocks, stale references, and self stay queue_target_unavailable', () => {
  for (const patch of [
    { incomingAllowed: false },
    { blocked: true },
    { referenceMatchesCurrentLeader: false },
    { leaderStillFirst: false },
    { isSelf: true },
    { viewerPosition: 1 },
    { viewerPosition: null },
  ]) {
    assert.deepEqual(evaluateQueueTargetPreview({ ...eligible, ...patch }), {
      ok: false,
      status: 404,
      code: 'queue_target_unavailable',
    });
  }
});

test('preview responses keep only first name, last name, and position', () => {
  const preview = presentQueueTargetPreview({
    firstName: 'Ada',
    lastName: 'Lovelace',
    position: 1,
    userId: 'user_secret',
    email: 'ada@example.test',
    phone: '+15555550100',
    phoneE164: '+15555550100',
  });
  assert.deepEqual(preview, {
    firstName: 'Ada',
    lastName: 'Lovelace',
    position: 1,
  });
  const rendered = JSON.stringify(preview);
  assert.equal(rendered.includes('user_secret'), false);
  assert.equal(rendered.includes('@'), false);
  assert.equal(rendered.includes('+1555'), false);
});

test('incomplete or unsafe names fail closed so the client can keep initials', () => {
  assert.equal(presentQueueTargetPreview({
    firstName: '',
    lastName: 'Lovelace',
    position: 1,
  }), null);
  assert.equal(presentQueueTargetPreview({
    firstName: 'Ada',
    lastName: '',
    position: 1,
  }), null);
  assert.equal(presentQueueTargetPreview({
    firstName: 'Ada<script>',
    lastName: 'Lovelace',
    position: 1,
  }), null);
  assert.equal(presentQueueTargetPreview({
    firstName: 'Ada',
    lastName: 'Lovelace',
    position: 0,
  }), null);
});
