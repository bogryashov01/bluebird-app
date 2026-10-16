import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canAccessClerkMemberScreens,
  isClerkCoreTabRoute,
  clearClerkMemberCacheOnIdentityChange,
  createLegacyAuthTokenGetter,
  getClerkEntryState,
  isLegacyMemberQueryEnabled,
  shouldUseLocalFlightReadMode,
  shouldRedirectClerkRoute,
  shouldClearClerkMemberCache,
} from "../scripts/.clerk-auth-session.test.mjs";
import {
  customFetch,
  setAuthTokenGetter,
} from "../scripts/.custom-fetch.test.mjs";
import {
  CLERK_MEMBER_NAVIGATION_READINESS,
  PRODUCTION_AUTH_AVAILABILITY,
} from "../scripts/.production-auth-state.test.mjs";
import { isClerkHomeAvailable } from "../scripts/.clerk-member-resolution.test.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("central Clerk resolution states gate member screens and distinguish outcomes", () => {
  assert.equal(getClerkEntryState({ isLoaded: false, isSignedIn: undefined }), "loading");
  assert.equal(getClerkEntryState({ isLoaded: true, isSignedIn: false }), "signed-out");
  assert.equal(getClerkEntryState({ isLoaded: true, isSignedIn: true }), "member-pending");
  assert.equal(getClerkEntryState({
    isLoaded: true,
    isSignedIn: true,
    memberResolution: { status: "not_checked" },
  }), "member-not-checked");
  assert.equal(canAccessClerkMemberScreens({
    isLoaded: true,
    isSignedIn: true,
    memberResolution: { status: "not_checked" },
  }), false);
  assert.equal(
    getClerkEntryState({
      isLoaded: true,
      isSignedIn: true,
      memberResolution: { status: "unresolved", reason: "projection_only" },
    }),
    "member-unlinked",
  );
  assert.equal(
    getClerkEntryState({
      isLoaded: true,
      isSignedIn: true,
      memberResolution: { status: "registration_required" },
    }),
    "registration-required",
  );
  assert.equal(
    getClerkEntryState({
      isLoaded: true,
      isSignedIn: true,
      memberResolution: { status: "onboarding_required" },
    }),
    "onboarding-required",
  );
  assert.equal(
    getClerkEntryState({
      isLoaded: true,
      isSignedIn: true,
      memberResolution: { status: "error", reason: "backend" },
    }),
    "error",
  );
  assert.equal(
    canAccessClerkMemberScreens({
      isLoaded: true,
      isSignedIn: true,
      memberResolution: { status: "linked", memberId: "bluebird-member-1" },
    }),
    true,
  );
  assert.equal(getClerkEntryState({
    isLoaded: true,
    isSignedIn: true,
    memberResolution: { status: "registered" },
  }), "registered-home");
  assert.equal(getClerkEntryState({
    isLoaded: true,
    isSignedIn: true,
    memberResolution: { status: "profile_complete", clerkUserId: "clerk-user-a" },
  }), "registered-home");
  assert.equal(canAccessClerkMemberScreens({
    isLoaded: true,
    isSignedIn: true,
    memberResolution: { status: "profile_complete", clerkUserId: "clerk-user-a" },
  }), false);
  assert.equal(getClerkEntryState({
    isLoaded: true,
    isSignedIn: true,
    memberResolution: { status: "profile_incomplete", clerkUserId: "clerk-user-a" },
  }), "profile-required");
  assert.equal(shouldRedirectClerkRoute(["(tabs)", "discover"], false, true), false);
  for (const route of ["discover", "trips", "membership", "profile"]) {
    assert.equal(shouldRedirectClerkRoute(["(tabs)", route], false, true), false);
    assert.equal(shouldRedirectClerkRoute(["(tabs)", route, "index"], false, true), false);
    assert.equal(shouldRedirectClerkRoute(["(tabs)", route], false, false), true);
  }
  assert.equal(isClerkCoreTabRoute(["(tabs)", "trips"]), true);
  assert.equal(isClerkCoreTabRoute(["(tabs)", "connections"]), false);
  assert.equal(shouldRedirectClerkRoute(["(tabs)", "trips"], false, true), false);
  assert.equal(canAccessClerkMemberScreens({
    isLoaded: true,
    isSignedIn: true,
    memberResolution: { status: "registered" },
  }), false);
  assert.equal(
    canAccessClerkMemberScreens({ isLoaded: true, isSignedIn: true }),
    false,
  );
  assert.equal(shouldRedirectClerkRoute(["(tabs)", "discover"], false), true);
  assert.equal(shouldRedirectClerkRoute(["(tabs)", "discover"], false, true), false);
  // Both post-login destinations are exempt from the root route guard once
  // the verified profile projection has selected them.
  assert.equal(shouldRedirectClerkRoute(["account", "bluebird-profile"], false, false), false);
  assert.equal(shouldRedirectClerkRoute(["(tabs)", "discover"], false, true), false);
  assert.equal(shouldRedirectClerkRoute(["(tabs)", "trips"], false, true), false);
  assert.equal(shouldRedirectClerkRoute(["queue", "join"], false, true), true);
  assert.equal(shouldRedirectClerkRoute(["(tabs)", "profile"], false), true);
  assert.equal(shouldRedirectClerkRoute(["(tabs)", "membership"], false), true);
  assert.equal(shouldRedirectClerkRoute(["notifications"], false), true);
  assert.equal(shouldRedirectClerkRoute(["(auth)", "complete-registration"], false), true);
  assert.equal(shouldRedirectClerkRoute(["(auth)", "onboarding"], false), true);
  assert.equal(shouldRedirectClerkRoute(["account", "bluebird-profile"], false), false);
  assert.equal(shouldRedirectClerkRoute(["membership", "plans"], false), false);
  assert.equal(shouldRedirectClerkRoute(["membership", "join"], false), true);
  assert.equal(shouldRedirectClerkRoute(["account", "personal-info"], false), true);
  assert.equal(shouldRedirectClerkRoute(["account", "personal-info"], false, true), false);
  assert.equal(shouldRedirectClerkRoute(["notifications"], false, true), false);
  assert.equal(shouldRedirectClerkRoute(["account", "personal-info"], false, false), true);
  assert.equal(shouldRedirectClerkRoute(["notifications"], false, false), true);
  assert.equal(shouldRedirectClerkRoute(["(tabs)", "connections"], false, true), true);
  assert.equal(shouldRedirectClerkRoute(["flight", "[id]"], false, true), false);
  assert.equal(shouldRedirectClerkRoute(["flight", "[id]"], false, false), true);
  assert.equal(shouldRedirectClerkRoute(["flight", "policy"], false, true), true);
  assert.equal(shouldRedirectClerkRoute(["flight", "confirmed"], false, true), true);
  for (const resolution of [
    { status: "signed_out" },
    { status: "resolving", clerkUserId: "clerk-user-a" },
    { status: "unresolved", reason: "missing_authoritative_decision" },
    { status: "profile_incomplete", clerkUserId: "clerk-user-a" },
  ]) {
    const homeReady = isClerkHomeAvailable(resolution, CLERK_MEMBER_NAVIGATION_READINESS);
    assert.equal(homeReady, false, `${resolution.status} must not authorize flight detail`);
    assert.equal(shouldRedirectClerkRoute(["flight", "[id]"], false, homeReady), true);
  }
  const completeNonmember = {
    status: "profile_complete",
    clerkUserId: "clerk-user-a",
    currentUser: { isAuthenticated: true, isProfileComplete: true, isMember: false },
  };
  const completeProfileHomeReady = isClerkHomeAvailable(
    completeNonmember,
    CLERK_MEMBER_NAVIGATION_READINESS,
  );
  assert.equal(completeProfileHomeReady, true);
  assert.equal(canAccessClerkMemberScreens({
    isLoaded: true,
    isSignedIn: true,
    memberResolution: completeNonmember,
  }), false);
  assert.equal(shouldRedirectClerkRoute(
    ["flight", "[id]"],
    false,
    completeProfileHomeReady,
  ), false);
  const rootLayoutSource = readFileSync(resolve(projectRoot, "app/_layout.tsx"), "utf8");
  const discoverSource = readFileSync(resolve(projectRoot, "app/(tabs)/discover/index.tsx"), "utf8");
  assert.match(rootLayoutSource, /shouldRedirectClerkRoute\(segments, memberAccessResolved, registeredHomeReady\)/);
  assert.match(discoverSource, /router\.push\(\{ pathname: '\/flight\/\[id\]', params: \{ id \} \}\)/);
  for (const path of [
    ["(tabs)", "discover"],
    ["(tabs)", "trips"],
    ["(tabs)", "membership"],
    ["(tabs)", "profile"],
    ["account", "personal-info"],
    ["notifications"],
  ]) {
    assert.equal(shouldRedirectClerkRoute(path, false, false), true, `${path.join("/")} must deny an incomplete Clerk profile`);
  }
  assert.equal(shouldRedirectClerkRoute(["(auth)", "welcome"], false), false);
  assert.equal(shouldRedirectClerkRoute(["(clerk-auth)", "sign-in"], false), false);
  assert.equal(shouldRedirectClerkRoute(["(clerk-auth)", "signed-in"], false), false);
  assert.equal(shouldRedirectClerkRoute(["(tabs)", "discover"], true), false);
});

test("both tab bars expose exactly Discover, Trips, Membership, and Profile", () => {
  const source = readFileSync(resolve(projectRoot, "app/(tabs)/_layout.tsx"), "utf8");
  const nativeTriggers = [...source.matchAll(/<NativeTabs\.Trigger name="([^"]+)"([^>]*)>/g)]
    .filter(([, , attributes]) => !attributes.includes("hidden"))
    .map(([, name]) => name);
  assert.deepEqual(nativeTriggers, [
    "discover/index",
    "trips/index",
    "membership/index",
    "profile/index",
  ]);
  const classicScreens = source.slice(source.indexOf("<Tabs\n")).split("<Tabs.Screen");
  const visibleClassicScreens = classicScreens
    .map((screen) => screen.match(/name="([^"]+)"/)?.[1])
    .filter((name) => name && name !== "index");
  assert.deepEqual(visibleClassicScreens, [
    "discover/index",
    "trips/index",
    "membership/index",
    "profile/index",
  ]);
  assert.match(source, /NativeTabs\.Trigger\.Label>Discover/);
  assert.match(source, /title: 'Discover'/);
  assert.doesNotMatch(source, /name="connections"/);
  const unreadHookSource = readFileSync(resolve(projectRoot, "hooks/useUnreadNotifications.ts"), "utf8");
  assert.match(unreadHookSource, /authMode === 'legacy' && isLocalFlightReadMode\(\)/);
});

test("Clerk Profile restores account destinations and sign-out without claiming unsupported saves", () => {
  const profileSource = readFileSync(resolve(projectRoot, "app/(tabs)/profile/index.tsx"), "utf8");
  const membershipSource = readFileSync(resolve(projectRoot, "app/(tabs)/membership/index.tsx"), "utf8");
  const plansSource = readFileSync(resolve(projectRoot, "app/membership/plans.tsx"), "utf8");
  const clerkProfile = profileSource
    .split("if (authMode === 'clerk') {")[1]
    ?.split("const initials")[0] ?? "";
  const clerkMembership = membershipSource
    .split("if (authMode === 'clerk') {")[1]
    ?.split("const currentTier")[0] ?? "";

  assert.match(plansSource, /loadClerkBluebirdMembership\(createClerkApi\(\)\.authenticated, signal\)/);
  assert.match(plansSource, /getVerifiedAccessToken: async \(\) =>/);
  assert.match(plansSource, /useProductionMembershipPlans\(\)/);
  assert.match(plansSource, /membershipState === 'available'/);
  assert.match(plansSource, /membershipState === 'conflict'/);
  assert.match(plansSource, /membershipState === 'unavailable'/);
  assert.match(plansSource, /current-plan-badge/);

  assert.match(profileSource, /loadClerkPersonalInfo\(createClerkApi\(\)\.authenticated, signal\)/);
  assert.match(clerkProfile, /profile\?\.firstName/);
  assert.match(clerkProfile, /profile\?\.email/);
  assert.match(clerkProfile, /Date of birth/);
  assert.match(clerkProfile, /Travel preferences/);
  assert.match(clerkProfile, /Favorite airports/);
  assert.match(clerkProfile, /clerk-profile-retry/);
  assert.match(clerkProfile, /Loading this profile may sync phone information/);
  assert.doesNotMatch(clerkProfile, /updateProfile|PUT \/me\/profile|useUpdateMe/);
  assert.match(clerkProfile, /title="Settings"/);
  assert.match(clerkProfile, /label: 'Appearance'/);
  assert.match(clerkProfile, /label: 'Personal Information'/);
  assert.match(clerkProfile, /router\.push\('\/account\/personal-info'/);
  assert.match(clerkProfile, /label: 'Notification Settings'/);
  assert.match(clerkProfile, /router\.push\('\/notifications'/);
  assert.match(clerkProfile, /label: 'Connections'/);
  assert.match(clerkProfile, /label: 'Sign Out'/);
  const personalInfoSource = readFileSync(resolve(projectRoot, "app/account/personal-info.tsx"), "utf8");
  assert.match(personalInfoSource, /authMode === 'clerk'/);
  assert.match(personalInfoSource, /<ClerkPersonalInfoScreen \/>/);
  assert.match(personalInfoSource, /loadClerkPersonalInfo\(createApi\(\)\.authenticated, signal\)/);
  assert.match(personalInfoSource, /currentIdentity\.current !== clerkUserId/);
  assert.doesNotMatch(personalInfoSource, /clerk-personal-info-unavailable|profile changes were requested/);
  const personalInfoContract = readFileSync(resolve(projectRoot, "lib/clerkPersonalInfo.ts"), "utf8");
  assert.match(personalInfoContract, /const currentUser = await api\.getMe\(options\)/);
  assert.match(personalInfoContract, /if \(currentUser\.isAuthenticated !== true\)/);
  assert.match(personalInfoContract, /const profile = await api\.getProfile\(options\)/);
  assert.doesNotMatch(personalInfoContract, /getMembership|useUpdateMe|localStorage/);
  const rootLayout = readFileSync(resolve(projectRoot, "app/_layout.tsx"), "utf8");
  assert.match(rootLayout, /name="account\/personal-info"[\s\S]*?headerShown: true[\s\S]*?\.\.\.headerOptions/);
  const appHeader = readFileSync(resolve(projectRoot, "components/AppHeader.tsx"), "utf8");
  assert.match(appHeader, /navigation\.goBack\(\)/);
  const notificationsSource = readFileSync(resolve(projectRoot, "app/notifications.tsx"), "utf8");
  const clerkNotifications = notificationsSource
    .split("function ClerkNotificationSettings() {")[1]
    ?.split("function LegacyNotificationsScreen()")[0] ?? "";
  assert.match(clerkNotifications, /api\.authenticated\.getProfile/);
  assert.match(clerkNotifications, /notificationPrefs/);
  assert.match(clerkNotifications, /Loading them may also synchronize your verified phone number/);
  assert.match(clerkNotifications, /Unavailable: no Clerk-authenticated history read is verified/);
  assert.match(clerkNotifications, /notificationPrefs does not define push-delivery settings/);
  assert.match(clerkNotifications, /clerk-load-notification-preferences/);
  assert.match(clerkNotifications, /enabled: false/);
  assert.match(clerkNotifications, /preferencesQuery\.refetch\(\)/);
   assert.match(clerkNotifications, /api\.authenticated\.updateProfile/);
   assert.match(clerkNotifications, /saveClerkNotificationPreferences/);
   assert.doesNotMatch(clerkNotifications, /useUpdateMe|useMarkNotificationRead|useListNotifications/);
  assert.match(notificationsSource, /authMode === 'clerk'/);
  assert.match(membershipSource, /loadClerkBluebirdMembership\(createClerkApi\(\)\.authenticated, signal\)/);
  assert.match(clerkMembership, /membershipState === 'available'/);
  assert.match(clerkMembership, /membershipState === 'conflict'/);
  assert.match(clerkMembership, /membershipState === 'unavailable'/);
  assert.match(clerkMembership, /clerk-membership-details/);
  assert.match(clerkMembership, /clerk-membership-retry/);
  assert.doesNotMatch(clerkMembership, /user\?\.membershipTier|linePassCount|annualFlightAllowance/);
  assert.doesNotMatch(clerkMembership, /useBuy|useChange|useUpgrade|updateProfile/);
});

test("Clerk Trips uses the selected account-scoped read-only Main API contract while legacy demo stays isolated", () => {
  const tripsSource = readFileSync(resolve(projectRoot, "app/(tabs)/trips/index.tsx"), "utf8");
  const clerkTripsSource = readFileSync(resolve(projectRoot, "components/ClerkTrips.tsx"), "utf8");
  assert.match(tripsSource, /authMode === 'clerk'/);
  assert.match(tripsSource, /return <ClerkTrips \/>/);
  assert.match(clerkTripsSource, /createMainBluebirdApiIntegration/);
  assert.match(clerkTripsSource, /mainBluebirdAuthenticatedQueryKey\(configuration\.environment, clerkUserId, 'trips'\)/);
  assert.match(clerkTripsSource, /return api\.authenticated\.listTrips\(\{ signal \}\)/);
  assert.match(clerkTripsSource, /current\.userId !== requestedUserId/);
  assert.match(clerkTripsSource, /query\.data\?\.\[activeList\]/);
  assert.match(clerkTripsSource, /query\.isError/);
  assert.match(clerkTripsSource, /items\?\.length === 0/);
  assert.match(clerkTripsSource, /Live authorization and account mapping have not been verified/);
  assert.doesNotMatch(clerkTripsSource, /useListTrips|useGetQueueStatus|useCancelTrip|useMutation|router\.push|router\.replace/);
  assert.doesNotMatch(clerkTripsSource, /getEmptyLegQueue|joinEmptyLegQueue|leaveEmptyLegQueue|updateProfile|getMembership|passengers|manifest|boardingPass/);
  assert.match(tripsSource, /authMode === 'legacy' && isLocalFlightReadMode\(\)/);
  assert.match(tripsSource, /enabled: memberQueryEnabled/);
});

test("member-data query gates require local demo mode and a legacy-auth member", () => {
  assert.equal(shouldUseLocalFlightReadMode("clerk", true), false);
  assert.equal(shouldUseLocalFlightReadMode("legacy", true), true);
  assert.equal(shouldUseLocalFlightReadMode("legacy", false), false);
  const flightDetailSource = readFileSync(resolve(projectRoot, "app/flight/[id].tsx"), "utf8");
  assert.match(flightDetailSource, /shouldUseLocalFlightReadMode\(authMode, isLocalFlightReadMode\(\)\)/);
  assert.match(flightDetailSource, /queryKey: PRODUCTION_FLIGHTS_QUERY_KEY/);
  assert.match(flightDetailSource, /fetchProductionFlights/);
  assert.doesNotMatch(flightDetailSource, /fetchProductionFlight\(/);
  assert.equal(isLegacyMemberQueryEnabled({
    authMode: "clerk",
    localDemoFlow: true,
    hasLegacyUser: true,
  }), false);
  assert.equal(isLegacyMemberQueryEnabled({
    authMode: "legacy",
    localDemoFlow: false,
    hasLegacyUser: true,
  }), false);
  assert.equal(isLegacyMemberQueryEnabled({
    authMode: "legacy",
    localDemoFlow: true,
    hasLegacyUser: false,
  }), false);
  assert.equal(isLegacyMemberQueryEnabled({
    authMode: "legacy",
    localDemoFlow: true,
    hasLegacyUser: true,
  }), true);

  let authenticatedMemberRequests = 0;
  const clerkGateClosed = isLegacyMemberQueryEnabled({
    authMode: "clerk",
    localDemoFlow: true,
    hasLegacyUser: true,
  });
  for (const _path of ["/me/profile", "/membership", "/trips", "/notifications"]) {
    if (clerkGateClosed) authenticatedMemberRequests += 1;
  }
  assert.equal(authenticatedMemberRequests, 0);
});

test("identity changes and sign-out clear member cache; unchanged and loading states do not", () => {
  assert.equal(shouldClearClerkMemberCache(undefined, "clerk-user-a", true), true);
  assert.equal(shouldClearClerkMemberCache("clerk-user-a", "clerk-user-b", true), true);
  assert.equal(shouldClearClerkMemberCache("clerk-user-a", null, true), true);
  assert.equal(shouldClearClerkMemberCache("clerk-user-a", "clerk-user-a", true), false);
  assert.equal(shouldClearClerkMemberCache("clerk-user-a", null, false), false);

  let clearCalls = 0;
  const cache = { clear: () => { clearCalls += 1; } };
  assert.equal(clearClerkMemberCacheOnIdentityChange(cache, "clerk-user-a", "clerk-user-b", true), true);
  assert.equal(clearClerkMemberCacheOnIdentityChange(cache, "clerk-user-b", "clerk-user-b", true), false);
  assert.equal(clearCalls, 1);
});

test("Clerk mode never reads or returns a legacy Bluebird JWT", async () => {
  let storageReads = 0;
  const readStoredToken = async () => {
    storageReads += 1;
    return "legacy-demo-jwt";
  };
  assert.equal(await createLegacyAuthTokenGetter(true, readStoredToken)(), null);
  assert.equal(storageReads, 0);

  assert.equal(await createLegacyAuthTokenGetter(false, readStoredToken)(), "legacy-demo-jwt");
  assert.equal(storageReads, 1);
});

test("shared public API requests omit Authorization in Clerk mode", async () => {
  const previousFetch = globalThis.fetch;
  let requestHeaders;
  globalThis.fetch = async (_input, init) => {
    requestHeaders = new Headers(init?.headers);
    return new Response("[]", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  };

  try {
    setAuthTokenGetter(createLegacyAuthTokenGetter(true, async () => "legacy-demo-jwt"));
    await customFetch("/api/flights", { responseType: "text" });
    assert.equal(requestHeaders.has("authorization"), false);
  } finally {
    setAuthTokenGetter(null);
    globalThis.fetch = previousFetch;
  }
});

test("authenticated production calls remain unavailable until backend acceptance is confirmed", () => {
  assert.equal(PRODUCTION_AUTH_AVAILABILITY.status, "unavailable");
  assert.deepEqual(PRODUCTION_AUTH_AVAILABILITY.reasons, [
    "clerk_token_acceptance_unverified",
    "member_identity_mapping_unverified",
  ]);
  assert.deepEqual(CLERK_MEMBER_NAVIGATION_READINESS, {
    registeredHome: true,
    linkedMember: false,
  });
});
