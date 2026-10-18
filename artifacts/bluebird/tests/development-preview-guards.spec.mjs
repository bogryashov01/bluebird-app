import assert from "node:assert/strict";
import {
  DEVELOPMENT_PREVIEW_PAGES,
  DEVELOPMENT_PREVIEW_STATES,
  isDevelopmentPreviewEnabled,
  isDevelopmentPreviewRoute,
  parseDevelopmentPreviewPage,
  parseDevelopmentPreviewState,
} from "../scripts/.development-preview.test.mjs";

assert.equal(isDevelopmentPreviewEnabled(true), true);
assert.equal(isDevelopmentPreviewEnabled(false), false);
for (const segments of [
  ["development-preview"],
  ["development-preview", "discover"],
  ["queue", "dev-preview"],
  ["membership", "dev-preview"],
]) {
  assert.equal(isDevelopmentPreviewRoute(segments, true), true);
  assert.equal(isDevelopmentPreviewRoute(segments, false), false);
}
assert.equal(isDevelopmentPreviewRoute(["(tabs)", "discover"], true), false);
assert.deepEqual(DEVELOPMENT_PREVIEW_PAGES, [
  "discover",
  "flight-details",
  "queue",
  "trips",
  "membership",
  "skip-line-pass",
  "profile",
  "notifications",
  "home-airport",
  "payment-methods",
]);
assert.deepEqual(DEVELOPMENT_PREVIEW_STATES.discover, ["available", "empty", "loading", "api-error"]);
assert.deepEqual(DEVELOPMENT_PREVIEW_STATES.queue, ["not-joined", "waiting", "unavailable"]);
assert.deepEqual(DEVELOPMENT_PREVIEW_STATES.trips, ["empty", "queued", "confirmed"]);
assert.deepEqual(DEVELOPMENT_PREVIEW_STATES.membership, ["non-member", "active-member", "loading", "api-error"]);
assert.deepEqual(DEVELOPMENT_PREVIEW_STATES["skip-line-pass"], [
  "non-member",
  "member-no-pass",
  "member-with-pass",
  "unavailable",
]);
assert.deepEqual(DEVELOPMENT_PREVIEW_STATES.profile, ["complete", "missing-information"]);
assert.deepEqual(DEVELOPMENT_PREVIEW_STATES.notifications, ["off", "all", "specific"]);
assert.equal(parseDevelopmentPreviewPage("profile"), "profile");
assert.equal(parseDevelopmentPreviewPage("not-a-preview"), null);
assert.equal(parseDevelopmentPreviewState("discover", "api-error"), "api-error");
assert.equal(parseDevelopmentPreviewState("discover", "not-a-state"), "available");

console.log("Development preview route denial and fixture-state checks passed.");
