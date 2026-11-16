/**
 * Web-only map component using react-leaflet + CARTO light basemap.
 * Metro's platform-suffix resolution picks this file on web,
 * so react-native-maps never gets bundled for web.
 *
 * Renders each flight as a smooth primary-blue arc from origin to destination,
 * with a small airplane at the route midpoint and airport-code labels
 * at the endpoints. Featured flights render in orange.
 *
 * Drag / pinch / double-click zoom use Leaflet. Camera auto-fits only on
 * first open, flight-set change, or Reset route.
 */
import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { MapContainer, TileLayer, Marker, Polyline, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { planeIconRotationDeg, presentFlightRoute } from '@/lib/flightGeo';
import {
  FLIGHT_MAP_ROUTE_STROKE,
  airportMapCoordinate,
  collectFlightMapFitCoordinates,
  flightMapFitEdgePadding,
  flightMapSelectionKey,
  isValidMapCoordinate,
  planFlightMapCameraUpdate,
  type FlightMapEdgePadding,
} from '@/lib/flightMapCamera';
import type { AirportRecord, FlightView } from '@/lib/productionFlights';

const SHOW_ROUTE_ENDPOINT_DIAGNOSTICS =
  typeof __DEV__ !== 'undefined' &&
  __DEV__ &&
  process.env.EXPO_PUBLIC_FLIGHT_MAP_ENDPOINT_DEBUG === '1';

// Leaflet CSS is required — inject it once into the document head.
function useLeafletCss() {
  useEffect(() => {
    const id = 'leaflet-css';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
  }, []);
}

const ORANGE = '#F5842E';

interface Props {
  flights: FlightView[];
  airports: AirportRecord[];
  onMapGestureActive?: (active: boolean) => void;
}

function planeIcon(rotationDeg: number, color: string) {
  return L.divIcon({
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `<div style="width:28px;height:28px;border-radius:14px;background:#fff;border:1px solid rgba(18,89,242,0.12);box-shadow:0 1px 3px rgba(10,17,40,0.12);display:flex;align-items:center;justify-content:center;cursor:pointer;">
      <div style="transform: rotate(${rotationDeg}deg); width:18px; height:18px; display:flex; align-items:center; justify-content:center;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="${color}" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 1.5c.6 0 1.2.5 1.2 1.6v6.2l8.3 5v2l-8.3-2.6v5l2.1 1.7v1.8L12 21.3l-3.3.9v-1.8l2.1-1.7v-5L2.5 16.3v-2l8.3-5V3.1c0-1.1.6-1.6 1.2-1.6z"/>
        </svg>
      </div>
    </div>`,
  });
}

function airportLabelIcon(code: string, color: string, halo: string) {
  const safeCode = code.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
  return L.divIcon({
    className: '',
    iconSize: [40, 16],
    iconAnchor: [20, -4],
    html: `<div style="display:flex; justify-content:center;">
      <span style="font-family: Inter, sans-serif; font-size: 11px; font-weight: 700; color: ${color}; letter-spacing: 0.3px; text-shadow: 0 0 3px ${halo}, 0 0 3px ${halo}; white-space: nowrap; cursor:pointer;">${safeCode}</span>
    </div>`,
  });
}

function airportDotIcon(fill: string, ring: string) {
  // 10×10 box with border-box so the visual circle center matches iconAnchor.
  return L.divIcon({
    className: '',
    iconSize: [10, 10],
    iconAnchor: [5, 5],
    html: `<div style="width:10px;height:10px;box-sizing:border-box;border-radius:999px;background:${fill};border:1.5px solid ${ring};box-shadow:0 0 2px rgba(0,0,0,0.3);"></div>`,
  });
}

function endpointDiagIcon() {
  return L.divIcon({
    className: '',
    iconSize: [8, 8],
    iconAnchor: [4, 4],
    html: `<div style="width:8px;height:8px;box-sizing:border-box;border:1.5px solid #E11D48;transform:rotate(45deg);background:transparent;"></div>`,
  });
}

function FitMapToRoutes({
  positions,
  selectionKey,
  resetToken,
  edgePadding,
}: {
  positions: [number, number][];
  selectionKey: string;
  resetToken: number;
  edgePadding: FlightMapEdgePadding;
}) {
  const map = useMap();
  const lastFittedSelectionKeyRef = React.useRef<string | null>(null);
  const lastFittedResetTokenRef = React.useRef(0);

  React.useEffect(() => {
    const decision = planFlightMapCameraUpdate({
      selectionKey,
      lastFittedSelectionKey: lastFittedSelectionKeyRef.current,
      resetToken,
      lastFittedResetToken: lastFittedResetTokenRef.current,
      fitCoordinateCount: positions.length,
    });
    if (decision.action !== 'fit') return;
    if (positions.length === 1) {
      map.setView(positions[0], 7, { animate: false });
    } else {
      map.fitBounds(L.latLngBounds(positions), {
        paddingTopLeft: L.point(edgePadding.left, edgePadding.top),
        paddingBottomRight: L.point(edgePadding.right, edgePadding.bottom),
        maxZoom: 8,
        animate: false,
      });
    }
    lastFittedSelectionKeyRef.current = decision.selectionKey;
    lastFittedResetTokenRef.current = decision.resetToken;
  }, [map, positions, selectionKey, resetToken, edgePadding]);

  return null;
}

function MapCameraControls({
  onGestureActive,
}: {
  onGestureActive?: (active: boolean) => void;
}) {
  const map = useMap();

  React.useEffect(() => {
    if (!onGestureActive) return;
    const start = () => onGestureActive(true);
    const end = () => onGestureActive(false);
    map.on('dragstart', start);
    map.on('zoomstart', start);
    map.on('dragend', end);
    map.on('zoomend', end);
    return () => {
      map.off('dragstart', start);
      map.off('zoomstart', start);
      map.off('dragend', end);
      map.off('zoomend', end);
    };
  }, [map, onGestureActive]);

  return null;
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
      >
        <Feather name="maximize" size={13} color={colors.primary} />
        <Text style={[styles.resetText, { color: colors.textOnSurface }]}>Reset route</Text>
      </TouchableOpacity>
    </View>
  );
}

function MapZoomApi({
  apiRef,
}: {
  apiRef: React.MutableRefObject<{ zoomIn: () => void; zoomOut: () => void } | null>;
}) {
  const map = useMap();
  React.useEffect(() => {
    apiRef.current = {
      zoomIn: () => {
        map.setZoom(map.getZoom() + 1, { animate: false });
      },
      zoomOut: () => {
        map.setZoom(map.getZoom() - 1, { animate: false });
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [map, apiRef]);
  return null;
}

export default function FlightMap({ flights, airports, onMapGestureActive }: Props) {
  const colors = useColors();
  useLeafletCss();
  const [resetToken, setResetToken] = React.useState(0);
  const zoomApiRef = React.useRef<{ zoomIn: () => void; zoomOut: () => void } | null>(null);

  const isDark = colors.scheme === 'dark';
  const isStage1ProductionPreview =
    typeof __DEV__ !== 'undefined' &&
    __DEV__ &&
    process.env.EXPO_PUBLIC_BLUEBIRD_FLIGHT_READ_MODE === 'production';
  const routeColor = colors.primary;
  const labelColor = isDark ? colors.paleBlueFaint : colors.primary;
  const halo = isDark ? colors.backgroundMid : '#fff';
  const [mapSize, setMapSize] = React.useState({ width: 360, height: 420 });
  const fitPadding = React.useMemo(
    () => flightMapFitEdgePadding({
      mapWidth: mapSize.width,
      mapHeight: mapSize.height,
    }),
    [mapSize.width, mapSize.height],
  );
  const tileUrl = isStage1ProductionPreview
    ? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
    : isDark
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
  const tileAttribution = isStage1ProductionPreview
    ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
    : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

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
      const origin = airportMapCoordinate(from);
      const destination = airportMapCoordinate(to);
      const route = presentFlightRoute(origin, destination);
      const segments = route.segments.map((segment) =>
        segment.map((p) => [p.latitude, p.longitude] as [number, number]),
      );
      const mid: [number, number] = [route.midpoint.latitude, route.midpoint.longitude];
      const rot = planeIconRotationDeg(route.headingDeg);
      return [{
        flight,
        fromCode,
        toCode,
        origin: route.origin,
        destination: route.destination,
        segments,
        mid,
        rot,
        featured: flight.featured,
        points: route.points,
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

  const fitPositions = React.useMemo(() => {
    return collectFlightMapFitCoordinates(routes.map((route) => ({
      points: [
        route.origin,
        ...route.points,
        route.destination,
      ],
    }))).map((point) => [point.latitude, point.longitude] as [number, number]);
  }, [routes]);

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

  return (
    <View
      style={styles.container}
      testID="flight-map"
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        if (width <= 0 || height <= 0) return;
        setMapSize((prev) => (
          prev.width === width && prev.height === height ? prev : { width, height }
        ));
      }}
    >
      <div style={{ width: '100%', height: '100%', borderRadius: 18, overflow: 'hidden' }}>
        <MapContainer
          center={[39.5, -98.35]}
          zoom={4}
          style={{ height: '100%', width: '100%', background: isDark ? '#0A1128' : '#f6f7f9' }}
          scrollWheelZoom={false}
          doubleClickZoom
          dragging
          touchZoom
          zoomControl={false}
        >
          <TileLayer
            key={colors.scheme}
            attribution={tileAttribution}
            url={tileUrl}
          />
          <FitMapToRoutes
            positions={fitPositions}
            selectionKey={selectionKey}
            resetToken={resetToken}
            edgePadding={fitPadding}
          />
          <MapCameraControls onGestureActive={onMapGestureActive} />
          <MapZoomApi apiRef={zoomApiRef} />
          {routes.map(({ flight, segments, mid, rot, featured }) => {
            const color = featured ? ORANGE : routeColor;
            return (
              <React.Fragment key={flight.id}>
                {segments.map((segment, segmentIndex) => (
                  <Polyline
                    key={`${flight.id}-seg-${segmentIndex}`}
                    positions={segment}
                    pathOptions={{
                      color,
                      weight: FLIGHT_MAP_ROUTE_STROKE,
                      opacity: 0.98,
                      lineCap: 'butt',
                      lineJoin: 'round',
                    }}
                    eventHandlers={{ click: () => goTo(flight.id) }}
                  />
                ))}
                <Marker
                  position={mid}
                  icon={planeIcon(rot, color)}
                  zIndexOffset={400}
                  eventHandlers={{ click: () => goTo(flight.id) }}
                >
                  <Tooltip direction="top" offset={[0, -8]}>
                    {flight.fromAirport ?? '—'} → {flight.toAirport ?? '—'} · {flight.aircraftType ?? ''}
                  </Tooltip>
                </Marker>
              </React.Fragment>
            );
          })}
          {routeAirports.map(([code, { airport, flight }]) => {
            const coordinate = airportMapCoordinate(airport);
            const position: [number, number] = [coordinate.latitude, coordinate.longitude];
            return (
              <React.Fragment key={code}>
                <Marker
                  position={position}
                  icon={airportDotIcon(routeColor, halo)}
                  zIndexOffset={500}
                  eventHandlers={{ click: () => goTo(flight.id) }}
                />
                <Marker
                  position={position}
                  icon={airportLabelIcon(code, labelColor, halo)}
                  zIndexOffset={510}
                  eventHandlers={{ click: () => goTo(flight.id) }}
                >
                  <Tooltip direction="top" offset={[0, -8]}>
                    {airport.name}
                    {airport.city ? ` · ${airport.city}` : ''}
                    {airport.tz ? ` · ${airport.tz}` : ''}
                  </Tooltip>
                </Marker>
              </React.Fragment>
            );
          })}
          {SHOW_ROUTE_ENDPOINT_DIAGNOSTICS && routes.map(({ flight, origin, destination }) => (
            <React.Fragment key={`diag-${flight.id}`}>
              <Marker
                position={[origin.latitude, origin.longitude]}
                icon={endpointDiagIcon()}
                zIndexOffset={900}
              />
              <Marker
                position={[destination.latitude, destination.longitude]}
                icon={endpointDiagIcon()}
                zIndexOffset={900}
              />
            </React.Fragment>
          ))}
        </MapContainer>
      </div>
      <MapChromeControls
        isDark={isDark}
        colors={colors}
        onZoomIn={() => zoomApiRef.current?.zoomIn()}
        onZoomOut={() => zoomApiRef.current?.zoomOut()}
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
  container: {
    height: 420,
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 18,
    overflow: 'hidden',
    position: 'relative',
  },
  placeholder: { alignItems: 'center', gap: 10, paddingVertical: 40 },
  emptyText: { fontSize: 15, fontFamily: 'Inter_400Regular' },
  controls: {
    position: 'absolute',
    top: 10,
    right: 10,
    alignItems: 'flex-end',
    gap: 8,
    zIndex: 1000,
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
    alignItems: 'center', zIndex: 900,
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
