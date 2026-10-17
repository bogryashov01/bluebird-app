import assert from "node:assert/strict";
import {
  isMembershipDevelopmentPreviewEnabled,
  isMembershipDevelopmentPreviewRoute,
  MEMBERSHIP_PREVIEW_STATES,
  parseMembershipPreviewState,
} from "../scripts/.membership-development-preview.test.mjs";

assert.equal(isMembershipDevelopmentPreviewEnabled(true), true);
assert.equal(isMembershipDevelopmentPreviewEnabled(false), false);
assert.equal(isMembershipDevelopmentPreviewRoute(["membership", "dev-preview"], true), true);
assert.equal(isMembershipDevelopmentPreviewRoute(["membership", "dev-preview"], false), false);
assert.equal(isMembershipDevelopmentPreviewRoute(["membership", "plans"], true), false);
assert.deepEqual(MEMBERSHIP_PREVIEW_STATES, [
  "non-member",
  "active-member",
  "unavailable",
  "loading",
  "api-error",
]);
assert.equal(parseMembershipPreviewState("api-error"), "api-error");
assert.equal(parseMembershipPreviewState("not-a-state"), "non-member");
console.log("Membership preview access and fixture-state checks passed.");
