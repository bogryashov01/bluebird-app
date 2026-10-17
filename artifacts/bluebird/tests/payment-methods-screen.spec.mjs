import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const screen = readFileSync(resolve(projectRoot, "app/account/payment-methods.tsx"), "utf8");
const profile = readFileSync(resolve(projectRoot, "app/(tabs)/profile/index.tsx"), "utf8");
const rootLayout = readFileSync(resolve(projectRoot, "app/_layout.tsx"), "utf8");

test("Payment Methods shows the honest empty state without card data or payment controls", () => {
  for (const copy of [
    "Payment Methods",
    "Your payment methods",
    "Manage payment methods for your Bluebird membership.",
    "No payment methods available",
    "Payment method management is coming soon.",
  ]) {
    assert.ok(screen.includes(copy), `missing required copy: ${copy}`);
  }

  assert.match(screen, /name="credit-card"/);
  assert.match(screen, /testID="payment-methods-empty-state"/);
  assert.doesNotMatch(
    screen,
    /INITIAL_CARDS|MockCard|usePersistedState|paymentMethods\\.|TextInput|Modal|Add Card|Add payment method|card number|CVC|CVV|expiration|set default|remove-card/,
  );
  assert.doesNotMatch(screen, /useAuth|createMainBluebirdApiIntegration/);
});

test("Payment Methods remains reachable from Profile and its back action preserves the Profile tab", () => {
  assert.equal(
    [...profile.matchAll(/router\.push\('\/account\/payment-methods'/g)].length,
    2,
    "both Profile auth-mode views should open Payment Methods",
  );
  assert.match(screen, /accessibilityLabel="Back to Profile"/);
  assert.match(screen, /router\.canGoBack\(\)/);
  assert.match(screen, /router\.back\(\)/);
  assert.match(screen, /router\.replace\('\/\(tabs\)\/profile'/);
  assert.match(rootLayout, /name="account\/payment-methods"[\s\S]*?options=\{\{ headerShown: false \}\}/);
});
