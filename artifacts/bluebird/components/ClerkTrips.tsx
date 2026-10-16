import React from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
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

type TripList = 'current' | 'past';

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

function ClerkTripCard({ trip, colors }: { trip: ProductionTrip; colors: ReturnType<typeof useColors> }) {
  const { leg } = trip;
  const origin = leg.originCity || leg.originAirport || 'Origin unavailable';
  const destination = leg.destinationCity || leg.destinationAirport || 'Destination unavailable';
  return (
    <View style={[styles.tripCard, { backgroundColor: colors.card }]} testID="clerk-trip-card">
      <View style={[styles.badge, { backgroundColor: colors.primary }]}>
        <Text style={[styles.badgeText, { color: colors.primaryForeground }]}>TRIP</Text>
      </View>
      <Text style={[styles.route, { color: colors.foreground }]}>{origin} → {destination}</Text>
      <Text style={[styles.meta, { color: colors.mutedForeground }]}>
        {[leg.aircraftType, formatDeparture(leg.departureTime)].filter(Boolean).join(' · ')}
      </Text>
    </View>
  );
}

export function ClerkTrips() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { authMode, clerkUserId } = useAuth();
  const session = useClerkAuthSnapshot();
  const sessionRef = React.useRef(session);
  sessionRef.current = session;
  const configuration = getMainBluebirdApiConfigurationOrNull();
  const [activeList, setActiveList] = React.useState<TripList>('current');
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
          description="A signed-in Clerk account is required. No trip data is shown while signed out."
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
          description="The selected Main API and matching Clerk environment are not configured."
          colors={colors}
        />
      </View>
    );
  }

  const items = query.data?.[activeList];
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
          ? 'Your Main API session could not be authorized. Your trips have not been replaced with an empty list.'
          : forbidden
            ? 'The Main API did not authorize this trip-list request. Your trips have not been replaced with an empty list.'
            : 'Trip data could not be loaded or did not match the supported response contract. Try again when the service is available.'}
        colors={colors}
        actionLabel="Try Again"
        onAction={() => { void query.refetch(); }}
      />
    );
  } else if (items?.length === 0) {
    state = (
      <StateMessage
        title={activeList === 'current' ? 'No current trips' : 'No past trips'}
        description={activeList === 'current'
          ? 'Current trips will appear here when available.'
          : 'Past trips will appear here when available.'}
        colors={colors}
        testID={`clerk-trips-empty-${activeList}`}
      />
    );
  } else {
    state = (
      <ScrollView
        style={styles.body}
        contentContainerStyle={[styles.list, { paddingBottom: bottomPad + 100 }]}
        showsVerticalScrollIndicator={false}
        testID={`clerk-trips-list-${activeList}`}
      >
        {(items ?? []).map((trip) => <ClerkTripCard key={trip.leg.id} trip={trip} colors={colors} />)}
      </ScrollView>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]} testID="clerk-trips">
      <View style={[styles.header, { paddingTop: topPad + 24 }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Trips</Text>
        <View style={[styles.tabRow, { backgroundColor: colors.card }]}>
          {([
            { id: 'current' as const, label: 'Current' },
            { id: 'past' as const, label: 'Past' },
          ]).map((tab) => (
            <TouchableOpacity
              key={tab.id}
              accessibilityRole="button"
              accessibilityState={{ selected: activeList === tab.id }}
              testID={`clerk-trips-tab-${tab.id}`}
              style={[styles.tabButton, activeList === tab.id && { backgroundColor: colors.primary }]}
              onPress={() => setActiveList(tab.id)}
              activeOpacity={0.75}
            >
              <Text style={[styles.tabLabel, { color: activeList === tab.id ? colors.primaryForeground : colors.mutedForeground }]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={[styles.contractNote, { color: colors.mutedForeground }]}>
          Uses the checked-in Main API trip-list source contract. Live authorization and account mapping have not been verified.
        </Text>
      </View>
      {state}
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
  tabLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  contractNote: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16, marginTop: 12 },
  body: { flex: 1 },
  list: { gap: 14, paddingHorizontal: 20 },
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
