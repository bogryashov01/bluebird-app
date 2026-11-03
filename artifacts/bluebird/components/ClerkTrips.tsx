import React from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
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
import { useDemoJoinFlow } from '@/lib/demoJoinFlowStore';
import { separateDemoTrip } from '@/lib/demoJoinFlow';
import { MyQueuesPanel } from '@/components/MyQueuesPanel';
import { awardedCurrentFlightIds } from '@/lib/myQueuesPresentation';
import { currentTripChecklistTarget, presentTripChecklistStatus, resolveCurrentTripChecklistNavigation } from '@/lib/winnerChecklist';
import { queueRosterQueryPrefix, queueViewerListQueryKey } from '@/lib/useMyQueues';

type TripList = 'current' | 'queues' | 'past';

function formatDeparture(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return 'Departure time unavailable';
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function ClerkTripCard({
  trip,
  list,
  colors,
  onOpenChecklist,
}: {
  trip: ProductionTrip;
  list: 'current' | 'past';
  colors: ReturnType<typeof useColors>;
  onOpenChecklist: (legId: number) => void;
}) {
  const { leg } = trip;
  const origin = leg.originCity || leg.originAirport || 'Origin unavailable';
  const destination = leg.destinationCity || leg.destinationAirport || 'Destination unavailable';
  const status = presentTripChecklistStatus({
    list,
    awarded: trip.checklist.awarded,
    remainingSteps: trip.checklist.remainingSteps,
  });
  const checklistTarget = currentTripChecklistTarget({
    list,
    awarded: trip.checklist.awarded,
    legId: leg.id,
  });
  const body = (
    <>
      <View style={[styles.badge, { backgroundColor: colors.primary }]}>
        <Text style={[styles.badgeText, { color: colors.primaryForeground }]}>TRIP</Text>
      </View>
      <Text style={[styles.route, { color: colors.foreground }]} numberOfLines={2}>{origin} → {destination}</Text>
      <Text testID="clerk-trip-status" style={[styles.meta, { color: colors.foreground }]}>{status}</Text>
      <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={2}>
        {[leg.aircraftType, formatDeparture(leg.departureTime)].filter(Boolean).join(' · ')}
      </Text>
      {checklistTarget ? (
        <Text testID="clerk-trip-checklist-label" style={[styles.meta, { color: colors.primary }]}>
          Winner checklist
        </Text>
      ) : null}
    </>
  );
  if (!checklistTarget) {
    return (
      <View style={[styles.tripCard, { backgroundColor: colors.card }]} testID="clerk-trip-card">
        {body}
      </View>
    );
  }
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`${origin} to ${destination}. Winner checklist`}
      accessibilityHint="Opens the winner checklist"
      testID="clerk-trip-open-checklist"
      style={[styles.tripCard, { backgroundColor: colors.card }]}
      activeOpacity={0.85}
      onPress={() => { onOpenChecklist(leg.id); }}
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
  const awardedFlightIds = awardedCurrentFlightIds(query.isSuccess ? query.data.current : []);
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
        title={unauthorized ? 'Sign in again to view trips' : forbidden ? 'Trips unavailable for this account' : 'Could not load your trips'}
        description={unauthorized
          ? 'Please sign in again to view your trips.'
          : forbidden
            ? 'Your trip information is unavailable right now.'
            : 'Check your connection and try again.'}
        colors={colors}
        actionLabel="Try Again"
        onAction={() => { void query.refetch(); }}
      />
    );
  } else if (items?.length === 0) {
    state = (
      <StateMessage
        title={activeList === 'current' ? 'No upcoming trips' : 'No past trips'}
        description={activeList === 'current'
          ? 'Upcoming trips will appear here when available.'
          : 'Past trips will appear here when available.'}
        colors={colors}
        testID={`clerk-trips-empty-${activeList}`}
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
        {(items ?? []).map((trip) => (
          <ClerkTripCard
            key={trip.leg.id}
            trip={trip}
            list={activeList === 'past' ? 'past' : 'current'}
            colors={colors}
            onOpenChecklist={openChecklist}
          />
        ))}
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
      ) : null}
      {keepQueues ? (
        <View
          style={activeList === 'queues' ? styles.queuesPane : styles.queuesHidden}
          accessibilityElementsHidden={activeList !== 'queues'}
          importantForAccessibility={activeList === 'queues' ? 'auto' : 'no-hide-descendants'}
        >
          <MyQueuesPanel awardedFlightIds={awardedFlightIds} active={activeList === 'queues'} />
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
  onAction,
}: {
  title: string;
  description: string;
  colors: ReturnType<typeof useColors>;
  testID?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.stateWrap} testID={testID}>
      <Text style={[styles.stateTitle, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.stateBody, { color: colors.mutedForeground }]}>{description}</Text>
      {actionLabel && onAction && (
        <TouchableOpacity
          accessibilityRole="button"
          testID="clerk-trips-retry"
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
  tripCard: { borderRadius: 20, padding: 18, gap: 8 },
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
