import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  BLUEBIRD_WEBSITE_ENTRY_URL,
  MEMBERSHIP_PAYMENT_METHOD_READ_VERIFIED,
  MEMBERSHIP_PAYMENT_WEBSITE_OPEN_ERROR,
  isOfficialBluebirdWebsiteEntry,
  membershipPaymentWebsiteDestination,
  openMembershipPaymentWebsite,
} from "../scripts/.membership-payment-method.test.mjs";
import { isNativeProductionAuthTestRequestAllowed } from "../scripts/.membership-payment-policy.test.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const screen = readFileSync(resolve(projectRoot, "app/account/payment-methods.tsx"), "utf8");
const model = readFileSync(resolve(projectRoot, "lib/membershipPaymentMethod.ts"), "utf8");
const policy = readFileSync(resolve(projectRoot, "lib/nativeAuthTestPolicy.ts"), "utf8");
const profile = readFileSync(resolve(projectRoot, "app/(tabs)/profile/index.tsx"), "utf8");
const membership = readFileSync(resolve(projectRoot, "app/(tabs)/membership/index.tsx"), "utf8");
const rootLayout = readFileSync(resolve(projectRoot, "app/_layout.tsx"), "utf8");

test("Payment Methods does not offer an unverified website or card flow", () => {
  assert.match(screen, /Payment Methods/);
  assert.match(screen, /Payments are not available in the app/);
  assert.match(screen, /does not sell memberships or collect card details/);
  assert.match(screen, /testID="payment-methods-unavailable"/);
  assert.match(screen, /name="credit-card"/);
  assert.doesNotMatch(screen, /openMembershipPaymentWebsite|Linking\.openURL|external-link|update your card/);
  assert.doesNotMatch(screen, /Add Card|Remove Card|Set Default|TextInput|WebView/);
});

test("the button opens only the official Bluebird website entry", async () => {
  const destination = membershipPaymentWebsiteDestination();
  assert.equal(destination.url, "https://bluebirdjets.com");
  assert.equal(destination.url, BLUEBIRD_WEBSITE_ENTRY_URL);
  assert.equal(destination.label, "Open Bluebird Website");
  assert.equal(destination.directPaymentPathVerified, false);
  assert.equal(isOfficialBluebirdWebsiteEntry(destination.url), true);
  assert.match(model, /Open Bluebird Website/);
  assert.doesNotMatch(screen, /testID="payment-methods-open-website"/);
  assert.doesNotMatch(screen, /Linking\.openURL/);

  const opened = [];
  assert.equal(
    await openMembershipPaymentWebsite(async (url) => {
      opened.push(url);
    }),
    "opened",
  );
  assert.deepEqual(opened, ["https://bluebirdjets.com"]);
  assert.equal(new URL(opened[0]).search, "");
  assert.equal(new URL(opened[0]).hash, "");
  assert.equal(new URL(opened[0]).username, "");
  assert.equal(new URL(opened[0]).pathname, "/");
});

test("a failed browser open stays on the screen with a recovery note", async () => {
  assert.equal(
    await openMembershipPaymentWebsite(async () => {
      throw new Error("browser unavailable");
    }),
    "unavailable",
  );
  assert.doesNotMatch(screen, /payment-methods-open-error/);
  assert.equal(
    MEMBERSHIP_PAYMENT_WEBSITE_OPEN_ERROR,
    "The Bluebird website couldn’t be opened. Try again in a moment.",
  );
});

test("invented payment paths, tokens, and other hosts are rejected", () => {
  for (const blocked of [
    "http://bluebirdjets.com",
    "https://bluebirdjets.com/api",
    "https://bluebirdjets.com/api/membership",
    "https://bluebirdjets.com/membership",
    "https://bluebirdjets.com/account",
    "https://bluebirdjets.com/?token=clerk",
    "https://bluebirdjets.com/#session",
    "https://user:secret@bluebirdjets.com",
    "https://bluebirdjets.com:444",
    "https://bluebird.co",
    "https://www.bluebirdjets.com",
    "https://bluebirdjets.com/invite/CODE",
  ]) {
    assert.equal(isOfficialBluebirdWebsiteEntry(blocked), false, blocked);
  }
});

test("no production payment request is sent and the auth-test allowlist is unchanged", () => {
  assert.equal(MEMBERSHIP_PAYMENT_METHOD_READ_VERIFIED, false);
  assert.doesNotMatch(
    `${screen}\n${model}`,
    /getMembership|fetch\(|requestPayment|createPayment|payment_method|INITIAL_CARDS|MockCard|XMLHttpRequest|Authorization|getToken/,
  );
  assert.doesNotMatch(screen, /\b(POST|PUT|PATCH|DELETE)\b/);
  assert.doesNotMatch(model, /getMembership|fetch\(|request\(/);
  assert.equal(isNativeProductionAuthTestRequestAllowed("https://bluebirdjets.com/api/membership", "GET"), true);
  assert.equal(isNativeProductionAuthTestRequestAllowed("https://bluebirdjets.com/api/membership", "POST"), false);
  assert.equal(isNativeProductionAuthTestRequestAllowed("https://bluebirdjets.com/api/membership/payment-method", "POST"), false);
  assert.equal(policy.includes("'/api/membership'"), true);
  assert.match(policy, /EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST === 'true'/);
});

test("Payment Methods is not linked from the Clerk member surfaces", () => {
  const clerkProfile = profile.split("if (authMode === 'clerk') {")[1]?.split("const demoProfile")[0] ?? "";
  const clerkMembership = membership.split("const clerkRows")[1]?.split("const mem =")[0] ?? "";
  assert.doesNotMatch(clerkProfile, /payment-methods/);
  assert.doesNotMatch(clerkMembership, /payment-methods/);
  assert.equal(
    [...profile.matchAll(/router\.push\('\/account\/payment-methods'/g)].length,
    1,
  );
  assert.match(screen, /accessibilityLabel="Back to Profile"/);
  assert.match(screen, /router\.canGoBack\(\)/);
  assert.match(screen, /router\.back\(\)/);
  assert.match(screen, /router\.replace\('\/\(tabs\)\/profile'/);
  assert.match(rootLayout, /name="account\/payment-methods"[\s\S]*?options=\{\{ headerShown: false \}\}/);
});
