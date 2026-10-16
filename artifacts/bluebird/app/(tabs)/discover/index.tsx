import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Alert,
  RefreshControl, ActivityIndicator, Platform, Image, ImageBackground,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import {
  useListFlights, useGetQueueStatus, useListTrips,
  type QueueEntry, type Trip,
} from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import { isLegacyMemberQueryEnabled, shouldUseLocalFlightReadMode } from '@/lib/clerkAuthSession';
import FlightMapView from '@/components/FlightMap';
import {
  fetchProductionAirports,
  fetchProductionFlights,
  getFlightImagePresentation,
  getFlightAirportCodes,
  isLocalFlightReadMode,
  mapLocalFlight,
  parseProductionFlightId,
  productionReadRetryDelay,
  shouldRetryProductionRead,
  type AirportRecord,
  type FlightView,
} from '@/lib/productionFlights';

const AIRCRAFT_IMAGES: { match: RegExp; source: any }[] = [
  { match: /gulfstream|g280|challenger|falcon/i, source: require('@/assets/images/aircraft-heavy.jpg') },
  { match: /king air|pilatus|pc-12|turboprop/i, source: require('@/assets/images/aircraft-turboprop.jpg') },
  { match: /phenom|xls|latitude/i, source: require('@/assets/images/aircraft-midsize.jpg') },
];
const LIGHT_JET = require('@/assets/images/aircraft-light.jpg');
const HERO = require('@/assets/images/hero-aircraft.jpg');

function aircraftImage(type: string | null) {
  return AIRCRAFT_IMAGES.find((a) => a.match.test(type ?? ''))?.source ?? LIGHT_JET;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function formatDateTime(flight: FlightView): string {
  const parts: string[] = [];
  if (flight.departureDate) {
    const [year, month, day] = flight.departureDate.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    if (!Number.isNaN(date.valueOf())) {
      parts.push(date.toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
      }));
    }
  }
  if (flight.departureTime) {
    const [hourText, minuteText] = flight.departureTime.split(':');
    const hour = Number(hourText);
    const minute = Number(minuteText);
    if (Number.isInteger(hour) && Number.isInteger(minute)) {
      const ampm = hour >= 12 ? 'P' : 'A';
      parts.push(`${hour % 12 || 12}:${String(minute).padStart(2, '0')}${ampm}${flight.departureTimeZone ? ` ${flight.departureTimeZone}` : ''}`);
    }
  }
  return parts.length ? parts.join(' · ') : 'Schedule unavailable';
}

function matchesQuery(flight: FlightView, q: string): boolean {
  return [flight.fromAirport, flight.toAirport, flight.fromCity, flight.toCity, flight.aircraftType]
    .some((value) => (value ?? '').toLowerCase().includes(q));
}

function airportLabel(code: string | null, city: string | null): string {
  return code || city || '—';
}

function openFlightDetails(flight: FlightView): void {
  const id = typeof flight.id === 'string' ? flight.id.trim() : '';
  if (!id || (flight.source === 'production' && parseProductionFlightId(id) === null)) {
    const message = 'Flight details are unavailable because this flight has no valid identifier.';
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') window.alert(message);
    } else {
      Alert.alert('Flight unavailable', message);
    }
    return;
  }

  router.push({ pathname: '/flight/[id]', params: { id } });
}

interface HeaderProps {
  colors: ReturnType<typeof useColors>;
  topPad: number;
  userName?: string;
  allCount: number;
  productionReadOnly: boolean;
  featured?: FlightView;
  search: string;
  onSearchChange: (t: string) => void;
  onClearSearch: () => void;
  view: 'list' | 'map';
  onViewChange: (v: 'list' | 'map') => void;
  mapFlights: FlightView[];
  mapAirports: AirportRecord[];
  mapLoading: boolean;
  mapError: boolean;
  onMapRetry: () => void;
  showEmpty: boolean;
  hasActiveQuery: boolean;
  onClearSearchFromEmpty: () => void;
}

/**
 * Module-level header component with a stable type identity so the FlatList
 * never remounts it (and its TextInput) between renders — this keeps the
 * search input focused while typing.
 */
const DiscoverHeader = React.memo(function DiscoverHeader({
  colors, topPad, userName, allCount, productionReadOnly, featured, search, onSearchChange, onClearSearch,
  view, onViewChange, mapFlights, mapAirports, mapLoading, mapError, onMapRetry,
  showEmpty, hasActiveQuery, onClearSearchFromEmpty,
}: HeaderProps) {
  return (
    <View>
      {/* Logo + concierge */}
      <View style={[styles.topBar, { paddingTop: topPad + 24 }]}>
        <View style={styles.logoRow}>
          <Image
            source={require('@/assets/images/bluebird-bird-mark.png')}
            style={styles.logoImg}
            resizeMode="contain"
          />
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
        {greeting()}{userName ? `, ${userName}` : ''}
      </Text>
      <Text style={[styles.subGreeting, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
        {allCount > 0
          ? productionReadOnly
            ? `${allCount} published flight${allCount === 1 ? '' : 's'}`
            : `${allCount} empty legs available`
          : productionReadOnly ? 'Browse published empty legs' : 'Browse available empty legs'}
      </Text>

      {/* Featured empty leg — hidden when it doesn't match an active search */}
      {featured && (
        <TouchableOpacity
          style={styles.featuredWrap}
          activeOpacity={0.85}
          onPress={() => openFlightDetails(featured)}
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
              {airportLabel(featured.fromCity, featured.fromAirport)} → {airportLabel(featured.toCity, featured.toAirport)}
              </Text>
              <Text style={[styles.featuredMeta, { color: 'rgba(255,255,255,0.65)', fontFamily: 'Inter_400Regular' }]}>
              {featured.aircraftType ?? 'Aircraft details unavailable'} · {formatDateTime(featured)}
              </Text>
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
          onChangeText={onSearchChange}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="never"
        />
        {search.length > 0 && (
          <TouchableOpacity
            onPress={onClearSearch}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Clear search"
          >
            <Feather name="x" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        )}
      </View>

      {/* List / Map toggle */}
      <View style={styles.toggleRow}>
        <TouchableOpacity
          style={[styles.toggleBtn, view === 'list' && { backgroundColor: colors.card }]}
          onPress={() => onViewChange('list')}
        >
          <Text style={[
            styles.toggleText,
            { fontFamily: 'Inter_600SemiBold' },
            { color: view === 'list' ? colors.foreground : colors.mutedForeground },
          ]}>List</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleBtn, view === 'map' && { backgroundColor: colors.card }]}
          onPress={() => onViewChange('map')}
        >
          <Text style={[
            styles.toggleText,
            { fontFamily: 'Inter_600SemiBold' },
            { color: view === 'map' ? colors.foreground : colors.mutedForeground },
          ]}>Map</Text>
        </TouchableOpacity>
      </View>

      {view === 'map' && (
        mapFlights.length > 0 ? (
          mapLoading ? (
            <View style={styles.mapPlaceholder}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : mapError ? (
            <View style={styles.mapPlaceholder}>
              <Feather name="wifi-off" size={28} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                Could not load airport locations
              </Text>
              <TouchableOpacity
                style={[styles.retryBtn, { borderColor: colors.border }]}
                onPress={onMapRetry}
              >
                <Text style={[styles.retryText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>
                  Try again
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FlightMapView flights={mapFlights} airports={mapAirports} />
          )
        ) : (
          <View style={styles.mapPlaceholder}>
            <Feather name="map" size={28} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              No flights match your search
            </Text>
            {hasActiveQuery && (
              <TouchableOpacity style={[styles.retryBtn, { borderColor: colors.border }]} onPress={onClearSearchFromEmpty}>
                <Text style={[styles.retryText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>
                  Clear search
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )
      )}

      {showEmpty && (
        <View style={styles.mapPlaceholder}>
          <Feather name="send" size={28} color={colors.mutedForeground} style={{ transform: [{ rotate: '-45deg' }] }} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            No flights match
          </Text>
          {hasActiveQuery && (
            <TouchableOpacity style={[styles.retryBtn, { borderColor: colors.border }]} onPress={onClearSearchFromEmpty}>
              <Text style={[styles.retryText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>
                Clear search
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
});

export default function DiscoverScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, isLoading: authLoading, authMode } = useAuth();
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'list' | 'map'>('list');

  const localReadMode = shouldUseLocalFlightReadMode(authMode, isLocalFlightReadMode());
  const memberQueryEnabled = isLegacyMemberQueryEnabled({
    authMode,
    localDemoFlow: localReadMode,
    hasLegacyUser: !!user,
  });
  const localFlightsQuery = useListFlights({}, { query: { enabled: localReadMode } });
  const productionFlightsQuery = useQuery({
    queryKey: ['production-empty-legs'],
    queryFn: ({ signal }) => fetchProductionFlights({ signal }),
    enabled: !localReadMode,
    retry: shouldRetryProductionRead,
    retryDelay: productionReadRetryDelay,
  });
  const flights: FlightView[] = localReadMode
    ? (localFlightsQuery.data ?? []).map(mapLocalFlight)
    : productionFlightsQuery.data ?? [];
  const flightsLoading = localReadMode ? localFlightsQuery.isLoading : productionFlightsQuery.isLoading;
  const flightsError = localReadMode ? localFlightsQuery.isError : productionFlightsQuery.isError;
  const flightsRefetching = localReadMode ? localFlightsQuery.isRefetching : productionFlightsQuery.isRefetching;
  const refetchFlights = localReadMode ? localFlightsQuery.refetch : productionFlightsQuery.refetch;

  // Personalized data: flights the member is already queued for or booked on
  // are hidden from Discover. Signed-out users see the full list.
  const { data: queueEntries, isLoading: queueLoading } = useGetQueueStatus({
    query: { enabled: memberQueryEnabled },
  });
  const { data: trips, isLoading: tripsLoading } = useListTrips({
    query: { enabled: memberQueryEnabled },
  });

  // Avoid flashing soon-to-be-hidden flights: stay in the loading state while
  // the persisted session is being restored, and while a signed-in member's
  // queue/trips data is still loading.
  const isLoading =
    flightsLoading || authLoading || (localReadMode && !!user && (queueLoading || tripsLoading));

  const excludedFlightIds = React.useMemo(() => {
    const ids = new Set<string>();
    if (!user) return ids;
    for (const e of (queueEntries as QueueEntry[]) ?? []) {
      if (e.status === 'waiting' || e.status === 'confirmed') ids.add(e.flightId);
    }
    for (const t of (trips as Trip[]) ?? []) {
      if (t.status === 'upcoming') ids.add(t.flightId);
    }
    return ids;
  }, [user, queueEntries, trips]);

  const topPad = Platform.OS === 'web' ? 40 : insets.top;

  // Keep the status contract source-specific. The production API's published
  // status is a discoverability signal, not proof of queue eligibility.
  // Flights the member has already joined or booked remain hidden as before.
  const all: FlightView[] = React.useMemo(
    () => (flights ?? []).filter((f) =>
      f.status === (localReadMode ? 'available' : 'published') && !excludedFlightIds.has(f.id)),
    [flights, excludedFlightIds, localReadMode],
  );
  const featured = all.find((f) => f.featured);
  const q = search.trim().toLowerCase();

  // Featured card steps aside when it doesn't match an active search
  const showFeatured = featured && (!q || matchesQuery(featured, q));

  const filteredFlights = React.useMemo(() => {
    let list = all.filter((f) => f.id !== featured?.id);
    if (q) list = list.filter((f) => matchesQuery(f, q));
    return list;
  }, [all, featured?.id, q]);

  // Map view respects search too (featured included when it matches)
  const mapFlights = React.useMemo(() => {
    let list = all;
    if (q) list = list.filter((f) => matchesQuery(f, q));
    return list;
  }, [all, q]);

  const airportCodes = React.useMemo(() => getFlightAirportCodes(mapFlights), [mapFlights]);
  const airportQuery = useQuery({
    queryKey: ['production-airports', airportCodes],
    queryFn: ({ signal }) => fetchProductionAirports(airportCodes, { signal }),
    enabled: view === 'map' && airportCodes.length > 0,
    retry: shouldRetryProductionRead,
    retryDelay: productionReadRetryDelay,
  });

  const onClearSearch = React.useCallback(() => setSearch(''), []);
  const onRefresh = React.useCallback(async () => {
    const refreshes: Promise<unknown>[] = [refetchFlights()];
    if (view === 'map' && airportCodes.length > 0) refreshes.push(airportQuery.refetch());
    await Promise.all(refreshes);
  }, [refetchFlights, view, airportCodes, airportQuery.refetch]);

  const renderCard = ({ item }: { item: FlightView }) => (
    <TouchableOpacity
      testID={item.source === 'production' ? `production-flight-card-${item.id}` : undefined}
      style={[styles.card, { backgroundColor: colors.card }]}
      activeOpacity={0.8}
      onPress={() => openFlightDetails(item)}
      accessibilityRole="button"
    >
      {getFlightImagePresentation(item) === 'unavailable' ? (
        <View style={[styles.cardThumb, styles.cardThumbPlaceholder, { backgroundColor: colors.muted }]}>
          <Feather name="image" size={20} color={colors.mutedForeground} />
        </View>
      ) : (
        <Image
          source={
            getFlightImagePresentation(item) === 'provided'
              ? { uri: item.imageUrl! }
              : aircraftImage(item.aircraftType)
          }
          style={styles.cardThumb}
        />
      )}
      <View style={styles.cardBody}>
        <Text style={[styles.cardRoute, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
          {airportLabel(item.fromAirport, item.fromCity)} → {airportLabel(item.toAirport, item.toCity)}
        </Text>
        <Text style={[styles.cardMeta, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]} numberOfLines={2}>
          {item.aircraftType
            ? `${item.aircraftType} · ${formatDateTime(item)}`
            : item.source === 'production'
              ? formatDateTime(item)
              : `Aircraft details unavailable · ${formatDateTime(item)}`}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {isLoading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : flightsError ? (
        <View style={styles.centered}>
          <Feather name="wifi-off" size={32} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Could not load flights
          </Text>
          <TouchableOpacity
            style={[styles.retryBtn, { borderColor: colors.border }]}
            onPress={() => void refetchFlights()}
            disabled={flightsRefetching}
          >
            {flightsRefetching
              ? <ActivityIndicator color={colors.primary} />
              : <Text style={[styles.retryText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>Try again</Text>}
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={view === 'list' ? filteredFlights : []}
          keyExtractor={(item) => item.id}
          renderItem={renderCard}
          contentContainerStyle={{ paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
          refreshControl={
            <RefreshControl
              refreshing={flightsRefetching || airportQuery.isRefetching}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          }
          ListHeaderComponent={
            <DiscoverHeader
              colors={colors}
              topPad={topPad}
              userName={user?.name?.split(' ')[0]}
              allCount={all.length}
              productionReadOnly={!localReadMode}
              featured={showFeatured ? featured : undefined}
              search={search}
              onSearchChange={setSearch}
              onClearSearch={onClearSearch}
              view={view}
              onViewChange={setView}
              mapFlights={mapFlights}
              mapAirports={airportQuery.data ?? []}
              mapLoading={airportQuery.isFetching}
              mapError={airportQuery.isError}
              onMapRetry={() => airportQuery.refetch()}
              showEmpty={view === 'list' && filteredFlights.length === 0}
              hasActiveQuery={q.length > 0}
              onClearSearchFromEmpty={onClearSearch}
            />
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
  logoImg: { width: 40, height: 31 },
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
    ...StyleSheet.absoluteFill, borderRadius: 24,
    backgroundColor: 'rgba(6,11,31,0.35)',
  },
  featuredBadge: {
    position: 'absolute', top: 14, left: 14,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
  },
  featuredBadgeText: { fontSize: 11, letterSpacing: 0.4 },
  featuredBottom: { padding: 16, gap: 4 },
  featuredRoute: { fontSize: 20, letterSpacing: -0.4 },
  featuredMeta: { fontSize: 13 },

  // Search
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 999,
    paddingHorizontal: 16, paddingVertical: Platform.OS === 'web' ? 13 : 10,
    marginHorizontal: 20, marginBottom: 16,
  },
  searchInput: { flex: 1, fontSize: 15, padding: 0 },

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
  cardThumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1, minWidth: 0 },
  cardRoute: { fontSize: 15 },
  cardMeta: { fontSize: 12.5, marginTop: 2 },

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
