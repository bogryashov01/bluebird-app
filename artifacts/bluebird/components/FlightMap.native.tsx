/**
 * Native map component using react-native-maps.
 * Metro picks this file on iOS/Android; FlightMap.web.tsx is used on web.
 *
 * Renders each flight as a curved navy arc from origin to destination,
 * with a small airplane icon along the route and airport-code labels
 * at the endpoints. Featured flights render in orange.
 */
import React from 'react';
import { View, Text, StyleSheet, Dimensions, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import type { Flight } from '@workspace/api-client-react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';

/** Coordinates for all seeded airports (origins and destinations) */
const AIRPORT_COORDS: Record<string, { latitude: number; longitude: number; label: string }> = {
  LAX: { latitude: 33.9425, longitude: -118.4081, label: 'Los Angeles' },
  SFO: { latitude: 37.6213, longitude: -122.3790, label: 'San Francisco' },
  JFK: { latitude: 40.6413, longitude:  -73.7781, label: 'New York JFK' },
  MIA: { latitude: 25.7959, longitude:  -80.2870, label: 'Miami' },
  ORD: { latitude: 41.9742, longitude:  -87.9073, label: 'Chicago' },
  DAL: { latitude: 32.8481, longitude:  -96.8518, label: 'Dallas' },
  LAS: { latitude: 36.0840, longitude: -115.1537, label: 'Las Vegas' },
  BOS: { latitude: 42.3656, longitude:  -71.0096, label: 'Boston' },
  SEA: { latitude: 47.4502, longitude: -122.3088, label: 'Seattle' },
  DEN: { latitude: 39.8561, longitude: -104.6737, label: 'Denver' },
  ASP: { latitude: 39.2232, longitude: -106.8690, label: 'Aspen' },
  TEB: { latitude: 40.8501, longitude:  -74.0608, label: 'Teterboro' },
};

const NAVY = '#1B2A5B';
const ORANGE = '#F5842E';

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
type LatLng = { latitude: number; longitude: number };

interface Props {
  flights: FlightData[];
}

/** Quadratic-bezier arc between two points, bowed perpendicular to the route. */
function arcPoints(from: LatLng, to: LatLng, segments = 48): LatLng[] {
  const mLat = (from.latitude + to.latitude) / 2;
  const mLng = (from.longitude + to.longitude) / 2;
  const cosLat = Math.cos((mLat * Math.PI) / 180);
  const dx = (to.longitude - from.longitude) * cosLat;
  const dy = to.latitude - from.latitude;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const k = 0.18;
  const ctrl = {
    latitude: mLat + (-dx / (dist || 1)) * dist * k,
    longitude: mLng + ((dy / (dist || 1)) * dist * k) / (cosLat || 1),
  };
  const pts: LatLng[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    pts.push({
      latitude: a * from.latitude + b * ctrl.latitude + c * to.latitude,
      longitude: a * from.longitude + b * ctrl.longitude + c * to.longitude,
    });
  }
  return pts;
}

/** Bearing (degrees, 0 = north, clockwise) between two points, in screen space. */
function bearing(p1: LatLng, p2: LatLng): number {
  const cosLat = Math.cos((((p1.latitude + p2.latitude) / 2) * Math.PI) / 180);
  const dx = (p2.longitude - p1.longitude) * cosLat;
  const dy = p2.latitude - p1.latitude;
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

export default function FlightMap({ flights }: Props) {
  const { height: screenHeight } = useWindowDimensions();
  const mapHeight = Math.round(screenHeight * 0.55);

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
            color: f.featured ? ORANGE : NAVY,
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
        <Feather name="map" size={28} color="rgba(255,255,255,0.35)" />
        <Text style={styles.emptyText}>No flights to display</Text>
      </View>
    );
  }

  const goTo = (id: string) => router.push(`/flight/${id}`);

  return (
    <View style={[styles.container, { height: mapHeight }]}>
      <MapView
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        customMapStyle={LIGHT_MAP_STYLE}
        mapType={Platform.OS === 'ios' ? 'mutedStandard' : 'standard'}
        userInterfaceStyle="light"
        initialRegion={{
          latitude: 39.5,
          longitude: -98.35,
          latitudeDelta: 35,
          longitudeDelta: 55,
        }}
      >
        {routes.map(({ flight, pts, mid, rot, color }) => (
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
        ))}
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
                <View style={styles.airportDot} />
                <Text style={styles.airportCode}>{code}</Text>
              </View>
            </Marker>
          );
        })}
      </MapView>
      <View style={styles.legend}>
        <View style={styles.legendPill}>
          <View style={[styles.legendSwatch, { backgroundColor: NAVY }]} />
          <Text style={styles.legendText}>Available</Text>
          <View style={[styles.legendSwatch, { backgroundColor: ORANGE, marginLeft: 10 }]} />
          <Text style={styles.legendText}>Featured</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginHorizontal: 20, marginBottom: 20, borderRadius: 18, overflow: 'hidden' },
  map: { flex: 1 },
  placeholder: { alignItems: 'center', gap: 10, paddingVertical: 40 },
  emptyText: { fontSize: 15, color: 'rgba(255,255,255,0.5)', fontFamily: 'Inter_400Regular' },
  airportMarker: { alignItems: 'center' },
  airportDot: {
    width: 7, height: 7, borderRadius: 999,
    backgroundColor: NAVY, borderWidth: 1.5, borderColor: '#fff',
  },
  airportCode: {
    fontSize: 10, fontFamily: 'Inter_700Bold', color: NAVY,
    letterSpacing: 0.3, marginTop: 1,
    textShadowColor: '#fff', textShadowRadius: 2,
  },
  legend: {
    position: 'absolute', bottom: 8, left: 0, right: 0,
    alignItems: 'center',
  },
  legendPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999,
  },
  legendSwatch: { width: 14, height: 3, borderRadius: 2 },
  legendText: {
    fontSize: 12, color: 'rgba(0,0,0,0.65)',
    fontFamily: 'Inter_400Regular',
  },
});
