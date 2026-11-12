import React from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { isClerkBluebirdProfileResultCurrent } from '@/lib/clerkBluebirdProfile';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import {
  clearMemberMessagesCache,
  createMemberMessagesClient,
  isMemberMessagesIntegrationEnabled,
  nextMemberMessageSend,
  readMemberMessagesSnapshot,
  refreshMemberMessageThreadLatest,
  rememberMemberMessagesSnapshot,
  retainMemberMessagesForAccount,
  type MemberMessage,
  type MemberMessagesFailure,
  type MessageConversation,
  type MessageReadState,
} from '@/lib/memberMessages';
import {
  isMemberMessageRealtimeEnabled,
  memberMessagePollIntervalMs,
  publishMemberMessageHint,
  realtimeHintRequestsHistory,
  realtimeHintRequestsInbox,
  subscribeMemberMessageHints,
  subscribeMemberMessageSocketLive,
} from '@/lib/memberMessageRealtime';

const FAILURE_COPY: Record<MemberMessagesFailure, string> = {
  configuration: 'Messages are not available yet.',
  token: 'Sign in again to view messages.',
  network: 'Messages could not be loaded. Try again.',
  timeout: 'Messages could not be loaded. Try again.',
  cancelled: '',
  schema: 'Messages could not be read.',
  invalid_body: 'That message could not be sent.',
  invalid_message: 'Messages must be 1–4,000 characters.',
  invalid_participant: 'Choose an accepted connection before sending a message.',
  invalid_conversation: 'That conversation is not available.',
  invalid_cursor: 'Older messages could not be loaded.',
  invalid_page_size: 'Older messages could not be loaded.',
  unauthorized: 'Sign in again to view messages.',
  membership_required: 'An active Bluebird membership is required.',
  connection_required: 'Messages are available for accepted connections.',
  not_found: 'That conversation is no longer available.',
  conflict: 'That conversation could not be opened. Try again.',
  unavailable: 'Messages could not be loaded. Try again.',
};

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

function useClient(enabled: boolean) {
  const session = useClerkAuthSnapshot();
  const sessionRef = React.useRef(session);
  sessionRef.current = session;
  const accountId = session?.isLoaded && session.isSignedIn === true ? session.userId : null;
  const clientForAccount = React.useCallback(() => {
    if (!enabled) return createMemberMessagesClient({
      enabled: false,
      environment: 'production',
      baseUrl: 'https://bluebirdjets.com/api',
      getAccessToken: async () => null,
    });
    const configuration = getMainBluebirdApiConfigurationOrNull();
    if (!configuration) return null;
    return createMemberMessagesClient({
      enabled: true,
      environment: configuration.environment,
      baseUrl: configuration.apiBaseUrl,
      getAccessToken: () => sessionRef.current?.getToken() ?? Promise.resolve(null),
    });
  }, [enabled]);
  return { accountId, clientForAccount, sessionRef };
}

function rememberUnreadFromReadState(input: {
  clerkUserId: string;
  conversationId: number;
  state: MessageReadState;
}) {
  const configuration = getMainBluebirdApiConfigurationOrNull();
  if (!configuration) return;
  const existing = readMemberMessagesSnapshot({
    environment: configuration.environment,
    apiBaseUrl: configuration.apiBaseUrl,
    clerkUserId: input.clerkUserId,
  });
  rememberMemberMessagesSnapshot({
    clerkUserId: input.clerkUserId,
    environment: configuration.environment,
    apiBaseUrl: configuration.apiBaseUrl,
    unreadCount: input.state.unreadCount,
    conversations: (existing?.conversations ?? []).map((conversation) => (
      conversation.id === input.conversationId
        ? { ...conversation, unreadCount: 0 }
        : conversation
    )),
  });
  publishMemberMessageHint({
    kind: 'unread',
    clerkUserId: input.clerkUserId,
    conversationId: input.conversationId,
  });
}

/**
 * Keeps the Connections tab badge aligned with the production unread-count
 * endpoint and the shared messages snapshot. Polls while the app is
 * foregrounded; does not require the Connections tab to be focused.
 */
export function useMemberMessagesUnreadCount(): number {
  const enabled = isMemberMessagesIntegrationEnabled();
  const foreground = useForeground();
  const { accountId, clientForAccount } = useClient(enabled);
  const accountRef = React.useRef(accountId);
  const generationRef = React.useRef(0);
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [socketLive, setSocketLive] = React.useState(false);
  const inFlight = React.useRef(false);

  if (accountRef.current !== accountId) {
    accountRef.current = accountId;
    generationRef.current += 1;
    setUnreadCount(0);
  }

  const current = React.useCallback((requestedAccountId: string, requestedGeneration: number) => {
    return requestedGeneration === generationRef.current && isClerkBluebirdProfileResultCurrent({
      requestedClerkUserId: requestedAccountId,
      currentClerkUserId: accountRef.current,
      aborted: false,
    });
  }, []);

  const load = React.useCallback(async (requestedAccountId: string, requestedGeneration: number) => {
    if (!enabled || inFlight.current) return;
    const configuration = getMainBluebirdApiConfigurationOrNull();
    const client = clientForAccount();
    if (!configuration || !client) return;
    inFlight.current = true;
    retainMemberMessagesForAccount(requestedAccountId);
    try {
      const result = await client.unreadCount();
      if (!current(requestedAccountId, requestedGeneration)) return;
      if (result.kind !== 'loaded') return;
      setUnreadCount(result.data.unreadCount);
      const existing = readMemberMessagesSnapshot({
        environment: configuration.environment,
        apiBaseUrl: configuration.apiBaseUrl,
        clerkUserId: requestedAccountId,
      });
      rememberMemberMessagesSnapshot({
        clerkUserId: requestedAccountId,
        environment: configuration.environment,
        apiBaseUrl: configuration.apiBaseUrl,
        conversations: existing?.conversations ?? [],
        unreadCount: result.data.unreadCount,
      });
    } finally {
      inFlight.current = false;
    }
  }, [clientForAccount, current, enabled]);

  React.useEffect(() => {
    if (!enabled || !accountId) {
      setUnreadCount(0);
      return;
    }
    if (!foreground) return;
    const requestedAccountId = accountId;
    const requestedGeneration = generationRef.current;
    const configuration = getMainBluebirdApiConfigurationOrNull();
    if (configuration) {
      const cached = readMemberMessagesSnapshot({
        environment: configuration.environment,
        apiBaseUrl: configuration.apiBaseUrl,
        clerkUserId: requestedAccountId,
      });
      if (cached) setUnreadCount(cached.unreadCount);
    }
    void load(requestedAccountId, requestedGeneration);
    const pollMs = memberMessagePollIntervalMs({
      realtimeEnabled: isMemberMessageRealtimeEnabled(),
      socketLive,
    });
    if (pollMs === null) return;
    const timer = setInterval(() => {
      void load(requestedAccountId, requestedGeneration);
    }, pollMs);
    return () => clearInterval(timer);
  }, [accountId, enabled, foreground, load, socketLive]);

  React.useEffect(() => subscribeMemberMessageSocketLive(setSocketLive), []);

  React.useEffect(() => {
    if (!enabled || !accountId) return;
    return subscribeMemberMessageHints((hint) => {
      if (!realtimeHintRequestsInbox(hint) || hint.clerkUserId !== accountId) return;
      const configuration = getMainBluebirdApiConfigurationOrNull();
      if (configuration) {
        const cached = readMemberMessagesSnapshot({
          environment: configuration.environment,
          apiBaseUrl: configuration.apiBaseUrl,
          clerkUserId: accountId,
        });
        if (cached) setUnreadCount(cached.unreadCount);
      }
      void load(accountId, generationRef.current);
    });
  }, [accountId, enabled, load]);

  return enabled && accountId ? unreadCount : 0;
}

export function useMemberConversations(active: boolean) {
  const enabled = isMemberMessagesIntegrationEnabled();
  const foreground = useForeground();
  const { accountId, clientForAccount } = useClient(enabled);
  const accountRef = React.useRef(accountId);
  const generationRef = React.useRef(0);
  const [focused, setFocused] = React.useState(false);
  const [conversations, setConversations] = React.useState<MessageConversation[]>([]);
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [status, setStatus] = React.useState<'disabled' | 'signed-out' | 'loading' | 'ready' | 'error'>(
    !enabled ? 'disabled' : accountId ? 'loading' : 'signed-out',
  );
  const [message, setMessage] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const [socketLive, setSocketLive] = React.useState(false);
  const inFlight = React.useRef<string | null>(null);

  if (accountRef.current !== accountId) {
    accountRef.current = accountId;
    generationRef.current += 1;
    setConversations([]);
    setUnreadCount(0);
    setMessage(null);
    setStatus(!enabled ? 'disabled' : accountId ? 'loading' : 'signed-out');
  }

  const current = React.useCallback((requestedAccountId: string, requestedGeneration: number) => {
    return requestedGeneration === generationRef.current && isClerkBluebirdProfileResultCurrent({
      requestedClerkUserId: requestedAccountId,
      currentClerkUserId: accountRef.current,
      aborted: false,
    });
  }, []);

  const load = React.useCallback(async (requestedAccountId: string, requestedGeneration: number) => {
    if (!enabled) {
      clearMemberMessagesCache();
      return;
    }
    if (inFlight.current === requestedAccountId) return;
    const configuration = getMainBluebirdApiConfigurationOrNull();
    const client = clientForAccount();
    if (!configuration || !client) {
      if (current(requestedAccountId, requestedGeneration)) {
        setStatus('error');
        setMessage(FAILURE_COPY.configuration);
      }
      return;
    }
    inFlight.current = requestedAccountId;
    retainMemberMessagesForAccount(requestedAccountId);
    try {
      const [listResult, unreadResult] = await Promise.all([
        client.listConversations(),
        client.unreadCount(),
      ]);
      if (!current(requestedAccountId, requestedGeneration)) return;
      if (listResult.kind === 'disabled' || unreadResult.kind === 'disabled') {
        clearMemberMessagesCache();
        setConversations([]);
        setUnreadCount(0);
        setStatus('disabled');
        return;
      }
      if (listResult.kind === 'error' || unreadResult.kind === 'error') {
        const code = listResult.kind === 'error' ? listResult.code : unreadResult.kind === 'error' ? unreadResult.code : 'unavailable';
        if (code === 'cancelled') return;
        const cached = readMemberMessagesSnapshot({
          environment: configuration.environment,
          apiBaseUrl: configuration.apiBaseUrl,
          clerkUserId: requestedAccountId,
        });
        setStatus(cached ? 'ready' : 'error');
        setMessage(FAILURE_COPY[code]);
        return;
      }
      setConversations(listResult.data.conversations);
      setUnreadCount(unreadResult.data.unreadCount);
      setStatus('ready');
      setMessage(null);
      rememberMemberMessagesSnapshot({
        clerkUserId: requestedAccountId,
        environment: configuration.environment,
        apiBaseUrl: configuration.apiBaseUrl,
        conversations: listResult.data.conversations,
        unreadCount: unreadResult.data.unreadCount,
      });
    } finally {
      if (inFlight.current === requestedAccountId) inFlight.current = null;
    }
  }, [clientForAccount, current, enabled]);

  useFocusEffect(React.useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));

  React.useEffect(() => {
    if (!enabled) {
      clearMemberMessagesCache();
      setStatus('disabled');
      setConversations([]);
      setUnreadCount(0);
      return;
    }
    if (!accountId) {
      clearMemberMessagesCache();
      setStatus('signed-out');
      setConversations([]);
      setUnreadCount(0);
      return;
    }
    if (!active || !focused || !foreground) return;
    const requestedAccountId = accountId;
    const requestedGeneration = generationRef.current;
    const cached = readMemberMessagesSnapshot({
      environment: getMainBluebirdApiConfigurationOrNull()?.environment ?? '',
      apiBaseUrl: getMainBluebirdApiConfigurationOrNull()?.apiBaseUrl ?? '',
      clerkUserId: requestedAccountId,
    });
    if (cached) {
      setConversations(cached.conversations);
      setUnreadCount(cached.unreadCount);
      setStatus('ready');
    }
    void load(requestedAccountId, requestedGeneration);
    const pollMs = memberMessagePollIntervalMs({
      realtimeEnabled: isMemberMessageRealtimeEnabled(),
      socketLive,
    });
    if (pollMs === null) return;
    const timer = setInterval(() => {
      void load(requestedAccountId, requestedGeneration);
    }, pollMs);
    return () => clearInterval(timer);
  }, [accountId, active, enabled, focused, foreground, load, socketLive]);

  React.useEffect(() => subscribeMemberMessageSocketLive(setSocketLive), []);

  React.useEffect(() => {
    if (!enabled || !accountId) return;
    return subscribeMemberMessageHints((hint) => {
      if (!realtimeHintRequestsInbox(hint) || hint.clerkUserId !== accountId) return;
      void load(accountId, generationRef.current);
    });
  }, [accountId, enabled, load]);

  const refresh = React.useCallback(async () => {
    if (!enabled || !accountId) return;
    setRefreshing(true);
    try {
      await load(accountId, generationRef.current);
    } finally {
      if (accountRef.current === accountId) setRefreshing(false);
    }
  }, [accountId, enabled, load]);

  return { enabled, status, message, conversations, unreadCount, refreshing, refresh };
}

export function useMemberMessageThread(conversationId: number | null) {
  const enabled = isMemberMessagesIntegrationEnabled();
  const foreground = useForeground();
  const { accountId, clientForAccount } = useClient(enabled);
  const accountRef = React.useRef(accountId);
  const conversationRef = React.useRef(conversationId);
  const generationRef = React.useRef(0);
  const [focused, setFocused] = React.useState(false);
  const [messages, setMessages] = React.useState<MemberMessage[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [hasMore, setHasMore] = React.useState(false);
  const [status, setStatus] = React.useState<'disabled' | 'signed-out' | 'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const historyInFlight = React.useRef(false);
  const markReadInFlight = React.useRef(false);
  const historyLockGeneration = React.useRef(0);
  const markReadLockGeneration = React.useRef(0);
  const sendLock = React.useRef(false);
  const markedId = React.useRef<number | null>(null);
  const [socketLive, setSocketLive] = React.useState(false);
  const paged = React.useRef(false);
  const activeRef = React.useRef(false);
  const messagesRef = React.useRef(messages);
  activeRef.current = focused && foreground;
  messagesRef.current = messages;

  if (accountRef.current !== accountId || conversationRef.current !== conversationId) {
    accountRef.current = accountId;
    conversationRef.current = conversationId;
    generationRef.current += 1;
    historyLockGeneration.current += 1;
    markReadLockGeneration.current += 1;
    markedId.current = null;
    historyInFlight.current = false;
    markReadInFlight.current = false;
    paged.current = false;
    setMessages([]);
    setNextCursor(null);
    setHasMore(false);
  }

  const current = React.useCallback((requestedAccountId: string, requestedGeneration: number) => {
    return requestedGeneration === generationRef.current && isClerkBluebirdProfileResultCurrent({
      requestedClerkUserId: requestedAccountId,
      currentClerkUserId: accountRef.current,
      aborted: false,
    });
  }, []);

  const loadLatest = React.useCallback(async (requestedAccountId: string, requestedGeneration: number) => {
    if (!enabled || conversationId === null) return;
    const client = clientForAccount();
    if (!client) {
      if (current(requestedAccountId, requestedGeneration)) {
        setStatus('error');
        setMessage(FAILURE_COPY.configuration);
      }
      return;
    }
    await refreshMemberMessageThreadLatest({
      historyInFlight,
      markReadInFlight,
      historyLockGeneration,
      markReadLockGeneration,
      markedId,
      isCurrent: () => current(requestedAccountId, requestedGeneration),
      isActive: () => activeRef.current,
      fetchHistory: () => client.history({ conversationId }),
      applyDisabled: () => {
        setMessages([]);
        setStatus('disabled');
      },
      applyError: (code) => {
        setStatus(messagesRef.current.length > 0 ? 'ready' : 'error');
        setMessage(FAILURE_COPY[code]);
      },
      applyLoaded: (page) => {
        setMessages((currentMessages) => mergeMessages(currentMessages, page.messages));
        if (!paged.current) {
          setNextCursor(page.nextCursor);
          setHasMore(page.hasMore);
        }
        setStatus('ready');
        setMessage(null);
        const newest = page.messages[page.messages.length - 1];
        return newest?.id ?? null;
      },
      markRead: () => client.markRead(conversationId),
      onReadState: (state) => {
        rememberUnreadFromReadState({
          clerkUserId: requestedAccountId,
          conversationId,
          state,
        });
      },
    });
  }, [clientForAccount, conversationId, current, enabled]);

  useFocusEffect(React.useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));

  React.useEffect(() => {
    if (!enabled) {
      clearMemberMessagesCache();
      setStatus('disabled');
      setMessages([]);
      return;
    }
    if (!accountId) {
      clearMemberMessagesCache();
      setStatus('signed-out');
      setMessages([]);
      return;
    }
    if (conversationId === null) {
      setStatus('error');
      setMessage(FAILURE_COPY.invalid_conversation);
      return;
    }
    if (!focused || !foreground) return;
    const requestedAccountId = accountId;
    const requestedGeneration = generationRef.current;
    void loadLatest(requestedAccountId, requestedGeneration);
    const pollMs = memberMessagePollIntervalMs({
      realtimeEnabled: isMemberMessageRealtimeEnabled(),
      socketLive,
    });
    if (pollMs === null) return;
    const timer = setInterval(() => {
      void loadLatest(requestedAccountId, requestedGeneration);
    }, pollMs);
    return () => clearInterval(timer);
  }, [accountId, conversationId, enabled, focused, foreground, loadLatest, socketLive]);

  React.useEffect(() => subscribeMemberMessageSocketLive(setSocketLive), []);

  React.useEffect(() => {
    if (!enabled || !accountId || conversationId === null) return;
    const requestedConversationId = conversationId;
    return subscribeMemberMessageHints((hint) => {
      if (hint.clerkUserId !== accountId || !realtimeHintRequestsHistory(hint, requestedConversationId)) return;
      void loadLatest(accountId, generationRef.current);
    });
  }, [accountId, conversationId, enabled, loadLatest]);

  const loadEarlier = React.useCallback(async () => {
    if (!enabled || !accountId || conversationId === null || !hasMore || !nextCursor || historyInFlight.current) return;
    const client = clientForAccount();
    if (!client) return;
    const requestedAccountId = accountId;
    const requestedGeneration = generationRef.current;
    historyInFlight.current = true;
    const historyLock = historyLockGeneration.current;
    paged.current = true;
    try {
      const result = await client.history({ conversationId, before: nextCursor });
      if (!current(requestedAccountId, requestedGeneration)) return;
      if (result.kind !== 'loaded') {
        if (result.kind === 'error') setMessage(FAILURE_COPY[result.code]);
        return;
      }
      setMessages((currentMessages) => mergeMessages(result.data.messages, currentMessages));
      setNextCursor(result.data.nextCursor);
      setHasMore(result.data.hasMore);
    } finally {
      if (historyLockGeneration.current === historyLock) {
        historyInFlight.current = false;
      }
    }
  }, [accountId, clientForAccount, conversationId, current, enabled, hasMore, nextCursor]);

  const send = React.useCallback(async (body: string): Promise<boolean> => {
    if (!enabled || !accountId || conversationId === null) return false;
    if (!nextMemberMessageSend({ inFlight: sendLock.current, body })) return false;
    const client = clientForAccount();
    if (!client) {
      setMessage(FAILURE_COPY.configuration);
      return false;
    }
    sendLock.current = true;
    setPending(true);
    const requestedAccountId = accountId;
    const requestedGeneration = generationRef.current;
    try {
      const result = await client.send(conversationId, body);
      if (!current(requestedAccountId, requestedGeneration)) return false;
      if (result.kind !== 'loaded') {
        if (result.kind === 'disabled') setMessage(FAILURE_COPY.configuration);
        if (result.kind === 'error') setMessage(FAILURE_COPY[result.code]);
        return false;
      }
      setMessages((currentMessages) => mergeMessages(currentMessages, [result.data.message]));
      setMessage(null);
      markedId.current = result.data.message.id;
      const read = await client.markRead(conversationId);
      if (current(requestedAccountId, requestedGeneration) && read.kind === 'loaded') {
        rememberUnreadFromReadState({
          clerkUserId: requestedAccountId,
          conversationId,
          state: read.data,
        });
      }
      return true;
    } finally {
      sendLock.current = false;
      if (accountRef.current === requestedAccountId) setPending(false);
    }
  }, [accountId, clientForAccount, conversationId, current, enabled]);

  const configuration = getMainBluebirdApiConfigurationOrNull();
  const participantUserId = accountId && configuration && conversationId !== null
    ? readMemberMessagesSnapshot({
      environment: configuration.environment,
      apiBaseUrl: configuration.apiBaseUrl,
      clerkUserId: accountId,
    })?.conversations.find((item) => item.id === conversationId)?.participantUserId ?? null
    : null;

  return {
    enabled,
    status,
    message,
    messages,
    hasMore: hasMore && nextCursor !== null,
    pending,
    loadEarlier,
    send,
    viewerId: accountId,
    participantUserId,
  };
}

export function useOpenAcceptedConversation() {
  const enabled = isMemberMessagesIntegrationEnabled();
  const { accountId, clientForAccount } = useClient(enabled);
  const pending = React.useRef(false);
  const [opening, setOpening] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  const open = React.useCallback(async (participantUserId: string) => {
    if (!enabled || !accountId || pending.current) return null;
    const client = clientForAccount();
    if (!client) {
      setMessage(FAILURE_COPY.configuration);
      return null;
    }
    pending.current = true;
    setOpening(true);
    try {
      const result = await client.createConversation(participantUserId);
      if (result.kind === 'error') {
        setMessage(FAILURE_COPY[result.code]);
        return result;
      }
      if (result.kind === 'loaded') {
        const configuration = getMainBluebirdApiConfigurationOrNull();
        if (configuration) {
          const existing = readMemberMessagesSnapshot({
            environment: configuration.environment,
            apiBaseUrl: configuration.apiBaseUrl,
            clerkUserId: accountId,
          });
          rememberMemberMessagesSnapshot({
            clerkUserId: accountId,
            environment: configuration.environment,
            apiBaseUrl: configuration.apiBaseUrl,
            unreadCount: existing?.unreadCount ?? 0,
            conversations: [
              result.data.conversation,
              ...(existing?.conversations ?? []).filter((item) => item.id !== result.data.conversation.id),
            ],
          });
        }
        setMessage(null);
      }
      return result;
    } finally {
      pending.current = false;
      setOpening(false);
    }
  }, [accountId, clientForAccount, enabled]);

  return { enabled, opening, message, open };
}

function mergeMessages(older: readonly MemberMessage[], newer: readonly MemberMessage[]): MemberMessage[] {
  const byId = new Map<number, MemberMessage>();
  for (const message of [...older, ...newer]) byId.set(message.id, message);
  return [...byId.values()].sort((left, right) => left.id - right.id);
}
