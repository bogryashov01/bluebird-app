import React from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { isClerkBluebirdProfileResultCurrent } from '@/lib/clerkBluebirdProfile';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import {
  connectionRefreshIntervalMs,
  isMemberMessageRealtimeEnabled,
  publishMemberMessageHint,
  realtimeHintRequestsConnections,
  subscribeMemberMessageHints,
  subscribeMemberMessageSocketLive,
} from '@/lib/memberMessageRealtime';
import { subscribeMemberSafetyRefresh } from '@/lib/memberSafety';
import {
  clearMemberConnectionsCache,
  connectionMemberLabel,
  createMemberConnectionsClient,
  isMemberConnectionsIntegrationEnabled,
  presentConnectionRequestConflict,
  projectOutgoingConnectionRequest,
  readMemberConnectionsSnapshot,
  reconcilePendingOutgoingRecipients,
  rememberMemberConnectionsSnapshot,
  retainMemberConnectionsForAccount,
  type AcceptedConnection,
  type ConnectionMemberIdentity,
  type ConnectionRelationship,
  type DiscoveredConnectionMember,
  type MemberConnectionsFailure,
  type OutgoingConnectionRequest,
  type PendingOutgoingRequestReceipt,
} from '@/lib/memberConnections';
import {
  discoveredStateFromDiscoveryMember,
  resolveConflictDiscoveredState,
  type DiscoveredMemberState,
} from '@/lib/memberConnectPresentation';

const FAILURE_COPY: Record<MemberConnectionsFailure, string> = {
  configuration: 'Connections are not available yet.',
  token: 'Sign in again to view Connections.',
  network: 'Connections couldn’t be loaded. Try again.',
  timeout: 'Connections couldn’t be loaded. Try again.',
  cancelled: '',
  schema: 'Connections couldn’t be read.',
  invalid_contact: 'Enter a valid phone number.',
  invalid_body: 'That connection couldn’t be updated.',
  unauthorized: 'Sign in again to view Connections.',
  membership_required: 'An active Bluebird membership is required.',
  incoming_requests_disabled: 'This member is not accepting connection requests.',
  not_found: 'That member or request is no longer available.',
  conflict: presentConnectionRequestConflict(null),
  unavailable: 'Connections couldn’t be loaded. Try again.',
  outgoing_unsupported: '',
};

export function memberConnectionsFailureCopy(code: MemberConnectionsFailure): string {
  return FAILURE_COPY[code];
}

function upsertOutgoingRequest(
  requests: OutgoingConnectionRequest[],
  request: OutgoingConnectionRequest,
): OutgoingConnectionRequest[] {
  const without = requests.filter((row) => row.id !== request.id);
  if (request.status !== 'pending') return without;
  return [request, ...without];
}

function upsertPendingRecipientUserId(userIds: string[], userId: string): string[] {
  const id = userId.trim();
  if (!id || userIds.includes(id)) return userIds;
  return [...userIds, id];
}

function useForeground(): boolean {
  const [foreground, setForeground] = React.useState(AppState.currentState === 'active');
  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active');
    });
    return () => subscription.remove();
  }, []);
  return foreground;
}

export function useMemberConnections() {
  const session = useClerkAuthSnapshot();
  const enabled = isMemberConnectionsIntegrationEnabled();
  const foreground = useForeground();
  const accountId = session?.isLoaded && session.isSignedIn === true ? session.userId : null;
  const accountRef = React.useRef(accountId);
  const sessionRef = React.useRef(session);
  const generationRef = React.useRef(0);
  sessionRef.current = session;

  const [focused, setFocused] = React.useState(false);
  const [incoming, setIncoming] = React.useState<ConnectionRelationship[]>([]);
  const [outgoing, setOutgoing] = React.useState<OutgoingConnectionRequest[]>([]);
  const [pendingOutgoingRecipientUserIds, setPendingOutgoingRecipientUserIds] = React.useState<string[]>([]);
  const [outgoingSupported, setOutgoingSupported] = React.useState(false);
  const [accepted, setAccepted] = React.useState<AcceptedConnection[]>([]);
  const [status, setStatus] = React.useState<'disabled' | 'signed-out' | 'loading' | 'ready' | 'error'>(
    !enabled ? 'disabled' : accountId ? 'loading' : 'signed-out',
  );
  const [message, setMessage] = React.useState<string | null>(null);
  const [discovery, setDiscovery] = React.useState<DiscoveredConnectionMember | null | undefined>(undefined);
  /** Task #1844 409 facts that hide Send Request for known pending/accepted/incoming. */
  const [relationshipOverrides, setRelationshipOverrides] = React.useState<
    Record<string, DiscoveredMemberState>
  >({});
  const [refreshing, setRefreshing] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [socketLive, setSocketLive] = React.useState(false);
  const pendingRef = React.useRef(false);
  const inFlight = React.useRef<string | null>(null);
  const outgoingRef = React.useRef<OutgoingConnectionRequest[]>([]);
  const pendingOutgoingRecipientUserIdsRef = React.useRef<string[]>([]);
  const pendingOutgoingReceiptsRef = React.useRef<PendingOutgoingRequestReceipt[]>([]);
  const outgoingSupportedRef = React.useRef(false);
  outgoingRef.current = outgoing;
  pendingOutgoingRecipientUserIdsRef.current = pendingOutgoingRecipientUserIds;
  outgoingSupportedRef.current = outgoingSupported;

  if (accountRef.current !== accountId) {
    accountRef.current = accountId;
    generationRef.current += 1;
    setIncoming([]);
    setOutgoing([]);
    setPendingOutgoingRecipientUserIds([]);
    pendingOutgoingReceiptsRef.current = [];
    setOutgoingSupported(false);
    setAccepted([]);
    setDiscovery(undefined);
    setRelationshipOverrides({});
    setMessage(null);
    setStatus(!enabled ? 'disabled' : accountId ? 'loading' : 'signed-out');
  }

  const current = React.useCallback((requestedAccountId: string, requestedGeneration: number, aborted: boolean) => {
    return requestedGeneration === generationRef.current && isClerkBluebirdProfileResultCurrent({
      requestedClerkUserId: requestedAccountId,
      currentClerkUserId: accountRef.current,
      aborted,
    });
  }, []);

  const load = React.useCallback(async (requestedAccountId: string, requestedGeneration: number, signal: AbortSignal) => {
    if (!enabled) {
      clearMemberConnectionsCache();
      return;
    }
    if (inFlight.current === requestedAccountId) return;
    const configuration = getMainBluebirdApiConfigurationOrNull();
    if (!configuration) {
      if (current(requestedAccountId, requestedGeneration, signal.aborted)) {
        setStatus('error');
        setMessage(FAILURE_COPY.configuration);
      }
      return;
    }
    inFlight.current = requestedAccountId;
    retainMemberConnectionsForAccount(requestedAccountId);
    try {
      const cached = readMemberConnectionsSnapshot({
        environment: configuration.environment,
        apiBaseUrl: configuration.apiBaseUrl,
        clerkUserId: requestedAccountId,
      });
      if (cached && current(requestedAccountId, requestedGeneration, signal.aborted)) {
        setIncoming(cached.incoming);
        setOutgoing(cached.outgoing);
        setPendingOutgoingRecipientUserIds(cached.pendingOutgoingRecipientUserIds);
        pendingOutgoingReceiptsRef.current = cached.pendingOutgoingRequestReceipts ?? [];
        setOutgoingSupported(cached.outgoingSupported);
        setAccepted(cached.accepted);
        setStatus('ready');
      }
      const client = createMemberConnectionsClient({
        enabled: true,
        environment: configuration.environment,
        baseUrl: configuration.apiBaseUrl,
        getAccessToken: () => sessionRef.current?.getToken() ?? Promise.resolve(null),
      });
      const listRequestedAt = Date.now();
      const [incomingResult, acceptedResult, outgoingResult] = await Promise.all([
        client.listIncoming(),
        client.listAccepted(),
        client.listOutgoing(),
      ]);
      if (!current(requestedAccountId, requestedGeneration, signal.aborted)) return;
      if (
        incomingResult.kind === 'disabled' ||
        acceptedResult.kind === 'disabled' ||
        outgoingResult.kind === 'disabled'
      ) {
        clearMemberConnectionsCache();
        setIncoming([]);
        setOutgoing([]);
        setPendingOutgoingRecipientUserIds([]);
        pendingOutgoingReceiptsRef.current = [];
        setOutgoingSupported(false);
        setAccepted([]);
        setStatus('disabled');
        return;
      }
      if (incomingResult.kind === 'error' && incomingResult.code === 'cancelled') return;
      if (acceptedResult.kind === 'error' && acceptedResult.code === 'cancelled') return;
      if (outgoingResult.kind === 'error' && outgoingResult.code === 'cancelled') return;
      if (incomingResult.kind === 'error' || acceptedResult.kind === 'error') {
        const code = incomingResult.kind === 'error' ? incomingResult.code : acceptedResult.kind === 'error' ? acceptedResult.code : 'unavailable';
        setStatus(cached ? 'ready' : 'error');
        setMessage(FAILURE_COPY[code]);
        return;
      }

      let nextOutgoing = outgoingRef.current;
      let nextOutgoingSupported = outgoingSupportedRef.current;
      let nextPendingRecipientUserIds = pendingOutgoingRecipientUserIdsRef.current;
      let outgoingMessage: string | null = null;
      if (outgoingResult.kind === 'loaded') {
        nextOutgoing = outgoingResult.data.requests;
        nextOutgoingSupported = true;
        // Redacted GET has no recipient user IDs — keep create-confirmed IDs only,
        // releasing those whose request ID this newer list no longer reports pending.
        const reconciled = reconcilePendingOutgoingRecipients({
          recipientUserIds: pendingOutgoingRecipientUserIdsRef.current,
          receipts: pendingOutgoingReceiptsRef.current,
          outgoing: outgoingResult.data.requests,
          listRequestedAt,
        });
        nextPendingRecipientUserIds = reconciled.recipientUserIds;
        pendingOutgoingRecipientUserIdsRef.current = reconciled.recipientUserIds;
        pendingOutgoingReceiptsRef.current = reconciled.receipts;
      } else if (outgoingResult.code === 'outgoing_unsupported') {
        nextOutgoingSupported = false;
        nextOutgoing = outgoingRef.current;
        nextPendingRecipientUserIds = pendingOutgoingRecipientUserIdsRef.current;
      } else {
        outgoingMessage = FAILURE_COPY[outgoingResult.code] || 'Sent requests couldn’t be loaded. Try again.';
        nextOutgoing = outgoingRef.current;
        nextPendingRecipientUserIds = pendingOutgoingRecipientUserIdsRef.current;
      }

      setIncoming(incomingResult.data.requests);
      setOutgoing(nextOutgoing);
      setPendingOutgoingRecipientUserIds(nextPendingRecipientUserIds);
      setOutgoingSupported(nextOutgoingSupported);
      setAccepted(acceptedResult.data.connections);
      setStatus('ready');
      setMessage(outgoingMessage);
      rememberMemberConnectionsSnapshot({
        clerkUserId: requestedAccountId,
        environment: configuration.environment,
        apiBaseUrl: configuration.apiBaseUrl,
        incoming: incomingResult.data.requests,
        outgoing: nextOutgoing,
        pendingOutgoingRecipientUserIds: nextPendingRecipientUserIds,
        pendingOutgoingRequestReceipts: pendingOutgoingReceiptsRef.current,
        accepted: acceptedResult.data.connections,
        outgoingSupported: nextOutgoingSupported,
      });
    } finally {
      if (inFlight.current === requestedAccountId) inFlight.current = null;
    }
  }, [current, enabled]);

  useFocusEffect(React.useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));

  React.useEffect(() => {
    if (!enabled) {
      clearMemberConnectionsCache();
      setStatus('disabled');
      setIncoming([]);
      setOutgoing([]);
      setPendingOutgoingRecipientUserIds([]);
      setOutgoingSupported(false);
      setAccepted([]);
      return;
    }
    if (!accountId) {
      clearMemberConnectionsCache();
      setStatus('signed-out');
      return;
    }
    if (!focused || !foreground) return;
    const requestedAccountId = accountId;
    const requestedGeneration = generationRef.current;
    const controller = new AbortController();
    void load(requestedAccountId, requestedGeneration, controller.signal);
    const pollMs = connectionRefreshIntervalMs({
      realtimeEnabled: isMemberMessageRealtimeEnabled(),
      socketLive,
    });
    const timer = pollMs === null
      ? null
      : setInterval(() => {
        void load(requestedAccountId, requestedGeneration, new AbortController().signal);
      }, pollMs);
    return () => {
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [accountId, enabled, focused, foreground, load, socketLive]);

  React.useEffect(() => subscribeMemberMessageSocketLive(setSocketLive), []);

  React.useEffect(() => {
    if (!enabled || !accountId) return;
    return subscribeMemberMessageHints((hint) => {
      if (hint.clerkUserId !== accountId || !realtimeHintRequestsConnections(hint)) return;
      void load(accountId, generationRef.current, new AbortController().signal);
    });
  }, [accountId, enabled, load]);

  React.useEffect(() => {
    if (!enabled || !accountId) return;
    return subscribeMemberSafetyRefresh(() => {
      void load(accountId, generationRef.current, new AbortController().signal);
    });
  }, [accountId, enabled, load]);

  const refresh = React.useCallback(async () => {
    if (!enabled || !accountId) return;
    setRefreshing(true);
    try {
      await load(accountId, generationRef.current, new AbortController().signal);
    } finally {
      if (accountRef.current === accountId) setRefreshing(false);
    }
  }, [accountId, enabled, load]);

  const rememberLocalOutgoing = React.useCallback((
    requestedAccountId: string,
    created: ConnectionRelationship,
  ) => {
    const configuration = getMainBluebirdApiConfigurationOrNull();
    const projected = projectOutgoingConnectionRequest(created);
    const recipientUserId = created.recipient.userId.trim();
    if (recipientUserId && created.status === 'pending') {
      pendingOutgoingReceiptsRef.current = [
        ...pendingOutgoingReceiptsRef.current.filter((receipt) => receipt.requestId !== created.id),
        { recipientUserId, requestId: created.id, confirmedAt: Date.now() },
      ];
    }
    setOutgoing((previous) => {
      const nextOutgoing = upsertOutgoingRequest(previous, projected);
      setPendingOutgoingRecipientUserIds((previousIds) => {
        const nextIds = upsertPendingRecipientUserId(previousIds, recipientUserId);
        if (configuration) {
          const cached = readMemberConnectionsSnapshot({
            environment: configuration.environment,
            apiBaseUrl: configuration.apiBaseUrl,
            clerkUserId: requestedAccountId,
          });
          rememberMemberConnectionsSnapshot({
            clerkUserId: requestedAccountId,
            environment: configuration.environment,
            apiBaseUrl: configuration.apiBaseUrl,
            incoming: cached?.incoming ?? [],
            outgoing: nextOutgoing,
            pendingOutgoingRecipientUserIds: nextIds,
            pendingOutgoingRequestReceipts: pendingOutgoingReceiptsRef.current,
            accepted: cached?.accepted ?? [],
            outgoingSupported: outgoingSupportedRef.current,
          });
        }
        return nextIds;
      });
      return nextOutgoing;
    });
  }, []);

  const runMutation = React.useCallback(async (
    work: () => Promise<
      | { ok: true; notice: string | null; clearMessage?: boolean; createdOutgoing?: ConnectionRelationship }
      | { ok: false; message: string }
    >,
  ) => {
    if (!enabled || !accountId || pendingRef.current) return false;
    pendingRef.current = true;
    setPending(true);
    const requestedAccountId = accountId;
    const requestedGeneration = generationRef.current;
    try {
      const outcome = await work();
      if (!current(requestedAccountId, requestedGeneration, false)) return false;
      if (!outcome.ok) {
        setMessage(outcome.message);
        return false;
      }
      // Drop a stale unclassified-409 sentence before refresh. A focused
      // reload can no-op while another list request is in flight.
      if (outcome.clearMessage) setMessage(null);
      await load(requestedAccountId, requestedGeneration, new AbortController().signal);
      if (!current(requestedAccountId, requestedGeneration, false)) return false;
      // Confirmed create: keep redacted display row + recipient userId for Find Member.
      // Required when GET outgoing is unsupported; also needed when GET is redacted.
      if (outcome.createdOutgoing) {
        rememberLocalOutgoing(requestedAccountId, outcome.createdOutgoing);
      }
      if (outcome.notice) setMessage(outcome.notice);
      return true;
    } finally {
      pendingRef.current = false;
      if (accountRef.current === requestedAccountId) setPending(false);
    }
  }, [accountId, current, enabled, load, rememberLocalOutgoing]);

  const clientForAccount = React.useCallback(() => {
    const configuration = getMainBluebirdApiConfigurationOrNull();
    if (!configuration) return null;
    return createMemberConnectionsClient({
      enabled,
      environment: configuration.environment,
      baseUrl: configuration.apiBaseUrl,
      getAccessToken: () => sessionRef.current?.getToken() ?? Promise.resolve(null),
    });
  }, [enabled]);

  return {
    enabled,
    status,
    message,
    incoming,
    outgoing,
    /**
     * Recipient user IDs from confirmed creates in this account session only.
     * Redacted GET outgoing cannot populate this — do not match Find Member by name.
     */
    pendingOutgoingRecipientUserIds,
    outgoingSupported,
    accepted,
    discovery,
    relationshipOverrides,
    refreshing,
    pending,
    refresh,
    accountId,
    clearDiscovery: () => setDiscovery(undefined),
    discover: (input: { email?: string; phoneE164?: string }) => runMutation(async () => {
      const client = clientForAccount();
      if (!client) return { ok: false, message: FAILURE_COPY.configuration };
      const result = await client.discover(input);
      if (result.kind === 'disabled') return { ok: false, message: FAILURE_COPY.configuration };
      if (result.kind === 'error') return { ok: false, message: FAILURE_COPY[result.code] };
      setDiscovery(result.data.member);
      const discoveredState = discoveredStateFromDiscoveryMember(result.data.member);
      if (result.data.member?.userId) {
        const userId = result.data.member.userId;
        setRelationshipOverrides((previous) => {
          if (!(userId in previous)) return previous;
          const next = { ...previous };
          delete next[userId];
          return next;
        });
        // Explicit "no relationship" replaces a stale local pending mark.
        if (discoveredState === 'available') {
          const nextIds = pendingOutgoingRecipientUserIdsRef.current.filter((id) => id !== userId);
          if (nextIds.length !== pendingOutgoingRecipientUserIdsRef.current.length) {
            pendingOutgoingRecipientUserIdsRef.current = nextIds;
            setPendingOutgoingRecipientUserIds(nextIds);
          }
        }
      }
      // Persist server-confirmed pending for this account session (survives Find Member).
      // Never clear session-local pending on discover false (may be stale).
      if (result.data.member?.outgoingRequestPending === true) {
        const configuration = getMainBluebirdApiConfigurationOrNull();
        const recipientUserId = result.data.member.userId;
        const nextIds = upsertPendingRecipientUserId(
          pendingOutgoingRecipientUserIdsRef.current,
          recipientUserId,
        );
        pendingOutgoingRecipientUserIdsRef.current = nextIds;
        setPendingOutgoingRecipientUserIds(nextIds);
        if (configuration && accountRef.current) {
          const cached = readMemberConnectionsSnapshot({
            environment: configuration.environment,
            apiBaseUrl: configuration.apiBaseUrl,
            clerkUserId: accountRef.current,
          });
          rememberMemberConnectionsSnapshot({
            clerkUserId: accountRef.current,
            environment: configuration.environment,
            apiBaseUrl: configuration.apiBaseUrl,
            incoming: cached?.incoming ?? [],
            outgoing: cached?.outgoing ?? outgoingRef.current,
            pendingOutgoingRecipientUserIds: nextIds,
            pendingOutgoingRequestReceipts: pendingOutgoingReceiptsRef.current,
            accepted: cached?.accepted ?? [],
            outgoingSupported: outgoingSupportedRef.current,
          });
        }
      }
      return {
        ok: true,
        clearMessage: result.data.member != null,
        notice: result.data.member
          ? null
          : input.phoneE164 && !input.email
            ? 'No member matched that phone number.'
            : 'No member matched that exact email or phone.',
      };
    }),
    sendRequest: (member: ConnectionMemberIdentity) => runMutation(async () => {
      const client = clientForAccount();
      if (!client) return { ok: false, message: FAILURE_COPY.configuration };
      if (pendingOutgoingRecipientUserIdsRef.current.includes(member.userId)) {
        return {
          ok: false,
          message: presentConnectionRequestConflict({ status: 'pending', direction: 'outgoing' }),
        };
      }
      const result = await client.createRequest(member.userId);
      if (result.kind === 'disabled') return { ok: false, message: FAILURE_COPY.configuration };
      if (result.kind === 'error') {
        const relationship = 'relationship' in result ? result.relationship : undefined;
        const discoveryState = discovery?.userId === member.userId
          ? discoveredStateFromDiscoveryMember(discovery)
          : null;
        // A fresh discover that explicitly reports no relationship is authoritative.
        // A later bare 409 must not put Send Request back behind "status unavailable".
        if (result.code === 'conflict' && !relationship && discoveryState === 'available') {
          setRelationshipOverrides((previous) => {
            if (!(member.userId in previous)) return previous;
            const next = { ...previous };
            delete next[member.userId];
            return next;
          });
          return {
            ok: false,
            message: 'The request was not sent. No existing connection was confirmed, so you can try again.',
          };
        }
        let acceptedUserIds = accepted.map((row) => row.member.userId);
        let incomingRequesterIds = incoming.map((row) => row.requester.userId);
        const outgoingRecipientIds = pendingOutgoingRecipientUserIdsRef.current;

        // Generic Production 409 (no Task #1844 fields): refresh authenticated lists
        // so Find Member can use server evidence only — never invent "Request pending".
        const discoverPending = discovery?.userId === member.userId
          ? discovery.outgoingRequestPending
          : undefined;
        if (result.code === 'conflict' && !relationship) {
          const [nextIncoming, nextAccepted, nextOutgoing] = await Promise.all([
            client.listIncoming(),
            client.listAccepted(),
            client.listOutgoing(),
          ]);
          if (nextIncoming.kind === 'loaded') {
            setIncoming(nextIncoming.data.requests);
            incomingRequesterIds = nextIncoming.data.requests.map((row) => row.requester.userId);
          }
          if (nextAccepted.kind === 'loaded') {
            setAccepted(nextAccepted.data.connections);
            acceptedUserIds = nextAccepted.data.connections.map((row) => row.member.userId);
          }
          if (nextOutgoing.kind === 'loaded') {
            setOutgoing(nextOutgoing.data.requests);
            setOutgoingSupported(true);
          } else if (nextOutgoing.kind === 'error' && nextOutgoing.code === 'outgoing_unsupported') {
            setOutgoingSupported(false);
          }
        }

        const override = resolveConflictDiscoveredState({
          relationship,
          userId: member.userId,
          acceptedUserIds,
          incomingRequesterIds,
          outgoingRecipientIds,
          outgoingRequestPending: discoverPending,
          blockUnspecifiedConflict: result.code === 'conflict',
        });
        if (override) {
          setRelationshipOverrides((previous) => ({ ...previous, [member.userId]: override }));
        }
        if (override === 'outgoing'
          && (relationship?.status === 'pending'
            || discoverPending === true
            || outgoingRecipientIds.includes(member.userId))) {
          // Only mark session pending from server-confirmed evidence.
          const nextIds = upsertPendingRecipientUserId(
            pendingOutgoingRecipientUserIdsRef.current,
            member.userId,
          );
          pendingOutgoingRecipientUserIdsRef.current = nextIds;
          setPendingOutgoingRecipientUserIds(nextIds);
          setDiscovery((current) => (
            current?.userId === member.userId
              ? { ...current, outgoingRequestPending: true }
              : current
          ));
        }
        if (override === 'unavailable') {
          // Clear any previously invented session pending mark for this member.
          const nextIds = pendingOutgoingRecipientUserIdsRef.current.filter(
            (id) => id !== member.userId,
          );
          if (nextIds.length !== pendingOutgoingRecipientUserIdsRef.current.length) {
            pendingOutgoingRecipientUserIdsRef.current = nextIds;
            setPendingOutgoingRecipientUserIds(nextIds);
          }
          setDiscovery((current) => {
            if (current?.userId !== member.userId) return current;
            if (!Object.prototype.hasOwnProperty.call(current, 'outgoingRequestPending')) {
              return current;
            }
            const { outgoingRequestPending: _cleared, ...rest } = current;
            return rest;
          });
        }
        const conflictMessageRelationship = relationship ?? (
          override === 'connected'
            ? { status: 'accepted' as const, direction: null }
            : override === 'incoming'
              ? { status: 'pending' as const, direction: 'incoming' as const }
              : override === 'outgoing'
                ? { status: 'pending' as const, direction: 'outgoing' as const }
                : null
        );
        return {
          ok: false,
          message: result.code === 'conflict'
            ? presentConnectionRequestConflict(conflictMessageRelationship)
            : FAILURE_COPY[result.code],
        };
      }
      setDiscovery(undefined);
      setRelationshipOverrides((previous) => {
        if (!(member.userId in previous)) return previous;
        const next = { ...previous };
        delete next[member.userId];
        return next;
      });
      return {
        ok: true,
        notice: `Request sent to ${connectionMemberLabel(result.data.connection.recipient)}.`,
        createdOutgoing: result.data.connection,
      };
    }),
    accept: (connectionId: number) => runMutation(async () => {
      const client = clientForAccount();
      if (!client) return { ok: false, message: FAILURE_COPY.configuration };
      const result = await client.accept(connectionId);
      if (result.kind === 'disabled') return { ok: false, message: FAILURE_COPY.configuration };
      if (result.kind === 'error') return { ok: false, message: FAILURE_COPY[result.code] };
      // HTTP-only: nudge Messages inbox + Connections subscribers (gateway optional).
      if (accountRef.current) {
        publishMemberMessageHint({
          kind: 'connection-accepted',
          clerkUserId: accountRef.current,
          connectionId,
        });
      }
      return { ok: true, notice: null };
    }),
    decline: (connectionId: number) => runMutation(async () => {
      const client = clientForAccount();
      if (!client) return { ok: false, message: FAILURE_COPY.configuration };
      const result = await client.decline(connectionId);
      if (result.kind === 'disabled') return { ok: false, message: FAILURE_COPY.configuration };
      if (result.kind === 'error') return { ok: false, message: FAILURE_COPY[result.code] };
      return { ok: true, notice: null };
    }),
    remove: (connectionId: number) => runMutation(async () => {
      const client = clientForAccount();
      if (!client) return { ok: false, message: FAILURE_COPY.configuration };
      const result = await client.remove(connectionId);
      if (result.kind === 'disabled') return { ok: false, message: FAILURE_COPY.configuration };
      if (result.kind === 'error') return { ok: false, message: FAILURE_COPY[result.code] };
      return { ok: true, notice: null };
    }),
  };
}
