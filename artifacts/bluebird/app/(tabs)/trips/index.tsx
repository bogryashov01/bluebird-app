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

// ─── Aircraft images (same matching logic as Discover) ────────────────────────
import { useAuth } from '@/context/AuthContext';
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
  const [y, m, d] = dateStr.split('-').map(Number);
  const label = new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
  return `${label} · ${timeStr}`;
}

type ActiveTab = 'upcoming' | 'pending' | 'past';

// ─── Trip Card ────────────────────────────────────────────────────────────────
function TripCard({ flight, badge, badgeBlue, onPress, colors, onCancel, cancelling }: {
  flight: { fromCity: string; toCity: string; aircraftType: string; departureDate: string; departureTime: string };
  badge: string;
  badgeBlue: boolean;
  onPress?: () => void;
  colors: ReturnType<typeof useColors>;
  onCancel?: () => void;
  cancelling?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card }]}
      activeOpacity={0.85}
      onPress={onPress}
    >
      <Image source={aircraftImage(flight.aircraftType)} style={styles.cardImage} resizeMode="cover" />
      <View style={styles.cardBadgeWrap}>
        <View style={[
          styles.cardBadge,
          { backgroundColor: badgeBlue ? colors.primary : colors.secondary },
        ]}>
          <Text style={[styles.cardBadgeText, { color: badgeBlue ? colors.primaryForeground : colors.secondaryForeground }]}>{badge}</Text>
        </View>
      </View>
      <View style={styles.cardBody}>
        <Text style={[styles.cardRoute, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
          {flight.fromCity} → {flight.toCity}
        </Text>
        <Text style={[styles.cardMeta, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]} numberOfLines={1}>
          {flight.aircraftType} · {fmtDate(flight.departureDate, flight.departureTime)}
        </Text>
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
    </TouchableOpacity>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────
export default function TripsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<ActiveTab>('upcoming');
  const { user, updateUser } = useAuth();
  const queryClient = useQueryClient();

  const topPad = Platform.OS === 'web' ? 40 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const { data: trips, isLoading: tripsLoading } = useListTrips({
    query: { enabled: !!user },
  });
  const { data: queueEntries, isLoading: queueLoading } = useGetQueueStatus({
    query: { enabled: !!user },
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
    if (cancellingTripId) return;
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

  function renderContent() {
    if (isLoading) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
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
              flight={trip.flight ?? emptyFlight}
              badge="CONFIRMED"
              badgeBlue
              onPress={() => trip.flight && router.push(`/flight/${trip.flight.id}`)}
              onCancel={() => handleCancelTrip(trip)}
              cancelling={cancellingTripId === trip.id}
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
              flight={entry.flight ?? emptyFlight}
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
            flight={trip.flight ?? emptyFlight}
            badge={trip.status === 'cancelled' ? 'CANCELLED' : 'COMPLETED'}
            badgeBlue={false}
            onPress={undefined}
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

// Fallback for missing flight data
const emptyFlight = {
  fromCity: '—', toCity: '—', aircraftType: '',
  departureDate: '2025-01-01', departureTime: '00:00',
};

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
  cardRoute: {
    fontSize: 17,
    marginBottom: 2,
  },
  cardMeta: {
    fontSize: 13,
  },
  cancelBtn: {
    marginTop: 12,
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
