import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { createClerkProductionTokenProvider, type ClerkSessionSnapshot } from '@/lib/clerkProductionTokenProvider';
import { mainBluebirdAuthenticatedQueryKey } from '@/lib/mainBluebirdApi';
import {
  getMainBluebirdApiConfigurationOrNull,
  type MainBluebirdApiEnvironment,
} from '@/lib/mainBluebirdApiConfig';
import { fetchUpcomingMemberFlights, type FlightView } from '@/lib/productionFlights';
import { isNativeProductionAuthTestEnabled } from '@/lib/nativeAuthTestPolicy';
import { presentServerMemberQueues } from '@/lib/myQueuesPresentation';

export function queueViewerListQueryKey(
  environment: MainBluebirdApiEnvironment,
  clerkUserId: string,
) {
  return mainBluebirdAuthenticatedQueryKey(environment, clerkUserId, 'empty-leg-list');
}

export function queueRosterQueryPrefix(
  environment: MainBluebirdApiEnvironment,
  clerkUserId: string,
) {
  return mainBluebirdAuthenticatedQueryKey(environment, clerkUserId, 'empty-leg-queue');
}

export type MyQueuesListState = 'signed-out' | 'unavailable' | 'loading' | 'error' | 'ready';

export function useMyQueues(): {
  listState: MyQueuesListState;
  rows: FlightView[];
  refreshing: boolean;
  refresh: () => void;
} {
  const { authMode, clerkUserId } = useAuth();
  const session = useClerkAuthSnapshot();
  const sessionRef = React.useRef(session);
  sessionRef.current = session;
  const configuration = getMainBluebirdApiConfigurationOrNull();
  const authTest = isNativeProductionAuthTestEnabled();
  const signedIn = authMode === 'clerk' &&
    !!clerkUserId &&
    session?.isLoaded === true &&
    session.isSignedIn === true &&
    session.userId === clerkUserId;
  const requestedUserId = signedIn && clerkUserId ? clerkUserId : null;

  const query = useQuery({
    queryKey: configuration && requestedUserId
      ? queueViewerListQueryKey(configuration.environment, requestedUserId)
      : ['main-bluebird-api', 'signed-out', 'upcoming-member-flights'],
    enabled: signedIn && !!configuration && !authTest && !!requestedUserId,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      if (!configuration || !requestedUserId) {
        throw Object.assign(new Error('A signed-in account is required.'), { code: 'session_expired' });
      }
      const tokenProvider = createClerkProductionTokenProvider({
        getCurrentSession: () => currentSession(sessionRef.current, requestedUserId),
      }, configuration.environment);
      const token = await tokenProvider.getVerifiedAccessToken();
      if (sessionRef.current?.userId !== requestedUserId || sessionRef.current?.isSignedIn !== true) {
        throw Object.assign(new Error('The signed-in account changed.'), { code: 'cancelled' });
      }
      if (typeof token !== 'string' || token.length === 0 || /\s/.test(token)) {
        throw Object.assign(new Error('Main API access token is unavailable.'), { code: 'session_expired' });
      }
      return fetchUpcomingMemberFlights({ signal, accessToken: token });
    },
  });

  const rows = React.useMemo(
    () => (signedIn && query.data ? presentServerMemberQueues(query.data) : []),
    [query.data, signedIn],
  );

  let listState: MyQueuesListState;
  if (authMode === 'clerk' && session?.isLoaded !== true) listState = 'loading';
  else if (!signedIn) listState = 'signed-out';
  else if (authTest) listState = 'unavailable';
  else if (!configuration || (query.isError && !query.data)) listState = 'error';
  else if (!query.data) listState = 'loading';
  else listState = 'ready';

  const refresh = React.useCallback(() => {
    if (!signedIn || authTest) return;
    void query.refetch();
  }, [authTest, query, signedIn]);

  return {
    listState,
    rows,
    refreshing: listState === 'ready' && query.isFetching,
    refresh,
  };
}

function currentSession(
  session: (ClerkSessionSnapshot & { userId?: string | null }) | null,
  requestedUserId: string,
): ClerkSessionSnapshot {
  if (!session || session.userId !== requestedUserId || session.isSignedIn !== true) {
    return {
      isLoaded: true,
      isSignedIn: false,
      getToken: async () => null,
      signOut: async () => {},
    };
  }
  return session;
}
