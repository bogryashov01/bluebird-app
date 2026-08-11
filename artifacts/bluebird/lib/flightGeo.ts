/**
 * Shared flight-map geometry: airport coordinates plus arc/bearing math.
 * Imported by both FlightMap.web.tsx and FlightMap.native.tsx so a new
 * airport added here renders on both platforms.
 */

export type LatLng = { latitude: number; longitude: number };

export interface Airport extends LatLng {
  label: string;
}

/** Coordinates for all seeded airports (origins and destinations) */
export const AIRPORT_COORDS: Record<string, Airport> = {
  LAX: { latitude: 33.9425, longitude: -118.4081, label: 'Los Angeles' },
  SFO: { latitude: 37.6213, longitude: -122.3790, label: 'San Francisco' },
  JFK: { latitude: 40.6413, longitude: -73.7781, label: 'New York JFK' },
  MIA: { latitude: 25.7959, longitude: -80.2870, label: 'Miami' },
  ORD: { latitude: 41.9742, longitude: -87.9073, label: 'Chicago' },
  DAL: { latitude: 32.8481, longitude: -96.8518, label: 'Dallas' },
  LAS: { latitude: 36.0840, longitude: -115.1537, label: 'Las Vegas' },
  BOS: { latitude: 42.3656, longitude: -71.0096, label: 'Boston' },
  SEA: { latitude: 47.4502, longitude: -122.3088, label: 'Seattle' },
  DEN: { latitude: 39.8561, longitude: -104.6737, label: 'Denver' },
  ASP: { latitude: 39.2232, longitude: -106.8690, label: 'Aspen' },
  TEB: { latitude: 40.8501, longitude: -74.0608, label: 'Teterboro' },
  SDL: { latitude: 33.6229, longitude: -111.9105, label: 'Scottsdale' },
  PBI: { latitude: 26.6832, longitude: -80.0956, label: 'Palm Beach' },
  NAS: { latitude: 25.0390, longitude: -77.4662, label: 'Nassau' },
  YYZ: { latitude: 43.6777, longitude: -79.6248, label: 'Toronto' },
};

/** Quadratic-bezier arc between two points, bowed perpendicular to the route. */
export function arcPoints(from: LatLng, to: LatLng, segments = 48): LatLng[] {
  const mLat = (from.latitude + to.latitude) / 2;
  const mLng = (from.longitude + to.longitude) / 2;
  // Perpendicular offset scaled to route length, corrected for longitude compression
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
export function bearing(p1: LatLng, p2: LatLng): number {
  const cosLat = Math.cos((((p1.latitude + p2.latitude) / 2) * Math.PI) / 180);
  const dx = (p2.longitude - p1.longitude) * cosLat;
  const dy = p2.latitude - p1.latitude;
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}
