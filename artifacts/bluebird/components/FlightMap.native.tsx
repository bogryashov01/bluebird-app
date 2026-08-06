/**
 * Native map component using react-native-maps.
 * Metro picks this file on iOS/Android; FlightMap.web.tsx is used on web.
 */
import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import type { Flight } from '@workspace/api-client-react';

/** Coordinates for all seeded departure airports */
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

type FlightData = Flight;

interface Props {
  flights: FlightData[];
}

export default function FlightMap({ flights }: Props) {
  const screenHeight = Dimensions.get('window').height;
  const mapHeight = Math.round(screenHeight * 0.55);

  const byAirport = React.useMemo(() => {
    const map: Record<string, FlightData[]> = {};
    for (const f of flights) {
      if (!map[f.fromAirport]) map[f.fromAirport] = [];
      map[f.fromAirport].push(f);
    }
    return map;
  }, [flights]);

  const pins = Object.entries(byAirport).filter(([code]) => AIRPORT_COORDS[code]);

  if (pins.length === 0) {
    return (
      <View style={styles.placeholder}>
        <Feather name="map" size={28} color="rgba(255,255,255,0.35)" />
        <Text style={styles.emptyText}>No flights to display</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { height: mapHeight }]}>
      <MapView
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={{
          latitude: 39.5,
          longitude: -98.35,
          latitudeDelta: 35,
          longitudeDelta: 55,
        }}
      >
        {pins.map(([code, codeFlights]) => {
          const coords = AIRPORT_COORDS[code];
          const first = codeFlights[0];
          return (
            <Marker
              key={code}
              coordinate={{ latitude: coords.latitude, longitude: coords.longitude }}
              title={`${code} — ${coords.label}`}
              description={`${codeFlights.length} flight${codeFlights.length > 1 ? 's' : ''} departing`}
              onPress={() => router.push(`/flight/${first.id}`)}
            />
          );
        })}
      </MapView>
      <View style={styles.legend}>
        <Text style={styles.legendText}>Tap a pin to view flight details</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginHorizontal: 20, marginBottom: 20, borderRadius: 18, overflow: 'hidden' },
  map: { flex: 1 },
  placeholder: { alignItems: 'center', gap: 10, paddingVertical: 40 },
  emptyText: { fontSize: 15, color: 'rgba(255,255,255,0.5)', fontFamily: 'Inter_400Regular' },
  legend: {
    position: 'absolute', bottom: 8, left: 0, right: 0,
    alignItems: 'center',
  },
  legendText: {
    fontSize: 12, color: 'rgba(0,0,0,0.5)',
    backgroundColor: 'rgba(255,255,255,0.85)',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
    fontFamily: 'Inter_400Regular',
  },
});
