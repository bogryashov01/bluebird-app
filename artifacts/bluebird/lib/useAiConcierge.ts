import React from 'react';
import { AppState, Linking } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { isClerkBluebirdProfileResultCurrent } from '@/lib/clerkBluebirdProfile';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import {
  aiConciergeFailureCopy,
  canSubmitAiConciergeSend,
  clearAiConciergeCache,
  createAiConciergeClient,
  createAiConciergeClientMessageId,
  isAiConciergeIntegrationEnabled,
  mergeAiConciergeMessages,
  readAiConciergeSnapshot,
  rememberAiConciergeSnapshot,
  retainAiConciergeForAccount,
  type AiConciergeFailure,
  type AiConciergeMessage,
} from '@/lib/aiConcierge';

export type AiConciergeUiMessage =
  | {
    kind: 'server';
    message: AiConciergeMessage;
    supportUrl: string | null;
  }
  | {
    kind: 'pending-user';
    localId: string;
    clientMessageId: string;
    body: string;
    createdAt: string;
  }
  | {
    kind: 'failed-user';
    localId: string;
    clientMessageId: string;
    body: string;
    createdAt: string;
    error: string;
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

export function useAiConcierge() {
  const enabled = isAiConciergeIntegrationEnabled();
  const session = useClerkAuthSnapshot();
  const sessionRef = React.useRef(session);
  sessionRef.current = session;
  const accountId = session?.isLoaded === true && session.isSignedIn === true ? session.userId : null;
  const accountRef = React.useRef(accountId);
  const generationRef = React.useRef(0);
  const foreground = useForeground();
  const [focused, setFocused] = React.useState(false);
  const [messages, setMessages] = React.useState<AiConciergeUiMessage[]>([]);
  const [nextBefore, setNextBefore] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<'disabled' | 'signed-out' | 'loading' | 'ready' | 'error'>(
    !enabled ? 'disabled' : accountId ? 'loading' : 'signed-out',
  );
  const [message, setMessage] = React.useState<string | null>(null);
  const [sending, setSending] = React.useState(false);
  const [loadingOlder, setLoadingOlder] = React.useState(false);
  const inFlight = React.useRef(false);
  const pendingClientMessageId = React.useRef<string | null>(null);
  const messagesRef = React.useRef(messages);
  messagesRef.current = messages;

  if (accountRef.current !== accountId) {
    accountRef.current = accountId;
    generationRef.current += 1;
    pendingClientMessageId.current = null;
    inFlight.current = false;
    setMessages([]);
    setNextBefore(null);
    setMessage(null);
    setSending(false);
    setLoadingOlder(false);
    setStatus(!enabled ? 'disabled' : accountId ? 'loading' : 'signed-out');
  }

  const current = React.useCallback((requestedAccountId: string, requestedGeneration: number) => {
    return requestedGeneration === generationRef.current && isClerkBluebirdProfileResultCurrent({
      requestedClerkUserId: requestedAccountId,
      currentClerkUserId: accountRef.current,
      aborted: false,
    });
  }, []);

  const clientForAccount = React.useCallback(() => {
    if (!enabled) {
      return createAiConciergeClient({
        enabled: false,
        environment: 'production',
        baseUrl: 'https://bluebirdjets.com/api',
        getAccessToken: async () => null,
      });
    }
    const configuration = getMainBluebirdApiConfigurationOrNull();
    if (!configuration) return null;
    return createAiConciergeClient({
      enabled: true,
      environment: configuration.environment,
      baseUrl: configuration.apiBaseUrl,
      getAccessToken: () => sessionRef.current?.getToken() ?? Promise.resolve(null),
    });
  }, [enabled]);

  const remember = React.useCallback((
    requestedAccountId: string,
    nextMessages: AiConciergeMessage[],
    cursor: string | null,
  ) => {
    const configuration = getMainBluebirdApiConfigurationOrNull();
    if (!configuration) return;
    rememberAiConciergeSnapshot({
      clerkUserId: requestedAccountId,
      environment: configuration.environment,
      apiBaseUrl: configuration.apiBaseUrl,
      messages: nextMessages,
      nextBefore: cursor,
    });
  }, []);

  const loadLatest = React.useCallback(async (
    requestedAccountId: string,
    requestedGeneration: number,
  ) => {
    if (!enabled) {
      clearAiConciergeCache();
      return;
    }
    const configuration = getMainBluebirdApiConfigurationOrNull();
    const client = clientForAccount();
    if (!configuration || !client) {
      if (current(requestedAccountId, requestedGeneration)) {
        setStatus('error');
        setMessage(aiConciergeFailureCopy('configuration'));
      }
      return;
    }
    retainAiConciergeForAccount(requestedAccountId);
    const result = await client.history({ limit: 50 });
    if (!current(requestedAccountId, requestedGeneration)) return;
    if (result.kind === 'disabled') {
      clearAiConciergeCache();
      setMessages([]);
      setNextBefore(null);
      setStatus('disabled');
      return;
    }
    if (result.kind === 'error') {
      if (result.code === 'cancelled') return;
      const cached = readAiConciergeSnapshot({
        environment: configuration.environment,
        apiBaseUrl: configuration.apiBaseUrl,
        clerkUserId: requestedAccountId,
      });
      if (cached) {
        setMessages(cached.messages.map((item) => ({
          kind: 'server' as const,
          message: item,
          supportUrl: null,
        })));
        setNextBefore(cached.nextBefore);
        setStatus('ready');
      } else {
        setStatus('error');
      }
      setMessage(aiConciergeFailureCopy(result.code));
      return;
    }
    const serverMessages = result.data.messages;
    setMessages(serverMessages.map((item) => ({
      kind: 'server' as const,
      message: item,
      supportUrl: null,
    })));
    setNextBefore(result.data.nextBefore);
    setStatus('ready');
    setMessage(null);
    remember(requestedAccountId, serverMessages, result.data.nextBefore);
  }, [clientForAccount, current, enabled, remember]);

  useFocusEffect(React.useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));

  React.useEffect(() => {
    if (!enabled) {
      clearAiConciergeCache();
      setStatus('disabled');
      setMessages([]);
      setNextBefore(null);
      return;
    }
    if (!accountId) {
      clearAiConciergeCache();
      setStatus('signed-out');
      setMessages([]);
      setNextBefore(null);
      return;
    }
    if (!focused || !foreground) return;
    const requestedAccountId = accountId;
    const requestedGeneration = generationRef.current;
    const configuration = getMainBluebirdApiConfigurationOrNull();
    const cached = configuration
      ? readAiConciergeSnapshot({
        environment: configuration.environment,
        apiBaseUrl: configuration.apiBaseUrl,
        clerkUserId: requestedAccountId,
      })
      : null;
    if (cached) {
      setMessages(cached.messages.map((item) => ({
        kind: 'server' as const,
        message: item,
        supportUrl: null,
      })));
      setNextBefore(cached.nextBefore);
      setStatus('ready');
    }
    void loadLatest(requestedAccountId, requestedGeneration);
  }, [accountId, enabled, focused, foreground, loadLatest]);

  const loadOlder = React.useCallback(async () => {
    if (!enabled || !accountId || !nextBefore || loadingOlder || inFlight.current) return;
    const client = clientForAccount();
    if (!client) return;
    const requestedAccountId = accountId;
    const requestedGeneration = generationRef.current;
    setLoadingOlder(true);
    try {
      const result = await client.history({ before: nextBefore, limit: 50 });
      if (!current(requestedAccountId, requestedGeneration)) return;
      if (result.kind !== 'loaded') {
        if (result.kind === 'error' && result.code !== 'cancelled') {
          setMessage(aiConciergeFailureCopy(result.code));
        }
        return;
      }
      setMessages((currentMessages) => {
        const server = currentMessages
          .filter((item): item is Extract<AiConciergeUiMessage, { kind: 'server' }> => item.kind === 'server')
          .map((item) => item.message);
        const merged = mergeAiConciergeMessages(result.data.messages, server);
        remember(requestedAccountId, merged, result.data.nextBefore);
        const pending = currentMessages.filter((item) => item.kind !== 'server');
        return [
          ...merged.map((item) => ({ kind: 'server' as const, message: item, supportUrl: null })),
          ...pending,
        ];
      });
      setNextBefore(result.data.nextBefore);
      setMessage(null);
    } finally {
      if (accountRef.current === requestedAccountId) setLoadingOlder(false);
    }
  }, [accountId, clientForAccount, current, enabled, loadingOlder, nextBefore, remember]);

  const applySendSuccess = React.useCallback((
    requestedAccountId: string,
    clientMessageId: string,
    localId: string,
    result: {
      userMessage: AiConciergeMessage;
      assistantMessage: AiConciergeMessage;
      supportUrl: string | null;
    },
  ) => {
    setMessages((currentMessages) => {
      const withoutPending = currentMessages.filter((item) => {
        if (item.kind === 'pending-user' || item.kind === 'failed-user') {
          return item.localId !== localId && item.clientMessageId !== clientMessageId;
        }
        return true;
      });
      const server = withoutPending
        .filter((item): item is Extract<AiConciergeUiMessage, { kind: 'server' }> => item.kind === 'server')
        .map((item) => item.message);
      const merged = mergeAiConciergeMessages(server, [result.userMessage, result.assistantMessage]);
      remember(requestedAccountId, merged, nextBefore);
      const supportUrl = result.assistantMessage.status === 'needs_support' ? result.supportUrl : null;
      return merged.map((item) => ({
        kind: 'server' as const,
        message: item,
        supportUrl: item.id === result.assistantMessage.id ? supportUrl : null,
      }));
    });
    setMessage(null);
  }, [nextBefore, remember]);

  const send = React.useCallback(async (
    body: string,
    existing?: { localId: string; clientMessageId: string; createdAt: string },
  ): Promise<boolean> => {
    if (!enabled || !accountId) return false;
    if (!canSubmitAiConciergeSend({ inFlight: inFlight.current, body })) return false;
    const client = clientForAccount();
    if (!client) {
      setMessage(aiConciergeFailureCopy('configuration'));
      return false;
    }
    const text = body.trim();
    const clientMessageId = existing?.clientMessageId ?? createAiConciergeClientMessageId();
    const localId = existing?.localId ?? `local-${clientMessageId}`;
    const createdAt = existing?.createdAt ?? new Date().toISOString();
    const requestedAccountId = accountId;
    const requestedGeneration = generationRef.current;

    inFlight.current = true;
    pendingClientMessageId.current = clientMessageId;
    setSending(true);
    setMessages((currentMessages) => {
      const withoutSame = currentMessages.filter((item) => {
        if (item.kind === 'pending-user' || item.kind === 'failed-user') {
          return item.clientMessageId !== clientMessageId && item.localId !== localId;
        }
        return true;
      });
      return [
        ...withoutSame,
        {
          kind: 'pending-user',
          localId,
          clientMessageId,
          body: text,
          createdAt,
        },
      ];
    });

    try {
      const result = await client.send({ clientMessageId, body: text });
      if (!current(requestedAccountId, requestedGeneration)) return false;
      if (result.kind === 'disabled') {
        setMessage(aiConciergeFailureCopy('configuration'));
        return false;
      }
      if (result.kind === 'error') {
        if (result.code === 'conflict') {
          await loadLatest(requestedAccountId, requestedGeneration);
          setMessages((currentMessages) => currentMessages.filter((item) => {
            if (item.kind === 'pending-user' || item.kind === 'failed-user') {
              return item.clientMessageId !== clientMessageId;
            }
            return true;
          }));
          setMessage(aiConciergeFailureCopy('conflict'));
          return false;
        }
        const copy = aiConciergeFailureCopy(result.code);
        setMessages((currentMessages) => currentMessages.map((item) => {
          if (item.kind === 'pending-user' && item.clientMessageId === clientMessageId) {
            return {
              kind: 'failed-user' as const,
              localId: item.localId,
              clientMessageId: item.clientMessageId,
              body: item.body,
              createdAt: item.createdAt,
              error: copy,
            };
          }
          return item;
        }));
        setMessage(copy);
        return false;
      }
      applySendSuccess(requestedAccountId, clientMessageId, localId, result.data);
      return true;
    } finally {
      if (pendingClientMessageId.current === clientMessageId) {
        pendingClientMessageId.current = null;
        inFlight.current = false;
      }
      if (accountRef.current === requestedAccountId) setSending(false);
    }
  }, [accountId, applySendSuccess, clientForAccount, current, enabled, loadLatest]);

  const retryFailed = React.useCallback(async (localId: string): Promise<boolean> => {
    const failed = messagesRef.current.find((item) => item.kind === 'failed-user' && item.localId === localId);
    if (!failed || failed.kind !== 'failed-user') return false;
    return send(failed.body, {
      localId: failed.localId,
      clientMessageId: failed.clientMessageId,
      createdAt: failed.createdAt,
    });
  }, [send]);

  const openSupport = React.useCallback(async (supportUrl: string | null): Promise<boolean> => {
    if (!supportUrl) return false;
    try {
      await Linking.openURL(supportUrl);
      return true;
    } catch {
      setMessage('Support could not be opened right now.');
      return false;
    }
  }, []);

  const refresh = React.useCallback(async () => {
    if (!enabled || !accountId) return;
    await loadLatest(accountId, generationRef.current);
  }, [accountId, enabled, loadLatest]);

  return {
    enabled,
    status,
    message,
    messages,
    nextBefore,
    hasOlder: nextBefore !== null,
    sending,
    loadingOlder,
    send,
    retryFailed,
    loadOlder,
    openSupport,
    refresh,
  };
}

export type { AiConciergeFailure };
