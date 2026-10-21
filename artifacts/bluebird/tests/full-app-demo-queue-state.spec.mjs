import assert from "node:assert/strict";
import {
  createFullAppDemoQueueEntry,
  deserializeFullAppDemoQueueState,
  FULL_APP_DEMO_QUEUE_STORAGE_KEY,
  joinFullAppDemoQueue,
  leaveFullAppDemoQueue,
  parseFullAppDemoQueueState,
} from "../scripts/.full-app-demo-queue-state.test.mjs";

const flight = {
  id: "98765",
  source: "production",
  fromAirport: "SEA",
  fromCity: "Seattle",
  toAirport: "SFO",
  toCity: "San Francisco",
  departureDate: "2026-11-01",
  departureTime: "13:00",
  departureTimeZone: "America/Los_Angeles",
  aircraftType: "Gulfstream G280",
  aircraftTypeName: "Gulfstream G280",
  aircraftTypeCode: "G280",
  imageUrl: "https://images.example.test/flight.jpg",
};

assert.equal(FULL_APP_DEMO_QUEUE_STORAGE_KEY, "bluebird:full-app-demo:queue:v1");
const entry = createFullAppDemoQueueEntry(flight);
assert.equal(entry.flightId, "98765");
assert.equal(entry.flight.id, "98765");
assert.equal(entry.flight.fromAirport, "SEA");
assert.equal(entry.flight.toAirport, "SFO");
assert.equal(entry.flight.departureTime, "13:00");
assert.equal(entry.flight.aircraftTypeName, "Gulfstream G280");

const joined = joinFullAppDemoQueue([], flight);
assert.deepEqual(joined, [entry]);
assert.equal(joinFullAppDemoQueue(joined, { ...flight, toAirport: "LAX" })[0].flight.toAirport, "LAX");
assert.deepEqual(leaveFullAppDemoQueue(joined, "98765"), []);

const hydrated = parseFullAppDemoQueueState([
  entry,
  entry,
  { flightId: 0, flight: { ...entry.flight, id: "0" } },
  { flightId: "555", flight: { ...entry.flight, id: "556" } },
  { flightId: "777", flight: { ...entry.flight, id: "777", fromAirport: 12 } },
  null,
]);
assert.deepEqual(hydrated, [entry]);
assert.deepEqual(parseFullAppDemoQueueState(null), []);
assert.deepEqual(parseFullAppDemoQueueState({ flightId: "98765" }), []);
assert.deepEqual(deserializeFullAppDemoQueueState("{invalid-json"), []);
assert.deepEqual(deserializeFullAppDemoQueueState(JSON.stringify([entry])), [entry]);

assert.throws(
  () => createFullAppDemoQueueEntry({ ...flight, source: "local" }),
  /live Production flight/,
);
assert.throws(
  () => createFullAppDemoQueueEntry({ ...flight, id: "01" }),
  /live Production flight/,
);
assert.throws(() => leaveFullAppDemoQueue(joined, "invalid"), /positive numeric Production flight ID/);

console.log("full-app demo local queue state tests passed");
