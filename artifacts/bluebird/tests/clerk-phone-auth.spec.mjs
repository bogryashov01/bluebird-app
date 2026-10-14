import assert from "node:assert/strict";
import { test } from "node:test";
import {
  beginClerkPhoneAuth,
  createClerkPhoneAuthActions,
  normalizeClerkPhoneNumber,
  resendClerkPhoneCode,
  verifyClerkPhoneCode,
} from "../scripts/.clerk-phone-auth.test.mjs";

function makeResources(overrides = {}) {
  const calls = [];
  const signInAttempt = {
    status: "needs_first_factor",
    createdSessionId: null,
    firstFactorVerification: { status: "unverified" },
    prepareFirstFactor: async (params) => {
      calls.push(["prepare-sign-in-code", params]);
      if (overrides.prepareSignInError) throw overrides.prepareSignInError;
      return overrides.preparedSignInResult ?? signInAttempt;
    },
  };
  const signUpAttempt = {
    verifications: { phoneNumber: { status: "unverified" } },
    preparePhoneNumberVerification: async (params) => {
      calls.push(["prepare-sign-up-code", params]);
      if (overrides.prepareSignUpError) throw overrides.prepareSignUpError;
      return signUpAttempt;
    },
  };
  const signIn = {
    create: async (params) => {
      calls.push(["create-sign-in", params]);
      if (overrides.createSignInError) throw overrides.createSignInError;
      return signInAttempt;
    },
    prepareFirstFactor: async (params) => {
      calls.push(["resend-sign-in-code", params]);
      if (overrides.resendSignInError) throw overrides.resendSignInError;
      return signInAttempt;
    },
    attemptFirstFactor: async (params) => {
      calls.push(["attempt-sign-in-code", params]);
      const next = overrides.signInAttempts?.shift() ?? {
        status: "complete",
        createdSessionId: "mock-session-id",
      };
      if (next.error) throw next.error;
      return next;
    },
  };
  const signUp = {
    create: async (params) => {
      calls.push(["create-sign-up", params]);
      if (overrides.createSignUpError) throw overrides.createSignUpError;
      return signUpAttempt;
    },
    preparePhoneNumberVerification: async (params) => {
      calls.push(["resend-sign-up-code", params]);
      if (overrides.resendSignUpError) throw overrides.resendSignUpError;
      return signUpAttempt;
    },
    attemptPhoneNumberVerification: async (params) => {
      calls.push(["attempt-sign-up-code", params]);
      const next = overrides.signUpAttempts?.shift() ?? {
        status: "complete",
        createdSessionId: "mock-session-id",
        verifications: { phoneNumber: { status: "verified" } },
      };
      if (next.error) throw next.error;
      return next;
    },
  };
  let activationCalls = 0;
  const actions = createClerkPhoneAuthActions({
    signIn,
    signUp,
    setActive: async (params) => {
      calls.push(["set-active", params]);
      activationCalls += 1;
      if (overrides.setActiveError && activationCalls === 1) throw overrides.setActiveError;
    },
  });
  return { actions, calls, getActivationCalls: () => activationCalls };
}

test("phone normalization accepts US and international synthetic numbers only", () => {
  assert.equal(normalizeClerkPhoneNumber("(555) 555-0199"), "+15555550199");
  assert.equal(normalizeClerkPhoneNumber("1 555 555 0199"), "+15555550199");
  assert.equal(normalizeClerkPhoneNumber("+44 20 7946 0958"), "+442079460958");
  for (const invalid of ["", "55512", "55555501999", "+0123456789", "+1234567"]) {
    assert.equal(normalizeClerkPhoneNumber(invalid), null);
  }
});

test("sign-in creates a phone-code attempt, prepares it, verifies, and activates only a complete session", async () => {
  const fixture = makeResources();
  const started = await beginClerkPhoneAuth("sign-in", "(555) 555-0199", fixture.actions);
  assert.deepEqual(started, {
    ok: true,
    nextStep: "code",
    phoneNumber: "+15555550199",
    verificationPending: true,
  });
  assert.deepEqual(fixture.calls.slice(0, 2), [
    ["create-sign-in", { strategy: "phone_code", identifier: "+15555550199" }],
    ["prepare-sign-in-code", { strategy: "phone_code" }],
  ]);

  const verified = await verifyClerkPhoneCode("sign-in", "123456", fixture.actions);
  assert.deepEqual(verified, { ok: true });
  assert.deepEqual(fixture.calls.slice(-2), [
    ["attempt-sign-in-code", { strategy: "phone_code", code: "123456" }],
    ["set-active", { session: "mock-session-id" }],
  ]);
  assert.equal(fixture.getActivationCalls(), 1);
});

test("sign-up explicitly prepares phone-code verification and requires verified complete result", async () => {
  const fixture = makeResources();
  const started = await beginClerkPhoneAuth("sign-up", "+44 20 7946 0958", fixture.actions);
  assert.deepEqual(started, {
    ok: true,
    nextStep: "code",
    phoneNumber: "+442079460958",
  });
  assert.deepEqual(fixture.calls.slice(0, 2), [
    ["create-sign-up", { phoneNumber: "+442079460958" }],
    ["prepare-sign-up-code", { strategy: "phone_code" }],
  ]);

  const verified = await verifyClerkPhoneCode("sign-up", "654321", fixture.actions);
  assert.deepEqual(verified, { ok: true });
  assert.deepEqual(fixture.calls.slice(-2), [
    ["attempt-sign-up-code", { code: "654321" }],
    ["set-active", { session: "mock-session-id" }],
  ]);
  assert.equal(fixture.getActivationCalls(), 1);
});

test("successful SMS preparation with a pending first factor enters the code step without activating a session", async () => {
  const fixture = makeResources({
    preparedSignInResult: {
      status: "needs_first_factor",
      createdSessionId: null,
      firstFactorVerification: { status: "unverified" },
    },
  });
  let fetchCalls = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("unexpected network request");
  };
  try {
    const started = await beginClerkPhoneAuth("sign-in", "+15555550199", fixture.actions);

    assert.deepEqual(started, {
      ok: true,
      nextStep: "code",
      phoneNumber: "+15555550199",
      verificationPending: true,
    });
    assert.deepEqual(fixture.calls, [
      ["create-sign-in", { strategy: "phone_code", identifier: "+15555550199" }],
      ["prepare-sign-in-code", { strategy: "phone_code" }],
    ]);
    assert.equal(fixture.getActivationCalls(), 0);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("invalid phone numbers and codes do not call Clerk resources", async () => {
  const fixture = makeResources();
  const start = await beginClerkPhoneAuth("sign-in", "12", fixture.actions);
  const verify = await verifyClerkPhoneCode("sign-in", "not-a-code", fixture.actions);
  assert.equal(start.ok, false);
  assert.equal(start.stage, "input");
  assert.equal(verify.ok, false);
  assert.deepEqual(fixture.calls, []);
});

test("existing Clerk accounts get a sign-in recovery message without echoing phone values", async () => {
  const fixture = makeResources({ createSignUpError: { errors: [{ code: "form_identifier_exists" }] } });
  const result = await beginClerkPhoneAuth("sign-up", "+15555550199", fixture.actions);
  assert.equal(result.ok, false);
  assert.equal(result.stage, "create");
  assert.match(result.message, /already has a Clerk account\. Sign in instead/);
  assert.equal(result.message.includes("+15555550199"), false);
});

test("incorrect and expired codes are recoverable; resend and retry use mocked resources", async () => {
  const fixture = makeResources({
    signInAttempts: [
      { error: { errors: [{ code: "form_code_incorrect" }] } },
      { error: { errors: [{ code: "form_code_expired" }] } },
      { status: "complete", createdSessionId: "mock-session-id" },
    ],
  });
  const incorrect = await verifyClerkPhoneCode("sign-in", "111111", fixture.actions);
  assert.equal(incorrect.ok, false);
  assert.match(incorrect.message, /incorrect/);
  const resend = await resendClerkPhoneCode("sign-in", fixture.actions);
  assert.deepEqual(resend, { ok: true });
  const expired = await verifyClerkPhoneCode("sign-in", "222222", fixture.actions);
  assert.match(expired.message, /expired/);
  const retried = await verifyClerkPhoneCode("sign-in", "333333", fixture.actions);
  assert.deepEqual(retried, { ok: true });
  assert.equal(fixture.getActivationCalls(), 1);
});

test("network errors and Clerk verification-policy refusal do not activate sessions", async () => {
  const networkFixture = makeResources({ createSignInError: new TypeError("offline") });
  const networkResult = await beginClerkPhoneAuth("sign-in", "+15555550199", networkFixture.actions);
  assert.equal(networkResult.ok, false);
  assert.match(networkResult.message, /connection/);
  assert.equal(networkFixture.getActivationCalls(), 0);

  const outageFixture = makeResources({ prepareSignUpError: { status: 503 } });
  const outage = await beginClerkPhoneAuth("sign-up", "+15555550199", outageFixture.actions);
  assert.equal(outage.ok, false);
  assert.match(outage.message, /connection/);
  assert.equal(outageFixture.getActivationCalls(), 0);

  const refusedFixture = makeResources({ prepareSignUpError: { errors: [{ code: "strategy_not_enabled" }] } });
  const refused = await beginClerkPhoneAuth("sign-up", "+15555550199", refusedFixture.actions);
  assert.equal(refused.ok, false);
  assert.match(refused.message, /did not allow phone-code verification/);
  assert.equal(refusedFixture.getActivationCalls(), 0);
  assert.equal(refusedFixture.calls.some(([name]) => name === "attempt-sign-up-code"), false);
});

test("create, code-preparation, and verification failures report their lifecycle stage", async () => {
  const createFixture = makeResources({ createSignInError: { code: "clerk_api_error" } });
  const createFailure = await beginClerkPhoneAuth("sign-in", "+15555550199", createFixture.actions);
  assert.equal(createFailure.ok, false);
  assert.equal(createFailure.stage, "create");
  assert.match(createFailure.message, /could not start sign-in/i);

  const prepareFixture = makeResources({ prepareSignInError: { code: "clerk_api_error" } });
  const prepareFailure = await beginClerkPhoneAuth("sign-in", "+15555550199", prepareFixture.actions);
  assert.equal(prepareFailure.ok, false);
  assert.equal(prepareFailure.stage, "code-preparation");
  assert.match(prepareFailure.message, /could not prepare the verification code/i);

  const verifyFixture = makeResources({
    signInAttempts: [{ error: { code: "clerk_api_error" } }],
  });
  const verifyFailure = await verifyClerkPhoneCode("sign-in", "123456", verifyFixture.actions);
  assert.equal(verifyFailure.ok, false);
  assert.equal(verifyFailure.stage, "verification");
  assert.match(verifyFailure.message, /could not verify this code/i);
  assert.equal(createFixture.getActivationCalls(), 0);
  assert.equal(prepareFixture.getActivationCalls(), 0);
  assert.equal(verifyFixture.getActivationCalls(), 0);

  const missingAccountFixture = makeResources({
    createSignInError: { errors: [{ code: "form_identifier_not_found" }] },
  });
  const missingAccount = await beginClerkPhoneAuth(
    "sign-in",
    "+15555550199",
    missingAccountFixture.actions,
  );
  assert.equal(missingAccount.ok, false);
  assert.equal(missingAccount.stage, "create");
  assert.match(missingAccount.message, /No Clerk account was found/);

  const unexpectedResponseFixture = makeResources({
    preparedSignInResult: {
      status: "needs_second_factor",
      createdSessionId: null,
      firstFactorVerification: { status: null },
    },
  });
  const unexpectedResponse = await beginClerkPhoneAuth(
    "sign-in",
    "+15555550199",
    unexpectedResponseFixture.actions,
  );
  assert.equal(unexpectedResponse.ok, false);
  assert.equal(unexpectedResponse.stage, "response");
  assert.match(unexpectedResponse.message, /did not confirm that phone verification is pending/);
});

test("unverified and incomplete sign-up results stay signed out even if Clerk returns a session id", async () => {
  const unverifiedFixture = makeResources({
    signUpAttempts: [{
      status: "complete",
      createdSessionId: "mock-session-id",
      verifications: { phoneNumber: { status: "unverified" } },
    }],
  });
  const unverified = await verifyClerkPhoneCode("sign-up", "123456", unverifiedFixture.actions);
  assert.equal(unverified.ok, false);
  assert.match(unverified.message, /has not confirmed this phone number/);
  assert.equal(unverifiedFixture.getActivationCalls(), 0);

  const incompleteFixture = makeResources({
    signUpAttempts: [{
      status: "missing_requirements",
      createdSessionId: "mock-session-id",
      verifications: { phoneNumber: { status: "verified" } },
    }],
  });
  const incomplete = await verifyClerkPhoneCode("sign-up", "123456", incompleteFixture.actions);
  assert.equal(incomplete.ok, false);
  assert.equal(incomplete.stage, "verification");
  assert.match(incomplete.message, /additional sign-up information/);
  assert.equal(incompleteFixture.getActivationCalls(), 0);
});

test("failed session activation can be retried without exposing the session id", async () => {
  const fixture = makeResources({ setActiveError: new Error("mock activation failure") });
  const first = await verifyClerkPhoneCode("sign-in", "123456", fixture.actions);
  assert.equal(first.ok, false);
  assert.equal(first.stage, "session-activation");
  assert.match(first.message, /could not activate your session/);
  assert.equal(first.message.includes("mock-session-id"), false);
  const second = await verifyClerkPhoneCode("sign-in", "123456", fixture.actions);
  assert.deepEqual(second, { ok: true });
  assert.equal(fixture.getActivationCalls(), 2);
});

test("lifecycle tests only use injected Clerk resources and never call fetch", async () => {
  const fixture = makeResources();
  let fetchCalls = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("unexpected network request");
  };
  try {
    await beginClerkPhoneAuth("sign-in", "+15555550199", fixture.actions);
    await resendClerkPhoneCode("sign-in", fixture.actions);
    await verifyClerkPhoneCode("sign-in", "123456", fixture.actions);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
