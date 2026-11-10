import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Alert,
  ImageBackground,
  useWindowDimensions,
  Modal,
  Pressable,
  Linking,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useLocalSearchParams, usePathname, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useGetFlight,
  useGetFlightMyStatus,
  useCancelQueueEntry,
  useCancelTrip,
  useListAirports,
  useGetNetworkingFrontMember,
  useCreateNetworkingRequest,
  useGetQueueStatus,
  useListNetworkingConnections,
  type CreateNetworkingRequest,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { confirmDialog } from '@/lib/confirmDialog';
import {
  FRONT_QUEUE_AMBIGUOUS,
  FRONT_QUEUE_DECLINED,
  FRONT_QUEUE_MEMBER_UNAVAILABLE,
  FRONT_QUEUE_PENDING,
  FRONT_QUEUE_REQUEST_UNAVAILABLE,
  FRONT_QUEUE_STATUS_UNAVAILABLE,
  JOIN_TO_CONNECT_COPY,
  JOIN_TO_CONNECT_CTA,
  SELF_QUEUE_MEMBER_COPY,
  acceptedConnectionMemberUserId,
  canOpenLeaderQueuePreview,
  mergeLeaderQueueRelationships,
  presentFrontQueueConnection,
  presentLeaderPreviewTitle,
  presentLeaderQueuePreviewState,
  presentProductionQueueRoster,
  queueConnectionRequestFailureCopy,
  queueRequestFailureCopy,
  readFlightQueue,
  resolveProductionLeaderQueueTarget,
  type FrontQueueConnectionKind,
  type LeaderQueueConnection,
  type LeaderQueueRelationship,
} from '@/lib/flightQueuePresentation';
import { fetchFullAppDemoFlight } from '@/lib/fullAppDemoLiveReads';
import { useFullAppDemoQueueOptional } from '@/lib/fullAppDemoQueue';
import { shouldUseLocalFlightReadMode } from '@/lib/clerkAuthSession';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { createClerkProductionTokenProvider } from '@/lib/clerkProductionTokenProvider';
import {
  FLIGHT_DETAIL_QUERY_BEHAVIOR,
  flightDetailHttpStatus,
  flightDetailViewerScope,
  isDiscoverFlightListKey,
  isFlightDetailIdentityReady,
  prepareFlightDetailRequest,
  presentSeatsAvailable,
  productionFlightDetailQueryKey,
  readProductionFlightDetailCache,
  selectDisplayedFlight,
  type FlightDetailPhase,
} from '@/lib/flightDetailPresentation';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import { mainBluebirdAuthenticatedQueryKey } from '@/lib/mainBluebirdApi';
import { createMemberConnectionsClient, isMemberConnectionsIntegrationEnabled } from '@/lib/memberConnections';
import { useMemberConnections } from '@/lib/useMemberConnections';
import { useOpenAcceptedConversation } from '@/lib/useMemberMessages';
import { isProductionQueueVerified } from '@/lib/productionQueueReadiness';
import { joinFlightQueueCountLabel, joinFlightRouteParams } from '@/lib/joinFlightPresentation';
import { useJoinFlightQueueRead } from '@/lib/useJoinFlightQueueRead';
import { useDemoJoinFlow } from '@/lib/demoJoinFlowStore';
import { logJoinNav } from '@/lib/joinNavDiagnostics';
import { ClerkQueuePanel } from '@/components/ClerkQueuePanel';
import { ProductionQueueLeaveControl } from '@/components/ProductionQueueLeaveControl';
import { WinnerFlightNotice } from '@/components/WinnerFlightNotice';
import { productionQueueActionsVisible, queueClosedAt } from '@/lib/memberFlightPlacement';
import {
  fetchProductionAirports,
  fetchProductionFlight,
  findProductionFlightById,
  presentCachedDepartureClock,
  PRODUCTION_FLIGHTS_QUERY_KEY,
  getFlightAirportCodes,
  getFlightImagePresentation,
  isLocalFlightReadMode,
  mapLocalFlight,
  parseProductionFlightId,
  productionReadRetryDelay,
  shouldRetryProductionRead,
  type AirportRecord,
  type FlightView,
} from '@/lib/productionFlights';

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDate(d: string | null) {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const [y, m, day] = d.split('-').map(Number);
  const value = new Date(y, m - 1, day);
  if (value.getFullYear() !== y || value.getMonth() !== m - 1 || value.getDate() !== day) {
    return null;
  }
  return value.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function formatTime12(t: string | null): string | null {
  if (!t || !/^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(t)) return null;
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m).padStart(2, '0')} ${ampm}`;
}
function requestErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const data = (error as { data?: { code?: unknown } }).data;
  return typeof data?.code === 'string' ? data.code : null;
}

function queueHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const record = error as { status?: unknown; response?: { status?: unknown } };
  const status = typeof record.status === 'number' ? record.status : record.response?.status;
  return typeof status === 'number' ? status : null;
}

interface FlightInfoItem {
  label: string;
  value: string;
  detail?: string;
  detailTestID?: string;
  testID?: string;
  valueTestID?: string;
}

type AirportDisplayRecord = Pick<AirportRecord, 'code' | 'name' | 'city' | 'state' | 'country'> &
  Partial<Pick<AirportRecord, 'latitude' | 'longitude'>>;

interface DirectionsTarget {
  kind: 'airport' | 'fbo';
  label: string;
  destination: string;
  location?: string;
}

function QueueMemberRow({
  initials,
  displayName,
  position,
  first,
  viewer,
  selectable,
  onPress,
}: {
  initials: string;
  displayName?: string | null;
  position: number;
  first: boolean;
  viewer: boolean;
  selectable: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  const highlighted = first || viewer;
  const identity = displayName?.trim() ? displayName.trim() : null;
  const copy = (
    <>
      <View style={[styles.queueInitials, { backgroundColor: highlighted ? colors.primary : colors.muted }]}>
        <Text style={[styles.queueInitialsText, { color: highlighted ? colors.primaryForeground : colors.textOnSurface }]}>{initials}</Text>
      </View>
      <View style={styles.queueCopy}>
        <Text style={[styles.queuePosition, { color: colors.textOnSurface }]}>#{position}</Text>
        {identity ?
          <Text testID="flight-queue-leader-name" style={[styles.queueFirst, { color: colors.textOnSurface }]} numberOfLines={1}>
            {identity}
          </Text>
        : null}
        {first ?
          <Text style={[styles.queueFirst, { color: colors.primary }]}>First in line</Text>
        : null}
        {viewer ?
          <Text style={[styles.queueFirst, { color: colors.primary }]} testID="flight-queue-you">
            You
          </Text>
        : null}
      </View>
    </>
  );
  const rowStyle = [
    styles.queueRow,
    {
      backgroundColor: highlighted ? colors.primary + '12' : colors.surface,
      borderColor: highlighted ? colors.primary : colors.border,
    },
  ];
  if (!selectable) {
    return (
      <View testID={first ? 'flight-queue-first' : `flight-queue-member-${position}`} style={rowStyle}>
        {copy}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={identity ? `First in line, ${identity}` : `First in line, ${initials}`}
      testID="flight-queue-first"
      onPress={onPress}
      style={rowStyle}>
      {copy}
    </Pressable>
  );
}

function FlightInfoCard({ item, testID, colors }: { item: FlightInfoItem; testID: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View testID={testID} style={[styles.flightInfoCard, { backgroundColor: colors.surface, borderColor: colors.separator }]}>
      <Text style={[styles.flightInfoLabel, { color: colors.mutedForegroundLight }]}>{item.label}</Text>
      <Text testID={item.valueTestID} style={[styles.flightInfoValue, { color: colors.textOnSurface }]} numberOfLines={2}>
        {item.value}
      </Text>
      {!!item.detail && (
        <Text testID={item.detailTestID} style={[styles.flightInfoDetail, { color: colors.mutedForegroundLight }]} numberOfLines={1}>
          {item.detail}
        </Text>
      )}
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function FlightDetailScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pathname = usePathname();
  useEffect(() => {
    logJoinNav('flight-details-screen', {
      currentPathname: pathname,
      visibleLabel: 'Join the Flight',
      route: 'flight/[id]',
    });
  }, [pathname]);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  // Keep the aircraft image present without pushing the key flight details below the fold.
  const heroHeight = Math.round(Math.min(240, Math.max(150, windowHeight * 0.23)));
  const { user, updateUser, authMode, clerkUserId, demoMode } = useAuth();
  const queryClient = useQueryClient();
  const clerkSession = useClerkAuthSnapshot();
  const clerkSessionRef = useRef(clerkSession);
  clerkSessionRef.current = clerkSession;
  const localReadMode = !demoMode && shouldUseLocalFlightReadMode(authMode, isLocalFlightReadMode());
  const [flightListVersion, setFlightListVersion] = useState(0);
  const demoQueue = useFullAppDemoQueueOptional();
  const demoJoin = useDemoJoinFlow();
  const numericFlightId = parseProductionFlightId(id);
  const demoEntry = demoQueue?.entries.find((entry) => entry.flightId === String(numericFlightId));
  const [directionsTarget, setDirectionsTarget] = useState<DirectionsTarget | null>(null);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const [networkRequestStatus, setNetworkRequestStatus] = useState<'pending' | 'declined' | null>(null);
  const [networkError, setNetworkError] = useState('');
  const [frontPreview, setFrontPreview] = useState<'production' | 'local' | null>(null);
  const [previewDismissable, setPreviewDismissable] = useState(false);
  const [leaderPreviewName, setLeaderPreviewName] = useState<{ firstName: string; lastName: string } | null>(null);
  const [leaderRequestPending, setLeaderRequestPending] = useState(false);
  const [leaderRequestNotice, setLeaderRequestNotice] = useState<string | null>(null);
  const [leaderSendBlocked, setLeaderSendBlocked] = useState(false);
  const [confirmedLeaderRelationship, setConfirmedLeaderRelationship] = useState<LeaderQueueRelationship | null>(null);
  const memberConnections = useMemberConnections();
  const messages = useOpenAcceptedConversation();
  useEffect(() => {
    setFrontPreview(null);
    setPreviewDismissable(false);
    setLeaderPreviewName(null);
    setLeaderRequestNotice(null);
    setLeaderSendBlocked(false);
    setConfirmedLeaderRelationship(null);
  }, [id]);
  useEffect(() => {
    if (frontPreview == null) {
      setPreviewDismissable(false);
      return;
    }
    // The same finger-up that opens the preview can land on a backdrop Pressable
    // and close it immediately. Wait one frame cycle before allowing dismiss.
    const timer = setTimeout(() => setPreviewDismissable(true), 350);
    return () => clearTimeout(timer);
  }, [frontPreview]);
  useEffect(() => {
    if (frontPreview !== 'production') setLeaderPreviewName(null);
  }, [frontPreview]);
  const joinNavAt = useRef(0);
  const flightBackAt = useRef(0);

  const localFlightQuery = useGetFlight(id ?? '', {
    query: { enabled: localReadMode && !!id },
  });
  const signedInClerk =
    authMode === 'clerk' && clerkSession?.isLoaded === true && clerkSession.isSignedIn === true && clerkSession.userId === clerkUserId;
  const viewerScope = flightDetailViewerScope({
    demoMode,
    authMode,
    signedIn: signedInClerk,
    clerkUserId,
  });
  const identityReady = isFlightDetailIdentityReady({
    demoMode,
    authMode,
    sessionLoaded: authMode !== 'clerk' || clerkSession?.isLoaded === true,
    signedIn: clerkSession?.isSignedIn === true,
    sessionUserId: clerkSession?.userId ?? null,
    clerkUserId,
  });
  const detailQueryKey =
    numericFlightId === null ?
      (['production-empty-leg', 'missing'] as const)
    : productionFlightDetailQueryKey(numericFlightId, viewerScope);
  const productionFlightQuery = useQuery({
    queryKey: detailQueryKey,
    queryFn: async ({ signal }) => {
      const requestedScope = viewerScope;
      const flightId = numericFlightId!;
      if (demoMode) {
        const flight = await fetchFullAppDemoFlight(flightId, { signal });
        prepareFlightDetailRequest({ scope: 'demo', token: null, activeScope: 'demo' });
        return { flight, viewerAuthenticated: false };
      }
      let token: string | null = null;
      if (requestedScope !== 'anonymous') {
        const configuration = getMainBluebirdApiConfigurationOrNull();
        if (!configuration) throw new Error('Main API configuration is unavailable.');
        const tokenProvider = createClerkProductionTokenProvider(
          {
            getCurrentSession: () => {
              const current = clerkSessionRef.current;
              if (!current || current.userId !== requestedScope || current.isSignedIn !== true) {
                return {
                  isLoaded: true,
                  isSignedIn: false,
                  getToken: async () => null,
                  signOut: async () => {},
                };
              }
              return current;
            },
          },
          configuration.environment,
        );
        token = await tokenProvider.getVerifiedAccessToken();
      }
      const scopeFromSession = () => {
        const current = clerkSessionRef.current;
        return flightDetailViewerScope({
          demoMode: false,
          authMode,
          signedIn: authMode === 'clerk' && current?.isSignedIn === true && !!current.userId,
          clerkUserId: authMode === 'clerk' ? (current?.userId ?? null) : null,
        });
      };
      const request = prepareFlightDetailRequest({
        scope: requestedScope,
        token,
        activeScope: scopeFromSession(),
      });
      const flight = await fetchProductionFlight(flightId, {
        signal,
        accessToken: request.accessToken,
      });
      const scopeAfterRead = scopeFromSession();
      prepareFlightDetailRequest({
        scope: requestedScope,
        token: request.accessToken,
        activeScope: scopeAfterRead,
      });
      return { flight, viewerAuthenticated: request.viewerAuthenticated };
    },
    enabled: identityReady && (demoMode || !localReadMode) && numericFlightId !== null,
    retry: shouldRetryProductionRead,
    retryDelay: productionReadRetryDelay,
    ...FLIGHT_DETAIL_QUERY_BEHAVIOR,
  });
  useEffect(() => {
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated') return;
      if (isDiscoverFlightListKey(event.query.queryKey)) {
        setFlightListVersion((value) => value + 1);
      }
    });
  }, [queryClient]);
  const discoverListKey = demoMode ? (['full-app-demo', ...PRODUCTION_FLIGHTS_QUERY_KEY] as const) : PRODUCTION_FLIGHTS_QUERY_KEY;
  const cachedProductionFlight = React.useMemo(
    () => findProductionFlightById(queryClient.getQueryData<FlightView[]>(discoverListKey), numericFlightId),
    [discoverListKey, flightListVersion, numericFlightId, queryClient],
  );
  const detailPhase: FlightDetailPhase =
    productionFlightQuery.isSuccess ? 'success'
    : productionFlightQuery.isError ? 'error'
    : productionFlightQuery.fetchStatus === 'fetching' || !identityReady ? 'pending'
    : 'idle';
  const detailCache = readProductionFlightDetailCache(productionFlightQuery.data);
  const detailFlight = detailCache?.flight.id === String(numericFlightId) ? detailCache.flight : undefined;
  const displayedProduction = selectDisplayedFlight({
    cached: cachedProductionFlight,
    detail: detailFlight,
    phase: detailPhase,
    httpStatus: flightDetailHttpStatus(productionFlightQuery.error),
    viewerAuthenticated: detailCache?.viewerAuthenticated === true && viewerScope !== 'anonymous' && viewerScope !== 'demo',
  });
  const flight: FlightView | undefined =
    localReadMode ?
      localFlightQuery.data ?
        mapLocalFlight(localFlightQuery.data)
      : undefined
    : displayedProduction.flight;
  const { panel: productionQueue, refetch: refetchProductionQueue } = useJoinFlightQueueRead(
    numericFlightId ?? 0,
    !localReadMode && flight?.status === 'published' ? 'published' : null,
  );
  const apiConfiguration = getMainBluebirdApiConfigurationOrNull();
  const queueConnectionsEnabled =
    !localReadMode && signedInClerk && numericFlightId !== null && apiConfiguration !== null && isMemberConnectionsIntegrationEnabled();
  const queueConnectionStatus = useQuery({
    queryKey:
      queueConnectionsEnabled && clerkUserId && apiConfiguration ?
        mainBluebirdAuthenticatedQueryKey(apiConfiguration.environment, clerkUserId, 'connection-queue-status')
      : ['connection-queue-status', 'disabled'],
    enabled: queueConnectionsEnabled,
    retry: false,
    queryFn: async () => {
      const configuration = getMainBluebirdApiConfigurationOrNull();
      const accountId = clerkSessionRef.current?.isSignedIn === true ? clerkSessionRef.current.userId : null;
      if (!configuration || !accountId) throw new Error('unauthorized');
      const client = createMemberConnectionsClient({
        enabled: true,
        environment: configuration.environment,
        baseUrl: configuration.apiBaseUrl,
        getAccessToken: () => clerkSessionRef.current?.getToken() ?? Promise.resolve(null),
      });
      const result = await client.listQueueStatus();
      if (clerkSessionRef.current?.userId !== accountId) throw new Error('cancelled');
      if (result.kind !== 'loaded') throw new Error(result.kind === 'error' ? result.code : 'disabled');
      return result.data.relationships;
    },
  });
  useFocusEffect(
    useCallback(() => {
      if (!queueConnectionsEnabled) return;
      void queueConnectionStatus.refetch();
      void memberConnections.refresh();
    }, [memberConnections.refresh, queueConnectionStatus.refetch, queueConnectionsEnabled]),
  );
  useEffect(() => {
    if (!queueConnectionStatus.isSuccess) return;
    setConfirmedLeaderRelationship(null);
  }, [queueConnectionStatus.dataUpdatedAt, queueConnectionStatus.isSuccess]);
  React.useEffect(() => {
    if (!demoMode || !demoQueue || !demoEntry || !flight?.status) return;
    if (demoEntry.status !== 'waiting' && demoEntry.status !== 'changed-position') return;
    if (flight.status === 'available' || flight.status === 'published') return;
    void demoQueue.transition(demoEntry.flightId, 'closed').catch(() => {});
  }, [demoMode, demoQueue, demoEntry, flight?.status]);

  const localAirportsQuery = useListAirports({
    query: { enabled: localReadMode && !!flight },
  });
  const productionAirportCodes = getFlightAirportCodes(flight?.source === 'production' ? [flight] : []);
  const productionAirportsQuery = useQuery({
    queryKey: ['production-airports', productionAirportCodes],
    queryFn: ({ signal }) => fetchProductionAirports(productionAirportCodes, { signal }),
    enabled: !localReadMode && flight?.source === 'production' && productionAirportCodes.length > 0,
    retry: shouldRetryProductionRead,
    retryDelay: productionReadRetryDelay,
  });
  const localAirportGroups = Array.isArray(localAirportsQuery.data) ? localAirportsQuery.data : [];
  const localAirportRecords = localAirportGroups.flatMap((group) =>
    (Array.isArray(group?.airports) ? group.airports : []).map((airport) => ({
      code: airport.code,
      name: airport.name,
      city: airport.city,
      state: null,
      country: null,
    })),
  );
  const airportRecords: AirportDisplayRecord[] = localReadMode ? localAirportRecords : (productionAirportsQuery.data ?? []);
  const isLoading =
    localReadMode ?
      localFlightQuery.isLoading
    : !displayedProduction.flight && (!identityReady || productionFlightQuery.isLoading || productionFlightQuery.isFetching);
  const isError = localReadMode ? localFlightQuery.isError : displayedProduction.refreshFailed && !displayedProduction.flight;
  const isRetryingFlight = localReadMode ? localFlightQuery.isFetching : productionFlightQuery.isFetching;
  const retryFlight = localReadMode ? localFlightQuery.refetch : productionFlightQuery.refetch;

  // Fetch the user's relationship to this flight (requires auth)
  const { data: myStatus, isLoading: statusLoading } = useGetFlightMyStatus(id!, {
    query: {
      enabled: localReadMode && !!user && !!id,
      refetchInterval: user ? 10_000 : false,
      refetchOnMount: 'always',
    },
  });
  const { data: frontMember } = useGetNetworkingFrontMember(id!, {
    query: {
      enabled: localReadMode && !!user && String(user.membershipTier) !== 'none' && !!id,
      refetchInterval: 15000,
      refetchOnMount: 'always',
    },
  });
  const queueRoster = useGetQueueStatus({
    query: {
      enabled: localReadMode && !!user && !!id,
      refetchInterval: user ? 10_000 : false,
      refetchOnMount: 'always',
    },
  });
  const acceptedConnections = useListNetworkingConnections({
    query: {
      enabled: localReadMode && !!user && !!id,
      refetchOnMount: 'always',
    },
  });
  const networkingRequest = useCreateNetworkingRequest();

  const topPad = Platform.OS === 'web' ? 60 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const backTop = topPad + 14;

  const cancelMutation = useCancelQueueEntry({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['/api/queue/status'] });
        queryClient.invalidateQueries({ queryKey: [`/api/flights/${id}/my-status`] });
      },
      onError: (err: any) => {
        const msg = err?.data?.error || err?.message || 'Failed to leave queue';
        Alert.alert('Error', msg);
      },
    },
  });

  const cancelTripMutation = useCancelTrip({
    mutation: {
      onSuccess: (data: any) => {
        queryClient.invalidateQueries({ queryKey: ['/api/trips'] });
        queryClient.invalidateQueries({ queryKey: ['/api/queue/status'] });
        queryClient.invalidateQueries({ queryKey: ['/api/flights'] });
        queryClient.invalidateQueries({ queryKey: [`/api/flights/${id}`] });
        queryClient.invalidateQueries({ queryKey: [`/api/flights/${id}/my-status`] });
        if (user && typeof data?.linePassCount === 'number') {
          updateUser({ ...user, linePassCount: data.linePassCount });
        }
      },
      onError: (err: any) => {
        const msg = err?.data?.error || err?.message || 'Failed to cancel booking';
        if (Platform.OS === 'web') {
          if (typeof window !== 'undefined') window.alert(msg);
        } else {
          Alert.alert('Cancellation failed', msg);
        }
      },
    },
  });

  const handleCancelBooking = async () => {
    if (!myStatus?.tripId || cancelTripMutation.isPending) return;
    const route = flight ? `${(flight as any).fromCity} → ${(flight as any).toCity}` : 'this flight';
    const ok = await confirmDialog(
      'Cancel booking?',
      `Your seat on ${route} will be released to the next member in line. If you used a Skip the Line pass for this booking, it will be returned to your balance.`,
      'Cancel Booking',
      true,
    );
    if (ok) cancelTripMutation.mutate({ id: myStatus.tripId });
  };

  const handleLeaveQueue = async () => {
    if (!myStatus?.queueEntryId) return;
    const ok = await confirmDialog('Leave Queue?', 'You will lose your position in the queue.', 'Leave Queue', true);
    if (ok) cancelMutation.mutate({ id: myStatus.queueEntryId! });
  };

  const sendNetworkingRequest = () => {
    if (!id || networkingRequest.isPending || networkRequestStatus === 'pending') return;
    setNetworkError('');
    const memberRef = frontMember?.member && 'memberRef' in frontMember.member ? frontMember.member.memberRef : undefined;
    networkingRequest.mutate(
      {
        data: {
          flightId: id,
          message: 'I would like to connect.',
          ...(typeof memberRef === 'string' && memberRef.trim() !== '' ? { memberRef } : {}),
        } as CreateNetworkingRequest,
      },
      {
        onSuccess: (result) => {
          setNetworkRequestStatus(result.status === 'declined' ? 'declined' : 'pending');
          void acceptedConnections.refetch();
        },
        onError: (error: unknown) => {
          const code = requestErrorCode(error);
          if (code === 'DUPLICATE_REQUEST') {
            setNetworkRequestStatus('pending');
            setNetworkError('');
            return;
          }
          if (code === 'MEMBERSHIP_REQUIRED') {
            router.push('/membership/plans' as never);
            return;
          }
          setNetworkError(queueRequestFailureCopy(code));
        },
      },
    );
  };

  // ── Loading / Error — guards before any flight-property access ──
  if (isLoading && !flight) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.offWhite }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }
  if (!flight) {
    if (!localReadMode && displayedProduction.confirmedMissing) {
      return (
        <View style={[styles.centered, { backgroundColor: colors.offWhite }]}>
          <Text style={[styles.errText, { color: colors.mutedForegroundLight }]}>Flight unavailable</Text>
          <Text testID="flight-detail-unavailable" style={[styles.errorBody, { color: colors.mutedForegroundLight }]}>
            This flight is no longer available.
          </Text>
        </View>
      );
    }
    const canRetry = localReadMode ? !!id : numericFlightId !== null;
    return (
      <View style={[styles.centered, { backgroundColor: colors.offWhite }]}>
        <Text style={[styles.errText, { color: colors.mutedForegroundLight }]}>
          {isError ? 'Could not load flight details' : 'Flight unavailable'}
        </Text>
        {isError && <Text style={[styles.errorBody, { color: colors.mutedForegroundLight }]}>Check your connection and try again.</Text>}
        {!isError && (
          <Text style={[styles.errorBody, { color: colors.mutedForegroundLight }]}>
            This flight could not be found in the selected flight service.
          </Text>
        )}
        {canRetry && (
          <TouchableOpacity
            testID="flight-detail-retry"
            accessibilityRole="button"
            disabled={isRetryingFlight}
            style={[styles.retryBtn, { backgroundColor: colors.primary, opacity: isRetryingFlight ? 0.65 : 1 }]}
            onPress={() => void retryFlight()}>
            {isRetryingFlight ?
              <ActivityIndicator color={colors.primaryForeground} />
            : <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Try again</Text>}
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // f is guaranteed non-null below this point
  const f = flight;
  const imagePresentation = getFlightImagePresentation(f);
  const aircraftName = f.aircraftTypeName?.trim() || f.aircraftType?.trim() || null;
  const imgSource = imagePresentation === 'provided' && failedImageUrl !== f.imageUrl ? { uri: f.imageUrl! } : null;
  const readOnlyProduction = f.source === 'production';

  const status = myStatus?.status ?? 'none';
  // Public flight responses intentionally omit FBO details. A confirmed
  // member receives them only from the authenticated status response.
  const confirmedFbo = status === 'confirmed' ? myStatus?.confirmedFlight : undefined;
  const departureFbo = confirmedFbo?.departureFbo ?? null;
  const departureFboAddress = confirmedFbo?.departureFboAddress ?? null;
  const hasAuthorizedFboLocation = status === 'confirmed' && !!departureFbo?.trim() && !!departureFboAddress?.trim();
  const fromAirport = f.fromAirport?.trim() || null;
  const fromCity = f.fromCity?.trim() || null;
  const toAirport = f.toAirport?.trim() || null;
  const toCity = f.toCity?.trim() || null;
  const fromLabel = fromAirport ?? fromCity;
  const toLabel = toAirport ?? toCity;
  const departureTime = formatTime12(f.source === 'production' ? presentCachedDepartureClock(f.departureTime) : f.departureTime);
  const arrivalTime = formatTime12(f.source === 'production' ? presentCachedDepartureClock(f.arrivalTime) : f.arrivalTime);
  const viewerFieldsAuthenticated =
    detailCache?.viewerAuthenticated === true &&
    !displayedProduction.showingCachedDiscover &&
    viewerScope !== 'anonymous' &&
    viewerScope !== 'demo';
  const dateLabel = formatDate(f.departureDate);
  const arrivalDateLabel = formatDate(f.arrivalDate);
  const distinctArrivalDate = arrivalDateLabel && arrivalDateLabel !== dateLabel ? arrivalDateLabel : null;
  const scheduleParts = [
    dateLabel,
    departureTime ? `Departs ${departureTime}${f.departureTimeZone ? ` ${f.departureTimeZone}` : ''}` : null,
  ].filter((part): part is string => !!part);
  const routeSummary = fromAirport || toAirport ? `${fromAirport ?? '—'} → ${toAirport ?? '—'}` : 'Route unavailable';
  const findAirport = (code: string | null) => (code ? airportRecords.find((airport) => airport.code === code.toUpperCase()) : undefined);
  const originAirportInfo = findAirport(fromAirport);
  const destinationAirportInfo = findAirport(toAirport);
  const formatAirportLocation = (airport: AirportDisplayRecord | undefined, city: string | null) =>
    [airport?.city?.trim() || city, airport?.state?.trim(), airport?.country?.trim()]
      .filter((part): part is string => !!part?.trim())
      .join(', ');
  const hasCoordinates = (airport: AirportDisplayRecord | undefined) =>
    Number.isFinite(airport?.latitude) && Number.isFinite(airport?.longitude);
  const airportDirectionsTarget = (code: string | null, airport: AirportDisplayRecord | undefined): DirectionsTarget | null => {
    if (!hasCoordinates(airport)) return null;
    const label = airport?.name?.trim() ? `${airport.name.trim()}${code ? ` (${code})` : ''}` : (code ?? airport?.city?.trim() ?? null);
    if (!label) return null;
    return {
      kind: 'airport',
      label,
      destination: `${airport!.latitude},${airport!.longitude}`,
      location: formatAirportLocation(airport, null) || undefined,
    };
  };
  const departureAirportTarget = airportDirectionsTarget(fromAirport, originAirportInfo);
  const arrivalAirportTarget = airportDirectionsTarget(toAirport, destinationAirportInfo);
  const departureAirportLocation = formatAirportLocation(originAirportInfo, fromCity);
  const arrivalAirportLocation = formatAirportLocation(destinationAirportInfo, toCity);
  const departureFboTarget: DirectionsTarget | null =
    hasAuthorizedFboLocation ?
      {
        kind: 'fbo',
        label: departureFbo!.trim(),
        destination: departureFboAddress!.trim(),
      }
    : null;
  const seatsAvailableLabel = presentSeatsAvailable(f.seatsAvailable);
  const flightInformation: FlightInfoItem[] = [
    ...(aircraftName ?
      [
        {
          label: 'Aircraft',
          value: aircraftName,
          detail: f.aircraftTypeCode?.trim() || undefined,
          testID: 'flight-info-aircraft',
          detailTestID: 'flight-info-aircraft-code',
          valueTestID: 'flight-info-aircraft-type',
        },
      ]
    : []),
    ...(f.international !== null ?
      [
        {
          label: 'Route type',
          value: f.international ? 'International' : 'Domestic',
          testID: 'flight-info-international-card',
          valueTestID: 'flight-info-international',
        },
      ]
    : []),
    ...(seatsAvailableLabel ?
      [
        {
          label: 'Seats available',
          value: seatsAvailableLabel,
          testID: 'flight-info-seats-card',
          valueTestID: 'flight-info-seats',
        },
      ]
    : []),
  ];
  const rosterEntry = queueRoster.data?.find((entry) => entry.flightId === f.id && entry.status === 'waiting');
  const rosterMembers = rosterEntry ? readFlightQueue(rosterEntry.queueMembers) : null;
  const queueMembers = localReadMode ? rosterMembers : null;
  const productionRoster =
    !localReadMode && productionQueue.kind === 'participants' ? presentProductionQueueRoster(productionQueue.rows) : null;
  const queueRosterStatus = queueHttpStatus(queueRoster.error);
  const frontUserId = frontMember?.member?.userId ?? null;
  const acceptedConnection =
    acceptedConnections.data?.find((connection) => connection.memberAId === frontUserId || connection.memberBId === frontUserId) ?? null;
  const productionCount = productionQueue.kind === 'participants' ? joinFlightQueueCountLabel(productionQueue.participantCount) : null;
  const localCount = queueMembers && queueMembers.length > 0 ? joinFlightQueueCountLabel(queueMembers.length) : null;
  const rosterViewerPosition = productionRoster?.find((member) => member.isViewer)?.position ?? null;
  const queueViewerPosition = productionQueue.kind === 'participants' ? productionQueue.viewerPosition : null;
  const flightViewerPosition =
    typeof f.viewerQueuePosition === 'number' && Number.isSafeInteger(f.viewerQueuePosition) && f.viewerQueuePosition > 0 ?
      f.viewerQueuePosition
    : null;
  const viewerPosition = rosterViewerPosition ?? queueViewerPosition ?? flightViewerPosition;
  const productionViewerInQueue =
    f.userInQueue === true || rosterViewerPosition != null || (viewerPosition != null && viewerPosition >= 1);
  const leaderTarget = resolveProductionLeaderQueueTarget({
    roster: productionRoster,
    viewerPosition,
  });
  const leaderReference = leaderTarget.reference;
  const viewerIsLeader = leaderTarget.viewerIsLeader;
  const queueRelationshipStatus =
    !queueConnectionsEnabled ? 'ready'
    : queueConnectionStatus.isSuccess ? 'ready'
    : queueConnectionStatus.isError ? 'error'
    : 'loading';
  const leaderConnection = presentLeaderQueuePreviewState({
    viewerInQueue: productionViewerInQueue,
    viewerIsLeader,
    viewerBelowFirst: leaderTarget.viewerBelowFirst,
    reference: leaderReference,
    requestsEnabled: isMemberConnectionsIntegrationEnabled(),
    status: queueRelationshipStatus,
    relationships: mergeLeaderQueueRelationships(
      queueConnectionStatus.data ?? [],
      confirmedLeaderRelationship ? [confirmedLeaderRelationship] : [],
    ),
    flightId: numericFlightId ?? 0,
    sendBlocked: leaderSendBlocked,
  });
  const localViewerInQueue = myStatus?.status === 'waiting' && typeof myStatus.queuePosition === 'number' && myStatus.queuePosition >= 1;
  const localFrontConnection = presentFrontQueueConnection({
    viewerInQueue: localViewerInQueue,
    viewerIsFirst: myStatus?.queuePosition === 1,
    channel: 'local',
    localEligible: frontMember ? frontMember.eligible === true : undefined,
    localStatus: acceptedConnection ? 'accepted' : networkRequestStatus,
  });
  const openAcceptedConversation = () => {
    if (!acceptedConnection || localFrontConnection !== 'accepted') return;
    setFrontPreview(null);
    router.push(`/networking/connections/${acceptedConnection.id}` as never);
  };
  const openProductionConversation = () => {
    if (leaderConnection.kind !== 'accepted') return;
    const participantUserId = acceptedConnectionMemberUserId(leaderConnection.connectionId, memberConnections.accepted);
    if (!participantUserId) return;
    void messages.open(participantUserId).then((result) => {
      if (result?.kind !== 'loaded') return;
      setFrontPreview(null);
      router.push({
        pathname: '/messages/[conversationId]',
        params: { conversationId: String(result.data.conversation.id) },
      });
    });
  };
  const openJoinToConnect = () => {
    if (productionFlightId === null) return;
    setFrontPreview(null);
    router.push({
      pathname: '/flight/join',
      params: joinFlightRouteParams(productionFlightId, f, {
        originCountry: originAirportInfo?.country,
        destinationCountry: destinationAirportInfo?.country,
      }),
    });
  };
  const sendLeaderRequest = async () => {
    // Opaque queue target reference only — never a member user id.
    if (leaderConnection.kind !== 'request' || leaderRequestPending || numericFlightId == null) return;
    if (viewerIsLeader || !leaderTarget.viewerBelowFirst) return;
    const configuration = getMainBluebirdApiConfigurationOrNull();
    const accountId = clerkSessionRef.current?.isSignedIn === true ? clerkSessionRef.current.userId : null;
    if (!configuration || !accountId) return;
    const reference = leaderConnection.reference;
    setLeaderRequestPending(true);
    setLeaderRequestNotice(null);
    try {
      const client = createMemberConnectionsClient({
        enabled: isMemberConnectionsIntegrationEnabled(),
        environment: configuration.environment,
        baseUrl: configuration.apiBaseUrl,
        getAccessToken: () => clerkSessionRef.current?.getToken() ?? Promise.resolve(null),
      });
      const result = await client.createQueueRequest(reference);
      if (clerkSessionRef.current?.userId !== accountId) return;
      if (result.kind === 'loaded') {
        setConfirmedLeaderRelationship({
          connectionId: result.data.connection.id,
          emptyLegId: numericFlightId,
          status: 'pending',
          direction: 'outgoing',
        });
        await queueConnectionStatus.refetch();
        setLeaderSendBlocked(false);
        setLeaderRequestNotice(null);
        return;
      }
      const code = result.kind === 'error' ? result.code : 'unavailable';
      if (code === 'relationship_exists') {
        const refreshed = await queueConnectionStatus.refetch();
        const restored = (refreshed.data ?? []).some(
          (row) => row.emptyLegId === numericFlightId && (row.direction === 'outgoing' || row.status === 'accepted'),
        );
        if (restored) {
          setLeaderSendBlocked(false);
          setLeaderRequestNotice(null);
          return;
        }
        setLeaderSendBlocked(true);
      }
      if (code === 'queue_target_unavailable' || code === 'self_request' || code === 'first_in_queue_required') {
        await queryClient.invalidateQueries({
          queryKey: mainBluebirdAuthenticatedQueryKey(configuration.environment, accountId, 'empty-leg-queue', numericFlightId),
        });
      }
      if (code === 'self_request' || code === 'queue_target_unavailable' || code === 'first_in_queue_required') {
        setLeaderSendBlocked(true);
      }
      setLeaderRequestNotice(
        result.kind === 'disabled' ? 'Connection requests are not available yet.' : queueConnectionRequestFailureCopy(code),
      );
    } finally {
      setLeaderRequestPending(false);
    }
  };
  const previewConnection: FrontQueueConnectionKind | LeaderQueueConnection['kind'] =
    frontPreview === 'production' ? leaderConnection.kind
    : frontPreview === 'local' ? localFrontConnection
    : 'hidden';
  const productionChatUserId =
    leaderConnection.kind === 'accepted' ? acceptedConnectionMemberUserId(leaderConnection.connectionId, memberConnections.accepted) : null;
  const sendDisabled =
    frontPreview === 'production' ?
      previewConnection !== 'request' || leaderRequestPending
    : (previewConnection !== 'request' && previewConnection !== 'declined') || networkingRequest.isPending;
  const previewInitials =
    frontPreview === 'production' ?
      (leaderTarget.target?.initials ?? '')
    : (queueMembers?.find((member) => member.position === 1)?.initials ?? '');
  const previewTitle = presentLeaderPreviewTitle({
    displayName: frontPreview === 'production' ? (leaderTarget.target?.displayName ?? null) : null,
    firstName: frontPreview === 'production' ? (leaderPreviewName?.firstName ?? null) : null,
    lastName: frontPreview === 'production' ? (leaderPreviewName?.lastName ?? null) : null,
    initials: previewInitials,
  });
  const loadLeaderPreviewName = (reference: string | null) => {
    setLeaderPreviewName(null);
    const configuration = getMainBluebirdApiConfigurationOrNull();
    if (!reference || !configuration || !isMemberConnectionsIntegrationEnabled()) return;
    const accountId = clerkSessionRef.current?.isSignedIn === true ? clerkSessionRef.current.userId : null;
    if (!accountId) return;
    void createMemberConnectionsClient({
      enabled: true,
      environment: configuration.environment,
      baseUrl: configuration.apiBaseUrl,
      getAccessToken: () => clerkSessionRef.current?.getToken() ?? Promise.resolve(null),
    })
      .previewQueueTarget(reference)
      .then((result) => {
        if (clerkSessionRef.current?.userId !== accountId) return;
        if (result.kind !== 'loaded') return;
        setLeaderPreviewName({
          firstName: result.data.firstName,
          lastName: result.data.lastName,
        });
      })
      .catch(() => {});
  };

  const showMapError = (target: string) => {
    const message = `We couldn't open maps. Search for this location instead:\n\n${target}`;
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') window.alert(message);
    } else {
      Alert.alert('Unable to open maps', message);
    }
  };

  const openDirections = async (service: 'apple' | 'google') => {
    const target = directionsTarget;
    setDirectionsTarget(null);
    if (!target) return;
    const destination = encodeURIComponent(target.destination.replace(/\n/g, ', '));
    const url =
      service === 'apple' ?
        `https://maps.apple.com/?daddr=${destination}&dirflg=d`
      : `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
    try {
      await Linking.openURL(url);
    } catch {
      showMapError(target.kind === 'fbo' ? target.destination : target.label);
    }
  };

  const flightAvailable = f.status === 'available';
  const STATUS_LABELS: Record<string, string> = {
    boarding: 'Boarding',
    departed: 'Departed',
    completed: 'Completed',
    cancelled: 'Cancelled',
  };
  const statusLabel = STATUS_LABELS[f.status as string] ?? 'Unavailable';
  const responseFlightId = readOnlyProduction ? parseProductionFlightId(f.id) : null;
  const productionFlightId = responseFlightId !== null && responseFlightId === numericFlightId ? responseFlightId : null;

  // ── CTA footer rendering — branched on my-status ─────────────────────────
  function renderCTA() {
    if (demoMode) {
      if (!demoQueue || !demoQueue.hydrated) {
        return (
          <View style={styles.statusLoadingRow} testID="full-app-demo-queue-loading">
            <ActivityIndicator color={colors.primary} size="small" />
          </View>
        );
      }
      const entry = demoEntry;
      if (!entry && f.status && f.status !== 'available' && f.status !== 'published') {
        return renderUnavailableCTA(
          'Flight no longer available',
          'This flight is no longer accepting queue entries. No demo queue was created.',
        );
      }
      const openDemoQueue = () =>
        router.push({
          pathname: '/queue/status',
          params: { flightId: f.id, ...(entry ? { entryId: entry.id } : {}) },
        });
      const openDemoPolicy = () =>
        router.push({
          pathname: '/flight/policy',
          params: {
            flightId: f.id,
            from: f.fromAirport ?? '',
            to: f.toAirport ?? '',
            fromCity: f.fromCity ?? '',
            toCity: f.toCity ?? '',
            departureDate: f.departureDate ?? '',
            departureTime: f.departureTime ?? '',
            duration: f.duration ?? '',
            aircraftType: f.aircraftTypeName ?? f.aircraftType ?? '',
            international: f.international ? '1' : '0',
            feeUsd: String(f.internationalFeeUsd ?? 1000),
            flightStatus: f.status ?? 'available',
          },
        });
      return (
        <>
          {entry ?
            <View testID="full-app-demo-flight-queue-status" style={[styles.queuePositionCard, { backgroundColor: colors.primary + '12' }]}>
              <Text style={[styles.queuePositionLabel, { color: colors.mutedForegroundLight }]}>
                {entry.status === 'won' ? 'Local demo outcome' : 'Local demo queue status'}
              </Text>
              <Text style={[styles.queuePositionNumber, { color: colors.textOnSurface }]}>
                {entry.status === 'won' ?
                  'Flight won'
                : entry.status === 'waiting' || entry.status === 'changed-position' ?
                  `#${entry.position}`
                : entry.status === 'closed' ?
                  'Closed'
                : 'No longer waiting'}
              </Text>
            </View>
          : <View style={[styles.unavailableBadge, { backgroundColor: colors.muted }]}>
              <Text style={[styles.unavailableBadgeText, { color: colors.mutedForegroundLight }]}>
                {f.source === 'local' ? 'Sample flight · local demo queue' : 'Demo queue · local only'}
              </Text>
            </View>
          }
          {demoQueue.storageError ?
            <Text testID="full-app-demo-queue-storage-error" style={[styles.unavailableHint, { color: colors.mutedForegroundLight }]}>
              {demoQueue.storageError}
            </Text>
          : null}
          <TouchableOpacity
            testID={
              entry?.status === 'won' ? 'full-app-demo-view-won-flight'
              : entry ?
                'full-app-demo-open-queue-status'
              : 'full-app-demo-join-queue'
            }
            accessibilityRole="button"
            disabled={!!demoQueue.storageError}
            onPress={() => {
              const targetPathname =
                entry?.status === 'won' ? `/flight/${entry.flightId}`
                : entry ? '/queue/status'
                : '/flight/policy';
              logJoinNav('join-button', {
                screen: 'flight/[id]',
                visibleLabel:
                  entry?.status === 'won' ? 'View Flight Won'
                  : entry ? 'View Queue Status'
                  : 'Review Flight Policy & Join Queue',
                currentPathname: pathname,
                targetPathname,
                routerMethod: entry?.status === 'won' ? 'replace' : 'push',
                demoMode: true,
              });
              if (entry?.status === 'won') router.replace(`/flight/${entry.flightId}` as any);
              else if (entry) openDemoQueue();
              else openDemoPolicy();
            }}
            style={[styles.viewTripBtn, { backgroundColor: colors.primary }, demoQueue.storageError && { opacity: 0.6 }]}>
            <Text style={[styles.viewTripBtnText, { color: colors.primaryForeground }]}>
              {entry?.status === 'won' ?
                'View Flight Won'
              : demoEntry ?
                'View Queue Status'
              : 'Review Flight Policy & Join Queue'}
            </Text>
          </TouchableOpacity>
          <Text style={[styles.unavailableHint, { color: colors.mutedForegroundLight }]}>Demo outcomes stay on this device.</Text>
        </>
      );
    }
    // Keep production queue actions behind the runtime verification gate.
    // Until it opens, this stays a public read-only details screen.
    if (readOnlyProduction) {
      if (isProductionQueueVerified()) {
        return productionFlightId === null ?
            renderUnavailableCTA('Queue unavailable', 'This flight does not have a valid queue identifier.')
          : <ClerkQueuePanel emptyLegId={productionFlightId} existingSkipLineCredits={0} flightStatus={f.status} />;
      }
      const memberInQueue = f.userInQueue === true && productionFlightId !== null;
      const queueActionsOpen =
        memberInQueue &&
        productionQueueActionsVisible({
          userInQueue: f.userInQueue,
          viewerIsEffectiveWinner: f.viewerIsEffectiveWinner,
          viewerConfirmationStatus: f.viewerConfirmationStatus,
          viewerIsBookedPassenger: f.viewerIsBookedPassenger,
          queueClosed: queueClosedAt(f.queueClosesAt, Date.now()),
        });
      if (queueActionsOpen && productionFlightId !== null) {
        return (
          <>
            <TouchableOpacity
              testID="flight-detail-view-queue"
              accessibilityRole="button"
              accessibilityLabel="View Queue Status"
              onPress={() => {
                const now = Date.now();
                if (now - joinNavAt.current < 600) return;
                joinNavAt.current = now;
                router.push({
                  pathname: '/flight/queue-status',
                  params: { flightId: String(productionFlightId) },
                });
              }}
              style={[styles.viewTripBtn, { backgroundColor: colors.primary }]}>
              <Text style={[styles.viewTripBtnText, { color: colors.primaryForeground }]}>View Queue Status</Text>
            </TouchableOpacity>
            <ProductionQueueLeaveControl flightId={productionFlightId} visible label="Leave the Queue" />
          </>
        );
      }
      if (memberInQueue && !queueActionsOpen) return null;
      const selectedWinner = !productionQueueActionsVisible({
        userInQueue: true,
        viewerIsEffectiveWinner: f.viewerIsEffectiveWinner,
        viewerConfirmationStatus: f.viewerConfirmationStatus,
        viewerIsBookedPassenger: f.viewerIsBookedPassenger,
        queueClosed: queueClosedAt(f.queueClosesAt, Date.now()),
      });
      if (selectedWinner) return null;
      return (
        <TouchableOpacity
          testID="production-queue-read-only-cta"
          accessibilityRole="button"
          accessibilityLabel="Join the Flight"
          disabled={productionFlightId === null}
          onPress={() => {
            if (productionFlightId === null) return;
            const now = Date.now();
            if (now - joinNavAt.current < 600) return;
            joinNavAt.current = now;
            logJoinNav('join-button', {
              screen: 'flight/[id]',
              visibleLabel: 'Join the Flight',
              currentPathname: pathname,
              targetPathname: '/flight/join',
              flightId: productionFlightId,
              demoEnabled: demoJoin.enabled,
              routerMethod: 'push',
            });
            router.push({
              pathname: '/flight/join',
              params: joinFlightRouteParams(productionFlightId, f, {
                originCountry: originAirportInfo?.country,
                destinationCountry: destinationAirportInfo?.country,
              }),
            });
          }}
          style={[styles.viewTripBtn, { backgroundColor: colors.primary, opacity: productionFlightId === null ? 0.5 : 1 }]}>
          <Text style={[styles.viewTripBtnText, { color: colors.primaryForeground }]}>Join the Flight</Text>
        </TouchableOpacity>
      );
    }

    // Non-available flight: joining is impossible, so show the flight's
    // status instead of any join action. Confirmed/waiting members still see
    // their own state below (e.g. a confirmed trip on a departed flight).
    if (!flightAvailable && (!user || !myStatus || myStatus.status === 'none')) {
      return (
        <>
          <View style={[styles.unavailableBadge, { backgroundColor: colors.muted }]}>
            <Text style={[styles.unavailableBadgeText, { color: colors.mutedForegroundLight }]}>
              {f.status === 'cancelled' ? '✕' : '—'} {statusLabel}
            </Text>
          </View>
          <Text style={[styles.unavailableHint, { color: colors.mutedForegroundLight }]}>
            This flight is no longer accepting join requests.
          </Text>
        </>
      );
    }

    if (!user) {
      return renderUnavailableCTA(
        'Sign in required',
        'Sign in to review account-specific access. Queue and booking requests are unavailable from this screen.',
      );
    }

    if (String(user.membershipTier) === 'none') {
      return renderUnavailableCTA(
        'Membership required',
        'A membership is required to join. Membership changes are unavailable from this flight detail screen.',
      );
    }

    // Keep queue state explicit while it is loading; if the request fails,
    // avoid leaving a spinner on screen or implying that a request was sent.
    if (statusLoading) {
      return (
        <View style={styles.statusLoadingRow}>
          <ActivityIndicator color={colors.primary} size="small" />
        </View>
      );
    }
    if (!myStatus) {
      return renderUnavailableCTA(
        'Queue access unavailable',
        'We could not verify your access for this flight. No queue or booking request was sent.',
      );
    }

    if (status === 'confirmed') {
      return (
        <>
          <View style={[styles.confirmedBadge, { backgroundColor: colors.success + '15' }]}>
            <Text style={[styles.confirmedBadgeEmoji, { color: colors.success }]}>✓</Text>
            <Text style={[styles.confirmedBadgeText, { color: colors.success }]}>You're confirmed on this flight</Text>
          </View>
          <TouchableOpacity
            style={[styles.viewTripBtn, { backgroundColor: colors.backgroundMid }]}
            onPress={() => router.push('/(tabs)/trips')}
            activeOpacity={0.8}>
            <Text style={[styles.viewTripBtnText, { color: colors.primaryForeground }]}>View in My Trips</Text>
          </TouchableOpacity>
          {!!myStatus?.tripId && (
            <TouchableOpacity
              testID="open-passenger-list"
              style={[styles.leaveQueueBtn, { borderColor: colors.primary }]}
              onPress={() => router.push(`/trip/${myStatus.tripId}/passengers` as any)}
              activeOpacity={0.75}>
              <Text style={[styles.leaveQueueBtnText, { color: colors.primary }]}>
                Passenger Information
                {myStatus?.manifest ? ` — ${myStatus.manifest.completedCount} of ${myStatus.manifest.requiredCount} completed` : ''}
              </Text>
            </TouchableOpacity>
          )}
          {!!myStatus?.tripId && (
            <TouchableOpacity
              style={[styles.leaveQueueBtn, { borderColor: colors.border }, cancelTripMutation.isPending && { opacity: 0.6 }]}
              onPress={handleCancelBooking}
              disabled={cancelTripMutation.isPending}
              activeOpacity={0.75}>
              {cancelTripMutation.isPending ?
                <ActivityIndicator color={colors.mutedForegroundLight} size="small" />
              : <Text style={[styles.leaveQueueBtnText, { color: colors.mutedForegroundLight }]}>Cancel Booking</Text>}
            </TouchableOpacity>
          )}
        </>
      );
    }

    if (status === 'waiting') {
      const anyPending = cancelMutation.isPending;
      return (
        <>
          <View style={[styles.queuePositionCard, { backgroundColor: colors.primary + '12' }]}>
            <Text style={[styles.queuePositionLabel, { color: colors.mutedForegroundLight }]}>Your queue position</Text>
            <Text style={[styles.queuePositionNumber, { color: colors.textOnSurface }]}>
              #{myStatus?.queuePosition}
              <Text style={[styles.queuePositionTotal, { color: colors.mutedForegroundLight }]}> of {myStatus?.totalInQueue}</Text>
            </Text>
            {myStatus?.queuePosition === 1 && (
              <Text style={[styles.queuePositionEligible, { color: colors.success }]}>
                You're next — your seat will be confirmed automatically
              </Text>
            )}
          </View>
          <TouchableOpacity
            style={[styles.leaveQueueBtn, { borderColor: colors.border }, anyPending && { opacity: 0.6 }]}
            onPress={handleLeaveQueue}
            disabled={anyPending}
            activeOpacity={0.75}>
            {cancelMutation.isPending ?
              <ActivityIndicator color={colors.mutedForegroundLight} size="small" />
            : <Text style={[styles.leaveQueueBtnText, { color: colors.mutedForegroundLight }]}>Leave Queue</Text>}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.conciergeLink}
            onPress={() =>
              router.push({
                pathname: '/queue/status',
                params: myStatus?.queueEntryId ? { entryId: myStatus.queueEntryId } : { flightId: id! },
              })
            }
            activeOpacity={0.7}>
            <Text style={[styles.conciergeLinkText, { color: colors.mutedForegroundLight }]}>View full queue status</Text>
          </TouchableOpacity>
        </>
      );
    }

    return renderUnavailableCTA('Request unavailable', 'Queue and booking requests are not available from this flight detail screen.');
  }

  function renderUnavailableCTA(title: string, message: string) {
    return (
      <>
        <View style={[styles.unavailableBadge, { backgroundColor: colors.muted }]}>
          <Text style={[styles.unavailableBadgeText, { color: colors.mutedForegroundLight }]}>{title}</Text>
        </View>
        <Text style={[styles.unavailableHint, { color: colors.mutedForegroundLight }]}>{message}</Text>
      </>
    );
  }

  function renderAirportRow(
    label: 'Departure' | 'Arrival',
    code: string | null,
    city: string | null,
    airport: AirportDisplayRecord | undefined,
    location: string,
    target: DirectionsTarget | null,
  ) {
    const airportName = airport?.name?.trim() || null;
    const primary = airportName ? `${airportName}${code ? ` (${code})` : ''}` : (code ?? city);
    if (!primary) return null;
    const rowContent = (
      <>
        <View style={styles.airportRowCopy}>
          <Text style={[styles.airportRowLabel, { color: colors.mutedForegroundLight }]}>{label}</Text>
          <Text style={[styles.airportRowName, { color: colors.textOnSurface }]} numberOfLines={1}>
            {primary}
          </Text>
          {!!location && (
            <Text style={[styles.airportRowLocation, { color: colors.mutedForegroundLight }]} numberOfLines={1}>
              {location}
            </Text>
          )}
        </View>
        {target && <Feather name="navigation" size={17} color={colors.primary} />}
      </>
    );
    return (
      <View key={label} testID={`flight-airport-${label.toLowerCase()}`} style={[styles.airportRow, { backgroundColor: colors.surface }]}>
        {target ?
          <TouchableOpacity
            testID={label === 'Departure' ? 'departure-airport-directions' : 'arrival-airport-directions'}
            style={styles.airportRowAction}
            onPress={() => setDirectionsTarget(target)}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={`Get directions to ${target.label}`}
            accessibilityHint="Choose Apple Maps or Google Maps">
            {rowContent}
          </TouchableOpacity>
        : <View style={styles.airportRowAction}>{rowContent}</View>}
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]}>
      {/* ── Frosted back button (floats above hero) ── */}
      <TouchableOpacity
        style={[styles.backBtn, { top: backTop, backgroundColor: colors.surface + 'CC' }]}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        onPress={() => {
          const now = Date.now();
          if (now - flightBackAt.current < 600) return;
          flightBackAt.current = now;
          const canGoBack = router.canGoBack();
          logJoinNav('flight-details-back', {
            currentPathname: pathname,
            routerMethod: canGoBack ? 'back' : 'replace',
            destination: canGoBack ? 'previous' : '/(tabs)/discover',
            reason: 'flight-details-back-press',
          });
          if (canGoBack) router.back();
          else router.replace('/(tabs)/discover');
        }}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Back to flights"
        testID="flight-detail-back">
        <Text style={[styles.backChevron, { color: colors.textOnSurface }]}>‹</Text>
      </TouchableOpacity>

      <ScrollView
        style={{ flex: 1, backgroundColor: colors.offWhite }}
        contentContainerStyle={{
          paddingBottom: botPad + 128,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {/* ── Hero image with gradient ── */}
        <View style={[styles.heroFrame, { height: heroHeight }]}>
          {imgSource ?
            <ImageBackground
              testID="flight-detail-photo"
              source={imgSource}
              style={StyleSheet.absoluteFill}
              onError={() => setFailedImageUrl(f.imageUrl)}>
              {/* Top-to-middle dark fade so back button is visible */}
              <LinearGradient colors={['rgba(6,11,31,0.50)', 'rgba(6,11,31,0.0)']} locations={[0, 0.55]} style={StyleSheet.absoluteFill} />
              {/* Bottom fade to the screen bg so hero blends into content below */}
              <LinearGradient colors={[colors.offWhite + '00', colors.offWhite]} locations={[0.55, 1]} style={StyleSheet.absoluteFill} />
            </ImageBackground>
          : <View testID="flight-detail-photo-unavailable" style={[styles.heroUnavailable, { backgroundColor: colors.muted }]}>
              <Feather name="image" size={28} color={colors.mutedForeground} />
              <Text style={[styles.heroUnavailableText, { color: colors.mutedForeground }]}>Aircraft photo unavailable</Text>
            </View>
          }
          {!!(fromAirport || toAirport) && (
            <View
              testID="flight-detail-hero-route"
              style={[
                styles.heroRouteBadge,
                {
                  backgroundColor: imgSource ? colors.primaryForeground + '2E' : colors.surface,
                  borderColor: imgSource ? colors.primaryForeground + '4D' : colors.border,
                },
              ]}>
              <Text style={[styles.heroRouteBadgeText, { color: imgSource ? colors.primaryForeground : colors.textOnSurface }]}>
                {routeSummary}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.flightHeader}>
          {demoMode && f.source === 'local' ?
            <Text testID="full-app-demo-flight-fixture-badge" style={[styles.flightInfoLabel, { color: colors.primary }]}>
              SAMPLE FLIGHT · LOCAL QUEUE ONLY
            </Text>
          : null}
          {!!aircraftName && (
            <Text style={[styles.aircraftName, { color: colors.textOnSurface }]} numberOfLines={1}>
              {aircraftName}
            </Text>
          )}
          {scheduleParts.length > 0 && (
            <Text style={[styles.dateText, { color: colors.mutedForegroundLight }]} numberOfLines={1}>
              {scheduleParts.join(' · ')}
            </Text>
          )}
          {displayedProduction.refreshFailed && (
            <Text testID="flight-detail-refresh-error" style={[styles.dateText, { color: colors.mutedForegroundLight }]}>
              Flight details could not be refreshed.
            </Text>
          )}
          {productionFlightQuery.isFetching && displayedProduction.showingCachedDiscover && (
            <Text testID="flight-detail-refreshing" style={[styles.dateText, { color: colors.mutedForegroundLight }]}>
              Updating flight details
            </Text>
          )}
        </View>

        {!demoMode && f.source === 'production' && viewerFieldsAuthenticated && numericFlightId !== null && (
          <WinnerFlightNotice
            flightId={numericFlightId}
            viewerIsEffectiveWinner={f.viewerIsEffectiveWinner}
            viewerConfirmationStatus={f.viewerConfirmationStatus}
            queueClosesAt={f.queueClosesAt}
            departureAirport={fromLabel ?? 'Departure unavailable'}
            arrivalAirport={toLabel ?? 'Arrival unavailable'}
            scheduleLabel={scheduleParts.length > 0 ? scheduleParts.join(' · ') : 'Departure time unavailable'}
            aircraft={aircraftName}
          />
        )}

        {/* ── Compact route and local schedule ── */}
        <View
          testID="flight-detail-route-card"
          style={[styles.routeCard, { backgroundColor: colors.surface, borderColor: colors.separator }]}>
          <Text testID="flight-detail-route" style={[styles.routeSummary, { color: colors.textOnSurface }]} numberOfLines={1}>
            {routeSummary}
          </Text>
          <View style={styles.routeSchedule}>
            <View style={styles.routeEndpoint}>
              {departureTime && (
                <Text
                  testID="flight-detail-route-departure-time"
                  style={[styles.routeTime, { color: colors.textOnSurface }]}
                  numberOfLines={1}>
                  {departureTime}
                </Text>
              )}
              {!!(fromCity || originAirportInfo?.city) && (
                <Text style={[styles.routeCity, { color: colors.mutedForegroundLight }]} numberOfLines={1}>
                  {fromCity || originAirportInfo?.city}
                </Text>
              )}
            </View>
            <View style={styles.routeCenter}>
              <View style={[styles.routeLine, { backgroundColor: colors.separator }]} />
              <View style={[styles.routeDot, { backgroundColor: colors.primary }]} />
              {!!f.duration && (
                <Text
                  testID="flight-detail-route-duration"
                  style={[styles.routeDuration, { color: colors.mutedForegroundLight }]}
                  numberOfLines={1}>
                  {f.duration}
                </Text>
              )}
              <View style={[styles.routeDot, { backgroundColor: colors.primary }]} />
              <View style={[styles.routeLine, { backgroundColor: colors.separator }]} />
            </View>
            <View style={[styles.routeEndpoint, styles.routeEndpointRight]}>
              {arrivalTime && (
                <Text
                  testID="flight-detail-route-arrival-time"
                  style={[styles.routeTime, { color: colors.textOnSurface }]}
                  numberOfLines={1}>
                  {arrivalTime}
                </Text>
              )}
              {!!distinctArrivalDate && (
                <Text
                  testID="flight-detail-route-arrival-date"
                  style={[styles.routeCity, { color: colors.mutedForegroundLight }]}
                  numberOfLines={1}>
                  Arrives {distinctArrivalDate}
                </Text>
              )}
              {!!(toCity || destinationAirportInfo?.city) && (
                <Text style={[styles.routeCity, { color: colors.mutedForegroundLight }]} numberOfLines={1}>
                  {toCity || destinationAirportInfo?.city}
                </Text>
              )}
            </View>
          </View>
        </View>

        <View style={styles.flightInfoSection} testID="flight-queue-section">
          <Text style={[styles.flightInfoTitle, { color: colors.textOnSurface }]}>Flight Queue</Text>
          {localReadMode && !user ?
            <Text style={[styles.queueState, { color: colors.mutedForegroundLight }]} testID="flight-queue-signed-out">
              Sign in to see the flight queue.
            </Text>
          : localReadMode && queueRoster.isLoading ?
            <ActivityIndicator color={colors.primary} style={styles.queueState} testID="flight-queue-loading" />
          : localReadMode && queueRoster.isError ?
            <View testID={queueRosterStatus === 401 || queueRosterStatus === 403 ? 'flight-queue-denied' : 'flight-queue-error'}>
              <Text style={[styles.queueState, { color: colors.mutedForegroundLight }]}>
                {queueRosterStatus === 401 || queueRosterStatus === 403 ?
                  'Queue details are not available for this account.'
                : 'The queue could not be loaded.'}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  void queueRoster.refetch();
                }}
                accessibilityRole="button">
                <Text style={[styles.queueRetry, { color: colors.primary }]}>Try again</Text>
              </TouchableOpacity>
            </View>
          : !localReadMode && productionQueue.kind === 'loading' ?
            <ActivityIndicator color={colors.primary} style={styles.queueState} testID="flight-queue-loading" />
          : !localReadMode && productionQueue.kind === 'signed-out' ?
            <Text style={[styles.queueState, { color: colors.mutedForegroundLight }]} testID="flight-queue-signed-out">
              Sign in to see the flight queue.
            </Text>
          : !localReadMode && productionQueue.kind === 'unauthorized' ?
            <Text style={[styles.queueState, { color: colors.mutedForegroundLight }]} testID="flight-queue-denied">
              Queue details are not available for this account.
            </Text>
          : !localReadMode && productionQueue.kind === 'empty' ?
            <Text style={[styles.queueState, { color: colors.mutedForegroundLight }]} testID="flight-queue-empty">
              No one is waiting in this queue.
            </Text>
          : !localReadMode && productionQueue.kind === 'unavailable' ?
            <View testID="flight-queue-error">
              <Text style={[styles.queueState, { color: colors.mutedForegroundLight }]}>The queue could not be loaded.</Text>
              <TouchableOpacity
                onPress={() => {
                  void refetchProductionQueue();
                }}
                accessibilityRole="button"
                testID="flight-queue-retry">
                <Text style={[styles.queueRetry, { color: colors.primary }]}>Try again</Text>
              </TouchableOpacity>
            </View>
          : !localReadMode && productionRoster ?
            <>
              {productionCount ?
                <Text style={[styles.queueState, { color: colors.mutedForegroundLight }]} testID="flight-queue-count">
                  {productionCount}
                </Text>
              : null}
              <View testID="flight-queue-list">
                {productionRoster.map((member) => {
                  const first = member.position === 1;
                  return (
                    <QueueMemberRow
                      key={`${member.position}-${member.initials}`}
                      initials={member.initials}
                      displayName={first ? member.displayName : null}
                      position={member.position}
                      first={first}
                      viewer={member.isViewer}
                      selectable={
                        first &&
                        canOpenLeaderQueuePreview({
                          viewerIsLeader,
                          connection: leaderConnection.kind,
                        })
                      }
                      onPress={() => {
                        setFrontPreview('production');
                        loadLeaderPreviewName(leaderReference);
                      }}
                    />
                  );
                })}
              </View>
            </>
          : localReadMode && (queueMembers == null || myStatus?.status !== 'waiting') ?
            <Text
              style={[styles.queueState, { color: colors.mutedForegroundLight }]}
              testID={myStatus?.status !== 'waiting' ? 'flight-queue-empty' : 'flight-queue-unavailable'}>
              {myStatus?.status !== 'waiting' ?
                'Join this flight to see who is waiting.'
              : 'The full queue is not available for this flight.'}
            </Text>
          : localReadMode && queueMembers && queueMembers.length === 0 ?
            <Text style={[styles.queueState, { color: colors.mutedForegroundLight }]} testID="flight-queue-empty">
              No one is waiting in this queue.
            </Text>
          : localReadMode && queueMembers ?
            <>
              {localCount ?
                <Text style={[styles.queueState, { color: colors.mutedForegroundLight }]} testID="flight-queue-count">
                  {localCount}
                </Text>
              : null}
              <View testID="flight-queue-list">
                {queueMembers.map((member) => {
                  const first = member.position === 1;
                  const viewer = localViewerInQueue && member.position === myStatus?.queuePosition;
                  return (
                    <QueueMemberRow
                      key={`${member.position}-${member.initials}`}
                      initials={member.initials}
                      position={member.position}
                      first={first}
                      viewer={viewer}
                      selectable={first && localFrontConnection !== 'hidden'}
                      onPress={() => setFrontPreview('local')}
                    />
                  );
                })}
              </View>
            </>
          : <Text style={[styles.queueState, { color: colors.mutedForegroundLight }]} testID="flight-queue-unavailable">
              The full queue is not available for this flight.
            </Text>
          }
        </View>

        {/* ── Four supported flight facts ── */}
        {flightInformation.length > 0 && (
          <View style={styles.flightInfoSection}>
            <Text testID="flight-info-section-title" style={[styles.flightInfoTitle, { color: colors.textOnSurface }]}>
              Flight information
            </Text>
            <View style={styles.flightInfoGrid}>
              {flightInformation.map((item) => (
                <FlightInfoCard key={item.label} item={item} testID={item.testID!} colors={colors} />
              ))}
            </View>
          </View>
        )}

        {/* ── Airport locations only use names and locations returned by the readers ── */}
        {(fromLabel || toLabel) && (
          <View style={styles.airportSection}>
            <Text style={[styles.flightInfoTitle, { color: colors.textOnSurface }]}>Airport locations</Text>
            {renderAirportRow('Departure', fromAirport, fromCity, originAirportInfo, departureAirportLocation, departureAirportTarget)}
            {renderAirportRow('Arrival', toAirport, toCity, destinationAirportInfo, arrivalAirportLocation, arrivalAirportTarget)}
          </View>
        )}

        {/* ── FBO destination remains separate and is only read for confirmed members ── */}
        {!!departureFboTarget && (
          <TouchableOpacity
            style={[styles.fboCard, { backgroundColor: colors.backgroundMid }]}
            onPress={() => setDirectionsTarget(departureFboTarget)}
            activeOpacity={0.78}
            accessibilityRole="button"
            accessibilityLabel={`Get directions to ${departureFboTarget.label}`}
            accessibilityHint="Choose Apple Maps or Google Maps"
            testID="departure-fbo-directions">
            <View style={styles.fboHeader}>
              <Text style={[styles.fboLabel, { color: colors.mutedOnBrand }]}>FBO · DEPARTURE</Text>
              <Feather name="navigation" size={19} color={colors.textOnBrand} />
            </View>
            <Text style={[styles.fboValue, { color: colors.textOnBrand }]}>{departureFboTarget.label}</Text>
            <Text style={[styles.fboAddress, { color: colors.mutedOnBrand }]}>{departureFboAddress}</Text>
            <Text style={[styles.fboAction, { color: colors.textOnBrand }]}>Get directions</Text>
          </TouchableOpacity>
        )}

        {/* ── Policy link ── */}
        <TouchableOpacity
          style={[styles.policyRow, { borderTopColor: colors.separator }]}
          onPress={() => {
            logJoinNav('flight-details-policy', {
              screen: 'flight/[id]',
              visibleLabel: 'View Flight Policy & Terms',
              currentPathname: pathname,
              targetPathname: '/flight/policy',
              routerMethod: 'push',
            });
            router.push('/flight/policy');
          }}
          activeOpacity={0.7}>
          <Text style={[styles.policyText, { color: colors.mutedForegroundLight }]}>View Flight Policy & Terms</Text>
          <Text style={[styles.policyChevron, { color: colors.mutedForegroundLight }]}>›</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal
        visible={frontPreview != null}
        transparent
        animationType="fade"
        presentationStyle="overFullScreen"
        onRequestClose={() => setFrontPreview(null)}>
        <View
          style={[styles.queuePreviewBackdrop, { backgroundColor: colors.backgroundMid + 'B8' }]}
          testID="flight-queue-front-preview-backdrop">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss member preview"
            style={StyleSheet.absoluteFill}
            disabled={!previewDismissable}
            onPress={() => {
              if (!previewDismissable) return;
              setFrontPreview(null);
            }}
          />
          <View testID="flight-queue-front-preview" style={[styles.queuePreviewCard, { backgroundColor: colors.surface }]}>
            <View style={styles.mapSheetHeader}>
              <View style={styles.mapSheetTitleGroup}>
                <Text testID="flight-queue-front-preview-name" style={[styles.mapSheetTitle, { color: colors.textOnSurface }]}>
                  {previewTitle}
                </Text>
                <Text style={[styles.mapSheetAddress, { color: colors.mutedForegroundLight }]}>Queue position #1 · First in line</Text>
              </View>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={() => setFrontPreview(null)}
                style={styles.mapSheetClose}>
                <Feather name="x" size={20} color={colors.mutedForegroundLight} />
              </TouchableOpacity>
            </View>
            {previewConnection === 'join-to-connect' ?
              <Text testID="flight-queue-join-to-connect" style={[styles.queueState, { color: colors.mutedForegroundLight }]}>
                {JOIN_TO_CONNECT_COPY}
              </Text>
            : null}
            {previewConnection === 'self' ?
              <Text testID="flight-queue-connection-self" style={[styles.queueState, { color: colors.mutedForegroundLight }]}>
                {SELF_QUEUE_MEMBER_COPY}
              </Text>
            : null}
            {previewConnection === 'pending' ?
              <Text testID="flight-queue-connection-pending" style={[styles.queueState, { color: colors.mutedForegroundLight }]}>
                {FRONT_QUEUE_PENDING}
              </Text>
            : null}
            {previewConnection === 'declined' ?
              <Text style={[styles.queueState, { color: colors.mutedForegroundLight }]}>{FRONT_QUEUE_DECLINED}</Text>
            : null}
            {previewConnection === 'loading' ?
              <Text testID="flight-queue-connection-loading" style={[styles.queueState, { color: colors.mutedForegroundLight }]}>
                Checking this connection.
              </Text>
            : null}
            {previewConnection === 'ambiguous' ?
              <Text testID="flight-queue-connection-ambiguous" style={[styles.queueState, { color: colors.mutedForegroundLight }]}>
                {FRONT_QUEUE_AMBIGUOUS}
              </Text>
            : null}
            {previewConnection === 'unavailable' || previewConnection === 'hidden' ?
              <Text testID="flight-queue-connection-unavailable" style={[styles.queueState, { color: colors.mutedForegroundLight }]}>
                {frontPreview === 'production' ?
                  (leaderRequestNotice ??
                  (leaderConnection.kind === 'unavailable' && leaderConnection.reason === 'status' ?
                    FRONT_QUEUE_STATUS_UNAVAILABLE
                  : FRONT_QUEUE_REQUEST_UNAVAILABLE))
                : FRONT_QUEUE_MEMBER_UNAVAILABLE}
              </Text>
            : null}
            {leaderRequestNotice &&
            frontPreview === 'production' &&
            previewConnection !== 'unavailable' &&
            previewConnection !== 'hidden' &&
            previewConnection !== 'join-to-connect' &&
            previewConnection !== 'self' ?
              <Text testID="flight-queue-connection-notice" style={[styles.networkError, { color: colors.destructive }]}>
                {leaderRequestNotice}
              </Text>
            : null}
            {networkError && frontPreview === 'local' ?
              <Text style={[styles.networkError, { color: colors.destructive }]}>{networkError}</Text>
            : null}
            {messages.message && frontPreview === 'production' && previewConnection === 'accepted' ?
              <Text style={[styles.networkError, { color: colors.destructive }]}>{messages.message}</Text>
            : null}
            {previewConnection === 'join-to-connect' && frontPreview === 'production' ?
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityState={{ disabled: productionFlightId === null }}
                testID="flight-queue-join-to-connect-cta"
                disabled={productionFlightId === null}
                onPress={openJoinToConnect}
                style={[
                  styles.networkButton,
                  {
                    backgroundColor: colors.primary,
                    opacity: productionFlightId === null ? 0.45 : 1,
                  },
                ]}>
                <Text style={[styles.networkButtonText, { color: colors.primaryForeground }]}>{JOIN_TO_CONNECT_CTA}</Text>
              </TouchableOpacity>
            : previewConnection === 'accepted' ?
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityState={{ disabled: frontPreview === 'production' && !productionChatUserId }}
                testID="flight-queue-open-conversation"
                disabled={frontPreview === 'production' ? !productionChatUserId || messages.opening : false}
                style={[
                  styles.networkButton,
                  {
                    backgroundColor: colors.primary,
                    opacity: frontPreview === 'production' && !productionChatUserId ? 0.45 : 1,
                  },
                ]}
                onPress={frontPreview === 'production' ? openProductionConversation : openAcceptedConversation}>
                <Text style={[styles.networkButtonText, { color: colors.primaryForeground }]}>Open Chat</Text>
              </TouchableOpacity>
            : previewConnection === 'pending' || previewConnection === 'ambiguous' || previewConnection === 'self' ?
              null
            : <TouchableOpacity
                accessibilityRole="button"
                accessibilityState={{ disabled: sendDisabled }}
                testID="flight-queue-send-request"
                disabled={sendDisabled}
                onPress={
                  frontPreview === 'production' && previewConnection === 'request' ?
                    () => {
                      void sendLeaderRequest();
                    }
                  : frontPreview === 'local' && (previewConnection === 'request' || previewConnection === 'declined') ?
                    sendNetworkingRequest
                  : undefined
                }
                style={[
                  styles.networkButton,
                  {
                    backgroundColor: colors.primary,
                    opacity: sendDisabled ? 0.45 : 1,
                  },
                ]}>
                {(leaderRequestPending && frontPreview === 'production') || (networkingRequest.isPending && frontPreview === 'local') ?
                  <ActivityIndicator color={colors.primaryForeground} size="small" />
                : <Text style={[styles.networkButtonText, { color: colors.primaryForeground }]}>Send Connection Request</Text>}
              </TouchableOpacity>
            }
          </View>
        </View>
      </Modal>

      <Modal visible={!!directionsTarget} transparent animationType="fade" onRequestClose={() => setDirectionsTarget(null)}>
        <Pressable
          style={[styles.modalBackdrop, { backgroundColor: colors.backgroundMid + 'B8', paddingBottom: botPad + 12 }]}
          onPress={() => setDirectionsTarget(null)}>
          <Pressable style={[styles.mapSheet, { backgroundColor: colors.surface }]} onPress={(event) => event.stopPropagation()}>
            <View style={styles.mapSheetHeader}>
              <View style={styles.mapSheetTitleGroup}>
                <Text style={[styles.mapSheetTitle, { color: colors.textOnSurface }]}>Directions to {directionsTarget?.label}</Text>
                <Text style={[styles.mapSheetAddress, { color: colors.mutedForegroundLight }]}>
                  {directionsTarget?.kind === 'fbo' ? directionsTarget.destination : directionsTarget?.location || directionsTarget?.label}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.mapSheetClose}
                onPress={() => setDirectionsTarget(null)}
                accessibilityRole="button"
                accessibilityLabel="Close directions choices">
                <Feather name="x" size={23} color={colors.mutedForegroundLight} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.mapChoice, { borderColor: colors.separator }]}
              onPress={() => openDirections('apple')}
              testID="open-apple-maps">
              <Feather name="map-pin" size={20} color={colors.primary} />
              <Text style={[styles.mapChoiceText, { color: colors.textOnSurface }]}>Open in Apple Maps</Text>
              <Feather name="external-link" size={17} color={colors.mutedForegroundLight} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.mapChoice, { borderColor: colors.separator }]}
              onPress={() => openDirections('google')}
              testID="open-google-maps">
              <Feather name="map" size={20} color={colors.primary} />
              <Text style={[styles.mapChoiceText, { color: colors.textOnSurface }]}>Open in Google Maps</Text>
              <Feather name="external-link" size={17} color={colors.mutedForegroundLight} />
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Bottom sticky CTA ── */}
      {!directionsTarget && (
        <View style={[styles.ctaBar, { backgroundColor: colors.offWhite, borderTopColor: colors.separator, paddingBottom: botPad + 12 }]}>
          {renderCTA()}
          {!demoMode && authMode !== 'clerk' && (
            <TouchableOpacity
              style={styles.conciergeLink}
              onPress={() =>
                router.push({
                  pathname: '/concierge',
                  params: productionFlightId !== null ? joinFlightRouteParams(productionFlightId, f) : {},
                })
              }
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Ask AI Concierge">
              <Text style={[styles.conciergeLinkText, { color: colors.mutedForegroundLight }]}>Ask AI Concierge</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errText: { fontFamily: 'Inter_400Regular', fontSize: 16 },
  errorBody: { fontFamily: 'Inter_400Regular', fontSize: 14, textAlign: 'center', marginTop: 8, paddingHorizontal: 28 },
  retryBtn: {
    borderRadius: 999,
    minHeight: 44,
    minWidth: 132,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    marginTop: 18,
  },
  retryText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },

  // Back button
  backBtn: {
    position: 'absolute',
    zIndex: 20,
    left: 16,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backChevron: { fontFamily: 'Inter_500Medium', fontSize: 22, marginTop: -2 },

  // Hero
  heroFrame: {
    width: '100%',
    justifyContent: 'flex-end',
    position: 'relative',
    overflow: 'hidden',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  heroUnavailable: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  heroUnavailableText: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  heroRouteBadge: {
    position: 'absolute',
    left: 16,
    bottom: 13,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 6,
  },
  heroRouteBadgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, letterSpacing: 0.35 },
  // Aircraft and date header
  flightHeader: { paddingHorizontal: 18, paddingTop: 2, paddingBottom: 6 },
  aircraftName: { fontFamily: 'Inter_700Bold', fontSize: 20 },

  // Date
  dateText: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 3 },
  queueDetailCard: {
    marginHorizontal: 18,
    marginBottom: 10,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 4,
  },
  queueDetailText: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  queueDetailMeta: { fontFamily: 'Inter_400Regular', fontSize: 14 },

  // Compact route card
  routeCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  routeSummary: { fontFamily: 'Inter_700Bold', fontSize: 19, textAlign: 'center', letterSpacing: 0.2 },
  routeSchedule: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  routeEndpoint: { flex: 1, minWidth: 0, alignItems: 'flex-start' },
  routeEndpointRight: { alignItems: 'flex-end' },
  routeTime: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  routeCity: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 2 },
  routeCenter: { flex: 1.1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  routeLine: { flex: 1, height: 1 },
  routeDot: { width: 5, height: 5, borderRadius: 3 },
  routeDuration: { fontFamily: 'Inter_500Medium', fontSize: 10 },

  // Flight information
  flightInfoSection: { marginHorizontal: 16, marginBottom: 12 },
  flightInfoTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, marginHorizontal: 2, marginBottom: 7 },
  flightInfoGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  flightInfoCard: {
    width: '48.5%',
    borderRadius: 13,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 7,
  },
  flightInfoLabel: { fontFamily: 'Inter_500Medium', fontSize: 10, letterSpacing: 0.3 },
  flightInfoValue: { fontFamily: 'Inter_600SemiBold', fontSize: 14, lineHeight: 18, marginTop: 3 },
  flightInfoDetail: { fontFamily: 'Inter_400Regular', fontSize: 10, marginTop: 1 },
  queueState: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, marginTop: 4 },
  queueRetry: { fontFamily: 'Inter_600SemiBold', fontSize: 14, marginTop: 8 },
  queuePreviewBackdrop: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  queuePreviewCard: { borderRadius: 20, padding: 18, zIndex: 1 },
  queueRow: {
    minHeight: 58,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  queueInitials: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  queueInitialsText: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  queueCopy: { flex: 1, gap: 2 },
  queuePosition: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  queueFirst: { fontFamily: 'Inter_600SemiBold', fontSize: 12, letterSpacing: 0.2 },

  // Compact airport rows
  airportSection: { marginHorizontal: 16, marginBottom: 12 },
  airportRow: { borderRadius: 13, marginBottom: 7, overflow: 'hidden' },
  airportRowAction: {
    minHeight: 58,
    paddingHorizontal: 13,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  airportRowCopy: { flex: 1, minWidth: 0 },
  airportRowLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 9, letterSpacing: 0.8 },
  airportRowName: { fontFamily: 'Inter_600SemiBold', fontSize: 13, marginTop: 2 },
  airportRowLocation: { fontFamily: 'Inter_400Regular', fontSize: 10, marginTop: 1 },

  // Dark FBO departure card
  fboCard: {
    marginHorizontal: 16,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 18,
    marginBottom: 12,
  },
  fboLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 1, marginBottom: 4 },
  fboValue: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  fboHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fboAddress: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, marginTop: 7 },
  fboAction: { fontFamily: 'Inter_600SemiBold', fontSize: 13, marginTop: 8, textDecorationLine: 'underline' },

  networkCard: {
    marginHorizontal: 16,
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    marginBottom: 14,
  },
  networkHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  networkAvatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  networkAvatarText: { fontFamily: 'Inter_700Bold', fontSize: 19 },
  networkEyebrow: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.7 },
  networkName: { fontFamily: 'Inter_700Bold', fontSize: 17, marginTop: 3 },
  networkIndustry: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 1 },
  networkCopy: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, marginTop: 12 },
  networkInput: {
    minHeight: 64,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 12,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
  },
  networkError: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17, marginTop: 8 },
  networkButton: { borderRadius: 999, alignItems: 'center', paddingVertical: 13, marginTop: 12 },
  networkButtonText: { fontFamily: 'Inter_700Bold', fontSize: 14 },

  modalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
  },
  mapSheet: { borderRadius: 20, padding: 18, gap: 10 },
  mapSheetHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 },
  mapSheetClose: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', marginTop: -6 },
  mapSheetTitleGroup: { flex: 1, paddingRight: 16 },
  mapSheetTitle: { fontFamily: 'Inter_700Bold', fontSize: 19 },
  mapSheetAddress: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, marginTop: 4 },
  mapChoice: {
    minHeight: 54,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  mapChoiceText: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 15 },

  // Policy link
  policyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
  },
  policyText: { fontFamily: 'Inter_400Regular', fontSize: 14 },
  policyChevron: { fontFamily: 'Inter_400Regular', fontSize: 20 },

  // CTA bar
  ctaBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    gap: 10,
  },
  statusLoadingRow: { alignItems: 'center', paddingVertical: 16 },

  // waiting state
  queuePositionCard: {
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: 'center',
    gap: 4,
  },
  queuePositionLabel: { fontFamily: 'Inter_500Medium', fontSize: 12, marginBottom: 4 },
  queuePositionNumber: { fontFamily: 'Inter_700Bold', fontSize: 24 },
  queuePositionTotal: { fontFamily: 'Inter_400Regular', fontSize: 16 },
  queuePositionEligible: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginTop: 4 },
  leaveQueueBtn: {
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
  },
  leaveQueueBtnText: { fontFamily: 'Inter_500Medium', fontSize: 15 },

  // confirmed state
  confirmedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 14,
  },
  confirmedBadgeEmoji: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  confirmedBadgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  viewTripBtn: {
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  viewTripBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16 },

  // unavailable state
  unavailableBadge: {
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  unavailableBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  unavailableHint: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', paddingBottom: 4 },
  queueReadOnlyLink: { minHeight: 46, borderRadius: 14, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  queueReadOnlyLinkText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },

  conciergeLink: { alignItems: 'center', paddingBottom: 4 },
  conciergeLinkText: { fontFamily: 'Inter_500Medium', fontSize: 13 },
});
