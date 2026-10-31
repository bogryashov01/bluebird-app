import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/context/AuthContext';
import {
  CONNECTIONS_PREVIEW_TITLE,
  DEMO_CONVERSATION_NOTICE,
  type ConnectionsClient,
  type ConnectionsPreviewFailure,
  type ConnectionsPreviewState,
  createLocalConnectionsClient,
  presentConnections,
  presentConversations,
  presentMemberCards,
  presentRequests,
  shouldApplyConnectionsResult,
  unreadMessageCount,
} from '@/lib/connectionsPreview';

const ACTION_COPY: Record<ConnectionsPreviewFailure, string> = {
  'invalid-account': 'Connections Preview is available for the signed-in account on this device.',
  'unknown-member': 'That demo profile is not available.',
  duplicate: 'A request is already pending on this device.',
  connected: 'This demo profile is already connected on this device.',
  blocked: 'This demo profile is blocked on this device.',
  'not-incoming': 'That incoming request is no longer pending.',
  'not-outgoing': 'That sent request is no longer pending.',
  'not-connected': 'New messages cannot be sent after a connection is removed or blocked.',
  'missing-conversation': 'That demo conversation is not on this device.',
  'empty-message': 'Enter a message.',
  'message-too-long': 'Messages are limited to 2,000 characters.',
  corrupt: 'Saved Connections Preview data on this device could not be read.',
  unavailable: 'Connections Preview could not be saved on this device.',
};

function createClock() {
  let sequence = 0;
  return {
    now: () => new Date().toISOString(),
    nextId: (prefix: string) => {
      sequence += 1;
      const suffix = `${Date.now().toString(36)}${sequence.toString(36)}`.toLowerCase().replace(/[^a-z0-9]/g, '');
      return `demo-${prefix}-${suffix}`.slice(0, 70);
    },
  };
}

export function useConnectionsPreview(search = '') {
  const { authMode, clerkUserId } = useAuth();
  const accountId = authMode === 'clerk' && clerkUserId ? clerkUserId : null;
  const accountRef = React.useRef(accountId);
  const generationRef = React.useRef(0);
  const revisionRef = React.useRef(0);
  const clientRef = React.useRef<ConnectionsClient | null>(null);
  const clientAccountRef = React.useRef<string | null>(null);
  const [state, setState] = React.useState<ConnectionsPreviewState | null>(null);
  const [status, setStatus] = React.useState<'signed-out' | 'loading' | 'ready' | 'error'>(
    accountId ? 'loading' : 'signed-out',
  );
  const [actionMessage, setActionMessage] = React.useState<string | null>(null);

  if (accountRef.current !== accountId) {
    accountRef.current = accountId;
    generationRef.current += 1;
    revisionRef.current += 1;
    clientRef.current = null;
    clientAccountRef.current = null;
    setState(null);
    setActionMessage(null);
    setStatus(accountId ? 'loading' : 'signed-out');
  }

  const apply = React.useCallback((
    requestedAccountId: string,
    requestedGeneration: number,
    result: { ok: true; data: ConnectionsPreviewState } | { ok: false; reason: ConnectionsPreviewFailure },
  ): boolean => {
    if (!shouldApplyConnectionsResult({
      requestedAccountId,
      requestedGeneration,
      activeAccountId: accountRef.current,
      activeGeneration: generationRef.current,
    })) return false;
    if (!result.ok) {
      setStatus('error');
      setActionMessage(ACTION_COPY[result.reason]);
      return false;
    }
    setState(result.data);
    setStatus('ready');
    setActionMessage(null);
    return true;
  }, []);

  const clientFor = React.useCallback((requestedAccountId: string) => {
    if (!clientRef.current || clientAccountRef.current !== requestedAccountId) {
      clientAccountRef.current = requestedAccountId;
      clientRef.current = createLocalConnectionsClient(AsyncStorage, requestedAccountId, createClock());
    }
    return clientRef.current;
  }, []);

  const reload = React.useCallback(() => {
    if (!accountId) return;
    const requestedAccountId = accountId;
    const requestedGeneration = generationRef.current;
    const requestedRevision = revisionRef.current;
    void clientFor(requestedAccountId).load().then((result) => {
      if (requestedRevision !== revisionRef.current) return;
      apply(requestedAccountId, requestedGeneration, result);
    });
  }, [accountId, apply, clientFor]);

  React.useEffect(() => {
    reload();
  }, [reload]);

  const run = React.useCallback(async (
    work: (client: ConnectionsClient) => Promise<{ ok: true; data: ConnectionsPreviewState } | { ok: false; reason: ConnectionsPreviewFailure }>,
  ) => {
    if (!accountId) return null;
    const requestedAccountId = accountId;
    const requestedGeneration = generationRef.current;
    revisionRef.current += 1;
    const result = await work(clientFor(requestedAccountId));
    revisionRef.current += 1;
    if (!shouldApplyConnectionsResult({
      requestedAccountId,
      requestedGeneration,
      activeAccountId: accountRef.current,
      activeGeneration: generationRef.current,
    })) return null;
    if (!result.ok) {
      if (result.reason === 'corrupt' || result.reason === 'unavailable' || result.reason === 'invalid-account') {
        setStatus('error');
      }
      const message = ACTION_COPY[result.reason];
      setActionMessage(message);
      return message;
    }
    setState(result.data);
    setStatus('ready');
    setActionMessage(null);
    return null;
  }, [accountId, clientFor]);

  const visible = status === 'ready' && state ? state : null;

  return {
    accountId,
    title: CONNECTIONS_PREVIEW_TITLE,
    notice: DEMO_CONVERSATION_NOTICE,
    status,
    actionMessage,
    unreadCount: visible ? unreadMessageCount(visible) : 0,
    members: visible ? presentMemberCards(visible, search) : [],
    requests: visible ? presentRequests(visible) : { incoming: [], outgoing: [] },
    connections: visible ? presentConnections(visible) : [],
    conversations: visible ? presentConversations(visible) : [],
    messages: visible ? visible.messages : [],
    refresh: reload,
    clearActionMessage: () => setActionMessage(null),
    sendRequest: (memberId: string) => run((client) => client.createRequest(memberId)),
    acceptRequest: (requestId: string) => run((client) => client.acceptRequest(requestId)),
    declineRequest: (requestId: string) => run((client) => client.declineRequest(requestId)),
    cancelRequest: (requestId: string) => run((client) => client.cancelRequest(requestId)),
    removeConnection: (connectionId: string) => run((client) => client.removeConnection(connectionId)),
    blockMember: (connectionId: string) => run((client) => client.blockMember(connectionId)),
    openConversation: async (connectionId: string) => {
      if (!accountId) return null;
      const requestedAccountId = accountId;
      const requestedGeneration = generationRef.current;
      revisionRef.current += 1;
      const result = await clientFor(requestedAccountId).openConversation(connectionId);
      revisionRef.current += 1;
      if (!shouldApplyConnectionsResult({
        requestedAccountId,
        requestedGeneration,
        activeAccountId: accountRef.current,
        activeGeneration: generationRef.current,
      })) return null;
      if (!result.ok) {
        setActionMessage(ACTION_COPY[result.reason]);
        return null;
      }
      setState(result.data.state);
      setStatus('ready');
      return result.data.conversationId;
    },
    sendMessage: async (conversationId: string, body: string) => {
      if (!accountId) return 'Connections Preview is available for the signed-in account on this device.';
      const requestedAccountId = accountId;
      const requestedGeneration = generationRef.current;
      revisionRef.current += 1;
      const result = await clientFor(requestedAccountId).sendMessage(conversationId, body);
      revisionRef.current += 1;
      if (!shouldApplyConnectionsResult({
        requestedAccountId,
        requestedGeneration,
        activeAccountId: accountRef.current,
        activeGeneration: generationRef.current,
      })) return null;
      if (!result.ok) {
        const message = ACTION_COPY[result.reason];
        setActionMessage(message);
        return message;
      }
      setState(result.data.state);
      setStatus('ready');
      setActionMessage(null);
      return null;
    },
    markRead: (conversationId: string) => run((client) => client.markConversationRead(conversationId)),
  };
}
