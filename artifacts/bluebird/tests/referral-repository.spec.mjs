import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createProductionReferralRepository,
  formatReferralCredit,
  mapReferralStatistics,
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

test("production repository maps the contract methods without legacy endpoint fallback", async () => {
  const calls = [];
  const repository = createProductionReferralRepository({
    async getInviteCode() {
      calls.push("GET /api/me/invite-code");
      return { code: "BB-ALICE99", inviteUrl: "https://invite.example.test/join/BB-ALICE99" };
    },
    async getReferrals() {
      calls.push("GET /api/me/referrals");
      return { friendsActivated: 4, creditEarnedCents: 400_000, creditAppliedCents: 20_000, balanceCents: 380_000 };
    },
    async validateInvite(data) {
      calls.push(`POST /api/invites/validate ${data.code}`);
      return { valid: true, code: data.code };
    },
    async previewMembershipPricing(data) {
      calls.push(`POST /api/membership/preview-pricing ${data.tier} ${data.inviteCode}`);
      return { pricing: "contract-response" };
    },
  });
  const snapshot = await repository.getReferralSnapshot();
  assert.deepEqual(snapshot, {
    code: "BB-ALICE99",
    inviteUrl: "https://invite.example.test/join/BB-ALICE99",
    statistics: {
      friendsActivated: 4,
      creditEarnedCents: 400_000,
      creditAppliedCents: 20_000,
      balanceCents: 380_000,
    },
  });
  assert.deepEqual(await repository.validateCode(" bb-alice99 "), { valid: true, code: "BB-ALICE99" });
  assert.deepEqual(await repository.previewMembershipPricing("plus", "bb-alice99"), { pricing: "contract-response" });
  assert.deepEqual(calls, [
    "GET /api/me/invite-code",
    "GET /api/me/referrals",
    "POST /api/invites/validate BB-ALICE99",
    "POST /api/membership/preview-pricing plus BB-ALICE99",
  ]);
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
