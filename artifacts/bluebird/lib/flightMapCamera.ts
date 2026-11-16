import type { LatLng } from './flightGeo';

/** Thin primary route stroke — single layer, no underlay overshoot. */
export const FLIGHT_MAP_ROUTE_STROKE = 2.25;

/** Fallback padding when map size is unknown. */
export const FLIGHT_MAP_FIT_PADDING = {
  top: 44,
  right: 64,
  bottom: 72,
  left: 40,
} as const;

export const FLIGHT_MAP_MIN_LATITUDE_DELTA = 0.04;
export const FLIGHT_MAP_MAX_LATITUDE_DELTA = 80;
export const FLIGHT_MAP_ZOOM_IN_FACTOR = 0.55;
export const FLIGHT_MAP_ZOOM_OUT_FACTOR = 1.8;

export type FlightMapEdgePadding = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

/**
 * Camera padding that keeps endpoints clear of chrome (+/−, Reset, legend)
 * and respects the visible map frame.
 */
export function flightMapFitEdgePadding(input: {
  mapWidth: number;
  mapHeight: number;
  topInset?: number;
}): FlightMapEdgePadding {
  const width = Number.isFinite(input.mapWidth) && input.mapWidth > 0 ? input.mapWidth : 320;
  const height = Number.isFinite(input.mapHeight) && input.mapHeight > 0 ? input.mapHeight : 280;
  const topInset = Math.max(0, input.topInset ?? 0);
  return {
    top: Math.max(44, Math.round(height * 0.1) + Math.min(topInset, 24)),
    right: Math.max(64, Math.round(width * 0.16)),
    bottom: Math.max(72, Math.round(height * 0.14)),
    left: Math.max(40, Math.round(width * 0.1)),
  };
}

export type FlightMapRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

export function isValidMapCoordinate(
  value: { latitude?: unknown; longitude?: unknown } | null | undefined,
): value is LatLng {
  if (!value) return false;
  const { latitude, longitude } = value;
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}

/**
 * Canonical map coordinate for an airport marker AND its route endpoint.
 * Callers must use this for both so the polyline terminates on the marker center.
 */
export function airportMapCoordinate(
  airport: { latitude: number; longitude: number },
): LatLng {
  return { latitude: airport.latitude, longitude: airport.longitude };
}

export function coordinatesEqual(
  a: LatLng,
  b: LatLng,
  epsilon = 1e-12,
): boolean {
  return Math.abs(a.latitude - b.latitude) <= epsilon &&
    Math.abs(a.longitude - b.longitude) <= epsilon;
}

/**
 * Route segment endpoints must equal the airport marker coordinates exactly.
 * Native markers must pin the geographic point to the blue-dot center
 * (anchor 0.5/0.5 on the dot alone) — not a composite label view.
 */
export function routeEndpointsMatchAirports(input: {
  origin: LatLng;
  destination: LatLng;
  segmentStart: LatLng;
  segmentEnd: LatLng;
  originAirport: { latitude: number; longitude: number };
  destinationAirport: { latitude: number; longitude: number };
}): boolean {
  const originMarker = airportMapCoordinate(input.originAirport);
  const destinationMarker = airportMapCoordinate(input.destinationAirport);
  return (
    coordinatesEqual(input.origin, originMarker) &&
    coordinatesEqual(input.destination, destinationMarker) &&
    coordinatesEqual(input.segmentStart, originMarker) &&
    coordinatesEqual(input.segmentEnd, destinationMarker)
  );
}

/** Native: geographic point is the center of the airport blue dot. */
export const AIRPORT_DOT_MARKER_ANCHOR = { x: 0.5, y: 0.5 } as const;

/**
 * Stable identity for the set of renderable routes. Camera auto-fit runs only
 * when this changes (or when the member presses Reset).
 */
export function flightMapSelectionKey(
  routes: ReadonlyArray<{ flightId: string; fromCode: string; toCode: string }>,
): string {
  if (routes.length === 0) return '';
  return routes
    .map((route) => `${route.flightId}:${route.fromCode}->${route.toCode}`)
    .sort()
    .join('|');
}

export function shouldRefitFlightMapCamera(input: {
  selectionKey: string;
  lastFittedSelectionKey: string | null;
  resetToken: number;
  lastFittedResetToken: number;
}): boolean {
  if (!input.selectionKey) return false;
  if (input.resetToken !== input.lastFittedResetToken) return true;
  return input.selectionKey !== input.lastFittedSelectionKey;
}

/**
 * Points used to frame the route: endpoints plus evenly spaced arc samples so
 * the bowed path and both airports stay inside the viewport.
 */
export function collectFlightMapFitCoordinates(
  routes: ReadonlyArray<{ points: readonly LatLng[] }>,
): LatLng[] {
  const out: LatLng[] = [];
  for (const route of routes) {
    const pts = route.points;
    if (!Array.isArray(pts) || pts.length === 0) continue;
    const last = pts.length - 1;
    const steps = Math.min(8, last);
    for (let step = 0; step <= steps; step++) {
      const index = steps === 0 ? 0 : Math.round((step / steps) * last);
      const point = pts[index];
      if (isValidMapCoordinate(point)) out.push(point);
    }
  }
  return out;
}

export function clampMapLatitudeDelta(delta: number): number {
  if (!Number.isFinite(delta)) return FLIGHT_MAP_MAX_LATITUDE_DELTA;
  return Math.min(
    FLIGHT_MAP_MAX_LATITUDE_DELTA,
    Math.max(FLIGHT_MAP_MIN_LATITUDE_DELTA, delta),
  );
}

/** Pure region zoom used by +/- controls (no animation). */
export function zoomFlightMapRegion(
  region: FlightMapRegion,
  direction: 'in' | 'out',
): FlightMapRegion {
  const factor = direction === 'in' ? FLIGHT_MAP_ZOOM_IN_FACTOR : FLIGHT_MAP_ZOOM_OUT_FACTOR;
  const latitudeDelta = clampMapLatitudeDelta(region.latitudeDelta * factor);
  const aspect =
    region.latitudeDelta > 0 ? region.longitudeDelta / region.latitudeDelta : 1;
  return {
    latitude: region.latitude,
    longitude: region.longitude,
    latitudeDelta,
    longitudeDelta: clampMapLatitudeDelta(latitudeDelta * (Number.isFinite(aspect) ? aspect : 1)),
  };
}

export type FlightMapCameraDecision =
  | { action: 'none' }
  | { action: 'fit'; selectionKey: string; resetToken: number };

export function planFlightMapCameraUpdate(input: {
  selectionKey: string;
  lastFittedSelectionKey: string | null;
  resetToken: number;
  lastFittedResetToken: number;
  fitCoordinateCount: number;
}): FlightMapCameraDecision {
  if (input.fitCoordinateCount === 0) return { action: 'none' };
  if (
    !shouldRefitFlightMapCamera({
      selectionKey: input.selectionKey,
      lastFittedSelectionKey: input.lastFittedSelectionKey,
      resetToken: input.resetToken,
      lastFittedResetToken: input.lastFittedResetToken,
    })
  ) {
    return { action: 'none' };
  }
  return {
    action: 'fit',
    selectionKey: input.selectionKey,
    resetToken: input.resetToken,
  };
}

export interface FlightMapGestureTracker {
  touchStart: () => void;
  panDrag: () => void;
  touchEnd: () => void;
  isActive: () => boolean;
}

/**
 * Tracks whether a finger is on the native map so the parent page can pause
 * scrolling. Touch start/end are balanced per finger; `onPanDrag` fires many
 * times per gesture and must only mark the gesture active, never stack depth.
 */
export function createFlightMapGestureTracker(
  notify: (active: boolean) => void,
): FlightMapGestureTracker {
  let depth = 0;
  return {
    touchStart: () => {
      depth += 1;
      if (depth === 1) notify(true);
    },
    panDrag: () => {
      if (depth > 0) return;
      depth = 1;
      notify(true);
    },
    touchEnd: () => {
      if (depth === 0) return;
      depth -= 1;
      if (depth === 0) notify(false);
    },
    isActive: () => depth > 0,
  };
}
