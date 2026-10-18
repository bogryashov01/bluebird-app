import React, { useEffect, useState } from 'react';
import {
  AppState, View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Alert,
  RefreshControl, ActivityIndicator, Platform, Image, ScrollView,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useColors } from '@/hooks/useColors';
import {
  getGetQueueStatusQueryKey, getListFlightsQueryKey, getListTripsQueryKey,
  useListFlights, useGetQueueStatus, useListTrips,
  type QueueEntry, type Trip,
} from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import { isLegacyMemberQueryEnabled, shouldUseLocalFlightReadMode } from '@/lib/clerkAuthSession';
import { getGreetingForHour, reconcileFeaturedFlightId } from '@/lib/discoverPresentation';
import { isQueueDevelopmentPreviewEnabled } from '@/lib/queueDevelopmentPreview';
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
  PRODUCTION_FLIGHTS_QUERY_KEY,
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

function aircraftImage(type: string | null) {
  return AIRCRAFT_IMAGES.find((a) => a.match.test(type ?? ''))?.source ?? LIGHT_JET;
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

function formatDepartureDate(flight: FlightView): string {
  const date = validDepartureDate(flight.departureDate);
  return date
    ? date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : 'Departure date unavailable';
}

function featuredPrice(flight: FlightView): string | null {
  if (flight.totalPrice !== null && Number.isFinite(flight.totalPrice) && flight.totalPrice >= 0) {
    return `${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(flight.totalPrice)} total`;
  }
  if (flight.pricePerHour !== null && Number.isFinite(flight.pricePerHour) && flight.pricePerHour >= 0) {
    return `${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(flight.pricePerHour)}/hr`;
  }
  return null;
}

function matchesQuery(flight: FlightView, q: string): boolean {
  return [flight.fromAirport, flight.toAirport, flight.fromCity, flight.toCity, flight.aircraftType]
    .some((value) => (value ?? '').toLowerCase().includes(q));
}

function airportLabel(code: string | null, city: string | null): string {
  return code || city || '—';
}

type FlightFilter = 'all' | 'week' | 'short';

function validDepartureDate(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}

function durationInMinutes(value: string | null): number | null {
  if (!value) return null;
  const match = value.trim().match(/^(?:(\d+(?:\.\d+)?)\s*h)?(?:\s*(\d+)\s*m)?$/i);
  if (!match || (!match[1] && !match[2])) return null;
  return Math.round(Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0));
}

function isThisWeek(date: Date): boolean {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const weekday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - weekday);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return date >= start && date < end;
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
  greetingText: string;
  userName?: string;
  allCount: number;
  productionReadOnly: boolean;
  showQueuePreview: boolean;
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
  filter: FlightFilter;
  filters: FlightFilter[];
  onFilterChange: (filter: FlightFilter) => void;
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
  colors, topPad, greetingText, userName, allCount, productionReadOnly, showQueuePreview, featured, search, onSearchChange, onClearSearch,
  view, onViewChange, mapFlights, mapAirports, mapLoading, mapError, onMapRetry,
  filter, filters, onFilterChange, showEmpty, hasActiveQuery, onClearSearchFromEmpty,
}: HeaderProps) {
  const featuredImage = featured
    ? featured.imageUrl
      ? { uri: featured.imageUrl }
      : null
    : null;
  const featuredAircraft = featured?.aircraftTypeName?.trim() || featured?.aircraftType?.trim() || null;
  const featuredPriceLabel = featured ? featuredPrice(featured) : null;
  const featuredDetails = [
    featuredAircraft,
    featured?.aircraftTypeCode?.trim() || null,
    featuredPriceLabel,
  ].filter((value, index, values): value is string => !!value && values.indexOf(value) === index);

  return (
    <View>
      {/* Logo + concierge */}
      <View style={[styles.topBar, { paddingTop: topPad }]}>
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
      <Text testID="discover-greeting" style={[styles.greeting, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
        {greetingText}{userName ? `, ${userName}` : ''}
      </Text>
      <Text style={[styles.subGreeting, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
        {allCount > 0
          ? productionReadOnly
            ? `${allCount} available flight${allCount === 1 ? '' : 's'}`
            : `${allCount} empty legs available`
          : productionReadOnly ? 'Browse available flights' : 'Browse available empty legs'}
      </Text>
      {showQueuePreview && (
        <TouchableOpacity
          testID="discover-development-preview-entry"
          accessibilityRole="button"
          style={[styles.queuePreviewEntry, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.push('/development-preview' as any)}
        >
          <Feather name="eye" size={15} color={colors.primary} />
          <Text style={[styles.queuePreviewEntryText, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>
            DEMO · Open development preview hub
          </Text>
        </TouchableOpacity>
      )}
      {showQueuePreview && (
        <TouchableOpacity
          testID="discover-queue-demo-preview"
          accessibilityRole="button"
          style={[styles.queuePreviewEntry, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.push({ pathname: '/queue/dev-preview', params: { state: 'eligible-flight' } } as any)}
        >
          <Feather name="eye" size={15} color={colors.primary} />
          <Text style={[styles.queuePreviewEntryText, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>
            DEMO · Preview queue states
          </Text>
        </TouchableOpacity>
      )}

      {/* Featured empty leg stays independent of the active search and filters. */}
      {featured && (
        <TouchableOpacity
          testID={`discover-featured-card-${featured.id}`}
          style={styles.featuredWrap}
          activeOpacity={0.85}
          onPress={() => openFlightDetails(featured)}
          accessibilityRole="button"
          accessibilityLabel={`Featured flight from ${airportLabel(featured.fromAirport, featured.fromCity)} to ${airportLabel(featured.toAirport, featured.toCity)}. ${formatDepartureDate(featured)}`}
        >
          <View style={[styles.featuredImage, { backgroundColor: colors.backgroundMid }]}>
            {featuredImage && (
              <Image
                testID="discover-featured-image"
                source={featuredImage}
                style={[StyleSheet.absoluteFill, styles.featuredImageShape]}
                resizeMode="cover"
              />
            )}
            <LinearGradient
              colors={[colors.discoverHeroOverlayTop, colors.discoverHeroOverlayBottom]}
              style={styles.featuredOverlay}
            />
            <View style={[styles.featuredBadge, { backgroundColor: colors.primary }]}>
              <Text style={[styles.featuredBadgeText, { color: colors.primaryForeground, fontFamily: 'Inter_700Bold' }]}>
                FEATURED EMPTY LEG
              </Text>
            </View>
            <View style={styles.featuredBottom}>
              <Text style={[styles.featuredRoute, { color: colors.textOnBrand, fontFamily: 'Inter_700Bold' }]}>
                {airportLabel(featured.fromAirport, featured.fromCity)} → {airportLabel(featured.toAirport, featured.toCity)}
              </Text>
              <Text testID="discover-featured-date" style={[styles.featuredMeta, { color: colors.mutedOnBrand, fontFamily: 'Inter_400Regular' }]}>
                {formatDepartureDate(featured)}
              </Text>
              {featuredDetails.length > 0 && (
                <Text testID="discover-featured-details" style={[styles.featuredDetails, { color: colors.mutedOnBrand, fontFamily: 'Inter_400Regular' }]} numberOfLines={1}>
                  {featuredDetails.join(' · ')}
                </Text>
              )}
            </View>
          </View>
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

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
        accessibilityLabel="Flight filters"
      >
        {filters.map((item) => {
          const label = item === 'all' ? 'All' : item === 'week' ? 'This Week' : 'Under 4 hrs';
          const selected = filter === item;
          return (
            <TouchableOpacity
              key={item}
              testID={`discover-filter-${item}`}
              style={[
                styles.filterChip,
                { borderColor: colors.border },
                selected && { backgroundColor: colors.primary, borderColor: colors.primary },
              ]}
              onPress={() => onFilterChange(item)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`Filter flights: ${label}`}
            >
              <Text style={[
                styles.filterText,
                { color: selected ? colors.primaryForeground : colors.mutedForeground, fontFamily: 'Inter_500Medium' },
              ]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* List / Map toggle */}
      <View style={styles.toggleRow}>
        <TouchableOpacity
          style={[styles.toggleBtn, view === 'list' && { backgroundColor: colors.card }]}
          onPress={() => onViewChange('list')}
          accessibilityRole="tab"
          accessibilityState={{ selected: view === 'list' }}
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
          accessibilityRole="tab"
          accessibilityState={{ selected: view === 'map' }}
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
            {(hasActiveQuery || filter !== 'all') && (
              <TouchableOpacity style={[styles.retryBtn, { borderColor: colors.border }]} onPress={onClearSearchFromEmpty}>
                <Text style={[styles.retryText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>
                  {filter !== 'all' ? 'Reset filters' : 'Clear search'}
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
          {(hasActiveQuery || filter !== 'all') && (
            <TouchableOpacity style={[styles.retryBtn, { borderColor: colors.border }]} onPress={onClearSearchFromEmpty}>
              <Text style={[styles.retryText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>
                {filter !== 'all' ? 'Reset filters' : 'Clear search'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
});

export default function DiscoverScreen() {
  const activeColors = useColors();
  const colors = {
    ...activeColors,
    background: activeColors.discoverBackground,
    card: activeColors.discoverCard,
    muted: activeColors.discoverMuted,
    foreground: activeColors.discoverForeground,
    mutedForeground: activeColors.discoverMutedForeground,
    border: activeColors.discoverBorder,
  };
  const insets = useSafeAreaInsets();
  const { user, isLoading: authLoading, authMode } = useAuth();
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [filter, setFilter] = useState<FlightFilter>('all');
  const [greetingText, setGreetingText] = useState(() => getGreetingForHour(new Date().getHours()));
  const [featuredFlightId, setFeaturedFlightId] = useState<string | null>(null);

  useFocusEffect(React.useCallback(() => {
    const refreshGreeting = () => setGreetingText(getGreetingForHour(new Date().getHours()));
    refreshGreeting();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshGreeting();
    });
    return () => subscription.remove();
  }, []));

  const localReadMode = shouldUseLocalFlightReadMode(authMode, isLocalFlightReadMode());
  const memberQueryEnabled = isLegacyMemberQueryEnabled({
    authMode,
    localDemoFlow: localReadMode,
    hasLegacyUser: !!user,
  });
  const localFlightsQuery = useListFlights({}, {
    query: { enabled: localReadMode, queryKey: getListFlightsQueryKey({}) },
  });
  const productionFlightsQuery = useQuery({
    queryKey: PRODUCTION_FLIGHTS_QUERY_KEY,
    queryFn: ({ signal }) => fetchProductionFlights({ signal }),
    enabled: !localReadMode,
    retry: shouldRetryProductionRead,
    retryDelay: productionReadRetryDelay,
  });
  const flights: FlightView[] = React.useMemo(
    () => localReadMode
      ? (localFlightsQuery.data ?? []).map(mapLocalFlight)
      : productionFlightsQuery.data ?? [],
    [localReadMode, localFlightsQuery.data, productionFlightsQuery.data],
  );
  const flightsLoading = localReadMode ? localFlightsQuery.isLoading : productionFlightsQuery.isLoading;
  const flightsError = localReadMode ? localFlightsQuery.isError : productionFlightsQuery.isError;
  const flightsRefetching = localReadMode ? localFlightsQuery.isRefetching : productionFlightsQuery.isRefetching;
  const refetchFlights = localReadMode ? localFlightsQuery.refetch : productionFlightsQuery.refetch;

  // Personalized data: flights the member is already queued for or booked on
  // are hidden from Discover. Signed-out users see the full list.
  const { data: queueEntries, isLoading: queueLoading } = useGetQueueStatus({
    query: { enabled: memberQueryEnabled, queryKey: getGetQueueStatusQueryKey() },
  });
  const { data: trips, isLoading: tripsLoading } = useListTrips({
    query: { enabled: memberQueryEnabled, queryKey: getListTripsQueryKey() },
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

  const topPad = Platform.OS === 'web' ? 64 : insets.top + 5;

  // Keep the status contract source-specific. The production API's published
  // status is a discoverability signal, not proof of queue eligibility.
  // Flights the member has already joined or booked remain hidden as before.
  const all: FlightView[] = React.useMemo(
    () => (flights ?? []).filter((f) =>
      f.status === (localReadMode ? 'available' : 'published') && !excludedFlightIds.has(f.id)),
    [flights, excludedFlightIds, localReadMode],
  );
  useEffect(() => {
    setFeaturedFlightId((current) =>
      reconcileFeaturedFlightId(all.map((flight) => flight.id), current),
    );
  }, [all]);
  const featured = all.find((flight) => flight.id === featuredFlightId);
  const q = search.trim().toLowerCase();

  const filters: FlightFilter[] = [
    'all',
    ...(all.some((flight) => validDepartureDate(flight.departureDate)) ? ['week' as const] : []),
    ...(all.some((flight) => durationInMinutes(flight.duration) !== null) ? ['short' as const] : []),
  ];
  const selectedFilter: FlightFilter = filters.includes(filter) ? filter : 'all';

  const matchesFilter = React.useCallback((flight: FlightView) => {
    if (selectedFilter === 'week') {
      const date = validDepartureDate(flight.departureDate);
      return !!date && isThisWeek(date);
    }
    if (selectedFilter === 'short') {
      const minutes = durationInMinutes(flight.duration);
      return minutes !== null && minutes < 240;
    }
    return true;
  }, [selectedFilter]);

  const filteredFlights = React.useMemo(() => {
    let list = all;
    if (q) list = list.filter((f) => matchesQuery(f, q));
    list = list.filter(matchesFilter);
    return list;
  }, [all, q, matchesFilter]);

  // Map view respects the same search and supported flight filters.
  const mapFlights = React.useMemo(() => {
    let list = all;
    if (q) list = list.filter((f) => matchesQuery(f, q));
    list = list.filter(matchesFilter);
    return list;
  }, [all, q, matchesFilter]);

  const airportCodes = React.useMemo(() => getFlightAirportCodes(mapFlights), [mapFlights]);
  const airportQuery = useQuery({
    queryKey: ['production-airports', airportCodes],
    queryFn: ({ signal }) => fetchProductionAirports(airportCodes, { signal }),
    enabled: view === 'map' && airportCodes.length > 0,
    retry: shouldRetryProductionRead,
    retryDelay: productionReadRetryDelay,
  });

  const onClearSearch = React.useCallback(() => setSearch(''), []);
  const onResetResults = React.useCallback(() => {
    setSearch('');
    setFilter('all');
  }, []);
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
      accessibilityLabel={`Flight from ${airportLabel(item.fromAirport, item.fromCity)} to ${airportLabel(item.toAirport, item.toCity)}. ${formatDateTime(item)}`}
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
        <Text style={[styles.cardRoute, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]} numberOfLines={1}>
          {airportLabel(item.fromAirport, item.fromCity)} <Text style={{ color: colors.paleBlue }}>→</Text> {airportLabel(item.toAirport, item.toCity)}
        </Text>
        <Text style={[styles.cardMeta, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]} numberOfLines={1}>
          {[item.aircraftType, formatDateTime(item)].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {isLoading ? (
        <View style={styles.centered}>
          <View style={[styles.skeletonHero, { backgroundColor: colors.card }]} />
          <View style={[styles.skeletonLine, { backgroundColor: colors.card }]} />
          <View style={[styles.skeletonLineShort, { backgroundColor: colors.card }]} />
          <ActivityIndicator color={colors.primary} size="small" />
        </View>
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
              greetingText={greetingText}
              userName={user?.name?.trim().split(/\s+/)[0] || undefined}
              allCount={all.length}
              productionReadOnly={!localReadMode}
              showQueuePreview={isQueueDevelopmentPreviewEnabled(
                typeof __DEV__ !== 'undefined' && __DEV__,
              )}
              featured={featured}
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
              filter={selectedFilter}
              filters={filters}
              onFilterChange={setFilter}
              showEmpty={view === 'list' && filteredFlights.length === 0}
              hasActiveQuery={q.length > 0}
              onClearSearchFromEmpty={onResetResults}
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
  logoImg: { width: 28, height: 24 },
  conciergeBtn: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
  },
  greeting: { fontSize: 26, letterSpacing: -0.6, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 4 },
  subGreeting: { fontSize: 15, paddingHorizontal: 20, paddingBottom: 18 },
  queuePreviewEntry: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 8,
    marginHorizontal: 20, marginTop: -8, marginBottom: 16, paddingHorizontal: 13,
    paddingVertical: 9, borderRadius: 999, borderWidth: 1,
  },
  queuePreviewEntryText: { fontSize: 12 },

  // Featured card
  featuredWrap: { marginHorizontal: 20, marginBottom: 20, borderRadius: 24, overflow: 'hidden' },
  featuredImage: { height: 150, width: '100%', justifyContent: 'flex-end' },
  featuredImageShape: { borderRadius: 24 },
  featuredOverlay: { ...StyleSheet.absoluteFill, borderRadius: 24 },
  featuredBadge: {
    position: 'absolute', top: 14, left: 14,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
  },
  featuredBadgeText: { fontSize: 11, letterSpacing: 0.4 },
  featuredBottom: { padding: 16, gap: 3 },
  featuredRoute: { fontSize: 19, letterSpacing: -0.4 },
  featuredMeta: { fontSize: 13 },
  featuredDetails: { fontSize: 12, marginTop: 1 },

  // Search
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 999,
    paddingHorizontal: 16, paddingVertical: Platform.OS === 'web' ? 13 : 10,
    marginHorizontal: 20, marginBottom: 16,
  },
  searchInput: { flex: 1, fontSize: 15, padding: 0 },

  filterRow: { paddingHorizontal: 20, gap: 8, paddingBottom: 18 },
  filterChip: {
    minHeight: 34, justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderRadius: 999, paddingHorizontal: 14,
  },
  filterText: { fontSize: 12 },

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
  skeletonHero: { width: '86%', height: 152, borderRadius: 18, opacity: 0.75 },
  skeletonLine: { width: '72%', height: 14, borderRadius: 8, opacity: 0.75 },
  skeletonLineShort: { width: '48%', height: 12, borderRadius: 8, opacity: 0.75 },
  mapPlaceholder: { alignItems: 'center', gap: 10, paddingVertical: 40 },
  emptyText: { fontSize: 15 },
  retryBtn: {
    borderWidth: 1, borderRadius: 999,
    paddingHorizontal: 20, paddingVertical: 10,
  },
  retryText: { fontSize: 14 },
});
