import assert from "node:assert/strict";
import {
  createFullAppDemoQueueEntry,
  deserializeFullAppDemoQueueState,
  FULL_APP_DEMO_QUEUE_STORAGE_KEY,
  addFullAppDemoPass,
  joinFullAppDemoQueue,
  leaveFullAppDemoQueue,
  parseFullAppDemoQueueState,
  transitionFullAppDemoQueueEntry,
  useFullAppDemoPass,
} from "../scripts/.full-app-demo-queue-state.test.mjs";

const flight = {
  id: "98765",
  status: "published",
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
  duration: "2h 5m",
  international: false,
};

assert.equal(FULL_APP_DEMO_QUEUE_STORAGE_KEY, "bluebird:full-app-demo:queue:v1");
const entry = createFullAppDemoQueueEntry(flight, 1, "2026-10-22T00:00:00.000Z");
assert.equal(entry.flightId, "98765");
assert.equal(entry.flight.id, "98765");
assert.equal(entry.flight.fromAirport, "SEA");
assert.equal(entry.flight.toAirport, "SFO");
assert.equal(entry.flight.departureTime, "13:00");
assert.equal(entry.flight.aircraftTypeName, "Gulfstream G280");

const joined = joinFullAppDemoQueue([], flight);
assert.equal(joined.length, 1);
assert.equal(joined[0].flightId, entry.flightId);
assert.equal(joined[0].status, "waiting");
assert.equal(joined[0].flight.id, entry.flight.id);
assert.equal(joinFullAppDemoQueue([], { ...flight, toAirport: "LAX" })[0].flight.toAirport, "LAX");
assert.throws(() => joinFullAppDemoQueue(joined, flight), /already have a local demo queue/);
assert.deepEqual(leaveFullAppDemoQueue(joined, "98765"), []);

const hydrated = parseFullAppDemoQueueState([
  entry,
  entry,
  { flightId: 0, flight: { ...entry.flight, id: "0" } },
  { flightId: "555", flight: { ...entry.flight, id: "556" } },
  { flightId: "777", flight: { ...entry.flight, id: "777", fromAirport: 12 } },
  null,
]);
assert.deepEqual(hydrated, { entries: [entry], passCount: 0 });
assert.deepEqual(parseFullAppDemoQueueState(null), { entries: [], passCount: 0 });
assert.deepEqual(parseFullAppDemoQueueState({ flightId: "98765" }), { entries: [], passCount: 0 });
assert.deepEqual(deserializeFullAppDemoQueueState("{invalid-json"), { entries: [], passCount: 0 });
assert.deepEqual(deserializeFullAppDemoQueueState(JSON.stringify([entry])), { entries: [entry], passCount: 0 });

const fallbackFlight = { ...flight, source: "local", id: "98766", international: true };
const fallbackEntry = createFullAppDemoQueueEntry(fallbackFlight);
assert.equal(fallbackEntry.flight.international, true);
assert.equal(joinFullAppDemoQueue([], fallbackFlight)[0].flightId, "98766");
assert.throws(
  () => createFullAppDemoQueueEntry({ ...flight, source: "production", status: "cancelled" }),
  /no longer available/,
);

const legacyState = parseFullAppDemoQueueState([{
  flightId: "555",
  flight: { ...entry.flight, id: "555", duration: undefined, international: undefined, status: undefined },
}]);
assert.equal(legacyState.entries[0].status, "waiting");
assert.equal(legacyState.entries[0].flight.duration, null);
assert.equal(legacyState.passCount, 0);

const changed = transitionFullAppDemoQueueEntry(joined, "98765", "changed-position", 2);
assert.equal(changed[0].status, "changed-position");
assert.equal(changed[0].position, 2);
assert.throws(
  () => transitionFullAppDemoQueueEntry(joined, "98765", "changed-position"),
  /different positive position/,
);
assert.equal(transitionFullAppDemoQueueEntry(changed, "98765", "lost")[0].status, "lost");
assert.equal(transitionFullAppDemoQueueEntry(joined, "98765", "closed")[0].status, "closed");

const purchased = addFullAppDemoPass({ entries: joined, passCount: 0 });
assert.equal(purchased.passCount, 1);
const won = useFullAppDemoPass(purchased, "98765");
assert.equal(won.passCount, 0);
assert.equal(won.entries[0].status, "won");
assert.throws(() => useFullAppDemoPass({ entries: joined, passCount: 0 }, "98765"), /do not have a Skip the Line pass/);
assert.throws(() => useFullAppDemoPass(won, "98765"), /Only a waiting local demo queue/);

assert.throws(
  () => createFullAppDemoQueueEntry({ ...flight, id: "01" }),
  /live or typed fallback flight/,
);
assert.throws(() => leaveFullAppDemoQueue(joined, "invalid"), /positive numeric flight ID/);

console.log("full-app demo local queue state tests passed");
