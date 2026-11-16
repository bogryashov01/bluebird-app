/**
 * Native map component using react-native-maps.
 * Metro picks this file on iOS/Android; FlightMap.web.tsx is used on web.
 *
 * Renders each flight as a smooth primary-blue arc from origin to destination,
 * with a small airplane at the route midpoint and airport-code labels
 * at the endpoints. Featured flights render in orange.
 *
 * Pinch zoom, one-finger pan, and double-tap zoom use the library defaults.
 * Camera auto-fits only on first open, flight-set change, or Reset route.
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  useWindowDimensions,
  TouchableOpacity,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT, type Region } from 'react-native-maps';
import Svg, { Path } from 'react-native-svg';
import { useColors } from '@/hooks/useColors';
import { planeIconRotationDeg, presentFlightRoute } from '@/lib/flightGeo';
import {
  AIRPORT_DOT_MARKER_ANCHOR,
  FLIGHT_MAP_ROUTE_STROKE,
  airportMapCoordinate,
  collectFlightMapFitCoordinates,
  flightMapFitEdgePadding,
  flightMapSelectionKey,
  isValidMapCoordinate,
  planFlightMapCameraUpdate,
  zoomFlightMapRegion,
  type FlightMapEdgePadding,
  type FlightMapRegion,
} from '@/lib/flightMapCamera';
import type { AirportRecord, FlightView } from '@/lib/productionFlights';

const ORANGE = '#F5842E';

/**
 * Opt-in endpoint diagnostics (dev only). Set
 * EXPO_PUBLIC_FLIGHT_MAP_ENDPOINT_DEBUG=1 to draw a tiny crosshair at each
 * route endpoint and airport coordinate. Disabled in production (__DEV__ false).
 */
const SHOW_ROUTE_ENDPOINT_DIAGNOSTICS =
  typeof __DEV__ !== 'undefined' &&
  __DEV__ &&
  process.env.EXPO_PUBLIC_FLIGHT_MAP_ENDPOINT_DEBUG === '1';

const INITIAL_REGION: Region = {
  latitude: 39.5,
  longitude: -98.35,
  latitudeDelta: 35,
  longitudeDelta: 55,
};

function RouteAirplane({ color, rotationDeg }: { color: string; rotationDeg: number }) {
  return (
    <View style={styles.planeHalo}>
      <View style={{ transform: [{ rotate: `${rotationDeg}deg` }] }}>
        <Svg width={18} height={18} viewBox="0 0 24 24">
          <Path
            fill={color}
            d="M12 1.5c.6 0 1.2.5 1.2 1.6v6.2l8.3 5v2l-8.3-2.6v5l2.1 1.7v1.8L12 21.3l-3.3.9v-1.8l2.1-1.7v-5L2.5 16.3v-2l8.3-5V3.1c0-1.1.6-1.6 1.2-1.6z"
          />
        </Svg>
      </View>
    </View>
  );
}

/** Muted dark style — applies on Google-provider maps (Android). iOS Apple Maps uses userInterfaceStyle. */
const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#0D1636' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8896B3' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0A1128' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#060B1F' }] },
  { featureType: 'road', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.province', elementType: 'geometry.stroke', stylers: [{ color: '#1E2D4F' }] },
];

/** Muted light style — applies on Google-provider maps (Android). iOS Apple Maps uses mapType "mutedStandard". */
const LIGHT_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#f5f5f5' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9aa0a6' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f5f5f5' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#dde3ea' }] },
  { featureType: 'administrative.province', elementType: 'geometry.stroke', stylers: [{ color: '#d5d9de' }] },
];

interface Props {
  flights: FlightView[];
  airports: AirportRecord[];
  /** When true, parent scroll views should yield so map pan/zoom win. */
  onMapGestureActive?: (active: boolean) => void;
}

function MapChromeControls({
  onZoomIn,
  onZoomOut,
  onReset,
  isDark,
  colors,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  isDark: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  const pillBg = isDark ? 'rgba(13,22,54,0.92)' : 'rgba(255,255,255,0.94)';
  const border = isDark ? 'rgba(127,168,250,0.25)' : 'rgba(18,89,242,0.14)';
  return (
    <View style={styles.controls} pointerEvents="box-none">
      <View style={[styles.zoomStack, { backgroundColor: pillBg, borderColor: border }]}>
        <TouchableOpacity
          testID="flight-map-zoom-in"
          accessibilityRole="button"
          accessibilityLabel="Zoom in"
          onPress={onZoomIn}
          style={styles.zoomBtn}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Feather name="plus" size={16} color={colors.textOnSurface} />
        </TouchableOpacity>
        <View style={[styles.zoomDivider, { backgroundColor: border }]} />
        <TouchableOpacity
          testID="flight-map-zoom-out"
          accessibilityRole="button"
          accessibilityLabel="Zoom out"
          onPress={onZoomOut}
          style={styles.zoomBtn}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Feather name="minus" size={16} color={colors.textOnSurface} />
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        testID="flight-map-reset-route"
        accessibilityRole="button"
        accessibilityLabel="Reset route"
        onPress={onReset}
        style={[styles.resetBtn, { backgroundColor: pillBg, borderColor: border }]}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Feather name="maximize" size={13} color={colors.primary} />
        <Text style={[styles.resetText, { color: colors.textOnSurface }]}>Reset route</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function FlightMap({ flights, airports, onMapGestureActive }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const mapHeight = Math.round(screenHeight * 0.55);
  const [mapSize, setMapSize] = React.useState({ width: screenWidth - 40, height: mapHeight });

  const isDark = colors.scheme === 'dark';
  const routeColor = colors.primary;
  const labelColor = isDark ? colors.paleBlueFaint : colors.primary;
  const halo = isDark ? colors.backgroundMid : '#fff';
  const mapRef = React.useRef<MapView | null>(null);
  const regionRef = React.useRef<FlightMapRegion>(INITIAL_REGION);
  const lastFittedSelectionKeyRef = React.useRef<string | null>(null);
  const lastFittedResetTokenRef = React.useRef(0);
  const [resetToken, setResetToken] = React.useState(0);
  const gestureDepthRef = React.useRef(0);

  const fitPadding = React.useMemo<FlightMapEdgePadding>(
    () => flightMapFitEdgePadding({
      mapWidth: mapSize.width,
      mapHeight: mapSize.height,
      topInset: insets.top,
    }),
    [mapSize.width, mapSize.height, insets.top],
  );

  const onMapLayout = React.useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width <= 0 || height <= 0) return;
    setMapSize((prev) => (
      prev.width === width && prev.height === height ? prev : { width, height }
    ));
  }, []);

  const setGestureActive = React.useCallback((active: boolean) => {
    if (active) {
      gestureDepthRef.current += 1;
      if (gestureDepthRef.current === 1) onMapGestureActive?.(true);
      return;
    }
    gestureDepthRef.current = Math.max(0, gestureDepthRef.current - 1);
    if (gestureDepthRef.current === 0) onMapGestureActive?.(false);
  }, [onMapGestureActive]);

  const airportsByCode = React.useMemo(
    () => new Map(airports.map((airport) => [airport.code, airport])),
    [airports],
  );

  const routes = React.useMemo(
    () => flights.flatMap((flight) => {
      const fromCode = flight.fromAirport;
      const toCode = flight.toAirport;
      if (!fromCode || !toCode) return [];
      const from = airportsByCode.get(fromCode);
      const to = airportsByCode.get(toCode);
      if (!isValidMapCoordinate(from) || !isValidMapCoordinate(to)) return [];
      // Canonical airport coordinates shared by polyline ends and marker centers.
      const origin = airportMapCoordinate(from);
      const destination = airportMapCoordinate(to);
      const route = presentFlightRoute(origin, destination);
      return [{
        flight,
        fromCode,
        toCode,
        origin: route.origin,
        destination: route.destination,
        segments: route.segments,
        pts: route.points,
        mid: route.midpoint,
        rot: planeIconRotationDeg(route.headingDeg),
        featured: flight.featured,
      }];
    }),
    [flights, airportsByCode],
  );

  const selectionKey = React.useMemo(
    () => flightMapSelectionKey(routes.map((route) => ({
      flightId: route.flight.id,
      fromCode: route.fromCode,
      toCode: route.toCode,
    }))),
    [routes],
  );

  const fitCoordinates = React.useMemo(
    () => collectFlightMapFitCoordinates(routes.map((route) => ({
      points: [
        route.origin,
        ...route.segments.flat(),
        route.destination,
      ],
    }))),
    [routes],
  );

  const routeAirports = React.useMemo(() => {
    const touched = new Map<string, { airport: AirportRecord; flight: FlightView }>();
    for (const { flight, fromCode, toCode } of routes) {
      const from = airportsByCode.get(fromCode);
      const to = airportsByCode.get(toCode);
      if (from && isValidMapCoordinate(from) && !touched.has(fromCode)) {
        touched.set(fromCode, { airport: from, flight });
      }
      if (to && isValidMapCoordinate(to) && !touched.has(toCode)) {
        touched.set(toCode, { airport: to, flight });
      }
    }
    return [...touched.entries()];
  }, [routes, airportsByCode]);

  const applyFit = React.useCallback(() => {
    const map = mapRef.current;
    if (!map || fitCoordinates.length === 0) return;
    if (fitCoordinates.length === 1) {
      const [coordinate] = fitCoordinates;
      const region = {
        ...coordinate,
        latitudeDelta: 4,
        longitudeDelta: 4,
      };
      regionRef.current = region;
      map.animateToRegion(region, 0);
      return;
    }
    map.fitToCoordinates(fitCoordinates, {
      edgePadding: fitPadding,
      animated: false,
    });
  }, [fitCoordinates, fitPadding]);

  React.useEffect(() => {
    const decision = planFlightMapCameraUpdate({
      selectionKey,
      lastFittedSelectionKey: lastFittedSelectionKeyRef.current,
      resetToken,
      lastFittedResetToken: lastFittedResetTokenRef.current,
      fitCoordinateCount: fitCoordinates.length,
    });
    if (decision.action !== 'fit') return;
    applyFit();
    lastFittedSelectionKeyRef.current = decision.selectionKey;
    lastFittedResetTokenRef.current = decision.resetToken;
  }, [selectionKey, resetToken, fitCoordinates.length, applyFit]);

  const productionRoutes = routes.some(({ flight }) => flight.source === 'production');
  const availableLocalRoutes = routes.some(({ flight }) => flight.status === 'available');
  const featuredRoutes = routes.some(({ featured }) => featured);

  if (routes.length === 0) {
    return (
      <View style={styles.placeholder} testID="flight-map-empty">
        <Feather name="map" size={28} color={colors.mutedForeground} />
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No flights to display</Text>
      </View>
    );
  }

  const goTo = (id: string) => router.push(`/flight/${id}`);

  const zoomBy = (direction: 'in' | 'out') => {
    const map = mapRef.current;
    if (!map) return;
    const next = zoomFlightMapRegion(regionRef.current, direction);
    regionRef.current = next;
    map.animateToRegion(next, 0);
  };

  const endGesture = (_event?: GestureResponderEvent) => {
    setGestureActive(false);
  };

  return (
    <View
      style={[styles.container, { height: mapHeight }]}
      testID="flight-map"
      onLayout={onMapLayout}
      onTouchStart={() => setGestureActive(true)}
      onTouchEnd={endGesture}
      onTouchCancel={endGesture}
    >
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        customMapStyle={isDark ? DARK_MAP_STYLE : LIGHT_MAP_STYLE}
        mapType={Platform.OS === 'ios' ? 'mutedStandard' : 'standard'}
        userInterfaceStyle={isDark ? 'dark' : 'light'}
        initialRegion={INITIAL_REGION}
        scrollEnabled
        zoomEnabled
        zoomTapEnabled
        rotateEnabled={false}
        pitchEnabled={false}
        zoomControlEnabled={false}
        moveOnMarkerPress={false}
        onPanDrag={() => setGestureActive(true)}
        onRegionChangeComplete={(region) => {
          regionRef.current = region;
        }}
      >
        {routes.map(({ flight, segments, mid, rot, featured }) => {
          const color = featured ? ORANGE : routeColor;
          return (
            <React.Fragment key={flight.id}>
              {segments.map((segment, segmentIndex) => (
                <Polyline
                  key={`${flight.id}-seg-${segmentIndex}`}
                  coordinates={segment}
                  strokeColor={color}
                  strokeWidth={FLIGHT_MAP_ROUTE_STROKE}
                  lineCap="butt"
                  lineJoin="round"
                  zIndex={1}
                  tappable
                  onPress={() => goTo(flight.id)}
                />
              ))}
              <Marker
                coordinate={mid}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
                zIndex={2}
                onPress={() => goTo(flight.id)}
              >
                <RouteAirplane color={color} rotationDeg={rot} />
              </Marker>
            </React.Fragment>
          );
        })}
        {routeAirports.map(([code, { airport, flight }]) => {
          // Dot is a separate marker with center anchor so the route meets the
          // geographic center. The label is a second marker offset below —
          // never bundled into the same view (that was shifting the anchor).
          const coordinate = airportMapCoordinate(airport);
          return (
            <React.Fragment key={code}>
              <Marker
                coordinate={coordinate}
                anchor={AIRPORT_DOT_MARKER_ANCHOR}
                tracksViewChanges={false}
                zIndex={3}
                title={airport.name}
                description={[
                  airport.city,
                  airport.tz ? `Time zone: ${airport.tz}` : null,
                ].filter(Boolean).join(' · ')}
                onPress={() => goTo(flight.id)}
              >
                <View
                  testID={`flight-map-airport-dot-${code}`}
                  style={[styles.airportDot, { backgroundColor: routeColor, borderColor: halo }]}
                />
              </Marker>
              <Marker
                coordinate={coordinate}
                anchor={{ x: 0.5, y: 0 }}
                tracksViewChanges={false}
                zIndex={4}
                onPress={() => goTo(flight.id)}
              >
                <View style={styles.airportLabelWrap} pointerEvents="none">
                  <Text style={[styles.airportCode, { color: labelColor, textShadowColor: halo }]}>{code}</Text>
                </View>
              </Marker>
            </React.Fragment>
          );
        })}
        {SHOW_ROUTE_ENDPOINT_DIAGNOSTICS && routes.map(({ flight, origin, destination }) => (
          <React.Fragment key={`diag-${flight.id}`}>
            <Marker coordinate={origin} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} zIndex={20}>
              <View style={styles.endpointDiag} testID={`flight-map-endpoint-diag-origin-${flight.id}`} />
            </Marker>
            <Marker coordinate={destination} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} zIndex={20}>
              <View style={styles.endpointDiag} testID={`flight-map-endpoint-diag-dest-${flight.id}`} />
            </Marker>
          </React.Fragment>
        ))}
      </MapView>
      <MapChromeControls
        isDark={isDark}
        colors={colors}
        onZoomIn={() => zoomBy('in')}
        onZoomOut={() => zoomBy('out')}
        onReset={() => setResetToken((token) => token + 1)}
      />
      <View style={styles.legend} pointerEvents="none">
        <View style={[styles.legendPill, { backgroundColor: isDark ? 'rgba(13,22,54,0.92)' : 'rgba(255,255,255,0.92)' }]}>
          <View style={[styles.legendSwatch, { backgroundColor: routeColor }]} />
          <Text style={[styles.legendText, { color: colors.mutedForeground }]}>
            {productionRoutes ? 'Published' : availableLocalRoutes ? 'Available' : 'Flights'}
          </Text>
          {featuredRoutes && (
            <>
              <View style={[styles.legendSwatch, { backgroundColor: ORANGE, marginLeft: 10 }]} />
              <Text style={[styles.legendText, { color: colors.mutedForeground }]}>Featured</Text>
            </>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginHorizontal: 20, marginBottom: 20, borderRadius: 18, overflow: 'hidden' },
  map: { flex: 1 },
  placeholder: { alignItems: 'center', gap: 10, paddingVertical: 40 },
  emptyText: { fontSize: 15, fontFamily: 'Inter_400Regular' },
  planeHalo: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(18,89,242,0.12)',
    ...Platform.select({
      ios: {
        shadowColor: '#0A1128',
        shadowOpacity: 0.12,
        shadowRadius: 3,
        shadowOffset: { width: 0, height: 1 },
      },
      android: { elevation: 2 },
      default: {},
    }),
  },
  airportDot: {
    width: 7, height: 7, borderRadius: 999,
    borderWidth: 1.5,
  },
  airportLabelWrap: {
    paddingTop: 10,
    alignItems: 'center',
  },
  airportCode: {
    fontSize: 10, fontFamily: 'Inter_700Bold',
    letterSpacing: 0.3,
    textShadowRadius: 2,
  },
  endpointDiag: {
    width: 8,
    height: 8,
    borderRadius: 1,
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: '#E11D48',
    transform: [{ rotate: '45deg' }],
  },
  controls: {
    position: 'absolute',
    top: 10,
    right: 10,
    alignItems: 'flex-end',
    gap: 8,
    zIndex: 20,
  },
  zoomStack: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  zoomBtn: {
    width: 36,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomDivider: { height: StyleSheet.hairlineWidth, width: '100%' },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  resetText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  legend: {
    position: 'absolute', bottom: 8, left: 0, right: 0,
    alignItems: 'center',
  },
  legendPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999,
  },
  legendSwatch: { width: 14, height: 3, borderRadius: 2 },
  legendText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
});
