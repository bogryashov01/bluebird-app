import assert from "node:assert/strict";
import {
  getGreetingForHour,
  reconcileFeaturedFlightId,
} from "../scripts/.discover-presentation.test.mjs";

for (const [hour, expected] of [
  [0, "Good night"],
  [4, "Good night"],
  [5, "Good morning"],
  [11, "Good morning"],
  [12, "Good afternoon"],
  [16, "Good afternoon"],
  [17, "Good evening"],
  [20, "Good evening"],
  [21, "Good night"],
  [23, "Good night"],
]) {
  assert.equal(getGreetingForHour(hour), expected, `greeting at local hour ${hour}`);
}

assert.equal(reconcileFeaturedFlightId([], null, () => 0), null);
assert.equal(reconcileFeaturedFlightId(["first", "second"], null, () => 0), "first");
assert.equal(reconcileFeaturedFlightId(["first", "second"], null, () => 0.99), "second");
assert.equal(
  reconcileFeaturedFlightId(["first", "second"], "second", () => 0),
  "second",
  "a still-eligible recommendation survives refreshes and unrelated rerenders",
);
assert.equal(
  reconcileFeaturedFlightId(["first", "replacement"], "removed", () => 0.99),
  "replacement",
  "a removed recommendation is replaced from the current eligible results",
);
assert.equal(
  reconcileFeaturedFlightId(["only"], "removed", () => 1),
  "only",
  "random selection remains within the candidate range",
);

console.log("Discover presentation tests passed.");
