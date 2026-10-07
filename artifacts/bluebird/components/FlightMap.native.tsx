/**
 * Native map component using react-native-maps.
 * Metro picks this file on iOS/Android; FlightMap.web.tsx is used on web.
 *
 * Renders each flight as a curved navy arc from origin to destination,
 * with a small airplane icon along the route and airport-code labels
 * at the endpoints. Featured flights render in orange.
 */
import React from 'react';
import { View, Text, StyleSheet, Dimensions, Platform, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { useColors } from '@/hooks/useColors';
import { arcPoints, bearing, type LatLng } from '@/lib/flightGeo';
import type { AirportRecord, FlightView } from '@/lib/productionFlights';

const NAVY = '#1B2A5B';
const ORANGE = '#F5842E';

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
}

export default function FlightMap({ flights, airports }: Props) {
  const colors = useColors();
  const { height: screenHeight } = useWindowDimensions();
  const mapHeight = Math.round(screenHeight * 0.55);

  const isDark = colors.scheme === 'dark';
  const routeColor = isDark ? colors.paleBlue : NAVY;      // brand blue, lightened for dark tiles
  const labelColor = isDark ? colors.paleBlueFaint : NAVY;
  const halo       = isDark ? colors.backgroundMid : '#fff'; // halo matches map tiles, not theme surfaces
  const mapRef = React.useRef<MapView | null>(null);

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
      if (!from || !to) return [];
      const pts = arcPoints(from, to);
      const midIdx = Math.floor(pts.length / 2);
      return [{
        flight,
        fromCode,
        toCode,
        pts,
        mid: pts[midIdx],
        rot: bearing(pts[midIdx - 2], pts[midIdx + 2]),
        featured: flight.featured,
      }];
    }),
    [flights, airportsByCode],
  );

  const routeAirports = React.useMemo(() => {
    const touched = new Map<string, { airport: AirportRecord; flight: FlightView }>();
    for (const { flight, fromCode, toCode } of routes) {
      const from = airportsByCode.get(fromCode);
      const to = airportsByCode.get(toCode);
      if (from && !touched.has(fromCode)) touched.set(fromCode, { airport: from, flight });
      if (to && !touched.has(toCode)) touched.set(toCode, { airport: to, flight });
    }
    return [...touched.entries()];
  }, [routes, airportsByCode]);
  const routeCoordinates = React.useMemo(
    () => routeAirports.map(([, { airport }]) => ({
      latitude: airport.latitude,
      longitude: airport.longitude,
    })),
    [routeAirports],
  );
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || routeCoordinates.length === 0) return;
    if (routeCoordinates.length === 1) {
      const [coordinate] = routeCoordinates;
      map.animateToRegion({
        ...coordinate,
        latitudeDelta: 4,
        longitudeDelta: 4,
      }, 0);
      return;
    }
    map.fitToCoordinates(routeCoordinates, {
      edgePadding: { top: 28, right: 28, bottom: 54, left: 28 },
      animated: false,
    });
  }, [routeCoordinates]);
  const productionRoutes = routes.some(({ flight }) => flight.source === 'production');
  const availableLocalRoutes = routes.some(({ flight }) => flight.status === 'available');
  const featuredRoutes = routes.some(({ featured }) => featured);

  if (routes.length === 0) {
    return (
      <View style={styles.placeholder}>
        <Feather name="map" size={28} color={colors.mutedForeground} />
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No flights to display</Text>
      </View>
    );
  }

  const goTo = (id: string) => router.push(`/flight/${id}`);

  return (
    <View style={[styles.container, { height: mapHeight }]}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        customMapStyle={isDark ? DARK_MAP_STYLE : LIGHT_MAP_STYLE}
        mapType={Platform.OS === 'ios' ? 'mutedStandard' : 'standard'}
        userInterfaceStyle={isDark ? 'dark' : 'light'}
        initialRegion={{
          latitude: 39.5,
          longitude: -98.35,
          latitudeDelta: 35,
          longitudeDelta: 55,
        }}
      >
        {routes.map(({ flight, pts, mid, rot, featured }) => {
          const color = featured ? ORANGE : routeColor;
          return (
          <React.Fragment key={flight.id}>
            <Polyline
              coordinates={pts}
              strokeColor={color}
              strokeWidth={2}
              tappable
              onPress={() => goTo(flight.id)}
            />
            <Marker
              coordinate={mid}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
              onPress={() => goTo(flight.id)}
            >
              <View style={{ transform: [{ rotate: `${rot - 45}deg` }] }}>
                <Feather name="send" size={15} color={color} />
              </View>
            </Marker>
          </React.Fragment>
          );
        })}
        {routeAirports.map(([code, { airport, flight }]) => {
          return (
            <Marker
              key={code}
              coordinate={{ latitude: airport.latitude, longitude: airport.longitude }}
              anchor={{ x: 0.5, y: 0.35 }}
              tracksViewChanges={false}
              title={airport.name}
              description={[
                airport.city,
                airport.tz ? `Time zone: ${airport.tz}` : null,
              ].filter(Boolean).join(' · ')}
              onPress={() => goTo(flight.id)}
            >
              <View style={styles.airportMarker}>
                <View style={[styles.airportDot, { backgroundColor: routeColor, borderColor: halo }]} />
                <Text style={[styles.airportCode, { color: labelColor, textShadowColor: halo }]}>{code}</Text>
              </View>
            </Marker>
          );
        })}
      </MapView>
      <View style={styles.legend}>
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
  airportMarker: { alignItems: 'center' },
  airportDot: {
    width: 7, height: 7, borderRadius: 999,
    borderWidth: 1.5,
  },
  airportCode: {
    fontSize: 10, fontFamily: 'Inter_700Bold',
    letterSpacing: 0.3, marginTop: 1,
    textShadowRadius: 2,
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
