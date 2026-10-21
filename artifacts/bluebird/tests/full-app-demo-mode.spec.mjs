import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  getFullAppDemoMembership,
  getFullAppDemoProfile,
  isFullAppDemoAllowedRoute,
  isFullAppDemoRoute,
  resolveFullAppDemoConfiguration,
} from "../scripts/.full-app-demo.test.mjs";

const fixture = JSON.parse(readFileSync(
  new URL("../fixtures/full-app-demo-me.json", import.meta.url),
  "utf8",
));

test("demo profile fixture matches the Bluebird /api/me display projection", () => {
  assert.deepEqual(fixture, {
    isAuthenticated: true,
    isAdmin: true,
    isConcierge: true,
    isMember: true,
    memberTier: "base",
    firstName: "Paul",
    lastName: "Mulko",
    isProfileComplete: true,
    needsPlanDecision: false,
    needsSignupPhone: false,
  });
  assert.deepEqual(getFullAppDemoProfile(), fixture);
  assert.equal(`${fixture.firstName} ${fixture.lastName}`, "Paul Mulko");
  assert.equal(getFullAppDemoMembership().tier, "base");
  assert.equal(getFullAppDemoMembership().status, "active");
});

test("public launch selection cannot enable the demo outside a development runtime", () => {
  assert.deepEqual(resolveFullAppDemoConfiguration("true", true), { enabled: true });
  assert.deepEqual(resolveFullAppDemoConfiguration("true", false), { enabled: false });
  assert.deepEqual(resolveFullAppDemoConfiguration("false", true), { enabled: false });
  assert.deepEqual(resolveFullAppDemoConfiguration(undefined, true), { enabled: false });
});

test("explicit demo URLs are recognized for release denial", () => {
  assert.equal(isFullAppDemoRoute("/bluebird/demo", []), true);
  assert.equal(isFullAppDemoRoute("/demo/profile", []), true);
  assert.equal(isFullAppDemoRoute("", ["demo", "profile"]), true);
  assert.equal(isFullAppDemoRoute("/membership/plans", ["membership", "plans"]), false);
  assert.equal(isFullAppDemoAllowedRoute("/", []), true);
  assert.equal(isFullAppDemoAllowedRoute("/bluebird/", ["bluebird"]), true);
  assert.equal(isFullAppDemoAllowedRoute("/membership/plans", ["membership", "plans"]), true);
  assert.equal(isFullAppDemoAllowedRoute("/demo/flight/98765", ["demo", "flight", "[id]"]), true);
  assert.equal(isFullAppDemoAllowedRoute("", ["demo", "flight", "[id]"]), true);
  assert.equal(isFullAppDemoAllowedRoute("/demo/flight/0", ["demo", "flight", "0"]), false);
  assert.equal(isFullAppDemoAllowedRoute("/demo/flight/98765/queue", ["demo", "flight", "[id]", "queue"]), false);
  assert.equal(isFullAppDemoAllowedRoute("/bluebird/concierge", ["bluebird", "concierge"]), false);
  assert.equal(isFullAppDemoAllowedRoute("/queue/join", ["queue", "join"]), false);
  assert.equal(isFullAppDemoAllowedRoute("/concierge", ["concierge"]), false);
});

test("the demo provider is identity-free and privileged sample controls stay disabled", () => {
  const authSource = readFileSync(new URL("../context/AuthContext.tsx", import.meta.url), "utf8");
  const viewsSource = readFileSync(new URL("../components/FullAppDemoViews.tsx", import.meta.url), "utf8");
  const demoFlightSource = readFileSync(new URL("../app/demo/flight/[id].tsx", import.meta.url), "utf8");
  const layoutSource = readFileSync(new URL("../app/_layout.tsx", import.meta.url), "utf8");
  const queueStoreSource = readFileSync(new URL("../lib/fullAppDemoQueue.tsx", import.meta.url), "utf8");
  assert.match(authSource, /export function DemoAuthProvider/);
  assert.match(authSource, /token: null,\s+user: null,\s+isLoading: false,\s+demoMode: true/);
  assert.match(authSource, /confirmClerkProfileCompletion: \(\) => false/);
  assert.match(viewsSource, /label: 'Admin flag', hint: String\(profile\.isAdmin\), disabled: true/);
  assert.match(viewsSource, /label: 'Concierge flag', hint: String\(profile\.isConcierge\), disabled: true/);
  assert.doesNotMatch(demoFlightSource, /useCancelQueueEntry|useCancelTrip|useCreateNetworkingRequest|useMutation|joinEmptyLegQueue|leaveEmptyLegQueue/);
  assert.match(layoutSource, /name="demo\/flight\/\[id\]"/);
  assert.match(layoutSource, /<FullAppDemoQueueProvider>/);
  assert.match(queueStoreSource, /FULL_APP_DEMO_QUEUE_STORAGE_KEY/);
  assert.doesNotMatch(queueStoreSource, /useMutation|joinEmptyLegQueue|leaveEmptyLegQueue|useCancelQueueEntry/);
  assert.match(viewsSource, /SIMULATED QUEUE/);
  assert.match(viewsSource, /not bookings/);
});

test("the full-app demo root precedes ordinary auth and Clerk mounts", () => {
  const rootSource = readFileSync(new URL("../app/_layout.tsx", import.meta.url), "utf8");
  const demoBranch = rootSource.indexOf("if (fullAppDemo.enabled) {");
  const authProvider = rootSource.indexOf("<AuthProvider>");
  const clerkProvider = rootSource.indexOf("<DormantClerkProvider>");
  assert.ok(demoBranch >= 0 && authProvider > demoBranch && clerkProvider > demoBranch);
  assert.match(rootSource, /if \(isFullAppDemoRoute\(pathname, segments\)\) return <FullAppDemoUnavailable \/>;/);
});
