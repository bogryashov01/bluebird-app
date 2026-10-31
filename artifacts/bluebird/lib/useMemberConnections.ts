import React from 'react';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { isClerkBluebirdProfileResultCurrent } from '@/lib/clerkBluebirdProfile';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import {
  clearMemberConnectionsCache,
  connectionMemberLabel,
  createMemberConnectionsClient,
  isMemberConnectionsIntegrationEnabled,
  readMemberConnectionsSnapshot,
  rememberMemberConnectionsSnapshot,
  retainMemberConnectionsForAccount,
  type AcceptedConnection,
  type ConnectionMemberIdentity,
  type ConnectionRelationship,
  type MemberConnectionsFailure,
} from '@/lib/memberConnections';

const FAILURE_COPY: Record<MemberConnectionsFailure, string> = {
  configuration: 'Connections are not available yet.',
  token: 'Sign in again to view Connections.',
  network: 'Connections could not be loaded. Try again.',
  timeout: 'Connections could not be loaded. Try again.',
  cancelled: '',
  schema: 'Connections could not be read.',
  invalid_contact: 'Enter one exact email address or phone number.',
  invalid_body: 'That connection could not be updated.',
  unauthorized: 'Sign in again to view Connections.',
  membership_required: 'An active Bluebird membership is required.',
  not_found: 'That member or request is no longer available.',
  conflict: 'A connection request already exists for this member.',
  unavailable: 'Connections could not be loaded. Try again.',
};

export function memberConnectionsFailureCopy(code: MemberConnectionsFailure): string {
  return FAILURE_COPY[code];
}

export function useMemberConnections() {
  const session = useClerkAuthSnapshot();
  const enabled = isMemberConnectionsIntegrationEnabled();
  const accountId = session?.isLoaded && session.isSignedIn === true ? session.userId : null;
  const accountRef = React.useRef(accountId);
  const sessionRef = React.useRef(session);
  const generationRef = React.useRef(0);
  sessionRef.current = session;

  const [incoming, setIncoming] = React.useState<ConnectionRelationship[]>([]);
  const [accepted, setAccepted] = React.useState<AcceptedConnection[]>([]);
  const [status, setStatus] = React.useState<'disabled' | 'signed-out' | 'loading' | 'ready' | 'error'>(
    !enabled ? 'disabled' : accountId ? 'loading' : 'signed-out',
  );
  const [message, setMessage] = React.useState<string | null>(null);
  const [discovery, setDiscovery] = React.useState<ConnectionMemberIdentity | null | undefined>(undefined);
  const [refreshing, setRefreshing] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const pendingRef = React.useRef(false);

  if (accountRef.current !== accountId) {
    accountRef.current = accountId;
    generationRef.current += 1;
    setIncoming([]);
    setAccepted([]);
    setDiscovery(undefined);
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
    const configuration = getMainBluebirdApiConfigurationOrNull();
    if (!configuration) {
      if (current(requestedAccountId, requestedGeneration, signal.aborted)) {
        setStatus('error');
        setMessage(FAILURE_COPY.configuration);
      }
      return;
    }
    retainMemberConnectionsForAccount(requestedAccountId);
    const cached = readMemberConnectionsSnapshot({
      environment: configuration.environment,
      apiBaseUrl: configuration.apiBaseUrl,
      clerkUserId: requestedAccountId,
    });
    if (cached && current(requestedAccountId, requestedGeneration, signal.aborted)) {
      setIncoming(cached.incoming);
      setAccepted(cached.accepted);
      setStatus('ready');
    }
    const client = createMemberConnectionsClient({
      enabled: true,
      environment: configuration.environment,
      baseUrl: configuration.apiBaseUrl,
      getAccessToken: () => sessionRef.current?.getToken() ?? Promise.resolve(null),
    });
    const [incomingResult, acceptedResult] = await Promise.all([
      client.listIncoming(),
      client.listAccepted(),
    ]);
    if (!current(requestedAccountId, requestedGeneration, signal.aborted)) return;
    if (incomingResult.kind === 'disabled' || acceptedResult.kind === 'disabled') {
      clearMemberConnectionsCache();
      setIncoming([]);
      setAccepted([]);
      setStatus('disabled');
      return;
    }
    if (incomingResult.kind === 'error' && incomingResult.code === 'cancelled') return;
    if (acceptedResult.kind === 'error' && acceptedResult.code === 'cancelled') return;
    if (incomingResult.kind === 'error' || acceptedResult.kind === 'error') {
      const code = incomingResult.kind === 'error' ? incomingResult.code : acceptedResult.kind === 'error' ? acceptedResult.code : 'unavailable';
      setStatus(cached ? 'ready' : 'error');
      setMessage(FAILURE_COPY[code]);
      return;
    }
    setIncoming(incomingResult.data.requests);
    setAccepted(acceptedResult.data.connections);
    setStatus('ready');
    setMessage(null);
    rememberMemberConnectionsSnapshot({
      clerkUserId: requestedAccountId,
      environment: configuration.environment,
      apiBaseUrl: configuration.apiBaseUrl,
      incoming: incomingResult.data.requests,
      accepted: acceptedResult.data.connections,
    });
  }, [current, enabled]);

  React.useEffect(() => {
    if (!enabled) {
      clearMemberConnectionsCache();
      setStatus('disabled');
      setIncoming([]);
      setAccepted([]);
      return;
    }
    if (!accountId) {
      clearMemberConnectionsCache();
      setStatus('signed-out');
      return;
    }
    const requestedAccountId = accountId;
    const requestedGeneration = generationRef.current;
    const controller = new AbortController();
    void load(requestedAccountId, requestedGeneration, controller.signal);
    return () => controller.abort();
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

  const runMutation = React.useCallback(async (
    work: () => Promise<{ ok: true; notice: string | null } | { ok: false; message: string }>,
  ) => {
    if (!enabled || !accountId || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    const requestedAccountId = accountId;
    const requestedGeneration = generationRef.current;
    try {
      const outcome = await work();
      if (!current(requestedAccountId, requestedGeneration, false)) return;
      if (!outcome.ok) {
        setMessage(outcome.message);
        return;
      }
      await load(requestedAccountId, requestedGeneration, new AbortController().signal);
      if (current(requestedAccountId, requestedGeneration, false) && outcome.notice) {
        setMessage(outcome.notice);
      }
    } finally {
      pendingRef.current = false;
      if (accountRef.current === requestedAccountId) setPending(false);
    }
  }, [accountId, current, enabled, load]);

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
    accepted,
    discovery,
    refreshing,
    pending,
    refresh,
    accountId,
    discover: (input: { email?: string; phoneE164?: string }) => runMutation(async () => {
      const client = clientForAccount();
      if (!client) return { ok: false, message: FAILURE_COPY.configuration };
      const result = await client.discover(input);
      if (result.kind === 'disabled') return { ok: false, message: FAILURE_COPY.configuration };
      if (result.kind === 'error') return { ok: false, message: FAILURE_COPY[result.code] };
      setDiscovery(result.data.member);
      return {
        ok: true,
        notice: result.data.member ? null : 'No member matched that exact email or phone.',
      };
    }),
    sendRequest: (member: ConnectionMemberIdentity) => runMutation(async () => {
      const client = clientForAccount();
      if (!client) return { ok: false, message: FAILURE_COPY.configuration };
      const result = await client.createRequest(member.userId);
      if (result.kind === 'disabled') return { ok: false, message: FAILURE_COPY.configuration };
      if (result.kind === 'error') return { ok: false, message: FAILURE_COPY[result.code] };
      setDiscovery(undefined);
      return { ok: true, notice: `Request sent to ${connectionMemberLabel(result.data.connection.recipient)}.` };
    }),
    accept: (connectionId: number) => runMutation(async () => {
      const client = clientForAccount();
      if (!client) return { ok: false, message: FAILURE_COPY.configuration };
      const result = await client.accept(connectionId);
      if (result.kind === 'disabled') return { ok: false, message: FAILURE_COPY.configuration };
      if (result.kind === 'error') return { ok: false, message: FAILURE_COPY[result.code] };
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
