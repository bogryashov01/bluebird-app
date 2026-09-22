/**
 * Development-only in-memory OTP handoff.
 *
 * The local API may return demoCode because SMS is not sent. That value must
 * never go in a URL, router params, AsyncStorage, SecureStore, or production UI.
 */

export type DevOtpOptions = {
  isDevelopment?: boolean;
};

type MemorySlot = { phone: string; code: string } | null;

let slot: MemorySlot = null;
let lastAutofillKey = '';

function defaultIsDevelopment(): boolean {
  if (typeof __DEV__ !== 'undefined') return __DEV__;
  return process.env.NODE_ENV !== 'production';
}

function isDevelopment(options?: DevOtpOptions): boolean {
  return options?.isDevelopment ?? defaultIsDevelopment();
}

function normalizeCode(code: string | null | undefined): string | null {
  const digits = (code ?? '').replace(/\D/g, '');
  return digits.length === 6 ? digits : null;
}

export function clearDevOtp(): void {
  slot = null;
  lastAutofillKey = '';
}

export function rememberDevOtp(
  phone: string,
  code: string | null | undefined,
  options?: DevOtpOptions,
): void {
  if (!isDevelopment(options)) {
    slot = null;
    lastAutofillKey = '';
    return;
  }

  const normalized = normalizeCode(code);
  if (!phone || !normalized) {
    slot = null;
    return;
  }

  slot = { phone, code: normalized };
  lastAutofillKey = '';
}

export function peekDevOtp(phone: string, options?: DevOtpOptions): string | null {
  if (!isDevelopment(options) || !phone || !slot) return null;
  return slot.phone === phone ? slot.code : null;
}

/**
 * Returns the in-memory code once per phone+code pair so Strict Mode remounts
 * do not auto-submit the same OTP twice.
 */
export function takeDevOtpForAutofill(phone: string, options?: DevOtpOptions): string | null {
  const code = peekDevOtp(phone, options);
  if (!code) return null;
  const key = `${phone}:${code}`;
  if (lastAutofillKey === key) return null;
  lastAutofillKey = key;
  return code;
}

/** Production and development UI both hide the demo OTP card. */
export function shouldRenderDemoOtpBanner(): boolean {
  return false;
}

export function developmentOtpLogMessage(
  code: string | null | undefined,
  options?: DevOtpOptions,
): string | null {
  if (!isDevelopment(options)) return null;
  const normalized = normalizeCode(code);
  if (!normalized) return null;
  return `[bluebird] Development OTP (SMS not sent): ${normalized}`;
}

export function otpDigitsFromInput(raw: string, length = 6): string {
  return raw.replace(/\D/g, '').slice(0, length);
}

export function shouldAutoSubmitOtp(
  digits: string,
  submitted: string | null,
  pending: boolean,
  length = 6,
): boolean {
  return digits.length === length && submitted !== digits && !pending;
}

export function verifyLoginPayload(
  phone: string,
  code: string,
  referralCode?: string,
): { phone: string; code: string; referralCode?: string } {
  return {
    phone,
    code,
    ...(referralCode ? { referralCode } : {}),
  };
}

export function verifyCodeNavigationParams(input: {
  phone: string;
  cooldownSeconds?: number;
  referralCode?: string;
  demoCode?: string;
}): Record<string, string> {
  const params: Record<string, string> = { phone: input.phone };
  if (input.cooldownSeconds && input.cooldownSeconds > 0) {
    params.cooldown = String(input.cooldownSeconds);
  }
  if (input.referralCode) {
    params.referralCode = input.referralCode;
  }
  return params;
}

export function completeRegistrationNavigationParams(
  referralCode?: string,
): Record<string, string> {
  return referralCode ? { referralCode } : {};
}
