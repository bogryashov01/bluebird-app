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
      style={styles.card}
      activeOpacity={0.8}
      onPress={() => router.push(`/flight/${item.id}`)}
    >
      <Image source={aircraftImage(item.aircraftType)} style={styles.cardThumb} />
      <View style={styles.cardBody}>
        <Text style={[styles.cardRoute, { fontFamily: 'Inter_700Bold' }]}>
          {item.fromAirport} → {item.toAirport}
        </Text>
        <Text style={[styles.cardMeta, { fontFamily: 'Inter_400Regular' }]} numberOfLines={1}>
          {item.aircraftType} · {formatDateTime(item)}
        </Text>
      </View>
      {item.priceUsd ? (
        <Text style={[styles.cardPrice, { fontFamily: 'Inter_700Bold' }]}>
          ${item.priceUsd.toLocaleString()}
        </Text>
      ) : null}
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: '#060B1F' }]}>
      {isLoading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : isError ? (
        <View style={styles.centered}>
          <Feather name="wifi-off" size={32} color="rgba(255,255,255,0.5)" />
          <Text style={[styles.emptyText, { fontFamily: 'Inter_400Regular' }]}>Could not load flights</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => refetch()}>
            <Text style={[styles.retryText, { fontFamily: 'Inter_500Medium' }]}>Try again</Text>
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
                  <Text style={[styles.logoText, { fontFamily: 'Inter_700Bold' }]}>Bluebird</Text>
                </View>
                <TouchableOpacity style={styles.conciergeBtn} onPress={() => router.push('/concierge')}>
                  <Feather name="message-circle" size={18} color="#fff" />
                </TouchableOpacity>
              </View>

              {/* Greeting */}
              <Text style={[styles.greeting, { fontFamily: 'Inter_700Bold' }]}>
                {greeting()}{user?.name ? `, ${user.name.split(' ')[0]}` : ''}
              </Text>
              <Text style={[styles.subGreeting, { fontFamily: 'Inter_400Regular' }]}>
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
                    <View style={styles.featuredBadge}>
                      <Text style={[styles.featuredBadgeText, { fontFamily: 'Inter_700Bold' }]}>FEATURED EMPTY LEG</Text>
                    </View>
                    <View style={styles.featuredBottom}>
                      <Text style={[styles.featuredRoute, { fontFamily: 'Inter_700Bold' }]}>
                        {featured.fromCity} → {featured.toCity}
                      </Text>
                      <View style={styles.featuredMetaRow}>
                        <Text style={[styles.featuredMeta, { fontFamily: 'Inter_400Regular' }]}>
                          {featured.aircraftType} · {formatDateTime(featured)}
                        </Text>
                        {featured.discountPct ? (
                          <Text style={[styles.featuredDiscount, { fontFamily: 'Inter_700Bold' }]}>
                            {featured.discountPct}% off
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  </ImageBackground>
                </TouchableOpacity>
              )}

              {/* Search */}
              <View style={styles.searchWrap}>
                <Feather name="search" size={16} color="rgba(255,255,255,0.5)" />
                <TextInput
                  style={[styles.searchInput, { fontFamily: 'Inter_400Regular' }]}
                  placeholder="Search routes, airports, aircraft"
                  placeholderTextColor="rgba(255,255,255,0.45)"
                  value={search}
                  onChangeText={setSearch}
                />
              </View>

              {/* Filter chips */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
                {FILTERS.map((f) => (
                  <TouchableOpacity
                    key={f}
                    style={[styles.filterChip, f === activeFilter && styles.filterChipActive]}
                    onPress={() => setActiveFilter(f)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.filterChipText, { fontFamily: 'Inter_600SemiBold' }, f === activeFilter && styles.filterChipTextActive]}>
                      {f}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* List / Map toggle */}
              <View style={styles.toggleRow}>
                <TouchableOpacity
                  style={[styles.toggleBtn, view === 'list' && styles.toggleBtnActive]}
                  onPress={() => setView('list')}
                >
                  <Text style={[styles.toggleText, { fontFamily: 'Inter_600SemiBold' }, view === 'list' && styles.toggleTextActive]}>List</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toggleBtn, view === 'map' && styles.toggleBtnActive]}
                  onPress={() => setView('map')}
                >
                  <Text style={[styles.toggleText, { fontFamily: 'Inter_600SemiBold' }, view === 'map' && styles.toggleTextActive]}>Map</Text>
                </TouchableOpacity>
              </View>

              {view === 'map' && (
                <FlightMapView flights={all} />
              )}

              {view === 'list' && filteredFlights.length === 0 && (
                <View style={styles.mapPlaceholder}>
                  <Feather name="send" size={28} color="rgba(255,255,255,0.35)" style={{ transform: [{ rotate: '-45deg' }] }} />
                  <Text style={[styles.emptyText, { fontFamily: 'Inter_400Regular' }]}>No flights match</Text>
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
  logoText: { color: '#fff', fontSize: 17, letterSpacing: -0.3 },
  conciergeBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  greeting: { color: '#fff', fontSize: 26, letterSpacing: -0.6, paddingHorizontal: 20, paddingBottom: 4 },
  subGreeting: { color: 'rgba(255,255,255,0.5)', fontSize: 15, paddingHorizontal: 20, paddingBottom: 18 },
  featuredWrap: { marginHorizontal: 20, marginBottom: 20, borderRadius: 24, overflow: 'hidden' },
  featuredImage: { height: 190, width: '100%', justifyContent: 'flex-end' },
  featuredOverlay: {
    ...StyleSheet.absoluteFillObject, borderRadius: 24,
    backgroundColor: 'rgba(6,11,31,0.35)',
  },
  featuredBadge: {
    position: 'absolute', top: 14, left: 14,
    backgroundColor: '#1259F2', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
  },
  featuredBadgeText: { color: '#fff', fontSize: 12 },
  featuredBottom: { padding: 16, gap: 4 },
  featuredRoute: { color: '#fff', fontSize: 20, letterSpacing: -0.4 },
  featuredMetaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  featuredMeta: { color: 'rgba(255,255,255,0.65)', fontSize: 13 },
  featuredDiscount: { color: '#7FA8FA', fontSize: 17 },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 999,
    paddingHorizontal: 16, paddingVertical: Platform.OS === 'web' ? 13 : 10,
    marginHorizontal: 20, marginBottom: 16,
  },
  searchInput: { flex: 1, color: '#fff', fontSize: 15, padding: 0 },
  filterRow: { gap: 8, paddingHorizontal: 20, paddingBottom: 18 },
  filterChip: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 15, paddingVertical: 9, borderRadius: 999,
  },
  filterChipActive: { backgroundColor: '#1259F2' },
  filterChipText: { color: 'rgba(255,255,255,0.75)', fontSize: 13 },
  filterChipTextActive: { color: '#fff' },
  toggleRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 20, paddingBottom: 16 },
  toggleBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10 },
  toggleBtnActive: { backgroundColor: 'rgba(255,255,255,0.1)' },
  toggleText: { color: 'rgba(255,255,255,0.5)', fontSize: 13 },
  toggleTextActive: { color: '#fff' },
  card: {
    flexDirection: 'row', gap: 12, alignItems: 'center',
    backgroundColor: '#0D1636', borderRadius: 18, padding: 12,
    marginHorizontal: 20, marginBottom: 12,
  },
  cardThumb: { width: 74, height: 60, borderRadius: 12 },
  cardBody: { flex: 1, minWidth: 0 },
  cardRoute: { color: '#fff', fontSize: 15 },
  cardMeta: { color: 'rgba(255,255,255,0.5)', fontSize: 12.5, marginTop: 2 },
  cardPrice: { color: '#7FA8FA', fontSize: 15 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  mapPlaceholder: { alignItems: 'center', gap: 10, paddingVertical: 40 },
  emptyText: { fontSize: 15, color: 'rgba(255,255,255,0.5)' },
  retryBtn: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  retryText: { fontSize: 14, color: '#fff' },
});
