/**
 * Web-only map component using react-leaflet + CARTO light basemap.
 * Metro's platform-suffix resolution picks this file on web,
 * so react-native-maps never gets bundled for web.
 *
 * Renders each flight as a curved navy arc from origin to destination,
 * with a small airplane icon along the route and airport-code labels
 * at the endpoints. Featured flights render in orange.
 */
import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import type { Flight } from '@workspace/api-client-react';
import { MapContainer, TileLayer, Marker, Polyline, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import { AIRPORT_COORDS, arcPoints, bearing } from '@/lib/flightGeo';

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

const NAVY = '#1B2A5B';
const ORANGE = '#F5842E';

type FlightData = Flight;

interface Props {
  flights: FlightData[];
}

function planeIcon(rotationDeg: number, color: string) {
  return L.divIcon({
    className: '',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `<div style="transform: rotate(${rotationDeg}deg); width:22px; height:22px; display:flex; align-items:center; justify-content:center; cursor:pointer;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="${color}" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 1.5c.6 0 1.2.5 1.2 1.6v6.2l8.3 5v2l-8.3-2.6v5l2.1 1.7v1.8L12 21.3l-3.3.9v-1.8l2.1-1.7v-5L2.5 16.3v-2l8.3-5V3.1c0-1.1.6-1.6 1.2-1.6z"/>
      </svg>
    </div>`,
  });
}

function airportLabelIcon(code: string, color: string, halo: string) {
  return L.divIcon({
    className: '',
    iconSize: [40, 16],
    iconAnchor: [20, -4],
    html: `<div style="display:flex; justify-content:center;">
      <span style="font-family: Inter, sans-serif; font-size: 11px; font-weight: 700; color: ${color}; letter-spacing: 0.3px; text-shadow: 0 0 3px ${halo}, 0 0 3px ${halo}; white-space: nowrap; cursor:pointer;">${code}</span>
    </div>`,
  });
}

function airportDotIcon(fill: string, ring: string) {
  return L.divIcon({
    className: '',
    iconSize: [8, 8],
    iconAnchor: [4, 4],
    html: `<div style="width:7px;height:7px;border-radius:999px;background:${fill};border:1.5px solid ${ring};box-shadow:0 0 2px rgba(0,0,0,0.3);"></div>`,
  });
}

export default function FlightMap({ flights }: Props) {
  const colors = useColors();
  useLeafletCss();

  const isDark = colors.scheme === 'dark';
  const routeColor = isDark ? colors.paleBlue : NAVY;      // brand blue, lightened for dark tiles
  const labelColor = isDark ? colors.paleBlueFaint : NAVY;
  const halo       = isDark ? colors.backgroundMid : '#fff'; // halo matches map tiles, not theme surfaces
  const tileUrl = isDark
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

  // Flights with coordinates for both endpoints
  const routes = React.useMemo(
    () =>
      flights
        .filter((f) => AIRPORT_COORDS[f.fromAirport] && AIRPORT_COORDS[f.toAirport])
        .map((f) => {
          const from = AIRPORT_COORDS[f.fromAirport];
          const to = AIRPORT_COORDS[f.toAirport];
          const arc = arcPoints(from, to);
          const midIdx = Math.floor(arc.length / 2);
          const rot = bearing(arc[midIdx - 2], arc[midIdx + 2]);
          const pts: [number, number][] = arc.map((p) => [p.latitude, p.longitude]);
          return { flight: f, pts, mid: pts[midIdx], rot, featured: !!f.featured };
        }),
    [flights],
  );

  // Unique airports touched by any renderable route, with the first flight for navigation
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
    <View style={styles.container}>
      {/* MapContainer must be inside a div with an explicit height for Leaflet to render */}
      <div style={{ width: '100%', height: '100%', borderRadius: 18, overflow: 'hidden' }}>
        <MapContainer
          center={[39.5, -98.35]}
          zoom={4}
          style={{ height: '100%', width: '100%', background: isDark ? '#0A1128' : '#f6f7f9' }}
          scrollWheelZoom={false}
        >
          {/* Minimal basemap (CARTO Positron / Dark Matter per theme) */}
          <TileLayer
            key={colors.scheme}
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url={tileUrl}
          />
          {routes.map(({ flight, pts, mid, rot, featured }) => {
            const color = featured ? ORANGE : routeColor;
            return (
            <React.Fragment key={flight.id}>
              <Polyline
                positions={pts}
                pathOptions={{ color, weight: 2, opacity: 0.9 }}
                eventHandlers={{ click: () => goTo(flight.id) }}
              />
              <Marker
                position={mid}
                icon={planeIcon(rot, color)}
                eventHandlers={{ click: () => goTo(flight.id) }}
              >
                <Tooltip direction="top" offset={[0, -8]}>
                  {flight.fromAirport} → {flight.toAirport} · {flight.aircraftType}
                </Tooltip>
              </Marker>
            </React.Fragment>
            );
          })}
          {airports.map(([code, flight]) => {
            const c = AIRPORT_COORDS[code];
            return (
              <React.Fragment key={code}>
                <Marker
                  position={[c.latitude, c.longitude]}
                  icon={airportDotIcon(routeColor, halo)}
                  eventHandlers={{ click: () => goTo(flight.id) }}
                />
                <Marker
                  position={[c.latitude, c.longitude]}
                  icon={airportLabelIcon(code, labelColor, halo)}
                  eventHandlers={{ click: () => goTo(flight.id) }}
                />
              </React.Fragment>
            );
          })}
        </MapContainer>
      </div>
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
  legend: {
    position: 'absolute', bottom: 8, left: 0, right: 0,
    alignItems: 'center', zIndex: 1000,
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
