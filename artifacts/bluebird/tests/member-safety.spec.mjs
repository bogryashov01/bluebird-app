import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  MEMBER_BLOCKS_PATH,
  MEMBER_REPORT_PATH,
  MEMBER_REPORT_REASONS,
  createMemberSafetyClient,
  memberBlockRequestBody,
  memberReportRequestBody,
  blockedMemberDisplayName,
  blockedMembersAfterUnblock,
  outgoingBlockForMember,
  parseMemberBlockList,
  presentBlockedMemberUnblockConfirmation,
  presentBlockedMembersEmpty,
  presentMemberAccessClosed,
  presentMemberBlockConfirmation,
  presentMemberBlockSuccess,
  presentMemberReportSuccess,
  presentMemberSafetyFailure,
  advanceMemberSafetyHandoff,
  publishMemberSafetyRefresh,
  queueMemberSafetyHandoff,
  subscribeMemberSafetyRefresh,
} from '../scripts/.member-safety.test.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = 'https://bluebirdjets.com/api';
const createdAt = '2026-04-01T12:00:00.000Z';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function client(handler) {
  const calls = [];
  const safety = createMemberSafetyClient({
    enabled: true,
    environment: 'production',
    baseUrl,
    getAccessToken: async () => 'clerk-session-token',
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      return handler(url, init);
    },
  });
  return { safety, calls };
}

test('report payloads keep required fields and omit empty descriptions', () => {
  for (const reason of MEMBER_REPORT_REASONS) {
    const result = memberReportRequestBody({
      targetUserId: ' member-clerk-id ',
      reason,
      description: '   ',
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.body, { targetUserId: 'member-clerk-id', reason });
  }
  const described = memberReportRequestBody({
    targetUserId: 'member-clerk-id',
    reason: 'harassment',
    description: ' Optional description ',
    messageId: 154,
  });
  assert.deepEqual(described.body, {
    targetUserId: 'member-clerk-id',
    reason: 'harassment',
    description: 'Optional description',
    messageId: 154,
  });
  assert.equal(memberReportRequestBody({ targetUserId: '', reason: 'spam' }).ok, false);
  assert.equal(memberReportRequestBody({ targetUserId: 'member-clerk-id', reason: 'abuse' }).ok, false);
  assert.equal(memberReportRequestBody({
    targetUserId: 'member-clerk-id',
    reason: 'other',
    description: 'x'.repeat(5001),
  }).ok, false);
  assert.equal(memberReportRequestBody({
    targetUserId: 'member-clerk-id',
    reason: 'other',
    messageId: 0,
  }).ok, false);
  assert.equal(memberReportRequestBody({
    targetUserId: 'member-clerk-id',
    reason: 'other',
    messageId: 1.5,
  }).ok, false);
  assert.equal(memberReportRequestBody({
    targetUserId: 'member-clerk-id',
    reason: 'other',
    messageId: 2_147_483_648,
  }).ok, false);
  assert.deepEqual(memberBlockRequestBody(' member-clerk-id '), {
    ok: true,
    body: { targetUserId: 'member-clerk-id' },
  });
});

test('a successful report sends only the contract body', async () => {
  const { safety, calls } = client(async () => jsonResponse(201, {
    report: { id: 42, type: 'member_report', status: 'new', createdAt },
  }));
  const result = await safety.report({
    targetUserId: 'member-clerk-id',
    reason: 'spam',
    description: '',
    messageId: 154,
  });
  assert.equal(result.kind, 'loaded');
  assert.deepEqual(result.data.report, {
    id: 42,
    type: 'member_report',
    status: 'new',
    createdAt,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}${MEMBER_REPORT_PATH}`);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer clerk-session-token');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    targetUserId: 'member-clerk-id',
    reason: 'spam',
    messageId: 154,
  });
  assert.equal(presentMemberReportSuccess().includes('privately'), true);
});

test('report errors stay on the documented codes', async () => {
  const cases = [
    [400, 'invalid_body', 'invalid_body'],
    [400, 'self_report', 'self_report'],
    [400, 'invalid_message_reference', 'invalid_message_reference'],
    [401, 'unauthorized', 'unauthorized'],
    [403, 'active_membership_required', 'membership_required'],
    [404, 'member_not_found', 'member_not_found'],
  ];
  for (const [status, code, expected] of cases) {
    const { safety } = client(async () => jsonResponse(status, { error: 'hidden', code }));
    const result = await safety.report({ targetUserId: 'member-clerk-id', reason: 'other' });
    assert.equal(result.kind, 'error');
    assert.equal(result.code, expected);
    assert.equal(presentMemberSafetyFailure(result.code).toLowerCase().includes('blocked you'), false);
  }
});

test('blocking sends the member id and invalidates cached member state', async () => {
  const { safety, calls } = client(async () => jsonResponse(201, {
    block: { id: 17, createdAt, targetUserId: 'must-not-be-kept' },
  }));
  let refreshes = 0;
  const stop = subscribeMemberSafetyRefresh(() => {
    refreshes += 1;
  });
  const result = await safety.block('member-clerk-id');
  assert.equal(result.kind, 'loaded');
  assert.deepEqual(result.data.block, { id: 17, createdAt });
  assert.deepEqual(JSON.parse(calls[0].init.body), { targetUserId: 'member-clerk-id' });
  assert.equal(calls[0].url, `${baseUrl}${MEMBER_BLOCKS_PATH}`);
  publishMemberSafetyRefresh();
  assert.equal(refreshes, 1);
  stop();
  assert.equal(presentMemberBlockSuccess().includes('can’t message'), true);
  assert.equal(presentMemberBlockConfirmation().includes('not told'), true);
});

test('repeated block responses stay idempotent receipts', async () => {
  const { safety } = client(async () => jsonResponse(201, { block: { id: 17, createdAt } }));
  assert.equal((await safety.block('member-clerk-id')).kind, 'loaded');
  assert.equal((await safety.block('member-clerk-id')).kind, 'loaded');
});

test('block errors do not invent a relationship', async () => {
  const cases = [
    [400, 'invalid_body', 'invalid_body'],
    [400, 'self_block', 'self_block'],
    [401, 'unauthorized', 'unauthorized'],
    [403, 'active_membership_required', 'membership_required'],
    [404, 'member_not_found', 'member_not_found'],
  ];
  for (const [status, code, expected] of cases) {
    const { safety } = client(async () => jsonResponse(status, { error: 'hidden', code }));
    const result = await safety.block('member-clerk-id');
    assert.equal(result.code, expected);
  }
});

test('blocked member parsing keeps profile fields and the previous id-only shape', () => {
  const parsed = parseMemberBlockList({
    blocks: [
      {
        id: 42,
        createdAt,
        targetUserId: 'user_123',
        firstName: 'Alex',
        lastName: null,
        imageUrl: 'https://img.clerk.com/example',
        extra: 'ignored',
      },
      {
        id: 17,
        createdAt,
      },
      {
        id: 18,
        createdAt,
        firstName: '   ',
        lastName: null,
        imageUrl: 'http://insecure.example/photo.jpg',
        targetUserId: 'user_456',
      },
    ],
  });
  assert.deepEqual(parsed.blocks[0], {
    id: 42,
    createdAt,
    targetUserId: 'user_123',
    firstName: 'Alex',
    lastName: null,
    imageUrl: 'https://img.clerk.com/example',
  });
  assert.deepEqual(parsed.blocks[1], {
    id: 17,
    createdAt,
    targetUserId: null,
    firstName: null,
    lastName: null,
    imageUrl: null,
  });
  assert.equal(blockedMemberDisplayName(parsed.blocks[0]), 'Alex');
  assert.equal(blockedMemberDisplayName(parsed.blocks[1]), 'Unavailable member');
  assert.equal(blockedMemberDisplayName(parsed.blocks[2]), 'Unavailable member');
  assert.equal(blockedMemberDisplayName(parsed.blocks[1]).includes('user_'), false);
  assert.equal(presentBlockedMembersEmpty().includes('not blocked'), true);
  assert.equal(outgoingBlockForMember(parsed.blocks, 'user_123')?.id, 42);
  assert.equal(outgoingBlockForMember(parsed.blocks, 'user_456')?.id, 18);
  assert.equal(outgoingBlockForMember(parsed.blocks, 'user_789'), null);
  assert.equal(outgoingBlockForMember(parsed.blocks, 'Alex'), null);
  assert.equal(outgoingBlockForMember([{
    id: 9,
    createdAt,
    targetUserId: null,
    firstName: 'Alex',
    lastName: 'Morgan',
    imageUrl: null,
  }], 'user_123'), null);
});

test('the block list request accepts the extended response and unblock failures stay listed', async () => {
  const { safety, calls } = client(async (url, init) => {
    if (init?.method === 'DELETE') return jsonResponse(404, { error: 'hidden', code: 'block_not_found' });
    return jsonResponse(200, {
      blocks: [{ id: 42, createdAt, targetUserId: 'user_123', firstName: 'Alex', lastName: 'Morgan', imageUrl: null }],
    });
  });
  const listed = await safety.listBlocks();
  assert.equal(listed.kind, 'loaded');
  assert.equal(listed.data.blocks[0].firstName, 'Alex');
  assert.equal(listed.data.blocks[0].lastName, 'Morgan');
  assert.equal(calls[0].init.method, 'GET');
  const failed = await safety.unblock(42);
  assert.equal(failed.code, 'block_not_found');
  const kept = blockedMembersAfterUnblock(listed.data.blocks, 42, false);
  assert.equal(kept.length, 1);
  const removed = blockedMembersAfterUnblock(listed.data.blocks, 42, true);
  assert.deepEqual(removed, []);
  assert.equal(presentBlockedMemberUnblockConfirmation().includes('does not send'), true);
});

test('unblock uses the opaque block id and does not create a connection', async () => {
  const { safety, calls } = client(async (url) => {
    if (String(url).endsWith('/18')) return jsonResponse(404, { error: 'hidden', code: 'block_not_found' });
    return jsonResponse(200, { removed: true, connection: { status: 'accepted' } });
  });
  const removed = await safety.unblock(17);
  assert.deepEqual(removed, { kind: 'loaded', data: { removed: true } });
  assert.equal(calls[0].url, `${baseUrl}${MEMBER_BLOCKS_PATH}/17`);
  assert.equal(calls[0].init.method, 'DELETE');
  assert.equal(calls[0].init.body, undefined);
  const missing = await safety.unblock(18);
  assert.equal(missing.code, 'block_not_found');
  assert.equal((await safety.unblock(0)).code, 'invalid_block_id');
  assert.equal(presentMemberAccessClosed(), 'This conversation is no longer available.');
});

test('a profile report waits until each covering modal has dismissed', () => {
  const queued = queueMemberSafetyHandoff(null, { mode: 'report', userId: 'member-clerk-id' });
  assert.deepEqual(
    queueMemberSafetyHandoff(queued, { mode: 'block', userId: 'member-clerk-id' }),
    queued,
  );
  const overProfile = advanceMemberSafetyHandoff({
    pending: queued,
    profileVisible: true,
    requestsVisible: true,
    findVisible: false,
  });
  assert.equal(overProfile.dismissProfile, true);
  assert.equal(overProfile.present, null);
  const overRequests = advanceMemberSafetyHandoff({
    pending: overProfile.pending,
    profileVisible: false,
    requestsVisible: true,
    findVisible: false,
  });
  assert.equal(overRequests.dismissRequests, true);
  assert.equal(overRequests.present, null);
  const ready = advanceMemberSafetyHandoff({
    pending: overRequests.pending,
    profileVisible: false,
    requestsVisible: false,
    findVisible: false,
  });
  assert.deepEqual(ready.present, { mode: 'report', userId: 'member-clerk-id' });
  assert.equal(ready.pending, null);
  const block = advanceMemberSafetyHandoff({
    pending: { mode: 'block', userId: 'member-clerk-id' },
    profileVisible: true,
    requestsVisible: false,
    findVisible: true,
  });
  assert.equal(block.dismissProfile, true);
  const afterFind = advanceMemberSafetyHandoff({
    pending: block.pending,
    profileVisible: false,
    requestsVisible: false,
    findVisible: true,
  });
  assert.equal(afterFind.dismissFind, true);
  assert.equal(afterFind.present, null);
});

test('safety screens confirm a block, cancel it, and refuse a second submit while one is pending', () => {
  const dialog = readFileSync(resolve(projectRoot, 'components/MemberSafetyDialogs.tsx'), 'utf8');
  const profile = readFileSync(resolve(projectRoot, 'components/MemberProfileSheet.tsx'), 'utf8');
  const connections = readFileSync(resolve(projectRoot, 'components/MemberConnectionsScreen.tsx'), 'utf8');
  const thread = readFileSync(resolve(projectRoot, 'components/MemberMessageThread.tsx'), 'utf8');
  const blocked = readFileSync(resolve(projectRoot, 'app/account/blocked-members.tsx'), 'utf8');
  const unblockConfirm = readFileSync(resolve(projectRoot, 'components/MemberUnblockConfirm.tsx'), 'utf8');
  const profileSettings = readFileSync(resolve(projectRoot, 'app/(tabs)/profile/index.tsx'), 'utf8');
  const session = readFileSync(resolve(projectRoot, 'lib/clerkAuthSession.ts'), 'utf8');
  const connectionsHook = readFileSync(resolve(projectRoot, 'lib/useMemberConnections.ts'), 'utf8');
  const messagesHook = readFileSync(resolve(projectRoot, 'lib/useMemberMessages.ts'), 'utf8');
  assert.match(dialog, /keyboardWillShow/);
  assert.match(dialog, /keyboardDismissMode/);
  assert.match(dialog, /keyboardShouldPersistTaps="handled"/);
  assert.match(dialog, /member-report-submit/);
  assert.match(dialog, /Report message/);
  assert.match(dialog, /member-block-confirm/);
  assert.match(dialog, /member-safety-cancel/);
  assert.match(dialog, /pendingRef\.current/);
  assert.match(dialog, /if \(!targetUserId \|\| pendingRef\.current \|\| done\) return/);
  assert.match(connections, /member-connections-report/);
  assert.match(connections, /member-connections-block/);
  assert.match(connections, /member-connections-unblock/);
  assert.match(connections, /outgoingBlockForMember/);
  assert.match(connections, /blockedByCurrentMember\) return null/);
  assert.match(connections, /Unblock member/);
  assert.match(connections, /openMemberSafety\('report', userId\)/);
  assert.match(connections, /openMemberSafety\('block', userId\)/);
  assert.match(connections, /MemberUnblockConfirm/);
  assert.match(profile, /tone === 'blocked'/);
  assert.match(profile, /colors\.destructive/);
  assert.match(connections, /onDismiss=\{applyMemberSafetyHandoff\}/);
  assert.match(profile, /onDismiss=\{onDismiss\}/);
  assert.doesNotMatch(connections, /onPress: \(\) => setSafety/);
  assert.match(connections, /sendRequest\(discovery\)/);
  assert.match(connections, /acceptIncoming\(incoming\)/);
  assert.match(connections, /connections\.decline\(incoming\.id\)/);
  assert.match(thread, /member-message-report/);
  assert.match(thread, /member-message-block/);
  assert.match(thread, /messageId: message\.id/);
  assert.match(thread, /onBlocked=\{\(\) => setAccessClosed\(true\)\}/);
  assert.match(connectionsHook, /subscribeMemberSafetyRefresh/);
  assert.match(connectionsHook, /listIncoming/);
  assert.match(messagesHook, /subscribeMemberSafetyRefresh/);
  assert.match(messagesHook, /connection_required/);
  assert.match(blocked, /MemberUnblockConfirm/);
  assert.match(unblockConfirm, /blocked-member-confirm-cancel/);
  assert.match(unblockConfirm, /blocked-member-confirm-submit/);
  assert.match(unblockConfirm, /presentBlockedMemberUnblockConfirmation/);
  assert.match(blocked, /if \(confirmId === null \|\| pendingRef\.current !== null\) return/);
  assert.match(blocked, /publishMemberSafetyRefresh\(\)/);
  assert.match(blocked, /blockedMembersAfterUnblock/);
  assert.match(blocked, /backgroundColor: colors\.offWhite/);
  assert.doesNotMatch(blocked, /targetUserId/);
  assert.match(profileSettings, /clerk-blocked-members/);
  assert.match(session, /blocked-members/);
  assert.doesNotMatch(connections, /Blocked Members/);
  assert.doesNotMatch(thread, /Blocked Members/);
  assert.doesNotMatch(`${connections}\n${thread}\n${dialog}\n${unblockConfirm}`, /who blocked/i);
});
