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
import type { Flight } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { AIRPORT_COORDS, arcPoints, bearing, type LatLng } from '@/lib/flightGeo';

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

type FlightData = Flight;

interface Props {
  flights: FlightData[];
}

export default function FlightMap({ flights }: Props) {
  const colors = useColors();
  const { height: screenHeight } = useWindowDimensions();
  const mapHeight = Math.round(screenHeight * 0.55);

  const isDark = colors.scheme === 'dark';
  const routeColor = isDark ? colors.paleBlue : NAVY;      // brand blue, lightened for dark tiles
  const labelColor = isDark ? colors.paleBlueFaint : NAVY;
  const halo       = isDark ? colors.backgroundMid : '#fff'; // halo matches map tiles, not theme surfaces

  const routes = React.useMemo(
    () =>
      flights
        .filter((f) => AIRPORT_COORDS[f.fromAirport] && AIRPORT_COORDS[f.toAirport])
        .map((f) => {
          const from = AIRPORT_COORDS[f.fromAirport];
          const to = AIRPORT_COORDS[f.toAirport];
          const pts = arcPoints(from, to);
          const midIdx = Math.floor(pts.length / 2);
          return {
            flight: f,
            pts,
            mid: pts[midIdx],
            rot: bearing(pts[midIdx - 2], pts[midIdx + 2]),
            featured: !!f.featured,
          };
        }),
    [flights],
  );

  const airports = React.useMemo(() => {
    const map: Record<string, FlightData> = {};
    for (const { flight } of routes) {
      if (!map[flight.fromAirport]) map[flight.fromAirport] = flight;
      if (!map[flight.toAirport]) map[flight.toAirport] = flight;
    }
    return Object.entries(map);
  }, [routes]);

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
        {airports.map(([code, flight]) => {
          const c = AIRPORT_COORDS[code];
          return (
            <Marker
              key={code}
              coordinate={{ latitude: c.latitude, longitude: c.longitude }}
              anchor={{ x: 0.5, y: 0.35 }}
              tracksViewChanges={false}
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
          <Text style={[styles.legendText, { color: colors.mutedForeground }]}>Available</Text>
          <View style={[styles.legendSwatch, { backgroundColor: ORANGE, marginLeft: 10 }]} />
          <Text style={[styles.legendText, { color: colors.mutedForeground }]}>Featured</Text>
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
