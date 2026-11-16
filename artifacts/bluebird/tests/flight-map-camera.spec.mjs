import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AIRPORT_DOT_MARKER_ANCHOR,
  FLIGHT_MAP_ROUTE_STROKE,
  airportMapCoordinate,
  collectFlightMapFitCoordinates,
  coordinatesEqual,
  createFlightMapGestureTracker,
  flightMapFitEdgePadding,
  flightMapSelectionKey,
  isValidMapCoordinate,
  planFlightMapCameraUpdate,
  routeEndpointsMatchAirports,
  shouldRefitFlightMapCamera,
  zoomFlightMapRegion,
} from "../scripts/.flight-map-camera.test.mjs";
import { presentFlightRoute } from "../scripts/.flight-map-camera-geo.test.mjs";

const projectRoot = resolve(import.meta.dirname, "..");

const dal = { latitude: 32.8471, longitude: -96.8518 };
const sfo = { latitude: 37.6213, longitude: -122.379 };
const invalid = { latitude: Number.NaN, longitude: -10 };

assert.equal(isValidMapCoordinate(dal), true);
assert.equal(isValidMapCoordinate(null), false);
assert.equal(isValidMapCoordinate(invalid), false);
assert.equal(isValidMapCoordinate({ latitude: 91, longitude: 0 }), false);
assert.equal(isValidMapCoordinate({ latitude: 0, longitude: 181 }), false);

const tmeAirport = { latitude: 30.3567, longitude: -95.9689, code: "TME" };
const tmeCoord = airportMapCoordinate(tmeAirport);
assert.deepEqual(tmeCoord, { latitude: 30.3567, longitude: -95.9689 });
assert.equal(coordinatesEqual(tmeCoord, airportMapCoordinate(tmeAirport)), true);
assert.deepEqual(AIRPORT_DOT_MARKER_ANCHOR, { x: 0.5, y: 0.5 });

const tmeRoute = presentFlightRoute(dal, tmeCoord);
assert.ok(routeEndpointsMatchAirports({
  origin: tmeRoute.origin,
  destination: tmeRoute.destination,
  segmentStart: tmeRoute.segments[0][0],
  segmentEnd: tmeRoute.segments[0].at(-1),
  originAirport: dal,
  destinationAirport: tmeAirport,
}));
assert.deepEqual(tmeRoute.points[0], dal);
assert.deepEqual(tmeRoute.points.at(-1), tmeCoord);
assert.equal(tmeRoute.points.length, tmeRoute.segments[0].length);

const keyA = flightMapSelectionKey([
  { flightId: "2", fromCode: "SFO", toCode: "DAL" },
  { flightId: "1", fromCode: "DAL", toCode: "SFO" },
]);
const keyB = flightMapSelectionKey([
  { flightId: "1", fromCode: "DAL", toCode: "SFO" },
  { flightId: "2", fromCode: "SFO", toCode: "DAL" },
]);
assert.equal(keyA, keyB, "selection key is order-independent");
assert.equal(flightMapSelectionKey([]), "");

assert.equal(
  shouldRefitFlightMapCamera({
    selectionKey: keyA,
    lastFittedSelectionKey: null,
    resetToken: 0,
    lastFittedResetToken: 0,
  }),
  true,
  "initial open fits",
);
assert.equal(
  shouldRefitFlightMapCamera({
    selectionKey: keyA,
    lastFittedSelectionKey: keyA,
    resetToken: 0,
    lastFittedResetToken: 0,
  }),
  false,
  "manual pan/zoom must not refit when selection is unchanged",
);
assert.equal(
  shouldRefitFlightMapCamera({
    selectionKey: keyA,
    lastFittedSelectionKey: keyA,
    resetToken: 2,
    lastFittedResetToken: 1,
  }),
  true,
  "Reset route refits",
);
assert.equal(
  shouldRefitFlightMapCamera({
    selectionKey: "1:DAL->LAX",
    lastFittedSelectionKey: keyA,
    resetToken: 1,
    lastFittedResetToken: 1,
  }),
  true,
  "flight switch refits",
);

assert.deepEqual(
  planFlightMapCameraUpdate({
    selectionKey: keyA,
    lastFittedSelectionKey: keyA,
    resetToken: 0,
    lastFittedResetToken: 0,
    fitCoordinateCount: 4,
  }),
  { action: "none" },
);
assert.deepEqual(
  planFlightMapCameraUpdate({
    selectionKey: keyA,
    lastFittedSelectionKey: null,
    resetToken: 0,
    lastFittedResetToken: 0,
    fitCoordinateCount: 4,
  }),
  { action: "fit", selectionKey: keyA, resetToken: 0 },
);
assert.deepEqual(
  planFlightMapCameraUpdate({
    selectionKey: keyA,
    lastFittedSelectionKey: null,
    resetToken: 0,
    lastFittedResetToken: 0,
    fitCoordinateCount: 0,
  }),
  { action: "none" },
  "missing coordinates skip fit",
);

assert.ok(FLIGHT_MAP_ROUTE_STROKE >= 2 && FLIGHT_MAP_ROUTE_STROKE <= 2.5);

const padding = flightMapFitEdgePadding({ mapWidth: 360, mapHeight: 280, topInset: 12 });
assert.ok(padding.right >= 64, "right padding clears zoom chrome");
assert.ok(padding.bottom >= 72, "bottom padding clears legend");
assert.ok(padding.top >= 44);
assert.ok(padding.left >= 40);
const compactPad = flightMapFitEdgePadding({ mapWidth: 200, mapHeight: 160 });
assert.deepEqual(
  { top: compactPad.top >= 44, right: compactPad.right >= 64 },
  { top: true, right: true },
);

const domestic = presentFlightRoute(dal, sfo);
const fitPts = collectFlightMapFitCoordinates([{ points: domestic.points }]);
assert.ok(fitPts.length >= 5, "denser arc samples improve framing");
assert.deepEqual(fitPts[0], domestic.points[0]);
assert.deepEqual(fitPts[fitPts.length - 1], domestic.points[domestic.points.length - 1]);
assert.ok(fitPts.some((p) => p === domestic.midpoint || (
  Math.abs(p.latitude - domestic.midpoint.latitude) < 1e-9 &&
  Math.abs(p.longitude - domestic.midpoint.longitude) < 1e-9
)), "fit sample includes route midpoint");

const region = {
  latitude: 35,
  longitude: -110,
  latitudeDelta: 10,
  longitudeDelta: 12,
};
const zoomedIn = zoomFlightMapRegion(region, "in");
const zoomedOut = zoomFlightMapRegion(region, "out");
assert.ok(zoomedIn.latitudeDelta < region.latitudeDelta);
assert.ok(zoomedOut.latitudeDelta > region.latitudeDelta);
assert.equal(zoomedIn.latitude, region.latitude);
assert.equal(zoomedOut.longitude, region.longitude);

const mapNative = readFileSync(resolve(projectRoot, "components/FlightMap.native.tsx"), "utf8");
const mapWeb = readFileSync(resolve(projectRoot, "components/FlightMap.web.tsx"), "utf8");
const discover = readFileSync(resolve(projectRoot, "app/(tabs)/discover/index.tsx"), "utf8");

assert.match(mapNative, /zoomEnabled/);
assert.match(mapNative, /scrollEnabled/);
assert.match(mapNative, /zoomTapEnabled/);
assert.match(mapNative, /flight-map-zoom-in/);
assert.match(mapNative, /flight-map-zoom-out/);
assert.match(mapNative, /flight-map-reset-route/);
assert.match(mapNative, /planFlightMapCameraUpdate/);
assert.match(mapNative, /onMapGestureActive/);
assert.match(mapNative, /presentFlightRoute/);
assert.match(mapNative, /isValidMapCoordinate/);
assert.match(mapNative, /FLIGHT_MAP_ROUTE_STROKE/);
assert.match(mapNative, /flightMapFitEdgePadding/);
assert.match(mapNative, /planeHalo/);
assert.match(mapNative, /segments\.map/);
assert.match(mapNative, /airportMapCoordinate/);
assert.match(mapNative, /AIRPORT_DOT_MARKER_ANCHOR/);
assert.match(mapNative, /flight-map-airport-dot-/);
assert.doesNotMatch(mapNative, /anchor=\{\{\s*x:\s*0\.5,\s*y:\s*0\.35\s*\}\}/);
assert.match(mapWeb, /flight-map-reset-route/);
assert.match(mapWeb, /planFlightMapCameraUpdate/);
assert.match(mapWeb, /doubleClickZoom/);
assert.match(mapWeb, /touchZoom/);
assert.match(mapWeb, /dragging/);
assert.match(mapWeb, /FLIGHT_MAP_ROUTE_STROKE/);
assert.match(mapWeb, /flightMapFitEdgePadding/);
assert.match(mapWeb, /border-radius:14px;background:#fff/);
assert.match(mapWeb, /route\.segments/);
assert.match(mapWeb, /airportMapCoordinate/);
assert.match(mapWeb, /iconAnchor: \[5, 5\]/);
assert.match(mapWeb, /box-sizing:border-box/);
assert.match(discover, /onMapGestureActive/);
assert.match(discover, /scrollEnabled=\{!\(view === 'map' && mapGestureActive\)\}/);
assert.doesNotMatch(mapNative, /FLIGHT_MAP_ROUTE_UNDERLAY/);
assert.doesNotMatch(mapWeb, /FLIGHT_MAP_ROUTE_UNDERLAY/);
assert.doesNotMatch(mapNative, /ROUTE_STROKE_WIDTH\s*=\s*2\.75/);
assert.doesNotMatch(mapWeb, /ROUTE_STROKE_WEIGHT\s*=\s*2\.75/);
assert.match(mapNative, /EXPO_PUBLIC_FLIGHT_MAP_ENDPOINT_DEBUG/);
assert.match(mapWeb, /EXPO_PUBLIC_FLIGHT_MAP_ENDPOINT_DEBUG/);

// Regression (TF20): repeated onPanDrag events in one gesture must not stack
// depth, or Discover's page scroll stays disabled after the first map pan.
{
  const events = [];
  const tracker = createFlightMapGestureTracker((active) => events.push(active));
  tracker.touchStart();
  for (let i = 0; i < 25; i += 1) tracker.panDrag();
  assert.equal(tracker.isActive(), true);
  tracker.touchEnd();
  assert.equal(tracker.isActive(), false);
  assert.deepEqual(events, [true, false]);

  // A second gesture re-locks and releases page scroll again.
  tracker.touchStart();
  tracker.panDrag();
  tracker.touchEnd();
  assert.deepEqual(events, [true, false, true, false]);

  // Two fingers: release only after both lift; extra end/cancel is a no-op.
  tracker.touchStart();
  tracker.touchStart();
  tracker.panDrag();
  tracker.touchEnd();
  assert.equal(tracker.isActive(), true);
  tracker.touchEnd();
  tracker.touchEnd();
  assert.deepEqual(events, [true, false, true, false, true, false]);

  // Pan without an observed touch start still releases on touch end.
  tracker.panDrag();
  tracker.panDrag();
  tracker.touchEnd();
  assert.equal(tracker.isActive(), false);
  assert.deepEqual(events, [true, false, true, false, true, false, true, false]);
}
assert.match(mapNative, /onPanDrag=\{gestureTracker\.panDrag\}/);
assert.doesNotMatch(mapNative, /onPanDrag=\{\(\) => setGestureActive\(true\)\}/);

console.log("Flight map camera tests passed.");
