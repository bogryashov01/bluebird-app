import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Platform, Image, ScrollView, Alert,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { useListTrips, useGetQueueStatus, useCancelTrip } from '@workspace/api-client-react';
import type { Trip, QueueEntry } from '@workspace/api-client-react';
import { confirmDialog } from '@/lib/confirmDialog';
import { isLocalFlightReadMode } from '@/lib/productionFlights';
import { TripAvailabilityState } from '@/components/TripAvailabilityState';
import { PRODUCTION_AUTH_UNAVAILABLE_MESSAGE } from '@/lib/productionAuthState';
import { ClerkTrips } from '@/components/ClerkTrips';
import { FullAppDemoMyQueueView } from '@/components/FullAppDemoViews';

// ─── Aircraft images (same matching logic as Discover) ────────────────────────
import { useAuth } from '@/context/AuthContext';
import { isLegacyMemberQueryEnabled } from '@/lib/clerkAuthSession';
const AIRCRAFT_IMAGES: { match: RegExp; source: any }[] = [
  { match: /gulfstream|g280|challenger|falcon/i, source: require('@/assets/images/aircraft-heavy.jpg') },
  { match: /king air|pilatus|pc-12|turboprop/i,  source: require('@/assets/images/aircraft-turboprop.jpg') },
  { match: /phenom|xls|latitude/i,               source: require('@/assets/images/aircraft-midsize.jpg') },
];
const LIGHT_JET = require('@/assets/images/aircraft-light.jpg');

function aircraftImage(type: string) {
  return AIRCRAFT_IMAGES.find((a) => a.match.test(type))?.source ?? LIGHT_JET;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtDate(dateStr: string, timeStr: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !timeStr) return 'Date unavailable';
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== dateStr) return 'Date unavailable';
  const label = date.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    timeZone: 'UTC',
  });
  return `${label} · ${timeStr}`;
}

type ActiveTab = 'upcoming' | 'pending' | 'past';

// ─── Trip Card ────────────────────────────────────────────────────────────────
function TripCard({ flight, badge, badgeBlue, onPress, colors, onCancel, cancelling, manifestProgress, onManifest }: {
  flight?: { fromCity: string; toCity: string; aircraftType: string; departureDate: string; departureTime: string };
  badge: string;
  badgeBlue: boolean;
  onPress?: () => void;
  colors: ReturnType<typeof useColors>;
  onCancel?: () => void;
  cancelling?: boolean;
  manifestProgress?: string;
  onManifest?: () => void;
}) {
  const mainContent = (
    <>
      {flight && <Image source={aircraftImage(flight.aircraftType)} style={styles.cardImage} resizeMode="cover" />}
      <View style={styles.cardBadgeWrap}>
        <View style={[
          styles.cardBadge,
          { backgroundColor: badgeBlue ? colors.primary : colors.secondary },
        ]}>
          <Text style={[styles.cardBadgeText, { color: badgeBlue ? colors.primaryForeground : colors.secondaryForeground }]}>{badge}</Text>
        </View>
      </View>
      <View style={styles.cardBody}>
        {flight ? (
          <>
            <Text style={[styles.cardRoute, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
              {flight.fromCity || 'Airport unavailable'} → {flight.toCity || 'Airport unavailable'}
            </Text>
            <Text style={[styles.cardMeta, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]} numberOfLines={1}>
              {[flight.aircraftType, fmtDate(flight.departureDate, flight.departureTime)].filter(Boolean).join(' · ')}
            </Text>
          </>
        ) : (
          <>
            <Text style={[styles.cardRoute, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Trip details unavailable</Text>
            <Text style={[styles.cardMeta, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>Flight information is not available.</Text>
          </>
        )}
      </View>
    </>
  );
  return (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      {onPress ? (
        <TouchableOpacity testID="trip-card-open-details" accessibilityRole="button" activeOpacity={0.85} onPress={onPress}>
          {mainContent}
        </TouchableOpacity>
      ) : (
        <View>{mainContent}</View>
      )}
      {((manifestProgress && onManifest) || onCancel) && (
        <View style={styles.cardActions}>
          {manifestProgress && onManifest && (
            <TouchableOpacity testID="trip-passenger-list" style={[styles.manifestRow, { backgroundColor: colors.muted }]} onPress={onManifest}>
              <View>
                <Text style={[styles.manifestTitle, { color: colors.foreground }]}>Passenger Information</Text>
                <Text style={[styles.manifestMeta, { color: colors.mutedForeground }]}>{manifestProgress}</Text>
              </View>
              <Text style={[styles.manifestChevron, { color: colors.primary }]}>›</Text>
            </TouchableOpacity>
          )}
          {onCancel && (
            <TouchableOpacity
              style={[styles.cancelBtn, { borderColor: colors.border }, cancelling && { opacity: 0.6 }]}
              onPress={onCancel}
              disabled={cancelling}
              activeOpacity={0.75}
            >
              {cancelling ? (
                <ActivityIndicator size="small" color={colors.mutedForeground} />
              ) : (
                <Text style={[styles.cancelBtnText, { color: colors.mutedForeground }]}>Cancel booking</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────
export default function TripsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<ActiveTab>('upcoming');
  const { user, updateUser, authMode, demoMode } = useAuth();
  const queryClient = useQueryClient();
  const localDemoFlow = !demoMode && authMode === 'legacy' && isLocalFlightReadMode();
  const memberQueryEnabled = !demoMode && isLegacyMemberQueryEnabled({
    authMode,
    localDemoFlow,
    hasLegacyUser: !!user,
  });

  const topPad = Platform.OS === 'web' ? 40 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const { data: trips, isLoading: tripsLoading, isError: tripsError, refetch: refetchTrips } = useListTrips({
    query: { enabled: memberQueryEnabled },
  });
  const { data: queueEntries, isLoading: queueLoading, isError: queueError, refetch: refetchQueue } = useGetQueueStatus({
    query: { enabled: memberQueryEnabled },
  });

  const upcomingTrips = useMemo(() =>
    ((trips as Trip[]) ?? []).filter((t) => t.status === 'upcoming'),
    [trips]);

  const pastTrips = useMemo(() =>
    ((trips as Trip[]) ?? []).filter((t) => t.status === 'completed' || t.status === 'cancelled'),
    [trips]);

  const pendingEntries = useMemo(() =>
    ((queueEntries as QueueEntry[]) ?? []).filter((e) => e.status === 'waiting'),
    [queueEntries]);

  const isLoading = tripsLoading || queueLoading;

  const cancelTripMutation = useCancelTrip({
    mutation: {
      onSuccess: (data: any, vars: { id: string }) => {
        setCancellingTripId(null);
        // Refresh trips (moves to Past as cancelled), queue status, and the
        // flight lists whose derived seat counts just changed.
        queryClient.invalidateQueries({ queryKey: ['/api/trips'] });
        queryClient.invalidateQueries({ queryKey: ['/api/queue/status'] });
        queryClient.invalidateQueries({ queryKey: ['/api/flights'] });
        if (user && typeof data?.linePassCount === 'number') {
          updateUser({ ...user, linePassCount: data.linePassCount });
        }
      },
      onError: (err: any) => {
        setCancellingTripId(null);
        const msg = err?.data?.error || err?.message || 'Failed to cancel booking';
        if (Platform.OS === 'web') {
          if (typeof window !== 'undefined') window.alert(msg);
        } else {
          Alert.alert('Cancellation failed', msg);
        }
      },
    },
  });
  const [cancellingTripId, setCancellingTripId] = useState<string | null>(null);

  const handleCancelTrip = async (trip: Trip) => {
    if (!localDemoFlow || cancellingTripId) return;
    const route = trip.flight ? `${trip.flight.fromCity} → ${trip.flight.toCity}` : 'this flight';
    const ok = await confirmDialog(
      'Cancel booking?',
      `Your seat on ${route} will be released to the next member in line. If you used a Skip the Line pass for this booking, it will be returned to your balance.`,
      'Cancel Booking',
      true,
    );
    if (!ok) return;
    setCancellingTripId(trip.id);
    cancelTripMutation.mutate({ id: trip.id });
  };

  const TABS: { id: ActiveTab; label: string }[] = [
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'pending', label: 'Pending' },
    { id: 'past', label: 'Past' },
  ];

  if (demoMode) {
    return <FullAppDemoMyQueueView />;
  }
  if (authMode === 'clerk') {
    return <ClerkTrips />;
  }
  if (!localDemoFlow) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: topPad + 24 }]}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Trips</Text>
        </View>
        <TripAvailabilityState
          title="Trips unavailable"
          description={`${PRODUCTION_AUTH_UNAVAILABLE_MESSAGE} Please try again later.`}
          testID="production-trips-unavailable"
        />
      </View>
    );
  }
  if (!user) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: topPad + 24 }]}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Trips</Text>
        </View>
        <TripAvailabilityState
          title="Sign in to view your trips"
          description="A member session is required. Trip and queue data are not loaded while signed out."
          testID="trips-auth-required"
        />
      </View>
    );
  }

  function renderContent() {
    if (isLoading) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      );
    }
    if (tripsError || queueError) {
      return (
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Could not load your trips</Text>
          <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>Check your connection and try again.</Text>
          <TouchableOpacity style={[styles.discoverBtn, { backgroundColor: colors.primary }]} onPress={() => { refetchTrips(); refetchQueue(); }}>
            <Text style={[styles.discoverBtnText, { color: colors.primaryForeground }]}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (activeTab === 'upcoming') {
      if (upcomingTrips.length === 0) {
        return (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No upcoming trips</Text>
            <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
              Browse empty legs and join a queue to book your first flight.
            </Text>
            <TouchableOpacity
              style={[styles.discoverBtn, { backgroundColor: colors.primary }]}
              onPress={() => router.replace('/(tabs)/discover')}
            >
              <Text style={[styles.discoverBtnText, { color: colors.primaryForeground }]}>Browse Flights</Text>
            </TouchableOpacity>
          </View>
        );
      }
      return (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.list, { paddingBottom: bottomPad + 100 }]}
          showsVerticalScrollIndicator={false}
        >
          {upcomingTrips.map((trip) => (
            <TripCard
              key={trip.id}
              colors={colors}
              flight={trip.flight}
              badge="UPCOMING"
              badgeBlue
              onPress={() => router.push(`/trip/${trip.id}` as any)}
              onCancel={() => handleCancelTrip(trip)}
              cancelling={cancellingTripId === trip.id}
              manifestProgress={trip.manifest ? `${trip.manifest.completedCount} of ${trip.manifest.requiredCount} completed` : undefined}
              onManifest={trip.manifest ? () => router.push(`/trip/${trip.id}/passengers` as any) : undefined}
            />
          ))}
        </ScrollView>
      );
    }

    if (activeTab === 'pending') {
      if (pendingEntries.length === 0) {
        return (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No pending queues</Text>
            <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
              Join a flight queue and it will appear here while you wait for confirmation.
            </Text>
            <TouchableOpacity
              style={[styles.discoverBtn, { backgroundColor: colors.primary }]}
              onPress={() => router.replace('/(tabs)/discover')}
            >
              <Text style={[styles.discoverBtnText, { color: colors.primaryForeground }]}>Browse Flights</Text>
            </TouchableOpacity>
          </View>
        );
      }
      return (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.list, { paddingBottom: bottomPad + 100 }]}
          showsVerticalScrollIndicator={false}
        >
          {pendingEntries.map((entry) => (
            <TripCard
              key={entry.id}
              colors={colors}
              flight={entry.flight}
              badge={`IN QUEUE · #${entry.position}`}
              badgeBlue={false}
              onPress={() => router.push({ pathname: '/queue/status', params: { entryId: entry.id } })}
            />
          ))}
        </ScrollView>
      );
    }

    // past
    if (pastTrips.length === 0) {
      return (
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No past trips</Text>
          <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
            Completed flights will appear here.
          </Text>
        </View>
      );
    }
    return (
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.list, { paddingBottom: bottomPad + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {pastTrips.map((trip) => (
          <TripCard
            key={trip.id}
            colors={colors}
            flight={trip.flight}
            badge={trip.status === 'cancelled' ? 'CANCELLED' : 'COMPLETED'}
            badgeBlue={false}
            onPress={() => router.push(`/trip/${trip.id}` as any)}
          />
        ))}
      </ScrollView>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 24 }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Trips</Text>

        {/* 3-tab pill selector */}
        <View style={[styles.tabRow, { backgroundColor: colors.card, borderRadius: 14 }]}>
          {TABS.map((tab) => (
            <TouchableOpacity
              key={tab.id}
              style={[
                styles.tabBtn,
                activeTab === tab.id && { backgroundColor: colors.primary },
              ]}
              onPress={() => setActiveTab(tab.id)}
              activeOpacity={0.7}
            >
              <Text style={[
                styles.tabLabel,
                { color: activeTab === tab.id ? colors.primaryForeground : colors.mutedForeground },
              ]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* AI Concierge banner */}
        <TouchableOpacity
          style={[styles.concierge, { backgroundColor: `${colors.primary}20` }]}
          onPress={() => router.push('/concierge')}
          activeOpacity={0.85}
        >
          <Text style={[styles.conciergeText, { color: colors.foreground }]}>
            Questions about a trip? Ask the AI Concierge
          </Text>
          <Text style={[styles.conciergeArrow, { color: colors.paleBlue }]}>›</Text>
        </TouchableOpacity>
      </View>

      {renderContent()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: { paddingHorizontal: 20 },
  headerTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 30,
    letterSpacing: -0.7,
    marginBottom: 14,
  },

  // ── Tabs
  tabRow: { flexDirection: 'row', gap: 4, marginBottom: 16, padding: 4 },
  tabBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 9,
    borderRadius: 999,
  },
  tabLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },

  // ── Concierge banner
  concierge: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: 18, paddingVertical: 13, paddingHorizontal: 16,
    marginBottom: 16,
  },
  conciergeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13.5,
    flex: 1,
  },
  conciergeArrow: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    marginLeft: 8,
  },

  // ── Cards list
  list: { gap: 14, paddingHorizontal: 20 },
  card: {
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowRadius: 32,
    shadowOpacity: 0.35,
    elevation: 8,
  },
  cardImage: { width: '100%', height: 130 },
  cardBadgeWrap: { position: 'absolute', top: 12, left: 12 },
  cardBadge: {
    paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999,
  },
  cardBadgeText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    letterSpacing: 0.3,
  },
  cardBody: { paddingVertical: 14, paddingHorizontal: 16 },
  cardActions: { paddingHorizontal: 16, paddingBottom: 14 },
  cardRoute: {
    fontSize: 17,
    marginBottom: 2,
  },
  cardMeta: {
    fontSize: 13,
  },
  cancelBtn: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  manifestRow: {
    padding: 12, borderRadius: 14, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'space-between',
  },
  manifestTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  manifestMeta: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  manifestChevron: { fontFamily: 'Inter_600SemiBold', fontSize: 24 },

  // ── Empty states
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 32, gap: 10,
  },
  emptyTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 18,
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
  },
  discoverBtn: {
    marginTop: 6,
    paddingHorizontal: 24, paddingVertical: 13, borderRadius: 999,
  },
  discoverBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
});
