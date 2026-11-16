/**
 * Shared flight-map geometry: airport coordinates plus arc/bearing math.
 * Imported by both FlightMap.web.tsx and FlightMap.native.tsx so a new
 * airport added here renders on both platforms.
 *
 * Every route starts at the exact origin airport LatLng and ends at the exact
 * destination airport LatLng (same coordinate source as markers). The curve is
 * a short-path bow that never extrapolates past those endpoints. Date-line
 * crossings are split into continuous segments for the map libraries.
 */

export type LatLng = { latitude: number; longitude: number };

export interface Airport extends LatLng {
  label: string;
}

/** Soft bow of the route relative to chord length (kept subtle). */
export const FLIGHT_ROUTE_ARC_BOW = 0.16;

/** Copy airport coordinates without inheriting extra record fields. */
export function copyLatLng(point: LatLng): LatLng {
  return { latitude: point.latitude, longitude: point.longitude };
}

/**
 * Shortest signed longitude delta in (-180, 180].
 * Keeps Pacific / date-line routes on the continuous short path.
 */
export function normalizeLongitudeDelta(fromLng: number, toLng: number): number {
  let delta = toLng - fromLng;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
}

/** Normalize a longitude into (-180, 180] for marker placement. */
export function normalizeLongitude(longitude: number): number {
  let lng = longitude;
  while (lng > 180) lng -= 360;
  while (lng <= -180) lng += 360;
  return lng;
}

/** Destination longitude unwrapped relative to origin for continuous short-path math. */
export function unwrapDestination(from: LatLng, to: LatLng): LatLng {
  return {
    latitude: to.latitude,
    longitude: from.longitude + normalizeLongitudeDelta(from.longitude, to.longitude),
  };
}

export function routeCrossesAntimeridian(from: LatLng, to: LatLng): boolean {
  return Math.abs(unwrapDestination(from, to).longitude - to.longitude) > 1e-9;
}

/** Approximate planar distance in degree-space (longitude scaled by cos(midLat)). */
export function approximateRouteSpanDegrees(from: LatLng, to: LatLng): number {
  const dest = unwrapDestination(from, to);
  const midLat = (from.latitude + dest.latitude) / 2;
  const cosLat = Math.cos((midLat * Math.PI) / 180);
  const dx = (dest.longitude - from.longitude) * (cosLat || 1e-6);
  const dy = dest.latitude - from.latitude;
  return Math.sqrt(dx * dx + dy * dy);
}

/** More segments on long hauls; enough samples on short hops for a smooth stroke. */
export function routeSegmentCount(from: LatLng, to: LatLng): number {
  const span = approximateRouteSpanDegrees(from, to);
  if (span < 1.5) return 24;
  if (span < 12) return 48;
  if (span < 35) return 72;
  return 96;
}

function sameLatLng(a: LatLng, b: LatLng, epsilon = 1e-9): boolean {
  return Math.abs(a.latitude - b.latitude) <= epsilon &&
    Math.abs(a.longitude - b.longitude) <= epsilon;
}

/**
 * Build bowed samples in unwrapped short-path space.
 * Index 0 is always `from`. The final sample uses the unwrapped destination
 * longitude so the path stays continuous for splitting; callers pin the
 * rendered last point to the canonical airport coordinate.
 */
function bowedSamplesUnwrapped(from: LatLng, to: LatLng, segments: number): LatLng[] {
  const origin = copyLatLng(from);
  const dest = unwrapDestination(origin, to);
  if (sameLatLng(origin, dest)) {
    return [origin, copyLatLng(dest)];
  }

  const mLat = (origin.latitude + dest.latitude) / 2;
  const mLng = (origin.longitude + dest.longitude) / 2;
  const cosLat = Math.cos((mLat * Math.PI) / 180);
  const safeCos = cosLat === 0 ? 1e-6 : cosLat;
  const dx = (dest.longitude - origin.longitude) * safeCos;
  const dy = dest.latitude - origin.latitude;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1e-6;
  const k = FLIGHT_ROUTE_ARC_BOW;
  // Perpendicular offset of the chord midpoint — stays within the endpoint span.
  const ctrl = {
    latitude: mLat + (-dx / dist) * dist * k,
    longitude: mLng + ((dy / dist) * dist * k) / safeCos,
  };

  const count = Math.max(2, Math.floor(segments));
  const pts: LatLng[] = new Array(count + 1);
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    pts[i] = {
      latitude: a * origin.latitude + b * ctrl.latitude + c * dest.latitude,
      longitude: a * origin.longitude + b * ctrl.longitude + c * dest.longitude,
    };
  }
  pts[0] = origin;
  pts[count] = dest;
  return pts;
}

/** Shift a continuous unwrapped segment so longitudes sit near [-180, 180]. */
function shiftSegmentToDisplayRange(segment: readonly LatLng[]): LatLng[] {
  if (segment.length === 0) return [];
  let shift = 0;
  const first = segment[0].longitude;
  while (first + shift > 180) shift -= 360;
  while (first + shift <= -180) shift += 360;
  return segment.map((point) => ({
    latitude: point.latitude,
    longitude: point.longitude + shift,
  }));
}

/**
 * Split a continuous unwrapped polyline at the antimeridian.
 * Does not invent geometry beyond the first/last samples.
 */
export function splitRouteAtAntimeridian(points: readonly LatLng[]): LatLng[][] {
  if (points.length === 0) return [];
  if (points.length === 1) return [shiftSegmentToDisplayRange([points[0]])];

  const rawSegments: LatLng[][] = [];
  let current: LatLng[] = [copyLatLng(points[0])];

  for (let i = 1; i < points.length; i++) {
    const prev = current[current.length - 1];
    const next = copyLatLng(points[i]);
    const prevBand = Math.floor((prev.longitude + 180) / 360);
    const nextBand = Math.floor((next.longitude + 180) / 360);

    if (prevBand === nextBand) {
      current.push(next);
      continue;
    }

    const goingEast = next.longitude > prev.longitude;
    const seamUnwrapped = goingEast
      ? (prevBand + 1) * 360 - 180
      : prevBand * 360 - 180;
    const span = next.longitude - prev.longitude;
    const t = Math.abs(span) < 1e-12 ? 1 : (seamUnwrapped - prev.longitude) / span;
    const clampedT = Math.min(1, Math.max(0, t));
    const seamLat = prev.latitude + (next.latitude - prev.latitude) * clampedT;

    current.push({ latitude: seamLat, longitude: seamUnwrapped });
    rawSegments.push(current);

    const resumeLng = goingEast ? seamUnwrapped + 1e-9 : seamUnwrapped - 1e-9;
    current = [
      { latitude: seamLat, longitude: resumeLng },
      next,
    ];
  }
  rawSegments.push(current);

  return rawSegments
    .map(shiftSegmentToDisplayRange)
    .filter((segment) => segment.length >= 2);
}

/**
 * Public arc helper: first point equals `from`, last equals canonical `to`.
 * Intermediate samples follow the short-path bow.
 */
export function arcPoints(from: LatLng, to: LatLng, segments = 48): LatLng[] {
  const origin = copyLatLng(from);
  const destination = copyLatLng(to);
  const unwrapped = bowedSamplesUnwrapped(origin, destination, segments);
  const points = unwrapped.map((point, index) => {
    if (index === 0) return origin;
    if (index === unwrapped.length - 1) return destination;
    return copyLatLng(point);
  });
  return points;
}

/** Bearing (degrees, 0 = north, clockwise) between two points, in screen space. */
export function bearing(p1: LatLng, p2: LatLng): number {
  const cosLat = Math.cos((((p1.latitude + p2.latitude) / 2) * Math.PI) / 180);
  const safeCos = cosLat === 0 ? 1e-6 : cosLat;
  const dx = (p2.longitude - p1.longitude) * safeCos;
  const dy = p2.latitude - p1.latitude;
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

export type FlightRoutePresentation = {
  /** Flattened samples with exact airport endpoints (canonical longitudes). */
  points: LatLng[];
  /** Continuous renderable polylines (split only at the antimeridian). */
  segments: LatLng[][];
  origin: LatLng;
  destination: LatLng;
  midpoint: LatLng;
  /** Heading along the arc at the midpoint, degrees clockwise from north. */
  headingDeg: number;
};

/**
 * One flight route for the Discover map: exact endpoints, smooth short-path
 * curve, antimeridian-safe segments, midpoint plane placement.
 */
export function presentFlightRoute(from: LatLng, to: LatLng): FlightRoutePresentation {
  const origin = copyLatLng(from);
  const destination = copyLatLng(to);
  const count = routeSegmentCount(origin, destination);
  const unwrapped = bowedSamplesUnwrapped(origin, destination, count);

  const midIdx = Math.floor(unwrapped.length / 2);
  const sample = Math.max(1, Math.round(count / 24));
  const behind = Math.max(0, midIdx - sample);
  const ahead = Math.min(unwrapped.length - 1, midIdx + sample);
  const midpoint = {
    latitude: unwrapped[midIdx].latitude,
    longitude: normalizeLongitude(unwrapped[midIdx].longitude),
  };
  const headingDeg = bearing(
    {
      latitude: unwrapped[behind].latitude,
      longitude: normalizeLongitude(unwrapped[behind].longitude),
    },
    {
      latitude: unwrapped[ahead].latitude,
      longitude: normalizeLongitude(unwrapped[ahead].longitude),
    },
  );

  let segments: LatLng[][];
  if (routeCrossesAntimeridian(origin, destination)) {
    segments = splitRouteAtAntimeridian(unwrapped);
  } else {
    const single = unwrapped.map((point, index) => {
      if (index === 0) return origin;
      if (index === unwrapped.length - 1) return destination;
      return copyLatLng(point);
    });
    segments = [single];
  }

  // Exact airport coordinates — same values markers use; no artificial offsets.
  if (segments.length > 0) {
    segments[0][0] = origin;
    const last = segments[segments.length - 1];
    last[last.length - 1] = destination;
  }

  const points = segments.length === 1
    ? segments[0]
    : [
        origin,
        ...unwrapped.slice(1, -1).map((point) => ({
          latitude: point.latitude,
          longitude: normalizeLongitude(point.longitude),
        })),
        destination,
      ];

  return {
    points,
    segments,
    origin,
    destination,
    midpoint,
    headingDeg,
  };
}

/**
 * Rotation applied to a north-up airplane glyph so its nose follows the route.
 * Pass a nonzero glyphOffsetDeg when the asset’s natural nose is not north
 * (e.g. Feather `send` points ~45°).
 */
export function planeIconRotationDeg(headingDeg: number, glyphOffsetDeg = 0): number {
  const raw = headingDeg - glyphOffsetDeg;
  const wrapped = ((raw + 180) % 360 + 360) % 360 - 180;
  return wrapped;
}

/**
 * Projection of each sample onto the unwrapped chord must stay in [0, 1],
 * proving the geometry does not extend past either airport endpoint.
 */
export function routeSamplesStayWithinEndpoints(
  points: readonly LatLng[],
  from: LatLng,
  to: LatLng,
): boolean {
  if (points.length < 2) return false;
  if (!sameLatLng(points[0], from) || !sameLatLng(points[points.length - 1], to)) {
    return false;
  }
  const dest = unwrapDestination(from, to);
  const vx = dest.longitude - from.longitude;
  const vy = dest.latitude - from.latitude;
  const len2 = vx * vx + vy * vy || 1e-12;
  for (const point of points) {
    const lng = from.longitude + normalizeLongitudeDelta(from.longitude, point.longitude);
    // For unwrapped intermediates already outside [-180,180], use as-is when continuous.
    const useLng = Math.abs(point.longitude) > 180 ? point.longitude : lng;
    const wx = useLng - from.longitude;
    const t = (wx * vx + (point.latitude - from.latitude) * vy) / len2;
    if (t < -1e-6 || t > 1 + 1e-6) return false;
  }
  return true;
}
