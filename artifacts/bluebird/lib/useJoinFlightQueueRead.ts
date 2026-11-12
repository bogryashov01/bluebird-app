import React from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { createClerkProductionTokenProvider, type ClerkSessionSnapshot } from '@/lib/clerkProductionTokenProvider';
import {
  createMainBluebirdApiIntegration,
  mainBluebirdAuthenticatedQueryKey,
} from '@/lib/mainBluebirdApi';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import {
  canReadJoinFlightQueue,
  presentJoinFlightQueuePanel,
  type JoinFlightQueuePanel,
} from '@/lib/joinFlightPresentation';
import { MEMBER_MESSAGE_POLL_MS } from '@/lib/memberMessages';
import { createProductionQueueActions } from '@/lib/productionQueue';
import { ProductionAuthHttpError } from '@/lib/productionAuthApi';
import { parseProductionFlightId } from '@/lib/productionFlights';

export function useJoinFlightQueueRead(
  flightId: number,
  flightStatus: 'published' | null,
): {
  panel: JoinFlightQueuePanel;
  refetch: () => Promise<unknown>;
} {
  const { authMode, clerkUserId } = useAuth();
  const session = useClerkAuthSnapshot();
  const sessionRef = React.useRef(session);
  sessionRef.current = session;
  const configuration = getMainBluebirdApiConfigurationOrNull();
  const parsedFlightId = parseProductionFlightId(flightId);
  const published = canReadJoinFlightQueue(flightStatus);
  const sessionReady = session?.isLoaded === true;
  const signedIn = authMode === 'clerk' &&
    sessionReady &&
    session.isSignedIn === true &&
    typeof session.userId === 'string' &&
    session.userId.trim().length > 0 &&
    session.userId === clerkUserId;
  const ready = published &&
    signedIn &&
    parsedFlightId !== null &&
    !!configuration;
  const [focused, setFocused] = React.useState(false);
  const [foreground, setForeground] = React.useState(AppState.currentState === 'active');

  useFocusEffect(React.useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));

  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  const shouldPoll = ready && focused && foreground;

  const query = useQuery({
    queryKey: configuration && session?.userId && parsedFlightId !== null
      ? mainBluebirdAuthenticatedQueryKey(configuration.environment, session.userId, 'empty-leg-queue', parsedFlightId)
      : ['main-bluebird-api', configuration?.environment ?? 'unconfigured', session?.userId ?? 'signed-out', 'empty-leg-queue', parsedFlightId ?? 'invalid'],
    enabled: ready,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: shouldPoll ? MEMBER_MESSAGE_POLL_MS : false,
    refetchIntervalInBackground: false,
    queryFn: async ({ signal }) => {
      if (!configuration || parsedFlightId === null || !signedIn || !session?.userId) {
        throw new Error('A signed-in Clerk session is required to read this queue.');
      }
      const requestedUserId = session.userId;
      const requestedFlightId = parsedFlightId;
      const tokenProvider = createClerkProductionTokenProvider({
        getCurrentSession: () => {
          const current = sessionRef.current;
          if (!current || current.userId !== requestedUserId) {
            return {
              isLoaded: true,
              isSignedIn: false,
              getToken: async () => null,
              signOut: async () => {},
            };
          }
          return current as ClerkSessionSnapshot;
        },
      }, configuration.environment);
      const api = createMainBluebirdApiIntegration({
        configuration,
        tokenProvider,
      });
      return createProductionQueueActions(api.authenticated).read(requestedFlightId, { signal });
    },
  });
  const refetch = query.refetch;

  React.useEffect(() => {
    if (!shouldPoll) return;
    void refetch();
  }, [refetch, shouldPoll]);

  return {
    panel: presentJoinFlightQueuePanel({
      flightStatus,
      sessionReady: published ? sessionReady : true,
      signedIn,
      loading: ready && query.isLoading,
      failed: query.isError,
      unauthorized: query.error instanceof ProductionAuthHttpError && query.error.status === 401,
      read: query.data ?? null,
    }),
    refetch,
  };
}
