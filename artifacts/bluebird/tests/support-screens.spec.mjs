import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  EXTERNAL_RESOURCE_OPEN_ERROR,
  VERIFIED_SUPPORT_RESOURCES,
  isSafeExternalDestination,
  openVerifiedSupportResource,
  verifiedSupportResource,
} from "../scripts/.support-resources.test.mjs";
import { isNativeProductionAuthTestRequestAllowed } from "../scripts/.support-policy.test.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const help = readFileSync(resolve(projectRoot, "app/support/help-center.tsx"), "utf8");
const legal = readFileSync(resolve(projectRoot, "app/support/legal.tsx"), "utf8");
const page = readFileSync(resolve(projectRoot, "components/SupportPage.tsx"), "utf8");
const model = readFileSync(resolve(projectRoot, "lib/supportResources.ts"), "utf8");
const policy = readFileSync(resolve(projectRoot, "lib/nativeAuthTestPolicy.ts"), "utf8");
const profile = readFileSync(resolve(projectRoot, "app/(tabs)/profile/index.tsx"), "utf8");
const layout = readFileSync(resolve(projectRoot, "app/_layout.tsx"), "utf8");

test("Profile opens Help Center and Legal", () => {
  assert.equal([...profile.matchAll(/router\.push\('\/support\/help-center'/g)].length, 2);
  assert.equal([...profile.matchAll(/router\.push\('\/support\/legal'/g)].length, 2);
  assert.match(profile, /label: 'Help Center'/);
  assert.match(profile, /label: 'Legal'/);
  assert.match(layout, /name="support\/help-center"[\s\S]*?headerShown: false/);
  assert.match(layout, /name="support\/legal"[\s\S]*?headerShown: false/);
});

test("Help Center lists the confirmed support actions and does not open them on load", () => {
  assert.match(help, /Help Center/);
  assert.match(help, /How can we help\?/);
  assert.match(help, /Find answers to common questions or get in touch with the Bluebird team\./);
  assert.match(help, /\['faq', 'support-email', 'support-phone', 'contact-page'\]/);
  assert.match(help, /Linking\.openURL\(url\)/);
  assert.match(help, /onPress=/);
  assert.doesNotMatch(help, /useEffect|support@|legal@|What is an empty-leg|Skip the Line pass/);
  assert.equal(verifiedSupportResource("faq")?.url, "https://bluebirdjets.com/faq");
  assert.equal(verifiedSupportResource("faq")?.description, "Find answers to common questions about Bluebird.");
  assert.equal(verifiedSupportResource("support-email")?.url, "mailto:hello@bluebirdjets.com");
  assert.equal(verifiedSupportResource("support-email")?.label, "Email Support");
  assert.equal(verifiedSupportResource("support-email")?.description, "Get in touch with the Bluebird team.");
  assert.equal(verifiedSupportResource("support-phone")?.url, "tel:+13802499582");
  assert.equal(verifiedSupportResource("support-phone")?.description, "(380) 249-9582");
  assert.equal(verifiedSupportResource("contact-page")?.url, "https://bluebirdjets.com/contact");
  assert.equal(verifiedSupportResource("contact-page")?.description, "Visit the Bluebird contact page.");
});

test("Legal lists the confirmed website documents without embedding legal text", () => {
  assert.match(legal, /\['terms', 'privacy', 'flight-policy'\]/);
  assert.match(legal, /Official Bluebird documents open in your browser\./);
  assert.match(legal, /testID="legal-screen"/);
  assert.doesNotMatch(legal, /Last updated|legal@|support@|Memberships renew|Information We Collect|useEffect/);
  assert.equal(verifiedSupportResource("terms")?.url, "https://bluebirdjets.com/terms");
  assert.equal(verifiedSupportResource("privacy")?.url, "https://bluebirdjets.com/privacy");
  assert.equal(verifiedSupportResource("flight-policy")?.url, "https://bluebirdjets.com/flight-policy");
  assert.equal(VERIFIED_SUPPORT_RESOURCES.length, 7);
});

test("back returns through the stack or replaces Profile when opened directly", () => {
  assert.match(page, /accessibilityLabel="Back to Profile"/);
  assert.match(page, /router\.canGoBack\(\)/);
  assert.match(page, /router\.back\(\)/);
  assert.match(page, /router\.replace\('\/\(tabs\)\/profile'/);
  assert.match(help, /backTestID="help-center-back"/);
  assert.match(legal, /backTestID="legal-back"/);
});

test("each confirmed destination opens exactly once, and a handler failure stays on the screen", async () => {
  const opened = [];
  for (const id of ["faq", "support-email", "support-phone", "contact-page", "terms", "privacy", "flight-policy"]) {
    assert.equal(
      await openVerifiedSupportResource(verifiedSupportResource(id), async (url) => {
        opened.push(url);
      }),
      "opened",
    );
  }
  assert.deepEqual(opened, [
    "https://bluebirdjets.com/faq",
    "mailto:hello@bluebirdjets.com",
    "tel:+13802499582",
    "https://bluebirdjets.com/contact",
    "https://bluebirdjets.com/terms",
    "https://bluebirdjets.com/privacy",
    "https://bluebirdjets.com/flight-policy",
  ]);
  assert.equal(
    await openVerifiedSupportResource(verifiedSupportResource("support-email"), async () => {
      throw new Error("mail unavailable");
    }),
    "unavailable",
  );
  assert.equal(
    await openVerifiedSupportResource(verifiedSupportResource("support-phone"), async () => {
      throw new Error("phone unavailable");
    }),
    "unavailable",
  );
  assert.equal(EXTERNAL_RESOURCE_OPEN_ERROR, "This link couldn’t be opened. Try again in a moment.");
  assert.match(help, /help-center-open-error/);
  assert.match(legal, /legal-open-error/);
  assert.doesNotMatch(`${help}\n${legal}`, /email was sent|call completed|message sent/i);
});

test("unverified hosts, tokens, and the production API cannot be opened", async () => {
  for (const blocked of [
    "https://bluebirdjets.com",
    "https://bluebirdjets.com/api",
    "https://bluebirdjets.com/api/membership",
    "https://bluebirdjets.com/privacy?token=clerk",
    "https://user:secret@bluebirdjets.com/privacy",
    "https://bluebird.com/privacy",
    "https://bluebird.co/legal",
    "http://bluebirdjets.com/privacy",
    "mailto:support@bluebird.com?token=clerk",
    "mailto:support@bluebird.com",
    "mailto:legal@bluebird.com",
    "mailto:hello@bluebirdjets.com?token=clerk",
    "tel:+13802499582?token=clerk",
    "tel:+19995550100",
    "support@bluebird.com",
  ]) {
    assert.equal(isSafeExternalDestination(blocked), false, blocked);
  }
  assert.equal(isSafeExternalDestination("https://bluebirdjets.com/privacy"), true);
  assert.equal(isSafeExternalDestination("mailto:hello@bluebirdjets.com"), true);
  assert.equal(isSafeExternalDestination("tel:+13802499582"), true);
  let calls = 0;
  assert.equal(await openVerifiedSupportResource({
    id: "support-email",
    label: "Email Support",
    description: "Get in touch with the Bluebird team.",
    url: "mailto:legal@bluebird.com",
  }, async () => {
    calls += 1;
  }), "unavailable");
  assert.equal(await openVerifiedSupportResource({
    ...verifiedSupportResource("privacy"),
    url: "https://bluebirdjets.com/privacy?token=clerk",
  }, async () => {
    calls += 1;
  }), "unavailable");
  assert.equal(calls, 0);
  assert.doesNotMatch(`${help}\n${legal}`, /token=|getToken|hello@|bluebirdjets\.com\/|support@|legal@/);
  assert.match(model, /mailto:hello@bluebirdjets\.com/);
  assert.doesNotMatch(model, /mailto:support@|mailto:legal@|hello@bluebird\.co/);
});

test("support screens do not call production mutations and the auth allowlist stays unchanged", () => {
  assert.doesNotMatch(
    `${help}\n${legal}\n${page}\n${model}`,
    /getMembership|fetch\(|requestPayment|joinEmptyLegQueue|skipLine\(|getToken|Authorization|XMLHttpRequest/,
  );
  assert.doesNotMatch(`${help}\n${legal}`, /\b(POST|PUT|PATCH|DELETE)\b/);
  assert.equal(isNativeProductionAuthTestRequestAllowed("https://bluebirdjets.com/api/membership", "GET"), true);
  assert.equal(isNativeProductionAuthTestRequestAllowed("https://bluebirdjets.com/api/membership", "POST"), false);
  assert.equal(policy.includes("'/api/membership'"), true);
  assert.match(policy, /EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST === 'true'/);
  assert.doesNotMatch(policy, /help-center|\/support/);
});
