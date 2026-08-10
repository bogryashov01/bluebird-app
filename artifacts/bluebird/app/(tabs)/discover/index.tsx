import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput,
  RefreshControl, ActivityIndicator, Platform, Image, ScrollView, ImageBackground,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useListFlights, type Flight } from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import FlightMapView from '@/components/FlightMap';

const FILTERS = ['All', 'This Week', 'Under 4 hrs', 'Heavy Jet', 'Near Me'];

const AIRCRAFT_IMAGES: { match: RegExp; source: any }[] = [
  { match: /gulfstream|g280|challenger|falcon/i, source: require('@/assets/images/aircraft-heavy.jpg') },
  { match: /king air|pilatus|pc-12|turboprop/i, source: require('@/assets/images/aircraft-turboprop.jpg') },
  { match: /phenom|xls|latitude/i, source: require('@/assets/images/aircraft-midsize.jpg') },
];
const LIGHT_JET = require('@/assets/images/aircraft-light.jpg');
const HERO = require('@/assets/images/hero-aircraft.jpg');

function aircraftImage(type: string) {
  return AIRCRAFT_IMAGES.find((a) => a.match.test(type))?.source ?? LIGHT_JET;
}

type FlightData = Flight;

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function formatDateTime(f: FlightData): string {
  const d = new Date(`${f.departureDate}T${f.departureTime}:00`);
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  let hours = d.getHours();
  const mins = d.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'P' : 'A';
  hours = hours % 12 || 12;
  return `${day} · ${hours}:${mins}${ampm}`;
}

function durationHours(f: FlightData): number {
  const [h] = f.duration.split('h');
  return parseInt(h, 10) || 0;
}

export default function DiscoverScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [activeFilter, setActiveFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'list' | 'map'>('list');

  const { data: flights, isLoading, isError, refetch, isRefetching } = useListFlights({});

  const topPad = Platform.OS === 'web' ? 40 : insets.top;

  const all: FlightData[] = flights ?? [];
  const featured = all.find((f) => f.featured);

  const filteredFlights = React.useMemo(() => {
    let list = all.filter((f) => f.id !== featured?.id);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((f) =>
        [f.fromAirport, f.toAirport, f.fromCity, f.toCity, f.aircraftType]
          .some((s) => s.toLowerCase().includes(q)),
      );
    }
    switch (activeFilter) {
      case 'This Week': {
        const now = new Date();
        const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        return list.filter((f) => {
          const d = new Date(f.departureDate);
          return d >= new Date(now.toDateString()) && d <= weekOut;
        });
      }
      case 'Under 4 hrs':
        return list.filter((f) => durationHours(f) < 4);
      case 'Heavy Jet':
        return list.filter((f) => /gulfstream|g280|challenger|falcon|global/i.test(f.aircraftType));
      case 'Near Me':
        return list.filter((f) => ['LAX', 'SFO', 'LAS', 'SNA', 'VNY'].includes(f.fromAirport));
      default:
        return list;
    }
  }, [all, featured?.id, activeFilter, search]);

  const renderCard = ({ item }: { item: FlightData }) => (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card }]}
      activeOpacity={0.8}
      onPress={() => router.push(`/flight/${item.id}`)}
    >
      <Image source={aircraftImage(item.aircraftType)} style={styles.cardThumb} />
      <View style={styles.cardBody}>
        <Text style={[styles.cardRoute, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
          {item.fromAirport} → {item.toAirport}
        </Text>
        <Text style={[styles.cardMeta, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]} numberOfLines={1}>
          {item.aircraftType} · {formatDateTime(item)}
        </Text>
      </View>
      {item.priceUsd ? (
        <Text style={[styles.cardPrice, { color: colors.paleBlue, fontFamily: 'Inter_700Bold' }]}>
          ${item.priceUsd.toLocaleString()}
        </Text>
      ) : null}
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {isLoading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : isError ? (
        <View style={styles.centered}>
          <Feather name="wifi-off" size={32} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Could not load flights
          </Text>
          <TouchableOpacity
            style={[styles.retryBtn, { borderColor: colors.border }]}
            onPress={() => refetch()}
          >
            <Text style={[styles.retryText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={view === 'list' ? filteredFlights : []}
          keyExtractor={(item) => item.id}
          renderItem={renderCard}
          contentContainerStyle={{ paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListHeaderComponent={
            <View>
              {/* Logo + concierge */}
              <View style={[styles.topBar, { paddingTop: topPad + 24 }]}>
                <View style={styles.logoRow}>
                  <Image source={require('@/assets/images/icon.png')} style={styles.logoImg} />
                  <Text style={[styles.logoText, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
                    Bluebird
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.conciergeBtn, { backgroundColor: colors.card }]}
                  onPress={() => router.push('/concierge')}
                >
                  <Feather name="message-circle" size={18} color={colors.foreground} />
                </TouchableOpacity>
              </View>

              {/* Greeting */}
              <Text style={[styles.greeting, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
                {greeting()}{user?.name ? `, ${user.name.split(' ')[0]}` : ''}
              </Text>
              <Text style={[styles.subGreeting, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                {all.length > 0 ? `${Math.min(all.length, 3)} empty legs added near you today` : 'Empty legs near you'}
              </Text>

              {/* Featured empty leg */}
              {featured && (
                <TouchableOpacity
                  style={styles.featuredWrap}
                  activeOpacity={0.85}
                  onPress={() => router.push(`/flight/${featured.id}`)}
                >
                  <ImageBackground source={HERO} style={styles.featuredImage} imageStyle={{ borderRadius: 24 }}>
                    <View style={styles.featuredOverlay} />
                    <View style={[styles.featuredBadge, { backgroundColor: colors.primary }]}>
                      <Text style={[styles.featuredBadgeText, { color: colors.primaryForeground, fontFamily: 'Inter_700Bold' }]}>
                        FEATURED EMPTY LEG
                      </Text>
                    </View>
                    <View style={styles.featuredBottom}>
                      <Text style={[styles.featuredRoute, { color: '#FFFFFF', fontFamily: 'Inter_700Bold' }]}>
                        {featured.fromCity} → {featured.toCity}
                      </Text>
                      <View style={styles.featuredMetaRow}>
                        <Text style={[styles.featuredMeta, { color: 'rgba(255,255,255,0.65)', fontFamily: 'Inter_400Regular' }]}>
                          {featured.aircraftType} · {formatDateTime(featured)}
                        </Text>
                        {featured.discountPct ? (
                          <Text style={[styles.featuredDiscount, { color: colors.paleBlue, fontFamily: 'Inter_700Bold' }]}>
                            {featured.discountPct}% off
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  </ImageBackground>
                </TouchableOpacity>
              )}

              {/* Search */}
              <View style={[styles.searchWrap, { backgroundColor: colors.card }]}>
                <Feather name="search" size={16} color={colors.mutedForeground} />
                <TextInput
                  style={[styles.searchInput, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}
                  placeholder="Search routes, airports, aircraft"
                  placeholderTextColor={colors.mutedForeground}
                  value={search}
                  onChangeText={setSearch}
                />
              </View>

              {/* Filter chips */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
                {FILTERS.map((f) => (
                  <TouchableOpacity
                    key={f}
                    style={[
                      styles.filterChip,
                      { backgroundColor: f === activeFilter ? colors.primary : colors.card },
                    ]}
                    onPress={() => setActiveFilter(f)}
                    activeOpacity={0.7}
                  >
                    <Text style={[
                      styles.filterChipText,
                      { fontFamily: 'Inter_600SemiBold' },
                      { color: f === activeFilter ? colors.primaryForeground : colors.mutedForeground },
                    ]}>
                      {f}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* List / Map toggle */}
              <View style={styles.toggleRow}>
                <TouchableOpacity
                  style={[styles.toggleBtn, view === 'list' && { backgroundColor: colors.card }]}
                  onPress={() => setView('list')}
                >
                  <Text style={[
                    styles.toggleText,
                    { fontFamily: 'Inter_600SemiBold' },
                    { color: view === 'list' ? colors.foreground : colors.mutedForeground },
                  ]}>List</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toggleBtn, view === 'map' && { backgroundColor: colors.card }]}
                  onPress={() => setView('map')}
                >
                  <Text style={[
                    styles.toggleText,
                    { fontFamily: 'Inter_600SemiBold' },
                    { color: view === 'map' ? colors.foreground : colors.mutedForeground },
                  ]}>Map</Text>
                </TouchableOpacity>
              </View>

              {view === 'map' && (
                <FlightMapView flights={all} />
              )}

              {view === 'list' && filteredFlights.length === 0 && (
                <View style={styles.mapPlaceholder}>
                  <Feather name="send" size={28} color={colors.mutedForeground} style={{ transform: [{ rotate: '-45deg' }] }} />
                  <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                    No flights match
                  </Text>
                </View>
              )}
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingBottom: 18,
  },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logoImg: { width: 26, height: 26, borderRadius: 6 },
  logoText: { fontSize: 17, letterSpacing: -0.3 },
  conciergeBtn: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
  },
  greeting: { fontSize: 26, letterSpacing: -0.6, paddingHorizontal: 20, paddingBottom: 4 },
  subGreeting: { fontSize: 15, paddingHorizontal: 20, paddingBottom: 18 },

  // Featured card
  featuredWrap: { marginHorizontal: 20, marginBottom: 20, borderRadius: 24, overflow: 'hidden' },
  featuredImage: { height: 190, width: '100%', justifyContent: 'flex-end' },
  featuredOverlay: {
    ...StyleSheet.absoluteFillObject, borderRadius: 24,
    backgroundColor: 'rgba(6,11,31,0.35)',
  },
  featuredBadge: {
    position: 'absolute', top: 14, left: 14,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
  },
  featuredBadgeText: { fontSize: 11, letterSpacing: 0.4 },
  featuredBottom: { padding: 16, gap: 4 },
  featuredRoute: { fontSize: 20, letterSpacing: -0.4 },
  featuredMetaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  featuredMeta: { fontSize: 13 },
  featuredDiscount: { fontSize: 17 },

  // Search
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 999,
    paddingHorizontal: 16, paddingVertical: Platform.OS === 'web' ? 13 : 10,
    marginHorizontal: 20, marginBottom: 16,
  },
  searchInput: { flex: 1, fontSize: 15, padding: 0 },

  // Filter chips
  filterRow: { gap: 8, paddingHorizontal: 20, paddingBottom: 18 },
  filterChip: { paddingHorizontal: 15, paddingVertical: 9, borderRadius: 999 },
  filterChipText: { fontSize: 13 },

  // List/Map toggle
  toggleRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 20, paddingBottom: 16 },
  toggleBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10 },
  toggleText: { fontSize: 13 },

  // Flight row card
  card: {
    flexDirection: 'row', gap: 12, alignItems: 'center',
    borderRadius: 18, padding: 12,
    marginHorizontal: 20, marginBottom: 12,
  },
  cardThumb: { width: 74, height: 60, borderRadius: 12 },
  cardBody: { flex: 1, minWidth: 0 },
  cardRoute: { fontSize: 15 },
  cardMeta: { fontSize: 12.5, marginTop: 2 },
  cardPrice: { fontSize: 15 },

  // States
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  mapPlaceholder: { alignItems: 'center', gap: 10, paddingVertical: 40 },
  emptyText: { fontSize: 15 },
  retryBtn: {
    borderWidth: 1, borderRadius: 999,
    paddingHorizontal: 20, paddingVertical: 10,
  },
  retryText: { fontSize: 14 },
});
