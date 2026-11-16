import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  approximateRouteSpanDegrees,
  arcPoints,
  bearing,
  copyLatLng,
  normalizeLongitude,
  normalizeLongitudeDelta,
  planeIconRotationDeg,
  presentFlightRoute,
  routeCrossesAntimeridian,
  routeSamplesStayWithinEndpoints,
  routeSegmentCount,
  splitRouteAtAntimeridian,
  unwrapDestination,
} from "../scripts/.flight-geo.test.mjs";

const projectRoot = resolve(import.meta.dirname, "..");

const dal = { latitude: 32.8471, longitude: -96.8518 };
const sfo = { latitude: 37.6213, longitude: -122.379 };
const hnl = { latitude: 21.3187, longitude: -157.9225 };
const nrt = { latitude: 35.772, longitude: 140.3929 };
const nearby = { latitude: 32.9, longitude: -96.7 };
const lax = { latitude: 33.9425, longitude: -118.408 };

assert.equal(normalizeLongitudeDelta(170, -170), 20);
assert.equal(normalizeLongitudeDelta(-170, 170), -20);
assert.equal(normalizeLongitude(190), -170);
assert.equal(normalizeLongitude(-190), 170);

assert.equal(routeCrossesAntimeridian(dal, sfo), false);
assert.equal(routeCrossesAntimeridian(hnl, nrt), true);

const unwrappedNrt = unwrapDestination(hnl, nrt);
assert.ok(unwrappedNrt.longitude < hnl.longitude, "Pacific leg unwraps westward");
assert.ok(Math.abs(unwrappedNrt.longitude - nrt.longitude) > 1);

const shortSpan = approximateRouteSpanDegrees(dal, nearby);
const longSpan = approximateRouteSpanDegrees(hnl, nrt);
assert.ok(shortSpan < longSpan);
assert.equal(routeSegmentCount(dal, nearby), 24);
assert.ok(routeSegmentCount(hnl, nrt) >= 72);

const domestic = presentFlightRoute(dal, sfo);
assert.deepEqual(domestic.points[0], dal);
assert.deepEqual(domestic.points[domestic.points.length - 1], sfo);
assert.deepEqual(domestic.origin, dal);
assert.deepEqual(domestic.destination, sfo);
assert.deepEqual(domestic.segments[0][0], dal);
assert.deepEqual(
  domestic.segments[0][domestic.segments[0].length - 1],
  sfo,
);
assert.equal(domestic.segments.length, 1);
assert.ok(routeSamplesStayWithinEndpoints(domestic.points, dal, sfo));

// Shared airport: two routes ending/starting at SFO use identical endpoint coords.
const toSfo = presentFlightRoute(dal, sfo);
const fromSfo = presentFlightRoute(sfo, lax);
assert.deepEqual(toSfo.destination, sfo);
assert.deepEqual(fromSfo.origin, sfo);
assert.deepEqual(toSfo.destination, fromSfo.origin);
assert.equal(toSfo.destination.longitude, fromSfo.origin.longitude);
assert.equal(toSfo.destination.latitude, fromSfo.origin.latitude);

assert.ok(domestic.midpoint.longitude < dal.longitude);
assert.ok(domestic.midpoint.longitude > sfo.longitude);
assert.ok(domestic.headingDeg < -20, `westbound heading, got ${domestic.headingDeg}`);
assert.ok(domestic.headingDeg > -120);

const eastbound = presentFlightRoute(sfo, dal);
assert.ok(eastbound.headingDeg > 20);
assert.deepEqual(eastbound.points[0], sfo);
assert.deepEqual(eastbound.points[eastbound.points.length - 1], dal);

const dateLine = presentFlightRoute(hnl, nrt);
assert.deepEqual(dateLine.points[0], hnl);
assert.deepEqual(dateLine.points[dateLine.points.length - 1], nrt);
assert.deepEqual(dateLine.segments[0][0], hnl);
assert.deepEqual(
  dateLine.segments[dateLine.segments.length - 1].at(-1),
  nrt,
);
assert.ok(dateLine.segments.length >= 1);
for (const segment of dateLine.segments) {
  assert.ok(segment.length >= 2);
  for (let i = 1; i < segment.length; i++) {
    assert.ok(
      Math.abs(segment[i].longitude - segment[i - 1].longitude) <= 180 + 1e-6,
      "segment stays continuous without wrapping the long way",
    );
  }
}
assert.ok(Number.isFinite(dateLine.headingDeg));
assert.ok(dateLine.headingDeg < -20);

const short = presentFlightRoute(dal, nearby);
assert.deepEqual(short.points[0], dal);
assert.deepEqual(short.points[short.points.length - 1], nearby);
assert.ok(routeSamplesStayWithinEndpoints(short.points, dal, nearby));

const mirrored = arcPoints(dal, sfo, 48);
assert.deepEqual(mirrored[0], dal);
assert.deepEqual(mirrored[mirrored.length - 1], sfo);
assert.equal(mirrored.length, 49);
assert.ok(routeSamplesStayWithinEndpoints(mirrored, dal, sfo));

const split = splitRouteAtAntimeridian([
  hnl,
  { latitude: 25, longitude: -170 },
  { latitude: 30, longitude: -185 },
  unwrapDestination(hnl, nrt),
]);
assert.ok(split.length >= 1);
assert.ok(split.every((segment) => segment.length >= 2));

assert.deepEqual(copyLatLng(dal), { latitude: dal.latitude, longitude: dal.longitude });
assert.equal(planeIconRotationDeg(90), 90);
assert.equal(planeIconRotationDeg(90, 45), 45);

const north = bearing(
  { latitude: 0, longitude: 0 },
  { latitude: 1, longitude: 0 },
);
assert.ok(Math.abs(north) < 1e-6);

const mapNative = readFileSync(resolve(projectRoot, "components/FlightMap.native.tsx"), "utf8");
const mapWeb = readFileSync(resolve(projectRoot, "components/FlightMap.web.tsx"), "utf8");
assert.match(mapNative, /presentFlightRoute/);
assert.match(mapWeb, /presentFlightRoute/);
assert.match(mapNative, /route\.segments/);
assert.match(mapWeb, /route\.segments/);
assert.match(mapNative, /planeIconRotationDeg/);
assert.match(mapWeb, /planeIconRotationDeg/);
assert.match(mapNative, /colors\.primary/);
assert.match(mapWeb, /colors\.primary/);
assert.match(mapNative, /lineCap="butt"/);
assert.match(mapWeb, /lineCap: 'butt'/);
assert.match(mapNative, /zIndex=\{2\}/);
assert.match(mapWeb, /zIndexOffset=\{400\}/);
assert.match(mapNative, /AIRPORT_DOT_MARKER_ANCHOR/);
assert.doesNotMatch(mapNative, /y:\s*0\.35/);
assert.doesNotMatch(mapNative, /FLIGHT_MAP_ROUTE_UNDERLAY/);
assert.doesNotMatch(mapWeb, /FLIGHT_MAP_ROUTE_UNDERLAY/);
assert.doesNotMatch(mapNative, /NAVY|#1B2A5B/);
assert.doesNotMatch(mapWeb, /NAVY|#1B2A5B/);
assert.doesNotMatch(mapNative, /\bsetInterval\b|liveTracking|Animated\.|useSharedValue/);
assert.doesNotMatch(mapWeb, /\bsetInterval\b|liveTracking|Animated\.|useSharedValue/);

console.log("Flight geo tests passed.");
