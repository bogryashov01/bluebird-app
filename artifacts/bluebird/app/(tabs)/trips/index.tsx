import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Platform, Image, ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useListTrips, useGetQueueStatus } from '@workspace/api-client-react';
import type { Trip, QueueEntry } from '@workspace/api-client-react';

// ─── Aircraft images (same matching logic as Discover) ────────────────────────
const AIRCRAFT_IMAGES: { match: RegExp; source: any }[] = [
  { match: /gulfstream|g280|challenger|falcon/i, source: require('@/assets/images/aircraft-heavy.jpg') },
  { match: /king air|pilatus|pc-12|turboprop/i,  source: require('@/assets/images/aircraft-turboprop.jpg') },
  { match: /phenom|xls|latitude/i,               source: require('@/assets/images/aircraft-midsize.jpg') },
];
const LIGHT_JET = require('@/assets/images/aircraft-light.jpg');
const HERO = require('@/assets/images/hero-aircraft.jpg');

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
function TripCard({ flight, badge, badgeBlue, onPress }: {
  flight: { fromCity: string; toCity: string; aircraftType: string; departureDate: string; departureTime: string };
  badge: string;
  badgeBlue: boolean;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={onPress}>
      <Image source={aircraftImage(flight.aircraftType)} style={styles.cardImage} resizeMode="cover" />
      <View style={styles.cardBadgeWrap}>
        <View style={[styles.cardBadge, badgeBlue ? styles.cardBadgeBlue : styles.cardBadgeFrost]}>
          <Text style={styles.cardBadgeText}>{badge}</Text>
        </View>
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardRoute}>{flight.fromCity} → {flight.toCity}</Text>
        <Text style={styles.cardMeta} numberOfLines={1}>
          {flight.aircraftType} · {fmtDate(flight.departureDate, flight.departureTime)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────
export default function TripsScreen() {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<ActiveTab>('upcoming');

  const topPad = Platform.OS === 'web' ? 40 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const { data: trips, isLoading: tripsLoading } = useListTrips({});
  const { data: queueEntries, isLoading: queueLoading } = useGetQueueStatus({});

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

  const TABS: { id: ActiveTab; label: string }[] = [
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'pending', label: 'Pending' },
    { id: 'past', label: 'Past' },
  ];

  function renderContent() {
    if (isLoading) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator color="#1259F2" size="large" />
        </View>
      );
    }

    if (activeTab === 'upcoming') {
      if (upcomingTrips.length === 0) {
        return (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No upcoming trips</Text>
            <Text style={styles.emptyBody}>Browse empty legs and join a queue to book your first flight.</Text>
            <TouchableOpacity style={styles.discoverBtn} onPress={() => router.replace('/(tabs)/discover')}>
              <Text style={styles.discoverBtnText}>Browse Flights</Text>
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
              flight={trip.flight ?? emptyFlight}
              badge="CONFIRMED"
              badgeBlue
              onPress={() => trip.flight && router.push(`/flight/${trip.flight.id}`)}
            />
          ))}
        </ScrollView>
      );
    }

    if (activeTab === 'pending') {
      if (pendingEntries.length === 0) {
        return (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No pending queues</Text>
            <Text style={styles.emptyBody}>Join a flight queue and it will appear here while you wait for confirmation.</Text>
            <TouchableOpacity style={styles.discoverBtn} onPress={() => router.replace('/(tabs)/discover')}>
              <Text style={styles.discoverBtnText}>Browse Flights</Text>
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
              flight={entry.flight ?? emptyFlight}
              badge={`IN QUEUE · #${entry.position}`}
              badgeBlue={false}
              onPress={() => router.push('/queue/status')}
            />
          ))}
        </ScrollView>
      );
    }

    // past
    if (pastTrips.length === 0) {
      return (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No past trips</Text>
          <Text style={styles.emptyBody}>Completed flights will appear here.</Text>
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
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 24 }]}>
        <Text style={styles.headerTitle}>Trips</Text>

        {/* 3-tab pill selector */}
        <View style={styles.tabRow}>
          {TABS.map((tab) => (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tabBtn, activeTab === tab.id && styles.tabBtnActive]}
              onPress={() => setActiveTab(tab.id)}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabLabel, activeTab === tab.id && styles.tabLabelActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* AI Concierge banner */}
        <TouchableOpacity style={styles.concierge} onPress={() => router.push('/concierge')} activeOpacity={0.85}>
          <Text style={styles.conciergeText}>Questions about a trip? Ask the AI Concierge</Text>
          <Text style={styles.conciergeArrow}>›</Text>
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
  container: { flex: 1, backgroundColor: '#060B1F' },

  header: { paddingHorizontal: 20 },
  headerTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 30,
    color: '#fff',
    letterSpacing: -0.7,
    marginBottom: 14,
  },

  // ── Tabs
  tabRow: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  tabBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 9,
    borderRadius: 10,
  },
  tabBtnActive: { backgroundColor: '#1259F2' },
  tabLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
  },
  tabLabelActive: { color: '#fff' },

  // ── Concierge banner
  concierge: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(18,89,242,0.18)',
    borderRadius: 16, paddingVertical: 13, paddingHorizontal: 16,
    marginBottom: 16,
  },
  conciergeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13.5,
    color: '#fff',
    flex: 1,
  },
  conciergeArrow: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    color: '#7FA8FA',
    marginLeft: 8,
  },

  // ── Cards list
  list: { gap: 14, paddingHorizontal: 20 },
  card: {
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: '#0D1636',
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
  cardBadgeBlue: { backgroundColor: '#1259F2' },
  cardBadgeFrost: { backgroundColor: 'rgba(255,255,255,0.15)' },
  cardBadgeText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    color: '#fff',
    letterSpacing: 0.3,
  },
  cardBody: { paddingVertical: 14, paddingHorizontal: 16 },
  cardRoute: {
    fontFamily: 'Inter_700Bold',
    fontSize: 17,
    color: '#fff',
    marginBottom: 2,
  },
  cardMeta: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
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
    color: '#fff',
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    lineHeight: 21,
  },
  discoverBtn: {
    marginTop: 6,
    backgroundColor: '#1259F2',
    paddingHorizontal: 24, paddingVertical: 13, borderRadius: 999,
  },
  discoverBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: '#fff',
  },
});
