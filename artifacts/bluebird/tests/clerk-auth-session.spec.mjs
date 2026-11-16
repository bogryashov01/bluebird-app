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
  shouldApplyClerkRouteRedirect,
  shouldRedirectClerkRoute,
  shouldClearClerkMemberCache,
  CLERK_CONNECTIONS_TAB,
  clerkLegacyConversationHref,
  isConnectionsPreviewDevelopmentEnabled,
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
  for (const route of ["discover", "trips", "connections", "membership", "profile"]) {
    assert.equal(shouldRedirectClerkRoute(["(tabs)", route], false, true), false);
    assert.equal(shouldRedirectClerkRoute(["(tabs)", route, "index"], false, true), false);
    assert.equal(shouldRedirectClerkRoute(["(tabs)", route], false, false), true);
  }
  assert.equal(isClerkCoreTabRoute(["(tabs)", "trips"]), true);
  assert.equal(isClerkCoreTabRoute(["(tabs)", "connections"]), true);
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
  // Delete Account matches Personal Info: home-ready Clerk profiles only.
  assert.equal(shouldRedirectClerkRoute(["account", "delete-account"], false, true), false);
  assert.equal(shouldRedirectClerkRoute(["account", "delete-account"], false, false), true);
  assert.equal(shouldRedirectClerkRoute(["account", "delete-account"], false), true);
  assert.equal(shouldRedirectClerkRoute(["account", "delete-account", "extra"], false, true), true);
  // Incomplete-profile onboarding keeps bluebird-profile open; Delete Account stays closed.
  assert.equal(shouldRedirectClerkRoute(["account", "bluebird-profile"], false, false), false);
  assert.equal(shouldRedirectClerkRoute(["account", "delete-account"], false, false), true);
  // Unauthenticated / not home-ready users stay off Delete Account and other member account routes.
  assert.equal(shouldRedirectClerkRoute(["account", "personal-info"], false, false), true);
  assert.equal(shouldRedirectClerkRoute(["(tabs)", "profile"], false, false), true);
  assert.equal(shouldRedirectClerkRoute(["notifications"], false, true), false);
  assert.equal(shouldRedirectClerkRoute(["account", "payment-methods"], false, true), false);
  assert.equal(shouldRedirectClerkRoute(["account", "contacts"], false, true), false);
  assert.equal(shouldRedirectClerkRoute(["support", "help-center"], false, true), false);
  assert.equal(shouldRedirectClerkRoute(["support", "legal"], false, true), false);
  assert.equal(shouldRedirectClerkRoute(["support", "help-center"], false, false), true);
  assert.equal(shouldRedirectClerkRoute(["support", "legal"], false, false), true);
  assert.equal(shouldRedirectClerkRoute(["support", "help-center", "extra"], false, true), true);
  assert.equal(shouldRedirectClerkRoute(["support", "legal", "extra"], false, true), true);
  assert.equal(shouldRedirectClerkRoute(["concierge"], false, true), false);
  assert.equal(shouldRedirectClerkRoute(["concierge"], false, false), true);
  assert.equal(shouldRedirectClerkRoute(["concierge", "extra"], false, true), true);
  assert.equal(shouldRedirectClerkRoute(["connections-preview"], false, true), true);
  assert.equal(shouldRedirectClerkRoute(["connections-preview", "member", "demo-avery-lang"], false, true), true);
  assert.equal(shouldRedirectClerkRoute(["connections-preview", "chat", "demo-conversation-ellis"], false, true), true);
  assert.equal(shouldRedirectClerkRoute(["connections-preview"], false, true, "", true), false);
  assert.equal(shouldRedirectClerkRoute(["connections-preview", "member", "demo-avery-lang"], false, true, "", true), false);
  assert.equal(shouldRedirectClerkRoute(["connections-preview", "chat", "demo-conversation-ellis"], false, true, "", true), false);
  assert.equal(shouldRedirectClerkRoute(["messages", "[conversationId]"], false, true), false);
  assert.equal(shouldRedirectClerkRoute(["messages", "42"], false, true), false);
  assert.equal(shouldRedirectClerkRoute(["messages", "42"], false, true, "/messages/42"), false);
  assert.equal(shouldRedirectClerkRoute(["messages", "demo-ellis"], false, true), true);
  assert.equal(shouldRedirectClerkRoute(["messages", "[conversationId]"], false, true, "/messages/demo-ellis"), true);
  assert.equal(shouldRedirectClerkRoute(["messages", "42"], false, false), true);
  assert.equal(shouldRedirectClerkRoute(["connections-preview"], false, false), true);
  assert.equal(shouldRedirectClerkRoute(["connections-preview", "extra"], false, true), true);
  assert.equal(shouldRedirectClerkRoute(["airport-picker"], false, true), false);
  assert.equal(shouldRedirectClerkRoute(["account", "payment-methods"], false, false), true);
  assert.equal(shouldRedirectClerkRoute(["account", "contacts"], false, false), true);
  assert.equal(shouldRedirectClerkRoute(["airport-picker"], false, false), true);
  assert.equal(shouldRedirectClerkRoute(["account", "payment-methods"], false), true);
  assert.equal(shouldRedirectClerkRoute(["account", "contacts"], false), true);
  assert.equal(shouldRedirectClerkRoute(["airport-picker"], false), true);
  assert.equal(shouldRedirectClerkRoute(["account", "payment-methods", "extra"], false, true), true);
  assert.equal(shouldRedirectClerkRoute(["account", "contacts", "extra"], false, true), true);
  assert.equal(shouldRedirectClerkRoute(["airport-picker", "extra"], false, true), true);
  assert.equal(shouldRedirectClerkRoute(["account", "personal-info"], false, false), true);
  assert.equal(shouldRedirectClerkRoute(["notifications"], false, false), true);
  assert.equal(shouldRedirectClerkRoute(["(tabs)", "connections"], false, true), false);
  assert.equal(shouldRedirectClerkRoute(["flight", "[id]"], false, true), false);
  assert.equal(shouldRedirectClerkRoute(["flight", "[id]"], false, false), true);
  assert.equal(shouldRedirectClerkRoute(["flight", "join"], false, true), false);
  assert.equal(shouldRedirectClerkRoute(["flight", "join"], false, false), true);
  assert.equal(shouldRedirectClerkRoute(["flight", "checklist"], false, true), false);
  assert.equal(shouldRedirectClerkRoute(["flight", "checklist"], false, false), true);
  assert.equal(shouldRedirectClerkRoute(["flight", "checklist", "extra"], false, true), true);
  assert.equal(shouldRedirectClerkRoute(["flight", "passengers"], false, true), false);
  assert.equal(shouldRedirectClerkRoute(["flight", "passengers"], false, false), true);
  assert.equal(shouldRedirectClerkRoute(["flight", "passengers", "extra"], false, true), true);
  assert.equal(shouldRedirectClerkRoute(["flight", "queue-status"], false, true), false);
  assert.equal(shouldRedirectClerkRoute(["flight", "queue-status"], false, true, "/flight/queue-status"), false);
  assert.equal(shouldRedirectClerkRoute(["flight", "queue-status"], false, true, "/flight/queue-status?flightId=42"), false);
  assert.equal(shouldRedirectClerkRoute(["+not-found"], false, true, "/flight/queue-status?flightId=42"), false);
  assert.equal(shouldRedirectClerkRoute(["flight", "queue-status"], false, false), true);
  const queueStatusWouldRedirect = shouldRedirectClerkRoute(["flight", "queue-status"], false, false);
  assert.equal(shouldApplyClerkRouteRedirect({
    sessionLoaded: false,
    routeRequiresRedirect: queueStatusWouldRedirect,
  }), false);
  assert.equal(shouldApplyClerkRouteRedirect({
    sessionLoaded: true,
    routeRequiresRedirect: queueStatusWouldRedirect,
  }), true);
  assert.equal(shouldApplyClerkRouteRedirect({
    sessionLoaded: true,
    routeRequiresRedirect: shouldRedirectClerkRoute(["flight", "queue-status"], false, true, "/flight/queue-status"),
  }), false);
  assert.equal(shouldRedirectClerkRoute(["flight", "winner"], false, true), false);
  assert.equal(shouldRedirectClerkRoute(["flight", "winner"], false, true, "/flight/winner"), false);
  assert.equal(shouldRedirectClerkRoute(["+not-found"], false, true, "/flight/winner?flightId=42"), false);
  assert.equal(shouldRedirectClerkRoute(["flight", "winner"], false, false), true);
  assert.equal(shouldRedirectClerkRoute(["flight", "winner", "extra"], false, true), true);
  assert.equal(shouldRedirectClerkRoute(["flight", "policy-review"], false, true), false);
  assert.equal(shouldRedirectClerkRoute(["flight", "policy-review"], false, false), true);
  assert.equal(shouldRedirectClerkRoute(["flight", "policy-review", "extra"], false, true), true);
  assert.equal(shouldRedirectClerkRoute(["flight", "join", "extra"], false, true), true);
  for (const route of ["demo-policy", "demo-intl", "demo-joined", "demo-status", "demo-pass", "demo-purchase", "demo-winner", "demo-confirmed"]) {
    assert.equal(shouldRedirectClerkRoute(["flight", route], false, true), false);
    assert.equal(shouldRedirectClerkRoute(["flight", route], false, false), true);
    assert.equal(shouldRedirectClerkRoute(["flight", route, "extra"], false, true), true);
  }
  assert.equal(shouldRedirectClerkRoute(["flight", "policy"], false, true), true);
  assert.equal(shouldRedirectClerkRoute(["+not-found"], false, true, "/flight/join"), false);
  assert.equal(shouldRedirectClerkRoute(["+not-found"], false, true, "/flight/join?flightId=42"), false);
  assert.equal(shouldRedirectClerkRoute(["+not-found"], false, true, "/flight/demo-policy"), false);
  assert.equal(shouldRedirectClerkRoute(["+not-found"], false, false, "/flight/join"), true);
  assert.equal(shouldRedirectClerkRoute(["flight", "policy"], false, true, "/flight/policy"), true);
  assert.equal(shouldRedirectClerkRoute(["queue", "join"], false, true, "/queue/join"), true);
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
  assert.match(rootLayoutSource, /shouldRedirectClerkRoute\(\s*segments,\s*memberAccessResolved,\s*registeredHomeReady,\s*pathname,\s*connectionsPreviewEnabled,\s*typeof __DEV__ !== 'undefined' && __DEV__ === true,\s*\)/);
  assert.equal(shouldRedirectClerkRoute(["dev", "connection-diagnostics"], false, true, "", false, false), true);
  assert.equal(shouldRedirectClerkRoute(["dev", "connection-diagnostics"], false, true, "/dev/connection-diagnostics", false, true), false);
  assert.equal(shouldRedirectClerkRoute(["dev", "connection-diagnostics"], false, false, "", false, true), true);
  assert.equal(shouldRedirectClerkRoute(["+not-found"], false, true, "/dev/connection-diagnostics", false, true), false);
  assert.match(rootLayoutSource, /clerkLegacyConversationHref\(/);
  assert.match(rootLayoutSource, /if \(legacyConversationHref\)/);
  assert.match(discoverSource, /router\.push\(demoMode[\s\S]*pathname: '\/flight\/\[id\]'/);
  for (const path of [
    ["(tabs)", "discover"],
    ["(tabs)", "trips"],
    ["(tabs)", "membership"],
    ["(tabs)", "profile"],
    ["account", "personal-info"],
    ["notifications"],
    ["concierge"],
    ["connections-preview"],
    ["support", "help-center"],
    ["support", "legal"],
    ["flight", "join"],
  ]) {
    assert.equal(shouldRedirectClerkRoute(path, false, false), true, `${path.join("/")} must deny an incomplete Clerk profile`);
  }
  assert.equal(shouldRedirectClerkRoute(["(auth)", "welcome"], false), false);
  assert.equal(shouldRedirectClerkRoute(["(clerk-auth)", "sign-in"], false), false);
  assert.equal(shouldRedirectClerkRoute(["(clerk-auth)", "signed-in"], false), false);
  assert.equal(shouldRedirectClerkRoute(["(tabs)", "discover"], true), false);
});

test("production Clerk sessions leave legacy chats and JWT networking for Connections", () => {
  assert.equal(isConnectionsPreviewDevelopmentEnabled(false), false);
  assert.equal(isConnectionsPreviewDevelopmentEnabled(true), true);
  const home = {
    authMode: "clerk",
    homeReady: true,
    developmentPreview: false,
  };
  const legacyRoutes = [
    { segments: ["connections-preview"], pathname: "/connections-preview" },
    { segments: ["connections-preview", "chat", "demo-conversation-ellis"], pathname: "/connections-preview/chat/demo-conversation-ellis" },
    { segments: ["connections-preview", "member", "demo-avery-lang"], pathname: "/connections-preview/member/demo-avery-lang" },
    { segments: ["+not-found"], pathname: "/connections-preview/chat/demo-conversation-ellis" },
    { segments: ["networking", "requests"], pathname: "/networking/requests" },
    { segments: ["networking", "connections"], pathname: "/networking/connections" },
    { segments: ["networking", "connections", "[id]"], pathname: "/networking/connections/9" },
    { segments: ["networking", "profile"], pathname: "/networking/profile" },
    { segments: ["+not-found"], pathname: "/networking/connections/9?token=clerk" },
    { segments: ["messages", "demo-ellis"], pathname: "/messages/demo-ellis" },
    { segments: ["messages", "[conversationId]"], pathname: "/messages/demo-ellis" },
    { segments: ["messages"], pathname: "/messages" },
  ];
  for (const route of legacyRoutes) {
    assert.equal(clerkLegacyConversationHref({ ...home, ...route }), CLERK_CONNECTIONS_TAB, route.pathname);
    assert.equal(shouldRedirectClerkRoute(route.segments, false, true, route.pathname, false), true, route.pathname);
  }
  assert.equal(clerkLegacyConversationHref({
    ...home,
    segments: ["messages", "42"],
    pathname: "/messages/42",
  }), null);
  assert.equal(shouldRedirectClerkRoute(["messages", "42"], false, true, "/messages/42", false), false);
  assert.equal(clerkLegacyConversationHref({
    ...home,
    segments: ["(tabs)", "connections"],
    pathname: "/connections",
  }), null);
  assert.equal(clerkLegacyConversationHref({
    authMode: "clerk",
    segments: ["connections-preview", "chat", "demo-conversation-ellis"],
    pathname: "/connections-preview/chat/demo-conversation-ellis",
    homeReady: false,
    developmentPreview: false,
  }), null);
  assert.equal(shouldRedirectClerkRoute(
    ["connections-preview", "chat", "demo-conversation-ellis"],
    false,
    false,
    "/connections-preview/chat/demo-conversation-ellis",
    false,
  ), true);
  assert.equal(clerkLegacyConversationHref({
    authMode: "legacy",
    segments: ["networking", "connections", "[id]"],
    pathname: "/networking/connections/9",
    homeReady: true,
    developmentPreview: false,
  }), null);
  assert.equal(clerkLegacyConversationHref({
    authMode: "legacy",
    segments: ["connections-preview", "chat", "demo-conversation-ellis"],
    pathname: "/connections-preview/chat/demo-conversation-ellis",
    homeReady: true,
    developmentPreview: false,
  }), null);
  assert.equal(clerkLegacyConversationHref({
    authMode: "clerk",
    segments: ["connections-preview", "chat", "demo-conversation-ellis"],
    pathname: "/connections-preview/chat/demo-conversation-ellis",
    homeReady: true,
    developmentPreview: true,
  }), null);
  assert.equal(shouldRedirectClerkRoute(
    ["connections-preview", "chat", "demo-conversation-ellis"],
    false,
    true,
    "/connections-preview/chat/demo-conversation-ellis",
    true,
  ), false);
  assert.equal(clerkLegacyConversationHref({
    authMode: "clerk",
    segments: ["networking", "requests"],
    pathname: "/networking/requests",
    homeReady: true,
    developmentPreview: true,
  }), CLERK_CONNECTIONS_TAB);

  const messages = readFileSync(resolve(projectRoot, "lib/memberMessages.ts"), "utf8");
  const connections = readFileSync(resolve(projectRoot, "lib/memberConnections.ts"), "utf8");
  assert.match(messages, /export function isMemberMessagesIntegrationEnabled/);
  assert.match(messages, /return flag === 'true' && nativeAuthTest !== true/);
  assert.match(connections, /export function isMemberConnectionsIntegrationEnabled/);
  assert.match(connections, /return flag === 'true' && nativeAuthTest !== true/);
  const notifications = readFileSync(resolve(projectRoot, "app/notifications.tsx"), "utf8");
  const clerkNotifications = notifications.slice(
    notifications.indexOf("function ClerkNotificationSettings"),
    notifications.indexOf("function LegacyNotificationsScreen"),
  );
  assert.equal(clerkNotifications.includes("notificationRoute"), false);
  assert.equal(clerkNotifications.includes("connections-preview"), false);
  assert.equal(clerkNotifications.includes("/networking/"), false);
});

test("tab bars keep Connections mountable and hide it when both member integrations are off", () => {
  const source = readFileSync(resolve(projectRoot, "app/(tabs)/_layout.tsx"), "utf8");
  assert.match(source, /export function isMemberConnectionsTabVisible/);
  assert.match(source, /isMemberConnectionsIntegrationEnabled/);
  assert.match(source, /isMemberMessagesIntegrationEnabled/);
  assert.match(source, /useMemberMessagesUnreadCount/);
  assert.match(source, /formatMemberMessagesUnreadBadge/);
  assert.match(source, /connections-tab-unread-badge|messagesUnreadCount/);
  assert.match(source, /hidden=\{!connectionsVisible\}/);
  assert.match(source, /connectionsVisible\s*\?\s*\{[\s\S]*title: 'Connections'/);
  assert.match(source, /:\s*\{\s*href:\s*null\s*\}/);
  assert.match(source, /NativeTabs\.Trigger\.Label>Discover/);
  assert.match(source, /NativeTabs\.Trigger\.Label>Connections/);
  assert.match(source, /title: 'Discover'/);
  assert.match(source, /name="connections"/);
  const profileSource = readFileSync(resolve(projectRoot, "app/(tabs)/profile/index.tsx"), "utf8");
  assert.doesNotMatch(profileSource, /router\.push\(['"]\/\(tabs\)\/connections/);
  assert.match(profileSource, /connectionsEnabled \? \(/);
  assert.match(profileSource, /confirmOpenDeleteAccount/);
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
  assert.match(plansSource, /useProductionMembershipPlans\(\{ enabled: !demoMode \}\)/);
  assert.match(plansSource, /membershipState === 'available'/);
  assert.match(plansSource, /membershipState === 'conflict'/);
  assert.match(plansSource, /membershipState === 'unavailable'/);
  assert.match(plansSource, /current-plan-badge/);

  assert.match(profileSource, /loadClerkPersonalInfo\(createClerkApi\(\)\.authenticated, signal\)/);
  assert.match(clerkProfile, /profile\?\.firstName/);
  assert.match(clerkProfile, /profile\?\.email/);
  assert.match(profileSource, /cachedClerkProfile\.current/);
  assert.match(profileSource, /kind: 'refreshing'/);
  assert.match(profileSource, /<BluebirdLogo variant="symbol"/);
  assert.match(profileSource, /ActivityIndicator size="small"/);
  assert.match(profileSource, /clerkProfileLoadingMark/);
  assert.doesNotMatch(profileSource, /Loading this profile may sync phone information/);
  assert.match(clerkProfile, /saveIncomingConnectionRequestsPreference/);
  assert.match(clerkProfile, /updateProfile: \(data, options\) => api\.updateProfile\(data, options\)/);
  assert.doesNotMatch(clerkProfile, /PUT \/me\/profile|useUpdateMe/);
  assert.match(clerkProfile, /title="Account"/);
  assert.match(clerkProfile, /title="Preferences"/);
  assert.match(clerkProfile, /title="Support"/);
  assert.match(clerkProfile, /label: 'Appearance'/);
  assert.match(clerkProfile, /label: 'Personal Information'/);
  assert.match(clerkProfile, /router\.push\('\/account\/personal-info'/);
  assert.match(clerkProfile, /label: 'Connect Contacts'/);
  assert.match(clerkProfile, /router\.push\('\/account\/contacts'/);
  assert.match(clerkProfile, /label: 'Payment Methods'/);
  assert.match(clerkProfile, /router\.push\('\/account\/payment-methods'/);
  assert.match(clerkProfile, /label: 'Delete Account'/);
  assert.match(clerkProfile, /testID: 'clerk-delete-account'/);
  assert.match(clerkProfile, /confirmOpenDeleteAccount/);
  assert.match(profileSource, /router\.push\('\/account\/delete-account'/);
  assert.match(clerkProfile, /connectionsEnabled \? \(/);
  assert.match(clerkProfile, /label: 'Notification Settings'/);
  assert.match(clerkProfile, /router\.push\('\/notifications'/);
  assert.match(clerkProfile, /label: 'Allow incoming requests'/);
  assert.match(clerkProfile, /clerk-incoming-connection-requests-switch/);
  const preferencesOnly = clerkProfile
    .split('title="Preferences"')[1]
    ?.split('title="Connections"')[0] ?? "";
  assert.match(preferencesOnly, /clerk-incoming-connection-requests-switch/);
  assert.match(preferencesOnly, /Allow incoming requests/);
  assert.doesNotMatch(preferencesOnly, /Get notified when someone sends you a connection request/);
  assert.doesNotMatch(clerkProfile, /label: 'Community'/);
  assert.doesNotMatch(clerkProfile, /router\.push\('\/community'/);
  assert.match(clerkProfile, /label: 'AI Concierge'/);
  assert.match(clerkProfile, /hint: 'Not available yet'/);
  assert.match(clerkProfile, /router\.push\('\/concierge'/);
  assert.match(clerkProfile, /router\.push\('\/support\/help-center'/);
  assert.match(clerkProfile, /router\.push\('\/support\/legal'/);
  assert.match(clerkProfile, /label: 'Sign Out'/);
  assert.match(clerkProfile, /membershipStatus/);
  assert.doesNotMatch(clerkProfile, /recentActivity/);

  const contactsSource = readFileSync(resolve(projectRoot, "app/account/contacts.tsx"), "utf8");
  const connectContactsSource = readFileSync(resolve(projectRoot, "lib/connectContacts.ts"), "utf8");
  const communitySource = readFileSync(resolve(projectRoot, "app/community.tsx"), "utf8");
  const conciergeSource = readFileSync(resolve(projectRoot, "app/concierge.tsx"), "utf8");
  assert.match(contactsSource, /authMode === 'clerk'/);
  assert.match(contactsSource, /Connect Contacts/);
  assert.match(contactsSource, /FamilyMembershipScreen/);
  assert.match(contactsSource, /useReferralProgram/);
  assert.match(contactsSource, /Share\.share/);
  assert.match(contactsSource, /pickDeviceContact/);
  assert.match(contactsSource, /expo-contacts\/legacy/);
  assert.match(contactsSource, /presentContactPickerAsync/);
  assert.match(contactsSource, /expo-sms/);
  assert.match(contactsSource, /sendSMSAsync/);
  assert.match(contactsSource, /Share Another Way/);
  assert.doesNotMatch(contactsSource, /ProductionAuthenticatedUnavailableNotice|from 'expo-contacts'|getContactsAsync|requestPermissionsAsync|sms:|mailto:|console\.(log|info|debug|warn)/);
  assert.match(connectContactsSource, /status: 'unavailable'/);
  assert.doesNotMatch(connectContactsSource, /expo-contacts|getContactsAsync|requestPermissionsAsync|fetch\(|XMLHttpRequest/);
  assert.match(communitySource, /authMode === 'clerk'/);
  assert.match(communitySource, /Community unavailable/);
  assert.match(communitySource, /ProductionAuthenticatedUnavailableNotice/);
  assert.match(conciergeSource, /authMode === 'clerk'/);
  assert.match(conciergeSource, /demoMode/);
  assert.match(conciergeSource, /<DemoConciergeChat \/>/);
  assert.match(conciergeSource, /isAiConciergeIntegrationEnabled\(\)/);
  assert.match(conciergeSource, /ProductionAiConciergeChat/);
  assert.match(conciergeSource, /AI Concierge unavailable/);
  assert.match(conciergeSource, /clerk-concierge-unavailable/);
  assert.match(conciergeSource, /ProductionAuthenticatedUnavailableNotice/);
  const paymentMethodsSource = readFileSync(resolve(projectRoot, "app/account/payment-methods.tsx"), "utf8");
  assert.match(paymentMethodsSource, /Manage Your Payment Method/);
  assert.match(paymentMethodsSource, /DESTINATION\.label/);
  assert.match(paymentMethodsSource, /openMembershipPaymentWebsite/);
  const paymentWebsiteSource = readFileSync(resolve(projectRoot, "lib/membershipPaymentMethod.ts"), "utf8");
  assert.match(paymentWebsiteSource, /Open Bluebird Website/);
  assert.match(paymentWebsiteSource, /https:\/\/bluebirdjets\.com/);
  assert.doesNotMatch(paymentMethodsSource, /Payment method unavailable|authMode === 'clerk'|getMembership|fetch\(|4242|5100/);
  const personalInfoSource = readFileSync(resolve(projectRoot, "app/account/personal-info.tsx"), "utf8");
  assert.match(personalInfoSource, /authMode === 'clerk'/);
  assert.match(personalInfoSource, /<ClerkPersonalInfoScreen \/>/);
  assert.match(personalInfoSource, /loadClerkPersonalInfo\(createApi\(\)\.authenticated, signal\)/);
  assert.match(personalInfoSource, /currentIdentity\.current !== clerkUserId/);
  assert.match(personalInfoSource, /<Stack\.Screen options=\{\{ headerShown: false \}\} \/>/);
  assert.match(personalInfoSource, /formatClerkDateOfBirth\(values\.dob\)/);
  assert.match(personalInfoSource, /cachedProfile\.current/);
  assert.match(personalInfoSource, /<BluebirdLogo variant="symbol"/);
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
  assert.match(clerkNotifications, /enabled: canLoadPreferences/);
  assert.match(clerkNotifications, /useFocusEffect\(React\.useCallback/);
  assert.match(clerkNotifications, /clerk-retry-notification-preferences/);
  assert.match(clerkNotifications, /label: 'Membership Updates', hint: 'Coming soon', disabled: true/);
  assert.doesNotMatch(clerkNotifications, /clerk-connection-request-notifications|CONNECTION_REQUEST_NOTIFICATION|canControlConnectionRequestPushPreference|title="Connections"/);
  assert.doesNotMatch(clerkNotifications, /synchronize phone information|Notification History|Push Delivery|clerk-load-notification-preferences|clerk-refresh-notification-preferences/);
  assert.match(clerkNotifications, /api\.authenticated\.updateProfile/);
  assert.match(clerkNotifications, /saveClerkNotificationPreferences/);
  assert.doesNotMatch(clerkNotifications, /useUpdateMe|useMarkNotificationRead|useListNotifications/);
  assert.match(notificationsSource, /authMode === 'clerk'/);
  assert.match(clerkNotifications, /Choose airport/);
  assert.match(clerkNotifications, /router\.push\('\/airport-picker'/);
  assert.match(clerkNotifications, /title="Travel Preferences"/);
  assert.match(clerkNotifications, /router\.canGoBack\(\) \? router\.back\(\)/);
  const preferenceEditorSource = readFileSync(resolve(projectRoot, "components/NotificationPreferenceEditor.tsx"), "utf8");
  assert.match(preferenceEditorSource, /International Flights/);
  assert.match(preferenceEditorSource, /Coming soon/);
  assert.match(preferenceEditorSource, /Queue Updates/);
  assert.match(preferenceEditorSource, /Flight Confirmations/);
  assert.match(preferenceEditorSource, /Flights from my Home Airport/);
  assert.match(preferenceEditorSource, /All Flights/);
  assert.match(preferenceEditorSource, /mode === 'specific'/);
  const airportPickerSource = readFileSync(resolve(projectRoot, "app/airport-picker.tsx"), "utf8");
  assert.match(airportPickerSource, /fetchProductionAirportSearch/);
  assert.match(airportPickerSource, /saveClerkHomeAirport/);
  assert.match(airportPickerSource, /canSaveClerkNotificationPreferencesToAccount/);
  assert.match(airportPickerSource, /if \(!accountWritesEnabled \|\| !selectedAirport/);
  assert.match(airportPickerSource, /Home airport changes cannot be saved right now/);
  assert.match(airportPickerSource, /buildHomeAirportProfileUpdate/);
  assert.match(airportPickerSource, /Loading the saved profile may synchronize phone information/);
  assert.match(airportPickerSource, /Complete your profile before changing your home airport/);
  assert.match(notificationsSource, /router\.canGoBack\(\) \? router\.back\(\)/);
  assert.match(membershipSource, /loadDashboardProductionMembership/);
  assert.doesNotMatch(membershipSource, /loadPreparedMobileMembership|\/api\/mobile\/membership|\/api\/mobile\/plans|readApprovedDashboardMembership/);
  assert.doesNotMatch(clerkMembership, /loadClerkBluebirdMembership|getMembership\(/);
  assert.match(clerkMembership, /presentMembershipDashboard/);
  assert.match(clerkMembership, /router\.push\('\/concierge'/);
  assert.doesNotMatch(clerkMembership, /router\.(push|replace)\('\/\(tabs\)\/discover'/);
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
  assert.match(clerkTripsSource, /visibleItems\?\.length === 0/);
  assert.match(clerkTripsSource, /Your trip information is unavailable right now/);
  assert.match(clerkTripsSource, /clerk-trips-discover/);
  assert.match(clerkTripsSource, /Discover Flights/);
  assert.match(clerkTripsSource, /router\.replace\('\/\(tabs\)\/discover'/);
  assert.doesNotMatch(clerkTripsSource, /useListTrips|useGetQueueStatus|useCancelTrip|useMutation/);
  assert.match(clerkTripsSource, /router\.push\(target\)/);
  assert.doesNotMatch(clerkTripsSource, /getEmptyLegQueue|joinEmptyLegQueue|leaveEmptyLegQueue|updateProfile|getMembership|passengers|manifest|boardingPass|getTrip\(/);
  assert.match(tripsSource, /authMode === 'legacy' && isLocalFlightReadMode\(\)/);
  assert.match(tripsSource, /enabled: memberQueryEnabled/);
});

test("member-data query gates require local demo mode and a legacy-auth member", () => {
  assert.equal(shouldUseLocalFlightReadMode("clerk", true), false);
  assert.equal(shouldUseLocalFlightReadMode("legacy", true), true);
  assert.equal(shouldUseLocalFlightReadMode("legacy", false), false);
  const flightDetailSource = readFileSync(resolve(projectRoot, "app/flight/[id].tsx"), "utf8");
  assert.match(flightDetailSource, /shouldUseLocalFlightReadMode\(authMode, isLocalFlightReadMode\(\)\)/);
  assert.match(flightDetailSource, /productionFlightDetailQueryKey\(numericFlightId, viewerScope\)/);
  assert.match(flightDetailSource, /fetchProductionFlight\(flightId, \{/);
  assert.doesNotMatch(flightDetailSource, /fetchProductionFlights/);
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
