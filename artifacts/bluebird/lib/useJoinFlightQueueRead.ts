import React from 'react';
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
import { createProductionQueueActions } from '@/lib/productionQueue';
import { parseProductionFlightId } from '@/lib/productionFlights';

export function useJoinFlightQueueRead(
  flightId: number,
  flightStatus: 'published' | null,
): JoinFlightQueuePanel {
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

  const query = useQuery({
    queryKey: configuration && session?.userId && parsedFlightId !== null
      ? mainBluebirdAuthenticatedQueryKey(configuration.environment, session.userId, 'empty-leg-queue', parsedFlightId)
      : ['main-bluebird-api', configuration?.environment ?? 'unconfigured', session?.userId ?? 'signed-out', 'empty-leg-queue', parsedFlightId ?? 'invalid'],
    enabled: ready,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
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

  return presentJoinFlightQueuePanel({
    flightStatus,
    sessionReady: published ? sessionReady : true,
    signedIn,
    loading: ready && (query.isLoading || query.isFetching),
    failed: query.isError,
    read: query.data ?? null,
  });
}
