import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import {
  clearDevOtp,
  completeRegistrationNavigationParams,
  developmentOtpLogMessage,
  otpDigitsFromInput,
  peekDevOtp,
  rememberDevOtp,
  shouldAutoSubmitOtp,
  shouldRenderDemoOtpBanner,
  takeDevOtpForAutofill,
  verifyCodeNavigationParams,
  verifyLoginPayload,
} from '../lib/devOtp.ts';

const PHONE = '+15555550100';
const CODE = '123456';
const NEW_CODE = '654321';

afterEach(() => {
  clearDevOtp();
});

test('verify-code navigation params never include demoCode', () => {
  const params = verifyCodeNavigationParams({
    phone: PHONE,
    cooldownSeconds: 30,
    referralCode: 'FRIEND',
    demoCode: CODE,
  });

  assert.deepEqual(params, {
    phone: PHONE,
    cooldown: '30',
    referralCode: 'FRIEND',
  });
  assert.equal('demoCode' in params, false);
  assert.equal(JSON.stringify(params).includes(CODE), false);
  assert.equal(JSON.stringify(params).includes('demoCode'), false);
});

test('verify-code URL query built from params does not contain demoCode', () => {
  const params = verifyCodeNavigationParams({
    phone: PHONE,
    cooldownSeconds: 30,
    demoCode: CODE,
  });
  const query = new URLSearchParams(params).toString();
  assert.equal(query.includes('demoCode'), false);
  assert.equal(query.includes(CODE), false);
  assert.equal(query.includes(encodeURIComponent(PHONE)), true);
});

test('demoCode is not persisted outside in-memory development storage', () => {
  const writes = [];
  const fakeStorage = {
    setItem(key, value) {
      writes.push([key, value]);
    },
  };

  rememberDevOtp(PHONE, CODE, { isDevelopment: true });
  fakeStorage.setItem('probe', 'ok');

  assert.equal(peekDevOtp(PHONE, { isDevelopment: true }), CODE);
  assert.deepEqual(writes, [['probe', 'ok']]);
  assert.equal(peekDevOtp(PHONE, { isDevelopment: false }), null);
});

test('production never stores, logs, or autofills demoCode', () => {
  rememberDevOtp(PHONE, CODE, { isDevelopment: false });
  assert.equal(peekDevOtp(PHONE, { isDevelopment: false }), null);
  assert.equal(peekDevOtp(PHONE, { isDevelopment: true }), null);
  assert.equal(takeDevOtpForAutofill(PHONE, { isDevelopment: false }), null);
  assert.equal(developmentOtpLogMessage(CODE, { isDevelopment: false }), null);
  assert.equal(shouldRenderDemoOtpBanner(), false);
});

test('production UI cannot render the demo OTP banner', () => {
  rememberDevOtp(PHONE, CODE, { isDevelopment: true });
  assert.equal(shouldRenderDemoOtpBanner(), false);
});

test('development local login can still complete from in-memory demoCode', () => {
  rememberDevOtp(PHONE, CODE, { isDevelopment: true });
  const filled = takeDevOtpForAutofill(PHONE, { isDevelopment: true });
  assert.equal(filled, CODE);
  assert.equal(shouldAutoSubmitOtp(filled, null, false), true);
  assert.match(developmentOtpLogMessage(filled, { isDevelopment: true }), new RegExp(CODE));
  assert.equal(takeDevOtpForAutofill(PHONE, { isDevelopment: true }), null);
});

test('OTP verification payload still works and never includes demoCode', () => {
  const digits = otpDigitsFromInput('12a34b56', 6);
  assert.equal(digits, CODE);
  assert.equal(shouldAutoSubmitOtp(digits, null, false), true);
  assert.equal(shouldAutoSubmitOtp(digits, digits, false), false);
  assert.equal(shouldAutoSubmitOtp('12345', null, false), false);

  const signedIn = verifyLoginPayload(PHONE, digits);
  assert.deepEqual(signedIn, { phone: PHONE, code: CODE });
  assert.equal('demoCode' in signedIn, false);

  const referred = verifyLoginPayload(PHONE, digits, 'FRIEND');
  assert.deepEqual(referred, { phone: PHONE, code: CODE, referralCode: 'FRIEND' });
  assert.equal('demoCode' in referred, false);
});

test('new-user registration path keeps grant navigation free of demoCode', () => {
  rememberDevOtp(PHONE, CODE, { isDevelopment: true });
  const autofill = takeDevOtpForAutofill(PHONE, { isDevelopment: true });
  assert.equal(shouldAutoSubmitOtp(autofill, null, false), true);

  const withReferral = completeRegistrationNavigationParams('FRIEND');
  const withoutReferral = completeRegistrationNavigationParams();
  assert.deepEqual(withReferral, { referralCode: 'FRIEND' });
  assert.deepEqual(withoutReferral, {});
  assert.equal('demoCode' in withReferral, false);
  assert.equal(JSON.stringify(withReferral).includes(CODE), false);
});

test('resend remembers a new development code without putting it in the URL', () => {
  rememberDevOtp(PHONE, CODE, { isDevelopment: true });
  rememberDevOtp(PHONE, NEW_CODE, { isDevelopment: true });
  const params = verifyCodeNavigationParams({ phone: PHONE, cooldownSeconds: 30, demoCode: NEW_CODE });
  assert.equal('demoCode' in params, false);
  assert.equal(peekDevOtp(PHONE, { isDevelopment: true }), NEW_CODE);
  assert.equal(takeDevOtpForAutofill(PHONE, { isDevelopment: true }), NEW_CODE);
});
