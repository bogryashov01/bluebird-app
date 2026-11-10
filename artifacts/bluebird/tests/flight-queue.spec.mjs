import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  clearQueueConnectionRequests,
  acceptedConnectionMemberUserId,
  canOpenLeaderQueuePreview,
  leaderQueueViewerIsBelowFirst,
  mergeLeaderQueueRelationships,
  explainLeaderQueueSendDisabled,
  presentLeaderPreviewTitle,
  presentFrontQueueConnection,
  presentLeaderQueueConnection,
  presentLeaderQueuePreviewState,
  presentProductionQueueConnection,
  presentProductionQueueRoster,
  presentQueueConnectionAction,
  queueConnectionRequestFailureCopy,
  queueConnectionRequestShouldRefresh,
  queueRequestFailureCopy,
  readFlightQueue,
  readQueueConnectionRequest,
  rememberQueueConnectionRequest,
  rememberQueueRelationship,
  resolveProductionLeaderQueueTarget,
  retainQueueConnectionRequests,
  JOIN_TO_CONNECT_COPY,
  JOIN_TO_CONNECT_CTA,
  FRONT_QUEUE_PENDING,
  SELF_QUEUE_MEMBER_COPY,
} from '../scripts/.flight-queue.test.mjs';

test('queue roster keeps initials, position, and member reference in order', () => {
  const queue = readFlightQueue([
    { initials: 'qt', position: 2, name: 'Quinn', memberRef: 'b' },
    { initials: 'AL', position: 1, memberRef: 'a', phone: '555', email: 'a@example.test' },
    { initials: '', position: 3 },
    { initials: 'NO', position: 0 },
  ]);
  assert.deepEqual(queue, [
    { initials: 'AL', position: 1, memberRef: 'a' },
    { initials: 'QT', position: 2, memberRef: 'b' },
  ]);
  assert.equal(JSON.stringify(queue).includes('Quinn'), false);
  assert.equal(readFlightQueue(undefined), null);
  assert.deepEqual(readFlightQueue([]), []);
});

test('connection requests stay closed until the first member accepts', () => {
  assert.equal(presentQueueConnectionAction({ viewerIsFirst: true, eligible: true, status: null }), null);
  assert.equal(presentQueueConnectionAction({ viewerIsFirst: false, eligible: true, status: null }), 'request');
  assert.equal(presentQueueConnectionAction({ viewerIsFirst: false, eligible: true, status: 'pending' }), 'pending');
  assert.equal(presentQueueConnectionAction({ viewerIsFirst: false, eligible: false, status: 'accepted' }), 'accepted');
  assert.equal(presentQueueConnectionAction({ viewerIsFirst: false, eligible: true, status: 'declined' }), 'declined');
  assert.equal(presentQueueConnectionAction({ viewerIsFirst: false, eligible: false, status: null }), null);
  assert.equal(queueRequestFailureCopy('INCOMING_REQUESTS_DISABLED'), 'This member is not accepting connection requests.');
});

test('production queue rows keep a UUID reference and hide everything else', () => {
  const reference = '8F99B61F-5C0B-44E9-93BF-55FBB2A0B925';
  const roster = presentProductionQueueRoster([
    {
      position: 1,
      initials: 'AM',
      isViewer: false,
      connectionTargetReference: null,
      displayName: 'Alex Morgan',
    },
    {
      position: 2,
      initials: 'bm',
      isViewer: true,
      connectionTargetReference: reference,
      email: 'member@example.test',
      userId: 'user_secret',
      fullName: 'Blake Moore',
      displayName: 'user_secret',
    },
    {
      position: 3,
      initials: 'CM',
      isViewer: false,
      connectionTargetReference: 'not-a-uuid',
      displayName: 'cm@example.test',
    },
  ]);
  assert.deepEqual(roster, [
    {
      initials: 'AM',
      position: 1,
      isViewer: false,
      connectionTargetReference: null,
      displayName: 'Alex Morgan',
    },
    {
      initials: 'BM',
      position: 2,
      isViewer: true,
      connectionTargetReference: reference.toLowerCase(),
      displayName: null,
    },
    {
      initials: 'CM',
      position: 3,
      isViewer: false,
      connectionTargetReference: null,
      displayName: null,
    },
  ]);
  assert.equal(JSON.stringify(roster).includes('Blake'), false);
  assert.equal(JSON.stringify(roster).includes('user_secret'), false);
  assert.equal(JSON.stringify(roster).includes('@'), false);
  assert.equal(presentProductionQueueRoster([{ position: 1, initials: 'Member name', isViewer: false }]), null);
  assert.equal(presentProductionQueueRoster([{ position: 1, initials: 'AM', isViewer: 'yes' }]), null);
  assert.equal(
    presentProductionQueueRoster([
      { position: 1, initials: 'AM', isViewer: true },
      { position: 2, initials: 'BM', isViewer: true },
    ]),
    null,
  );
  assert.deepEqual(
    presentProductionQueueRoster([
      { position: 2, initials: 'qt', isViewer: false },
      { position: 1, initials: 'al', isViewer: true },
    ]),
    [
      { initials: 'AL', position: 1, isViewer: true, connectionTargetReference: null, displayName: null },
      { initials: 'QT', position: 2, isViewer: false, connectionTargetReference: null, displayName: null },
    ],
  );
});

test('only a non-first local member can request the front of the queue', () => {
  assert.equal(
    presentFrontQueueConnection({
      viewerInQueue: true,
      viewerIsFirst: true,
      channel: 'production',
    }),
    'hidden',
  );
  assert.equal(
    presentFrontQueueConnection({
      viewerInQueue: false,
      viewerIsFirst: false,
      channel: 'production',
    }),
    'hidden',
  );
  assert.equal(
    presentFrontQueueConnection({
      viewerInQueue: true,
      viewerIsFirst: false,
      channel: 'production',
    }),
    'unavailable',
  );
  assert.equal(
    presentFrontQueueConnection({
      viewerInQueue: true,
      viewerIsFirst: true,
      channel: 'local',
      localEligible: true,
      localStatus: null,
    }),
    'hidden',
  );
  assert.equal(
    presentFrontQueueConnection({
      viewerInQueue: true,
      viewerIsFirst: false,
      channel: 'local',
      localEligible: true,
      localStatus: null,
    }),
    'request',
  );
  assert.equal(
    presentFrontQueueConnection({
      viewerInQueue: true,
      viewerIsFirst: false,
      channel: 'local',
      localEligible: true,
      localStatus: 'pending',
    }),
    'pending',
  );
  assert.equal(
    presentFrontQueueConnection({
      viewerInQueue: true,
      viewerIsFirst: false,
      channel: 'local',
      localEligible: false,
      localStatus: 'accepted',
    }),
    'accepted',
  );
  assert.equal(
    presentFrontQueueConnection({
      viewerInQueue: true,
      viewerIsFirst: false,
      channel: 'local',
      localEligible: false,
      localStatus: 'declined',
    }),
    'declined',
  );
  assert.equal(
    presentFrontQueueConnection({
      viewerInQueue: true,
      viewerIsFirst: false,
      channel: 'local',
      localEligible: false,
      localStatus: null,
    }),
    'unavailable',
  );
});

test('production connection actions follow the opaque reference and the saved connection id', () => {
  clearQueueConnectionRequests();
  const reference = '8f99b61f-5c0b-44e9-93bf-55fbb2a0b925';
  const viewer = presentProductionQueueConnection({
    connectionTargetReference: null,
    connectionId: null,
    acceptedConnectionIds: [],
    relationshipKnown: false,
    requestsEnabled: true,
  });
  const eligible = presentProductionQueueConnection({
    connectionTargetReference: reference,
    connectionId: null,
    acceptedConnectionIds: [],
    relationshipKnown: false,
    requestsEnabled: true,
  });
  const unavailable = presentProductionQueueConnection({
    connectionTargetReference: reference,
    connectionId: null,
    acceptedConnectionIds: [],
    relationshipKnown: false,
    requestsEnabled: false,
  });
  assert.equal(viewer, null);
  assert.equal(eligible, 'request');
  assert.equal(unavailable, null);
  rememberQueueConnectionRequest({
    accountId: 'user_first',
    flightId: 42,
    reference,
    connectionId: 73,
  });
  assert.equal(readQueueConnectionRequest({ accountId: 'user_first', flightId: 42, reference }), 73);
  assert.equal(
    presentProductionQueueConnection({
      connectionTargetReference: reference,
      connectionId: 73,
      acceptedConnectionIds: [],
      relationshipKnown: false,
      requestsEnabled: true,
    }),
    'pending',
  );
  assert.equal(
    presentProductionQueueConnection({
      connectionTargetReference: null,
      connectionId: 73,
      acceptedConnectionIds: [73],
      relationshipKnown: false,
      requestsEnabled: true,
    }),
    'accepted',
  );
  rememberQueueRelationship({ accountId: 'user_first', flightId: 42, reference: '11111111-1111-1111-1111-111111111111' });
  assert.equal(
    presentProductionQueueConnection({
      connectionTargetReference: '11111111-1111-1111-1111-111111111111',
      connectionId: null,
      acceptedConnectionIds: [],
      relationshipKnown: true,
      requestsEnabled: true,
    }),
    'existing',
  );
  retainQueueConnectionRequests('user_other');
  assert.equal(readQueueConnectionRequest({ accountId: 'user_first', flightId: 42, reference }), null);
  assert.equal(
    queueConnectionRequestFailureCopy('queue_target_unavailable'),
    'A connection request to the first member is not available from this queue yet.',
  );
  assert.equal(
    queueConnectionRequestFailureCopy('first_in_queue_required'),
    'A connection request to the first member is not available from this queue yet.',
  );
  assert.equal(queueConnectionRequestShouldRefresh('relationship_exists'), true);
  assert.equal(queueConnectionRequestShouldRefresh('unauthorized'), false);
  clearQueueConnectionRequests();
});

test('members below first request only the position-1 reference', () => {
  const reference = '8f99b61f-5c0b-44e9-93bf-55fbb2a0b925';
  const ready = {
    reference,
    requestsEnabled: true,
    status: 'ready',
    relationships: [],
    flightId: 456,
    sendBlocked: false,
  };
  assert.equal(presentLeaderQueueConnection({ ...ready, viewerBelowFirst: false }).kind, 'hidden');
  assert.deepEqual(presentLeaderQueueConnection({ ...ready, viewerBelowFirst: true }), {
    kind: 'request',
    reference,
  });
  assert.equal(
    presentLeaderQueueConnection({
      ...ready,
      viewerBelowFirst: true,
      reference: null,
    }).kind,
    'unavailable',
  );
  assert.equal(
    presentLeaderQueueConnection({
      ...ready,
      viewerBelowFirst: true,
      requestsEnabled: false,
    }).kind,
    'unavailable',
  );
  assert.equal(
    presentLeaderQueueConnection({
      ...ready,
      viewerBelowFirst: true,
      status: 'loading',
    }).kind,
    'loading',
  );
  assert.deepEqual(
    presentLeaderQueueConnection({
      ...ready,
      viewerBelowFirst: true,
      status: 'error',
    }),
    { kind: 'unavailable', reason: 'status' },
  );
  assert.deepEqual(
    presentLeaderQueueConnection({
      ...ready,
      viewerBelowFirst: true,
      reference: null,
      relationships: [
        {
          connectionId: 73,
          emptyLegId: 456,
          status: 'pending',
          direction: 'outgoing',
        },
      ],
    }),
    { kind: 'pending', connectionId: 73 },
  );
  assert.deepEqual(
    presentLeaderQueueConnection({
      ...ready,
      viewerBelowFirst: false,
      relationships: [
        {
          connectionId: 74,
          emptyLegId: 456,
          status: 'accepted',
          direction: 'outgoing',
        },
      ],
    }),
    { kind: 'accepted', connectionId: 74 },
  );
  assert.equal(
    presentLeaderQueueConnection({
      ...ready,
      viewerBelowFirst: true,
      relationships: [
        {
          connectionId: 75,
          emptyLegId: 456,
          status: 'pending',
          direction: 'incoming',
        },
      ],
    }).kind,
    'request',
  );
  assert.equal(
    presentLeaderQueueConnection({
      ...ready,
      viewerBelowFirst: true,
      relationships: [
        { connectionId: 76, emptyLegId: 456, status: 'pending', direction: 'outgoing' },
        { connectionId: 77, emptyLegId: 456, status: 'accepted', direction: 'incoming' },
      ],
    }).kind,
    'ambiguous',
  );
  assert.equal(
    presentLeaderQueueConnection({
      ...ready,
      viewerBelowFirst: true,
      relationships: [{ connectionId: 78, emptyLegId: 999, status: 'pending', direction: 'outgoing' }],
    }).kind,
    'request',
  );
  const merged = mergeLeaderQueueRelationships(
    [{ connectionId: 73, emptyLegId: 456, status: 'accepted', direction: 'outgoing' }],
    [{ connectionId: 73, emptyLegId: 456, status: 'pending', direction: 'outgoing' }],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, 'accepted');
  assert.equal(
    acceptedConnectionMemberUserId(74, [
      { id: 74, member: { userId: 'user_leader' } },
      { id: 80, member: { userId: 'user_other' } },
    ]),
    'user_leader',
  );
  assert.equal(
    acceptedConnectionMemberUserId(74, [
      { id: 74, member: { userId: 'user_leader' } },
      { id: 74, member: { userId: 'user_other' } },
    ]),
    null,
  );
  assert.equal(acceptedConnectionMemberUserId(74, [{ id: 74, member: { userId: 'not a user' } }]), null);
  assert.equal(leaderQueueViewerIsBelowFirst(1), false);
  assert.equal(leaderQueueViewerIsBelowFirst(2), true);
  assert.equal(leaderQueueViewerIsBelowFirst(3), true);
  assert.equal(leaderQueueViewerIsBelowFirst(null), false);
  assert.equal(canOpenLeaderQueuePreview({ viewerIsLeader: false, connection: 'unavailable' }), true);
  assert.equal(canOpenLeaderQueuePreview({ viewerIsLeader: false, connection: 'request' }), true);
  assert.equal(canOpenLeaderQueuePreview({ viewerIsLeader: false, connection: 'loading' }), true);
  assert.equal(canOpenLeaderQueuePreview({ viewerIsLeader: false, connection: 'hidden' }), true);
  assert.equal(canOpenLeaderQueuePreview({ viewerIsLeader: true, connection: 'hidden' }), false);
  assert.equal(canOpenLeaderQueuePreview({ viewerIsLeader: true, connection: 'pending' }), true);
  assert.equal(canOpenLeaderQueuePreview({ viewerIsLeader: true, connection: 'accepted' }), true);
  assert.equal(canOpenLeaderQueuePreview({ viewerIsLeader: true, connection: 'ambiguous' }), true);
  assert.equal(
    presentLeaderPreviewTitle({
      displayName: 'Jordan Ellis',
      firstName: 'Ada',
      lastName: 'Lovelace',
      initials: 'AL',
    }),
    'Jordan Ellis',
  );
  assert.equal(
    presentLeaderPreviewTitle({
      firstName: 'Ada',
      lastName: 'Lovelace',
      initials: 'AL',
    }),
    'Ada Lovelace',
  );
  assert.equal(
    presentLeaderPreviewTitle({
      firstName: null,
      lastName: null,
      initials: 'ok',
    }),
    'Queue Member · OK',
  );
  assert.equal(
    presentLeaderPreviewTitle({
      firstName: 'Ada',
      lastName: null,
      initials: 'AL',
    }),
    'Ada',
  );
  assert.equal(
    presentLeaderPreviewTitle({
      displayName: 'user_secret',
      firstName: null,
      lastName: null,
      initials: 'AL',
    }),
    'Queue Member · AL',
  );
  assert.equal(
    explainLeaderQueueSendDisabled({
      connection: { kind: 'hidden' },
      viewerPosition: null,
      hasReference: false,
      requestsEnabled: true,
      queueStatus: 'ready',
      relationshipCountForFlight: 0,
      queueKind: 'participants',
      participantCount: 2,
      viewerRowCount: 0,
      flightUserInQueue: true,
      hasFlightViewerQueuePosition: false,
    }).reason,
    'viewer_position_unknown',
  );
  assert.equal(
    explainLeaderQueueSendDisabled({
      connection: { kind: 'unavailable', reason: 'reference' },
      viewerPosition: 2,
      hasReference: false,
      requestsEnabled: true,
      queueStatus: 'ready',
      relationshipCountForFlight: 0,
      queueKind: 'participants',
      participantCount: 2,
      viewerRowCount: 1,
      flightUserInQueue: true,
      hasFlightViewerQueuePosition: true,
    }).reason,
    'missing_connection_target_reference',
  );
  assert.equal(
    explainLeaderQueueSendDisabled({
      connection: { kind: 'request', reference: '8f99b61f-5c0b-44e9-93bf-55fbb2a0b925' },
      viewerPosition: 2,
      hasReference: true,
      requestsEnabled: true,
      queueStatus: 'ready',
      relationshipCountForFlight: 0,
      queueKind: 'participants',
      participantCount: 2,
      viewerRowCount: 1,
      flightUserInQueue: true,
      hasFlightViewerQueuePosition: true,
    }).sendEnabled,
    true,
  );
});

test('join-to-connect and queue request eligibility follow the product rules', () => {
  const reference = '8f99b61f-5c0b-44e9-93bf-55fbb2a0b925';
  const ready = {
    reference,
    requestsEnabled: true,
    status: 'ready',
    relationships: [],
    flightId: 22653,
    sendBlocked: false,
  };
  assert.deepEqual(
    presentLeaderQueuePreviewState({
      ...ready,
      viewerInQueue: false,
      viewerIsLeader: false,
      viewerBelowFirst: false,
    }),
    { kind: 'join-to-connect' },
  );
  assert.equal(JOIN_TO_CONNECT_COPY.includes('Join this flight'), true);
  assert.equal(JOIN_TO_CONNECT_CTA, 'Join the Flight to Connect');
  assert.deepEqual(
    presentLeaderQueuePreviewState({
      ...ready,
      viewerInQueue: true,
      viewerIsLeader: true,
      viewerBelowFirst: false,
    }),
    { kind: 'self' },
  );
  assert.match(SELF_QUEUE_MEMBER_COPY, /cannot send a connection request to yourself/);
  assert.deepEqual(
    presentLeaderQueuePreviewState({
      ...ready,
      viewerInQueue: true,
      viewerIsLeader: false,
      viewerBelowFirst: true,
    }),
    { kind: 'request', reference },
  );
  assert.equal(
    presentLeaderQueuePreviewState({
      ...ready,
      viewerInQueue: true,
      viewerIsLeader: false,
      viewerBelowFirst: true,
      reference: null,
    }).kind,
    'unavailable',
  );
  assert.deepEqual(
    presentLeaderQueuePreviewState({
      ...ready,
      viewerInQueue: true,
      viewerIsLeader: false,
      viewerBelowFirst: true,
      relationships: [{ connectionId: 91, emptyLegId: 22653, status: 'pending', direction: 'outgoing' }],
    }),
    { kind: 'pending', connectionId: 91 },
  );
  assert.equal(FRONT_QUEUE_PENDING, 'Request Sent');
  assert.equal(
    explainLeaderQueueSendDisabled({
      connection: { kind: 'join-to-connect' },
      viewerPosition: null,
      hasReference: false,
      requestsEnabled: true,
      queueStatus: 'ready',
      relationshipCountForFlight: 0,
      queueKind: 'participants',
      participantCount: 2,
      viewerRowCount: 0,
      flightUserInQueue: false,
      hasFlightViewerQueuePosition: false,
    }).reason,
    'join_required',
  );

  const roster = presentProductionQueueRoster([
    { position: 1, initials: 'JA', isViewer: false, connectionTargetReference: reference },
    { position: 2, initials: 'ME', isViewer: true },
  ]);
  const eligible = resolveProductionLeaderQueueTarget({ roster, viewerPosition: 2 });
  assert.equal(eligible.reference, reference);
  assert.equal(eligible.viewerBelowFirst, true);
  const first = resolveProductionLeaderQueueTarget({
    roster: presentProductionQueueRoster([{ position: 1, initials: 'ME', isViewer: true, connectionTargetReference: reference }]),
    viewerPosition: 1,
  });
  assert.equal(first.reference, null);
  assert.equal(first.viewerIsLeader, true);
  assert.equal(canOpenLeaderQueuePreview({ viewerIsLeader: true, connection: 'self' }), false);
  assert.equal(canOpenLeaderQueuePreview({ viewerIsLeader: false, connection: 'join-to-connect' }), true);
});

test('flight details show the queue once and keep the route duration', () => {
  const source = readFileSync(new URL('../app/flight/[id].tsx', import.meta.url), 'utf8');
  assert.match(source, /Flight Queue/);
  assert.match(source, /useJoinFlightQueueRead/);
  assert.match(source, /presentProductionQueueRoster/);
  assert.match(source, /presentLeaderQueuePreviewState/);
  assert.match(source, /resolveProductionLeaderQueueTarget/);
  assert.match(source, /canOpenLeaderQueuePreview/);
  assert.match(source, /presentLeaderPreviewTitle/);
  assert.match(source, /displayName: frontPreview === 'production'/);
  assert.match(source, /JOIN_TO_CONNECT_CTA/);
  assert.match(source, /flight-queue-join-to-connect-cta/);
  assert.match(source, /openJoinToConnect/);
  assert.match(source, /previewQueueTarget/);
  assert.match(source, /flight-queue-front-preview-name/);
  assert.match(source, /flight-queue-leader-name/);
  assert.match(source, /flight-queue-retry/);
  assert.match(source, /refetchProductionQueue/);
  assert.doesNotMatch(source, /flight-queue-send-eligibility|\[flight-queue-preview\]|explainLeaderQueueSendDisabled/);
  assert.match(source, /viewerQueuePosition/);
  assert.match(source, /visible=\{frontPreview != null\}/);
  assert.match(source, /presentationStyle="overFullScreen"/);
  assert.match(source, /previewDismissable/);
  assert.match(source, /flight-queue-front-preview-backdrop/);
  assert.equal(source.includes("visible={frontPreview != null && previewConnection !== 'hidden'}"), false);
  assert.equal(/onPress=\{\(\) => setFrontPreview\(null\)\}[\s\S]*flight-queue-front-preview/.test(source), false);
  assert.match(source, /flight-queue-first/);
  assert.match(source, /flight-queue-count/);
  assert.match(source, /flight-queue-you/);
  assert.match(source, /Send Connection Request/);
  assert.match(source, /flight-queue-send-request/);
  assert.match(source, /flight-queue-open-conversation/);
  assert.match(source, /createQueueRequest/);
  assert.match(source, /listQueueStatus/);
  assert.match(source, /connection-queue-status/);
  assert.match(source, /acceptedConnectionMemberUserId/);
  assert.equal(source.includes('rememberQueueConnectionRequest'), false);
  assert.equal(source.includes('targetUserId'), false);
  const connections = readFileSync(new URL('../lib/memberConnections.ts', import.meta.url), 'utf8');
  assert.match(connections, /queueTargetReference: reference/);
  assert.match(connections, /targetUserId: id/);
  assert.match(source, /flight-detail-route-duration/);
  assert.match(source, /WinnerFlightNotice/);
  assert.equal(source.includes('flight-info-status'), false);
  assert.equal(source.includes('flight-info-duration'), false);
  assert.equal(source.includes('Send introduction'), false);
});
