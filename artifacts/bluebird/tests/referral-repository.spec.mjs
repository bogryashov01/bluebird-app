import assert from "node:assert/strict";
import { test } from "node:test";
import {
  areReferralAccountReadsEnabled,
  createProductionReferralRepository,
  formatReferralCredit,
  mapReferralStatistics,
  parseReferralAccountResponse,
  ReferralContractUnavailableError,
  referralSchemaRejectionReason,
} from "../scripts/.referral-program.test.mjs";
import {
  createReferralDemoStorageKey,
  MockReferralRepository,
} from "../scripts/.mock-referral.test.mjs";
import {
  clearPendingReferralCode,
  readPendingReferralCode,
  savePendingReferralCode,
  PENDING_REFERRAL_CODE_STORAGE_KEY,
} from "../scripts/.pending-referral.test.mjs";

function fixture() {
  return {
    code: "BB-PAUL2026",
    inviteUrl: "https://bluebird.co/join/BB-PAUL2026",
    statistics: {
      friendsActivated: 2,
      creditEarnedCents: 200_000,
      creditAppliedCents: 25_000,
      balanceCents: 175_000,
    },
  };
}

function createStorage(initial = new Map()) {
  return {
    values: initial,
    async getItem(key) { return this.values.get(key) ?? null; },
    async setItem(key, value) { this.values.set(key, value); },
    async removeItem(key) { this.values.delete(key); },
  };
}

test("formats referral currency from integer cents and rejects invalid cents", () => {
  assert.equal(formatReferralCredit(100_050), "$1,000.50");
  assert.equal(formatReferralCredit(0), "$0.00");
  assert.throws(() => formatReferralCredit(1.25), /integer/);
  assert.throws(() => mapReferralStatistics({
    friendsActivated: 1,
    creditEarnedCents: 1000,
    creditAppliedCents: -1,
    balanceCents: 0,
  }), /creditAppliedCents/);
});

test("mock repository hydrates, simulates only local qualifying activations, and persists", async () => {
  const storage = createStorage();
  const key = createReferralDemoStorageKey("member-a");
  const first = new MockReferralRepository(storage, key, fixture());
  const initial = await first.getReferralSnapshot();
  assert.equal(initial.statistics.friendsActivated, 2);
  assert.equal(initial.statistics.balanceCents, 175_000);
  assert.deepEqual(await first.validateCode(" bb-paul2026 "), { valid: true, code: "BB-PAUL2026" });
  assert.deepEqual(await first.validateCode("BB-OTHER"), { valid: false, code: "BB-OTHER" });
  assert.equal((await first.previewMembershipPricing("base", "BB-PAUL2026")).referralDiscountCents, 50_000);

  const afterActivation = await first.simulateQualifyingActivation();
  assert.deepEqual(afterActivation.statistics, {
    friendsActivated: 3,
    creditEarnedCents: 300_000,
    creditAppliedCents: 25_000,
    balanceCents: 275_000,
  });

  const restored = new MockReferralRepository(storage, key, fixture());
  assert.deepEqual(await restored.getReferralSnapshot(), afterActivation);
  assert.notEqual(key, createReferralDemoStorageKey("member-b"));
  assert.equal(storage.values.size, 1);
});

test("production referral snapshot reads only GET /api/me/referrals and blocks mutations", async () => {
  const calls = [];
  const repository = createProductionReferralRepository({
    async getReferrals() {
      calls.push("GET /api/me/referrals");
      return parseReferralAccountResponse({
        code: "PERSONAL_CODE",
        shareUrl: "https://bluebirdjets.com/invite/PERSONAL_CODE",
        successfulReferrals: 0,
        creditEarnedCents: 0,
        creditAppliedCents: 0,
        creditBalanceCents: 0,
      });
    },
  });
  assert.equal(areReferralAccountReadsEnabled(), true);
  assert.deepEqual(await repository.getReferralSnapshot(), {
    code: "PERSONAL_CODE",
    inviteUrl: "https://bluebirdjets.com/invite/PERSONAL_CODE",
    statistics: {
      friendsActivated: 0,
      creditEarnedCents: 0,
      creditAppliedCents: 0,
      balanceCents: 0,
    },
  });
  await assert.rejects(repository.validateCode("PERSONAL_CODE"), ReferralContractUnavailableError);
  await assert.rejects(repository.previewMembershipPricing("plus", "PERSONAL_CODE"), ReferralContractUnavailableError);
  assert.deepEqual(calls, ["GET /api/me/referrals"]);
});

test("referral account response maps one GET payload onto the existing screen snapshot", () => {
  assert.deepEqual(parseReferralAccountResponse({
    code: "PERSONAL_CODE",
    shareUrl: "https://bluebirdjets.com/invite/PERSONAL_CODE",
    successfulReferrals: 2,
    creditEarnedCents: 200_000,
    creditAppliedCents: 25_000,
    creditBalanceCents: 175_000,
  }), {
    code: "PERSONAL_CODE",
    inviteUrl: "https://bluebirdjets.com/invite/PERSONAL_CODE",
    statistics: {
      friendsActivated: 2,
      creditEarnedCents: 200_000,
      creditAppliedCents: 25_000,
      balanceCents: 175_000,
    },
  });
  assert.equal(parseReferralAccountResponse({
    code: "BB-PAUL2026",
    shareUrl: "https://www.bluebird.co/join/BB-PAUL2026",
    successfulReferrals: 0,
    creditEarnedCents: 0,
    creditAppliedCents: 0,
    creditBalanceCents: 0,
  }).statistics.friendsActivated, 0);
});

test("referral account response rejects untrusted share URLs and invalid codes", () => {
  const valid = {
    code: "PERSONAL_CODE",
    shareUrl: "https://bluebirdjets.com/invite/PERSONAL_CODE",
    successfulReferrals: 0,
    creditEarnedCents: 0,
    creditAppliedCents: 0,
    creditBalanceCents: 0,
  };
  const rejected = [
    { ...valid, shareUrl: "https://example.com/invite/PERSONAL_CODE" },
    { ...valid, shareUrl: "https://user:pass@bluebirdjets.com/invite/PERSONAL_CODE" },
    { ...valid, shareUrl: "https://bluebirdjets.com/invite/PERSONAL_CODE?next=https://evil.test" },
    { ...valid, shareUrl: "https://bluebirdjets.com/invite/OTHER_CODE" },
    { ...valid, shareUrl: "https://bluebirdjets.com:444/invite/PERSONAL_CODE" },
    { ...valid, code: " PERSONAL_CODE" },
    { ...valid, code: "" },
    { ...valid, code: "code with spaces" },
    { ...valid, code: "../PERSONAL_CODE" },
    { ...valid, successfulReferrals: -1 },
    { ...valid, creditBalanceCents: 1.5 },
    { ...valid, paymentMethod: "4242" },
    { friendsActivated: 1, creditEarnedCents: 0, creditAppliedCents: 0, balanceCents: 0 },
  ];
  for (const payload of rejected) {
    assert.throws(() => parseReferralAccountResponse(payload), ReferralContractUnavailableError);
  }
});

test("schema reasons distinguish the checks that remain after a trusted host and accepted code", () => {
  const observedShape = {
    code: "PERSONAL_CODE",
    shareUrl: "https://bluebirdjets.com/invite/PERSONAL_CODE",
    successfulReferrals: 0,
    creditEarnedCents: 0,
    creditAppliedCents: 0,
    creditBalanceCents: 0,
  };
  assert.equal(referralSchemaRejectionReason(observedShape), "none");
  assert.doesNotThrow(() => parseReferralAccountResponse(observedShape));

  const reasons = [
    [{ ...observedShape, shareUrl: "ftp://bluebirdjets.com/invite/PERSONAL_CODE" }, "share-url-protocol"],
    [{ ...observedShape, shareUrl: "http://example.com/invite/PERSONAL_CODE" }, "share-url-host"],
    [{ ...observedShape, shareUrl: "https://user:pass@bluebirdjets.com/invite/PERSONAL_CODE" }, "share-url-credentials"],
    [{ ...observedShape, shareUrl: "https://bluebirdjets.com:444/invite/PERSONAL_CODE" }, "share-url-port"],
    [{ ...observedShape, shareUrl: "https://bluebirdjets.com/invite/PERSONAL_CODE?ref=1" }, "share-url-query"],
    [{ ...observedShape, shareUrl: "https://bluebirdjets.com/invite/PERSONAL_CODE#gift" }, "share-url-hash"],
    [{ ...observedShape, shareUrl: "https://bluebirdjets.com/invite" }, "share-url-path"],
    [{ ...observedShape, successfulReferrals: "0" }, "successfulReferrals-type"],
    [{ ...observedShape, creditEarnedCents: "0" }, "creditEarnedCents-type"],
    [{ ...observedShape, creditAppliedCents: "0" }, "creditAppliedCents-type"],
    [{ ...observedShape, creditBalanceCents: "0" }, "creditBalanceCents-type"],
    [{ ...observedShape, creditBalanceCents: 1.5 }, "creditBalanceCents-integer"],
    [{ ...observedShape, creditAppliedCents: -1 }, "creditAppliedCents-negative"],
  ];
  for (const [payload, reason] of reasons) {
    assert.equal(referralSchemaRejectionReason(payload), reason);
    assert.throws(() => parseReferralAccountResponse(payload), ReferralContractUnavailableError);
    assert.equal(reason.includes("PERSONAL_CODE"), false);
    assert.equal(reason.includes("bluebirdjets.com"), false);
    assert.equal(reason.includes("https://"), false);
  }
});

test("HTTP referral URLs on trusted hosts are stored as HTTPS and other URLs stay rejected", () => {
  const account = {
    successfulReferrals: 0,
    creditEarnedCents: 0,
    creditAppliedCents: 0,
    creditBalanceCents: 0,
  };
  const trusted = [
    ["https://bluebirdjets.com/invite/PERSONAL_CODE", "https://bluebirdjets.com/invite/PERSONAL_CODE"],
    ["http://bluebirdjets.com/invite/PERSONAL_CODE", "https://bluebirdjets.com/invite/PERSONAL_CODE"],
    ["http://www.bluebirdjets.com/join/PERSONAL_CODE", "https://www.bluebirdjets.com/join/PERSONAL_CODE"],
    ["http://bluebird.co/join/PERSONAL_CODE", "https://bluebird.co/join/PERSONAL_CODE"],
    ["https://www.bluebird.co/invite/PERSONAL_CODE", "https://www.bluebird.co/invite/PERSONAL_CODE"],
  ];
  for (const [shareUrl, inviteUrl] of trusted) {
    const snapshot = parseReferralAccountResponse({ ...account, code: "PERSONAL_CODE", shareUrl });
    assert.equal(snapshot.inviteUrl, inviteUrl);
    assert.equal(snapshot.inviteUrl.startsWith("https://"), true);
    assert.equal(referralSchemaRejectionReason({ ...account, code: "PERSONAL_CODE", shareUrl }), "none");
  }

  const rejected = [
    "http://example.com/invite/PERSONAL_CODE",
    "https://example.com/invite/PERSONAL_CODE",
    "http://bluebirdjets.com.evil.example/invite/PERSONAL_CODE",
    "https://bluebirdjets.com/invite/OTHER_CODE",
    "http://bluebirdjets.com/invite/OTHER_CODE",
    "https://user:pass@bluebirdjets.com/invite/PERSONAL_CODE",
    "http://user:pass@bluebirdjets.com/invite/PERSONAL_CODE",
    "https://bluebirdjets.com:444/invite/PERSONAL_CODE",
    "http://bluebirdjets.com:8080/invite/PERSONAL_CODE",
    "https://bluebirdjets.com/invite/PERSONAL_CODE?next=1",
    "http://bluebirdjets.com/invite/PERSONAL_CODE?next=1",
    "https://bluebirdjets.com/invite/PERSONAL_CODE#gift",
    "http://bluebirdjets.com/invite/PERSONAL_CODE#gift",
    "https://bluebirdjets.com/invite",
    "http://bluebirdjets.com/account",
    "ftp://bluebirdjets.com/invite/PERSONAL_CODE",
  ];
  for (const shareUrl of rejected) {
    assert.throws(
      () => parseReferralAccountResponse({ ...account, code: "PERSONAL_CODE", shareUrl }),
      ReferralContractUnavailableError,
    );
    const reason = referralSchemaRejectionReason({ ...account, code: "PERSONAL_CODE", shareUrl });
    assert.equal(reason === "none", false);
    assert.equal(reason.includes("PERSONAL_CODE"), false);
    assert.equal(reason.includes("http"), false);
  }
});

test("pending referral code survives interruptions until explicitly cleared", async () => {
  const storage = createStorage();
  assert.equal(await readPendingReferralCode(storage), null);
  await savePendingReferralCode(" bb-friend-01 ", storage);
  assert.equal(storage.values.get(PENDING_REFERRAL_CODE_STORAGE_KEY), "BB-FRIEND-01");
  assert.equal(await readPendingReferralCode(storage), "BB-FRIEND-01");
  assert.equal(await readPendingReferralCode(storage), "BB-FRIEND-01");
  await clearPendingReferralCode(storage);
  assert.equal(await readPendingReferralCode(storage), null);
  await assert.rejects(savePendingReferralCode("NOT-A-BB-CODE", storage), /invalid/);
});
