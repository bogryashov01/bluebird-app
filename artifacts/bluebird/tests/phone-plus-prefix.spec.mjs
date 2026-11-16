import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyPhonePlusPrefix,
  isPhonePlusPrefixOnly,
  optionalPhonePlusPrefixValue,
  phonePlusPrefixFieldProps,
  phonePlusPrefixForLegacyNormalize,
} from "../scripts/.phone-plus-prefix.test.mjs";

test("empty input becomes a single plus", () => {
  assert.equal(applyPhonePlusPrefix(""), "+");
  assert.equal(applyPhonePlusPrefix("   "), "+");
  assert.equal(isPhonePlusPrefixOnly(""), true);
  assert.equal(isPhonePlusPrefixOnly("+"), true);
  assert.equal(optionalPhonePlusPrefixValue("+"), null);
  assert.equal(optionalPhonePlusPrefixValue(""), null);
  assert.equal(optionalPhonePlusPrefixValue(null), null);
});

test("typing digits keeps a single plus prefix", () => {
  assert.equal(applyPhonePlusPrefix("1"), "+1");
  assert.equal(applyPhonePlusPrefix("+1"), "+1");
  assert.equal(applyPhonePlusPrefix("+15555550100"), "+15555550100");
  assert.equal(applyPhonePlusPrefix("5555550100"), "+5555550100");
});

test("deleting never removes the required plus", () => {
  assert.equal(applyPhonePlusPrefix("15555550100".slice(0, 0)), "+");
  assert.equal(applyPhonePlusPrefix(""), "+");
  assert.equal(applyPhonePlusPrefix("+"), "+");
  // Backspace that strips "+" leaves digits; prefix is restored.
  assert.equal(applyPhonePlusPrefix("15555550100"), "+15555550100");
});

test("paste with or without plus collapses duplicates and non-digits", () => {
  assert.equal(applyPhonePlusPrefix("++1"), "+1");
  assert.equal(applyPhonePlusPrefix("+ +1 (555) 555-0100"), "+15555550100");
  assert.equal(applyPhonePlusPrefix("1 (555) 555-0100"), "+15555550100");
  assert.equal(applyPhonePlusPrefix("+44 20 7946 0958"), "+442079460958");
  assert.equal(applyPhonePlusPrefix("+380 99 000 00 00"), "+380990000000");
});

test("existing international numbers stay E.164-shaped", () => {
  assert.equal(applyPhonePlusPrefix("+442079460958"), "+442079460958");
  assert.equal(applyPhonePlusPrefix("+380990000000"), "+380990000000");
  assert.equal(optionalPhonePlusPrefixValue("+15551234567"), "+15551234567");
  assert.equal(isPhonePlusPrefixOnly("+15551234567"), false);
});

test("caps at 15 digits after plus for E.164", () => {
  assert.equal(applyPhonePlusPrefix("+12345678901234567890"), "+123456789012345");
});

test("legacy normalize bridge keeps bare 10-digit US path for Clerk", () => {
  assert.equal(phonePlusPrefixForLegacyNormalize("+5555550100"), "5555550100");
  assert.equal(phonePlusPrefixForLegacyNormalize("5555550100"), "5555550100");
  assert.equal(phonePlusPrefixForLegacyNormalize("+15555550100"), "+15555550100");
  assert.equal(phonePlusPrefixForLegacyNormalize("+442079460958"), "+442079460958");
  assert.equal(phonePlusPrefixForLegacyNormalize("+"), "+");
});

test("field props keep plus visible and use phone-pad", () => {
  const updates = [];
  const empty = phonePlusPrefixFieldProps("", (next) => updates.push(next));
  assert.equal(empty.value, "+");
  assert.equal(empty.keyboardType, "phone-pad");
  empty.onFocus();
  assert.deepEqual(updates, ["+"]);

  updates.length = 0;
  const typed = phonePlusPrefixFieldProps("+1", (next) => updates.push(next));
  typed.onChangeText("++15");
  assert.deepEqual(updates, ["+15"]);

  updates.length = 0;
  const paste = phonePlusPrefixFieldProps("+", (next) => updates.push(next));
  paste.onChangeText("15551234567");
  assert.deepEqual(updates, ["+15551234567"]);

  updates.length = 0;
  const dirty = phonePlusPrefixFieldProps("1555", (next) => updates.push(next));
  assert.equal(dirty.value, "+1555");
  dirty.onFocus();
  assert.deepEqual(updates, ["+1555"]);
});
