import React from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import {
  ActivityIndicator,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { createClerkProductionTokenProvider, type ClerkSessionSnapshot } from '@/lib/clerkProductionTokenProvider';
import {
  createMainBluebirdApiIntegration,
  mainBluebirdAuthenticatedQueryKey,
} from '@/lib/mainBluebirdApi';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import type { ProductionTrip, ProductionTrips } from '@/lib/productionAuthApi';
import { getFlightImagePresentation, presentTripDeparture, type FlightView } from '@/lib/productionFlights';
import { useDemoJoinFlow } from '@/lib/demoJoinFlowStore';
import { separateDemoTrip } from '@/lib/demoJoinFlow';
import { MyQueuesPanel } from '@/components/MyQueuesPanel';
import { awardedCurrentFlightIds, memberQueueFlightId, memberQueuePosition } from '@/lib/myQueuesPresentation';
import { checklistFullyComplete, currentTripChecklistTarget, presentTripChecklistStatus, resolveCurrentTripChecklistNavigation } from '@/lib/winnerChecklist';
import { canonicalTripFlightId, declinedCurrentFlightIds, tripLifecycleOpenTarget, upcomingOwnedFlightIds } from '@/lib/memberFlightPlacement';
import { queueRosterQueryPrefix, queueViewerListQueryKey, useMyQueues } from '@/lib/useMyQueues';

type TripList = 'current' | 'queues' | 'past';

function formatDeparture(value: string): string {
  return presentTripDeparture(value);
}

function ClerkTripCard({
  trip,
  list,
  flight,
  colors,
  onOpenChecklist,
}: {
  trip: ProductionTrip;
  list: 'current' | 'past';
  flight: FlightView | null;
  colors: ReturnType<typeof useColors>;
  onOpenChecklist: (legId: number) => void;
}) {
  const { leg } = trip;
  const origin = leg.originCity || leg.originAirport || 'Origin unavailable';
  const destination = leg.destinationCity || leg.destinationAirport || 'Destination unavailable';
  const originAirport = flight?.fromAirport || leg.originAirport;
  const destinationAirport = flight?.toAirport || leg.destinationAirport;
  const route = originAirport && destinationAirport ? `${originAirport} → ${destinationAirport}` : `${origin} → ${destination}`;
  const aircraft = flight?.aircraftTypeName?.trim() || flight?.aircraftType?.trim() || leg.aircraftType?.trim() || null;
  const status = presentTripChecklistStatus({
    list,
    awarded: trip.checklist.awarded,
    remainingSteps: trip.checklist.remainingSteps,
    status: trip.status ?? null,
  });
  const flightId = canonicalTripFlightId(trip);
  const detailsTarget = flightId === null
    ? null
    : tripLifecycleOpenTarget({
      list,
      legId: flightId,
      status: trip.status ?? null,
      awarded: trip.checklist.awarded,
    });
  const checklistTarget = currentTripChecklistTarget({
    list,
    awarded: trip.checklist.awarded,
    legId: flightId ?? leg.id,
  });
  const checklistComplete = list === 'current' && checklistFullyComplete(trip.checklist);
  const queuePosition = flight && status === 'Pending' ? memberQueuePosition(flight) : null;
  const imageUrl = flight && getFlightImagePresentation(flight) === 'provided' ? flight.imageUrl : null;
  const upcoming = list === 'current';
  const body = upcoming ? (
    <>
      <View style={[styles.hero, { backgroundColor: colors.muted }]}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel="" />
        ) : (
          <View style={styles.heroFallback}>
            <Feather name="image" size={22} color={colors.mutedForeground} />
          </View>
        )}
        <View style={[styles.routeBadge, { backgroundColor: imageUrl ? 'rgba(255,255,255,0.18)' : colors.surface, borderColor: imageUrl ? 'rgba(255,255,255,0.30)' : colors.border }]}>
          <Text testID="clerk-trip-route" style={[styles.routeBadgeText, { color: imageUrl ? '#FFFFFF' : colors.textOnSurface }]} numberOfLines={1}>
            {route}
          </Text>
        </View>
      </View>
      <View style={styles.upcomingBody}>
        {aircraft ? (
          <Text testID="clerk-trip-aircraft" style={[styles.aircraft, { color: colors.textOnSurface }]} numberOfLines={1}>{aircraft}</Text>
        ) : null}
        <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={2}>
          {formatDeparture(leg.departureTime)}
        </Text>
        <Text testID="clerk-trip-status" style={[styles.status, { color: colors.textOnSurface }]}>{status}</Text>
        {queuePosition !== null ? (
          <Text testID="clerk-trip-position" style={[styles.meta, { color: colors.mutedForeground }]}>
            {`Queue position #${queuePosition}`}
          </Text>
        ) : null}
        {checklistTarget && flightId !== null && !checklistComplete ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Flight checklist"
            testID="clerk-trip-checklist-link"
            onPress={() => onOpenChecklist(flightId)}
          >
            <Text testID="clerk-trip-checklist-label" style={[styles.meta, { color: colors.primary }]}>
              Flight checklist
            </Text>
          </TouchableOpacity>
        ) : !detailsTarget && !checklistTarget ? (
          <Text testID="clerk-trip-unavailable" style={[styles.meta, { color: colors.mutedForeground }]}>
            Flight details are not available yet.
          </Text>
        ) : null}
      </View>
    </>
  ) : (
    <View style={styles.pastBody}>
      <View style={[styles.badge, { backgroundColor: colors.primary }]}>
        <Text style={[styles.badgeText, { color: colors.primaryForeground }]}>TRIP</Text>
      </View>
      <Text style={[styles.route, { color: colors.foreground }]} numberOfLines={2}>{origin} → {destination}</Text>
      <Text testID="clerk-trip-status" style={[styles.meta, { color: colors.foreground }]}>{status}</Text>
      <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={2}>
        {[leg.aircraftType, formatDeparture(leg.departureTime)].filter(Boolean).join(' · ')}
      </Text>
    </View>
  );
  if (!detailsTarget && !checklistTarget) {
    return (
      <View style={[styles.tripCard, { backgroundColor: colors.card }]} testID="clerk-trip-card">
        {body}
      </View>
    );
  }
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={checklistTarget
        ? `${origin} to ${destination}. Confirmed flight`
        : `${origin} to ${destination}. ${status}`}
      accessibilityHint="Opens flight details"
      testID={checklistTarget
        ? 'clerk-trip-open-checklist'
        : status === 'Winner confirmation required'
          ? 'clerk-trip-review-winner'
          : 'clerk-trip-open-pending'}
      style={[styles.tripCard, { backgroundColor: colors.card }]}
      activeOpacity={0.85}
      onPress={() => {
        if (detailsTarget) {
          router.push(detailsTarget);
          return;
        }
        if (checklistTarget && flightId !== null) onOpenChecklist(flightId);
      }}
    >
      {body}
    </TouchableOpacity>
  );
}

export function ClerkTrips() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { authMode, clerkUserId } = useAuth();
  const demo = useDemoJoinFlow();
  const session = useClerkAuthSnapshot();
  const sessionRef = React.useRef(session);
  sessionRef.current = session;
  const configuration = getMainBluebirdApiConfigurationOrNull();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ list?: string }>();
  const [activeList, setActiveList] = React.useState<TripList>(
    params.list === 'queues' ? 'queues' : 'current',
  );
  const [keepQueues, setKeepQueues] = React.useState(params.list === 'queues');
  React.useEffect(() => {
    if (params.list === 'queues') setActiveList('queues');
  }, [params.list]);
  if (activeList === 'queues' && !keepQueues) setKeepQueues(true);
  const previousClerkUserId = React.useRef<string | null>(null);
  const checklistNavAt = React.useRef(0);
  const clerkUserIdRef = React.useRef(clerkUserId);
  clerkUserIdRef.current = clerkUserId;
  React.useEffect(() => {
    const current = session?.isSignedIn === true ? session.userId : null;
    const previous = previousClerkUserId.current;
    if (previous && previous !== current && configuration) {
      queryClient.removeQueries({ queryKey: queueRosterQueryPrefix(configuration.environment, previous) });
      queryClient.removeQueries({ queryKey: queueViewerListQueryKey(configuration.environment, previous) });
    }
    previousClerkUserId.current = current;
  }, [configuration, queryClient, session?.isSignedIn, session?.userId]);
  const ready = authMode === 'clerk' &&
    !!configuration &&
    session?.isLoaded === true &&
    session.isSignedIn === true &&
    !!session.userId &&
    session.userId === clerkUserId;

  const query = useQuery<ProductionTrips>({
    queryKey: configuration && clerkUserId
      ? mainBluebirdAuthenticatedQueryKey(configuration.environment, clerkUserId, 'trips')
      : ['main-bluebird-api', configuration?.environment ?? 'unconfigured', clerkUserId ?? 'signed-out', 'trips'],
    enabled: ready,
    retry: false,
    queryFn: async ({ signal }) => {
      if (!configuration || !session?.userId || !ready) {
        throw new Error('A signed-in Clerk session and selected Main API are required.');
      }
      const requestedUserId = session.userId;
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
      return api.authenticated.listTrips({ signal });
    },
  });
  const queues = useMyQueues();
  const confirmationByFlightId = React.useMemo(() => {
    const confirmation = new Map<number, string | null>();
    for (const flight of queues.rows) {
      const id = memberQueueFlightId(flight.id);
      if (id !== null) confirmation.set(id, flight.viewerConfirmationStatus);
    }
    return confirmation;
  }, [queues.rows]);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  if (!session?.isLoaded || authMode !== 'clerk') {
    return (
      <View style={[styles.root, styles.centered, { backgroundColor: colors.background }]} testID="clerk-trips-loading-session">
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }
  if (session.isSignedIn !== true || !session.userId || session.userId !== clerkUserId) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: topPad + 24 }]}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Trips</Text>
        </View>
        <StateMessage
          title="Sign in to view your trips"
          description="Sign in to see your trip information."
          colors={colors}
        />
      </View>
    );
  }
  if (!configuration) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: topPad + 24 }]}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Trips</Text>
        </View>
        <StateMessage
          title="Trips unavailable"
          description="Your trip information is unavailable right now."
          colors={colors}
        />
      </View>
    );
  }

  const openChecklist = (legId: number) => {
    const active = sessionRef.current;
    if (!configuration) return;
    const accountUserId = clerkUserIdRef.current;
    if (!accountUserId) return;
    const cachedTrips = queryClient.getQueryData<ProductionTrips>(
      mainBluebirdAuthenticatedQueryKey(configuration.environment, accountUserId, 'trips'),
    ) ?? null;
    const target = resolveCurrentTripChecklistNavigation({
      signedIn: active?.isSignedIn === true,
      activeUserId: active?.isSignedIn === true ? active.userId : null,
      accountUserId,
      cachedTrips,
      legId,
    });
    if (!target) return;
    const now = Date.now();
    if (now - checklistNavAt.current < 600) return;
    checklistNavAt.current = now;
    router.push(target);
  };
  const items = activeList === 'current' || activeList === 'past'
    ? query.data?.[activeList]
    : undefined;
  const declinedIds = new Set(declinedCurrentFlightIds(
    activeList === 'current' && query.data ? query.data.current : [],
    confirmationByFlightId,
  ));
  const visibleItems = items?.filter((trip) => {
    const id = canonicalTripFlightId(trip);
    return id === null || !declinedIds.has(id);
  });
  const awardedFlightIds = awardedCurrentFlightIds(query.isSuccess ? query.data.current : []);
  const upcomingFlightIds = upcomingOwnedFlightIds(
    query.isSuccess ? query.data.current : [],
    confirmationByFlightId,
  );
  const demoTrip = query.data ? separateDemoTrip(query.data, demo.entry).demo : demo.demoTrip;
  let state: React.ReactNode;
  if (query.isPending) {
    state = (
      <View style={[styles.centered, styles.body]}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={[styles.stateBody, { color: colors.mutedForeground }]}>Loading trips…</Text>
      </View>
    );
  } else if (query.isError) {
    const error = query.error as { code?: string; status?: number };
    const unauthorized = error.code === 'session_expired' || error.status === 401;
    const forbidden = error.status === 403;
    state = (
      <StateMessage
        title={unauthorized ? 'Sign in again to view trips' : forbidden ? 'Trips unavailable for this account' : 'Couldn’t load your trips'}
        description={unauthorized
          ? 'Please sign in again to view your trips.'
          : forbidden
            ? 'Your trip information is unavailable right now.'
            : 'Check your connection and try again.'}
        colors={colors}
        actionLabel="Try again"
        onAction={() => { void query.refetch(); }}
      />
    );
  } else if (visibleItems?.length === 0) {
    state = (
      <StateMessage
        title={activeList === 'current' ? 'No upcoming flights' : 'No past flights'}
        description={activeList === 'current'
          ? 'Browse empty legs and join a queue to book your first flight.'
          : 'Completed flights will appear here.'}
        colors={colors}
        testID={`clerk-trips-empty-${activeList}`}
        actionLabel={activeList === 'current' ? 'Discover Flights' : undefined}
        actionTestID={activeList === 'current' ? 'clerk-trips-discover' : undefined}
        onAction={activeList === 'current'
          ? () => router.replace('/(tabs)/discover' as never)
          : undefined}
      />
    );
  } else {
    state = (
      <ScrollView
        style={[styles.body, { backgroundColor: colors.background }]}
        contentContainerStyle={[styles.list, { paddingBottom: bottomPad + 100 }]}
        showsVerticalScrollIndicator={false}
        testID={`clerk-trips-list-${activeList}`}
      >
        {(visibleItems ?? []).map((trip) => {
          const id = canonicalTripFlightId(trip);
          const flight = id === null ? null : queues.rows.find((row) => memberQueueFlightId(row.id) === id) ?? null;
          return (
            <ClerkTripCard
              key={trip.leg.id}
              trip={trip}
              list={activeList === 'past' ? 'past' : 'current'}
              flight={flight}
              colors={colors}
              onOpenChecklist={openChecklist}
            />
          );
        })}
      </ScrollView>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]} testID="clerk-trips">
      <View style={[styles.header, { paddingTop: topPad + 24 }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Trips</Text>
        <View style={[styles.tabRow, { backgroundColor: colors.card }]}>
          {([
            { id: 'current' as const, label: 'Upcoming' },
            { id: 'queues' as const, label: 'In Queue' },
            { id: 'past' as const, label: 'Past' },
          ]).map((tab) => (
            <TouchableOpacity
              key={tab.id}
              accessibilityRole="button"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: activeList === tab.id }}
              testID={`clerk-trips-tab-${tab.id}`}
              style={[styles.tabButton, activeList === tab.id && { backgroundColor: colors.primary }]}
              onPress={() => setActiveList(tab.id)}
              activeOpacity={0.75}
            >
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
                style={[styles.tabLabel, { color: activeList === tab.id ? colors.primaryForeground : colors.mutedForeground }]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      {demoTrip && activeList === 'current' ? (
        <View testID="demo-trip-section" style={styles.demoSection}>
          <View style={[styles.tripCard, { backgroundColor: colors.card }]} testID="demo-trip-card">
            <View style={styles.pastBody}>
            <View style={[styles.badge, { backgroundColor: colors.primary }]}>
              <Text style={[styles.badgeText, { color: colors.primaryForeground }]}>DEMO</Text>
            </View>
            <Text style={[styles.route, { color: colors.foreground }]}>{demoTrip.routeLabel}</Text>
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>
              Not booked. This simulated trip is separate from your account trips.
            </Text>
            {!!demoTrip.detailLabel && (
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>{demoTrip.detailLabel}</Text>
            )}
            </View>
          </View>
        </View>
      ) : null}
      {keepQueues ? (
        <View
          style={activeList === 'queues' ? styles.queuesPane : styles.queuesHidden}
          accessibilityElementsHidden={activeList !== 'queues'}
          importantForAccessibility={activeList === 'queues' ? 'auto' : 'no-hide-descendants'}
        >
          <MyQueuesPanel awardedFlightIds={awardedFlightIds} upcomingFlightIds={upcomingFlightIds} active={activeList === 'queues'} />
        </View>
      ) : null}
      {activeList === 'queues' ? null : state}
    </View>
  );
}

function StateMessage({
  title,
  description,
  colors,
  testID = 'clerk-trips-state',
  actionLabel,
  actionTestID = 'clerk-trips-retry',
  onAction,
}: {
  title: string;
  description: string;
  colors: ReturnType<typeof useColors>;
  testID?: string;
  actionLabel?: string;
  actionTestID?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.stateWrap} testID={testID}>
      <Text style={[styles.stateTitle, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.stateBody, { color: colors.mutedForeground }]}>{description}</Text>
      {actionLabel && onAction && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          testID={actionTestID}
          style={[styles.retryButton, { backgroundColor: colors.primary }]}
          onPress={onAction}
        >
          <Text style={[styles.retryLabel, { color: colors.primaryForeground }]}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 30, letterSpacing: -0.7, marginBottom: 14 },
  tabRow: { flexDirection: 'row', gap: 4, borderRadius: 14, padding: 4 },
  tabButton: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 999 },
  tabLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  body: { flex: 1 },
  queuesPane: { flex: 1 },
  queuesHidden: { display: 'none' },
  list: { gap: 14, paddingHorizontal: 20 },
  demoSection: { paddingHorizontal: 20, paddingBottom: 4 },
  tripCard: { borderRadius: 22, overflow: 'hidden' },
  pastBody: { padding: 18, gap: 8 },
  hero: { height: 148, position: 'relative', justifyContent: 'flex-end' },
  heroFallback: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  routeBadge: { position: 'absolute', left: 14, bottom: 12, borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5, maxWidth: '86%' },
  routeBadgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  upcomingBody: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16, gap: 4 },
  aircraft: { fontFamily: 'Inter_700Bold', fontSize: 20, letterSpacing: -0.2 },
  status: { fontFamily: 'Inter_600SemiBold', fontSize: 15, marginTop: 4 },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  badgeText: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.5 },
  route: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 13 },
  centered: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  stateWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28, gap: 10 },
  stateTitle: { fontFamily: 'Inter_700Bold', fontSize: 20, textAlign: 'center' },
  stateBody: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  retryButton: { minHeight: 46, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20, borderRadius: 14, marginTop: 8 },
  retryLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
});
