/**
 * Web-only map component using react-leaflet + OpenStreetMap tiles.
 * Metro's platform-suffix resolution picks this file on web,
 * so react-native-maps never gets bundled for web.
 */
import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { Flight } from '@workspace/api-client-react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';

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

// Fix default Leaflet marker icon paths (broken in bundlers)
function useLeafletIconFix() {
  useEffect(() => {
    // @ts-ignore
    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    });
  }, []);
}

/** Coordinates for all seeded departure airports */
const AIRPORT_COORDS: Record<string, { lat: number; lng: number; label: string }> = {
  LAX: { lat: 33.9425, lng: -118.4081, label: 'Los Angeles' },
  SFO: { lat: 37.6213, lng: -122.3790, label: 'San Francisco' },
  JFK: { lat: 40.6413, lng:  -73.7781, label: 'New York JFK' },
  MIA: { lat: 25.7959, lng:  -80.2870, label: 'Miami' },
  ORD: { lat: 41.9742, lng:  -87.9073, label: 'Chicago' },
  DAL: { lat: 32.8481, lng:  -96.8518, label: 'Dallas' },
  LAS: { lat: 36.0840, lng: -115.1537, label: 'Las Vegas' },
  BOS: { lat: 42.3656, lng:  -71.0096, label: 'Boston' },
  SEA: { lat: 47.4502, lng: -122.3088, label: 'Seattle' },
  DEN: { lat: 39.8561, lng: -104.6737, label: 'Denver' },
  ASP: { lat: 39.2232, lng: -106.8690, label: 'Aspen' },
  TEB: { lat: 40.8501, lng:  -74.0608, label: 'Teterboro' },
};

type FlightData = Flight;

interface Props {
  flights: FlightData[];
}

export default function FlightMap({ flights }: Props) {
  useLeafletCss();
  useLeafletIconFix();

  // Group flights by departure airport
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
    <View style={styles.container}>
      {/* MapContainer must be inside a div with an explicit height for Leaflet to render */}
      <div style={{ width: '100%', height: '100%', borderRadius: 18, overflow: 'hidden' }}>
        <MapContainer
          center={[39.5, -98.35]}
          zoom={4}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {pins.map(([code, codeFlights]) => {
            const coords = AIRPORT_COORDS[code];
            const first = codeFlights[0];
            return (
              <Marker key={code} position={[coords.lat, coords.lng]}>
                <Popup>
                  <div style={{ fontFamily: 'sans-serif', minWidth: 140 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
                      {code} · {coords.label}
                    </div>
                    <div style={{ color: '#555', fontSize: 12, marginBottom: 8 }}>
                      {codeFlights.length} flight{codeFlights.length > 1 ? 's' : ''} departing
                    </div>
                    <button
                      onClick={() => router.push(`/flight/${first.id}`)}
                      style={{
                        background: '#1259F2', color: '#fff', border: 'none',
                        borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      View flight →
                    </button>
                    {codeFlights.length > 1 && (
                      <div style={{ marginTop: 6, fontSize: 11, color: '#888' }}>
                        (showing first of {codeFlights.length} flights)
                      </div>
                    )}
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>
      <View style={styles.legend}>
        <Text style={styles.legendText}>Tap a pin to view flight details</Text>
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
  emptyText: { fontSize: 15, color: 'rgba(255,255,255,0.5)', fontFamily: 'Inter_400Regular' },
  legend: {
    position: 'absolute', bottom: 8, left: 0, right: 0,
    alignItems: 'center', zIndex: 1000,
  },
  legendText: {
    fontSize: 12, color: 'rgba(0,0,0,0.6)',
    backgroundColor: 'rgba(255,255,255,0.9)',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
    fontFamily: 'Inter_400Regular',
  },
});
