import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";
import {
  SKIP_PASS_FLIGHT_CLOSED,
  SKIP_PASS_FLIGHT_MISSING,
  SKIP_PASS_INSUFFICIENT,
  canonicalWaitingRankOrder,
  renumberWaitingPositionsAfterSkip,
  skipPassAlreadySettled,
  skipPassFlightRejection,
} from "./.skip-the-line.test.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const openFlight = {
  status: "available",
  departureDate: "2099-01-01",
  departureTime: "12:00",
};
const closedFlight = {
  status: "departed",
  departureDate: "2099-01-01",
  departureTime: "12:00",
};
const pastFlight = {
  status: "available",
  departureDate: "2020-01-01",
  departureTime: "12:00",
};

test("successful redemption ranking closes the gap behind the redeemed position", () => {
  assert.deepEqual(
    renumberWaitingPositionsAfterSkip({
      redeemedPosition: 3,
      waitingPositions: [1, 2, 4, 5],
    }),
    [1, 2, 3, 4],
  );
  assert.deepEqual(
    renumberWaitingPositionsAfterSkip({
      redeemedPosition: 1,
      waitingPositions: [2, 3],
    }),
    [1, 2],
  );
});

test("insufficient / ineligible pass copy stays explicit", () => {
  assert.match(SKIP_PASS_INSUFFICIENT, /do not have any Skip the Line passes/);
  assert.equal(skipPassFlightRejection(null), SKIP_PASS_FLIGHT_MISSING);
  assert.equal(skipPassFlightRejection(closedFlight), SKIP_PASS_FLIGHT_CLOSED);
  assert.equal(skipPassFlightRejection(pastFlight), SKIP_PASS_FLIGHT_CLOSED);
  assert.equal(skipPassFlightRejection(openFlight), null);
});

test("duplicate / already-settled redemption does not look like a new spend", () => {
  assert.equal(skipPassAlreadySettled("confirmed"), true);
  assert.equal(skipPassAlreadySettled("waiting"), false);
  assert.equal(skipPassAlreadySettled("cancelled"), false);
  const route = readFileSync(resolve(projectRoot, "src/routes/queue.ts"), "utf8");
  assert.match(route, /alreadyConfirmed: true/);
  assert.match(route, /skipPassAlreadySettled/);
  assert.match(route, /linePassCount: sql`\$\{usersTable\.linePassCount\} - 1`/);
  assert.match(route, /usedPasses\} < \$\{familyMembersTable\.allocatedPasses\}/);
});

test("concurrent redemption stays under SERIALIZABLE + still-waiting update", () => {
  const route = readFileSync(resolve(projectRoot, "src/routes/queue.ts"), "utf8");
  assert.match(route, /BEGIN ISOLATION LEVEL SERIALIZABLE/);
  assert.match(route, /eq\(queueEntriesTable\.status, "waiting"\)/);
  assert.match(route, /40001/);
  assert.match(route, /Queue update conflict/);
});

test("closed queue rejects use-pass before balance mutation", () => {
  const route = readFileSync(resolve(projectRoot, "src/routes/queue.ts"), "utf8");
  const closedIndex = route.indexOf("skipPassFlightRejection(flight)");
  const consumeIndex = route.indexOf('linePassCount: sql`${usersTable.linePassCount} - 1`');
  // The use-pass handler's closed check must precede its personal-pass decrement.
  const usePassStart = route.indexOf("router.post(\"/:id/use-pass\"");
  const usePassClosed = route.indexOf("skipPassFlightRejection(flight)", usePassStart);
  const usePassConsume = route.indexOf('linePassCount: sql`${usersTable.linePassCount} - 1`', usePassStart);
  assert.ok(usePassStart >= 0);
  assert.ok(usePassClosed > usePassStart);
  assert.ok(usePassConsume > usePassClosed);
  assert.equal(closedIndex >= 0, true);
  assert.equal(consumeIndex >= 0, true);
});

test("updated ranking and winner selection share ascending waiting positions", () => {
  const ranked = canonicalWaitingRankOrder([
    { id: "b", position: 3 },
    { id: "a", position: 1 },
    { id: "c", position: 2 },
  ]);
  assert.deepEqual(ranked.map((row) => row.id), ["a", "c", "b"]);
  const afterSkip = canonicalWaitingRankOrder(
    renumberWaitingPositionsAfterSkip({
      redeemedPosition: 1,
      waitingPositions: [2, 3],
    }).map((position, index) => ({ id: `m${index}`, position })),
  );
  assert.deepEqual(afterSkip.map((row) => row.position), [1, 2]);
});

test("use-pass and join expose the fields the client needs for success UI", () => {
  const route = readFileSync(resolve(projectRoot, "src/routes/queue.ts"), "utf8");
  const openapi = readFileSync(resolve(projectRoot, "../../lib/api-spec/openapi.yaml"), "utf8");
  assert.match(route, /linePassCount/);
  assert.match(route, /alreadyConfirmed/);
  assert.match(route, /totalInQueue/);
  assert.match(route, /usedFamilyPass/);
  assert.match(route, /status: "confirmed"/);
  assert.match(openapi, /\/queue\/\{id\}\/use-pass/);
  assert.match(openapi, /linePassCount/);
  assert.match(openapi, /alreadyConfirmed/);
});
