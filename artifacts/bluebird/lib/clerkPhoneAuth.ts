export type ClerkPhoneAuthMode = 'sign-in' | 'sign-up';
export type ClerkPhoneAuthFailureStage =
  | 'input'
  | 'create'
  | 'code-preparation'
  | 'response'
  | 'verification'
  | 'session-activation'
  | 'resend'
  | 'navigation';

export interface ClerkPhoneAuthAttempt {
  status: string | null;
  createdSessionId: string | null;
  phoneVerificationStatus?: string | null;
}

export interface ClerkPhoneAuthActions {
  startSignIn: (phoneNumber: string) => Promise<ClerkPhoneAuthAttempt>;
  startSignUp: (phoneNumber: string) => Promise<void>;
  resendSignIn: () => Promise<void>;
  resendSignUp: () => Promise<void>;
  attemptSignIn: (code: string) => Promise<ClerkPhoneAuthAttempt>;
  attemptSignUp: (code: string) => Promise<ClerkPhoneAuthAttempt>;
  setActive: (sessionId: string) => Promise<void>;
}

export interface ClerkSignInPhoneAttempt extends ClerkPhoneAuthAttempt {
  supportedFirstFactors: ClerkSignInSupportedFirstFactor[] | null;
  firstFactorVerification: { status: string | null };
  prepareFirstFactor: (params: {
    strategy: 'phone_code';
    phoneNumberId: string;
  }) => Promise<ClerkSignInPhoneAttempt>;
}

export type ClerkSignInSupportedFirstFactor =
  | { strategy: 'phone_code'; phoneNumberId: string }
  | { strategy: string; phoneNumberId?: string };

export interface ClerkSignInPhoneResource {
  create: (params: { strategy: 'phone_code'; identifier: string }) => Promise<ClerkSignInPhoneAttempt>;
  supportedFirstFactors: ClerkSignInSupportedFirstFactor[] | null;
  prepareFirstFactor: (params: {
    strategy: 'phone_code';
    phoneNumberId: string;
  }) => Promise<ClerkSignInPhoneAttempt>;
  attemptFirstFactor: (params: { strategy: 'phone_code'; code: string }) => Promise<ClerkSignInPhoneAttempt>;
}

export interface ClerkSignUpPhoneAttempt extends ClerkPhoneAuthAttempt {
  verifications: { phoneNumber: { status: string | null } };
  preparePhoneNumberVerification: (params: { strategy: 'phone_code' }) => Promise<ClerkSignUpPhoneAttempt>;
}

export interface ClerkSignUpPhoneResource {
  create: (params: { phoneNumber: string }) => Promise<ClerkSignUpPhoneAttempt>;
  preparePhoneNumberVerification: (params: { strategy: 'phone_code' }) => Promise<ClerkSignUpPhoneAttempt>;
  attemptPhoneNumberVerification: (params: { code: string }) => Promise<ClerkSignUpPhoneAttempt>;
}

export function createClerkPhoneAuthActions(input: {
  signIn: ClerkSignInPhoneResource;
  signUp: ClerkSignUpPhoneResource;
  setActive: (params: { session: string }) => Promise<unknown>;
}): ClerkPhoneAuthActions {
  return {
    startSignIn: async (phoneNumber) => {
      const attempt = await runAtStage('create', () =>
        input.signIn.create({ strategy: 'phone_code', identifier: phoneNumber }),
      );
      const prepared = await runAtStage('code-preparation', () =>
        attempt.prepareFirstFactor({
          strategy: 'phone_code',
          phoneNumberId: getRequiredPhoneNumberId(attempt.supportedFirstFactors),
        }),
      );
      return {
        status: prepared.status,
        createdSessionId: prepared.createdSessionId,
        phoneVerificationStatus: prepared.firstFactorVerification?.status ?? null,
      };
    },
    startSignUp: async (phoneNumber) => {
      const attempt = await runAtStage('create', () => input.signUp.create({ phoneNumber }));
      try {
        await attempt.preparePhoneNumberVerification({ strategy: 'phone_code' });
      } catch (error) {
        if (isClerkNetworkFailure(error)) {
          throw new ClerkPhoneAuthStageError('code-preparation', error);
        }
        throw new ClerkPhoneAuthStageError('code-preparation', {
          code: 'signup_phone_verification_unavailable',
        });
      }
    },
    resendSignIn: async () => {
      await runAtStage('resend', async () => {
        await input.signIn.prepareFirstFactor({
          strategy: 'phone_code',
          phoneNumberId: getRequiredPhoneNumberId(input.signIn.supportedFirstFactors),
        });
      });
    },
    resendSignUp: async () => {
      await runAtStage('resend', () =>
        input.signUp.preparePhoneNumberVerification({ strategy: 'phone_code' }),
      );
    },
    attemptSignIn: async (code) => {
      const attempt = await runAtStage('verification', () =>
        input.signIn.attemptFirstFactor({ strategy: 'phone_code', code }),
      );
      return { status: attempt.status, createdSessionId: attempt.createdSessionId };
    },
    attemptSignUp: async (code) => {
      const attempt = await runAtStage('verification', () =>
        input.signUp.attemptPhoneNumberVerification({ code }),
      );
      return {
        status: attempt.status,
        createdSessionId: attempt.createdSessionId,
        phoneVerificationStatus: attempt.verifications.phoneNumber.status,
      };
    },
    setActive: async (sessionId) => {
      await runAtStage('session-activation', () => input.setActive({ session: sessionId }));
    },
  };
}

function getRequiredPhoneNumberId(
  factors: ClerkSignInSupportedFirstFactor[] | null,
): string {
  const phoneFactor = factors?.find((factor) => factor.strategy === 'phone_code');
  if (
    !phoneFactor ||
    typeof phoneFactor.phoneNumberId !== 'string' ||
    phoneFactor.phoneNumberId.trim().length === 0
  ) {
    throw Object.assign(new Error('Phone-code factor is unavailable.'), {
      code: 'phone_code_factor_unavailable',
    });
  }
  return phoneFactor.phoneNumberId;
}

export type ClerkPhoneAuthFailure = {
  ok: false;
  stage: ClerkPhoneAuthFailureStage;
  message: string;
};

export type ClerkPhoneAuthStartResult =
  | ClerkPhoneAuthFailure
  | { ok: true; nextStep: 'code'; phoneNumber?: string; verificationPending?: boolean };

export type ClerkPhoneAuthResult = ClerkPhoneAuthFailure | { ok: true };

class ClerkPhoneAuthStageError extends Error {
  constructor(
    readonly stage: ClerkPhoneAuthFailureStage,
    readonly originalError: unknown,
  ) {
    super('Clerk phone authentication stage failed.');
    this.name = 'ClerkPhoneAuthStageError';
  }
}

async function runAtStage<T>(
  stage: ClerkPhoneAuthFailureStage,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof ClerkPhoneAuthStageError) throw error;
    throw new ClerkPhoneAuthStageError(stage, error);
  }
}

function unwrapStageError(error: unknown): unknown {
  return error instanceof ClerkPhoneAuthStageError ? error.originalError : error;
}

function getFailureStage(
  error: unknown,
  fallback: ClerkPhoneAuthFailureStage,
): ClerkPhoneAuthFailureStage {
  return error instanceof ClerkPhoneAuthStageError ? error.stage : fallback;
}

export function normalizeClerkPhoneNumber(input: string): string | null {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, '');

  if (trimmed.startsWith('+')) {
    const normalized = `+${digits}`;
    return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
  }

  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

export function getClerkAuthErrorMessage(
  error: unknown,
  mode?: ClerkPhoneAuthMode,
  fallbackStage: ClerkPhoneAuthFailureStage = 'verification',
): string {
  const stage = getFailureStage(error, fallbackStage);
  const originalError = unwrapStageError(error);
  const code = getClerkErrorCode(originalError);

  if (code === 'form_identifier_exists' || code === 'identifier_exists' || code === 'form_phone_number_exists') {
    return 'That phone number already has a Clerk account. Sign in instead.';
  }
  if (code === 'form_identifier_not_found' || code === 'identifier_not_found') {
    return mode === 'sign-up'
      ? 'Clerk could not start an account with that number. Check the number and try again.'
      : 'No Clerk account was found for that number. Check it or create an account.';
  }
  if (code === 'form_code_incorrect' || code === 'form_code_expired' || code === 'verification_expired') {
    return code === 'form_code_incorrect'
      ? 'That code is incorrect. Check the SMS and try again.'
      : 'That code has expired. Request a new code and try again.';
  }
  if (code === 'form_param_format_invalid' || code === 'form_identifier_invalid') {
    return 'Enter a valid phone number, including the country code for numbers outside the US.';
  }
  if (isClerkNetworkFailure(originalError)) {
    return stage === 'verification'
      ? 'Clerk could not verify the code because the service could not be reached. Check your connection or request a new code.'
      : 'Clerk could not be reached. Check your connection and try again.';
  }
  if (
    code === 'verification_strategy_not_enabled' ||
    code === 'strategy_not_enabled' ||
    code === 'phone_number_verification_not_enabled' ||
    code === 'signup_phone_verification_unavailable'
  ) {
    return 'Clerk did not allow phone-code verification for sign-up. You remain signed out. Ask the app owner to enable phone verification before trying again.';
  }
  if (code === 'too_many_requests' || code === 'rate_limit_exceeded') {
    return 'Too many attempts. Wait a moment, then try again.';
  }

  if (stage === 'create') {
    return 'Clerk could not start sign-in. Check the phone number and try again.';
  }
  if (stage === 'code-preparation') {
    return 'Clerk could not prepare the verification code. Try sending the code again.';
  }
  if (stage === 'response') {
    return 'Clerk did not confirm that phone verification is pending. Try sending a new code or check the phone number.';
  }
  if (stage === 'resend') {
    return 'Clerk could not resend the verification code. Check your connection and try again.';
  }
  if (stage === 'verification') {
    return 'Clerk could not verify this code. Check it or request a new code.';
  }
  if (stage === 'session-activation') {
    return 'Clerk accepted the code but could not activate your session. You remain signed out; try verifying again.';
  }
  if (stage === 'navigation') {
    return 'Your Clerk session is active, but the signed-in screen could not be opened. Try returning to the app home screen.';
  }

  return 'Clerk authentication could not be completed. Please try again.';
}

export async function beginClerkPhoneAuth(
  mode: ClerkPhoneAuthMode,
  phoneInput: string,
  actions: ClerkPhoneAuthActions,
): Promise<ClerkPhoneAuthStartResult> {
  const phoneNumber = normalizeClerkPhoneNumber(phoneInput);
  if (!phoneNumber) {
    return {
      ok: false,
      stage: 'input',
      message: 'Enter a valid phone number. Use 10 US digits or include an international country code starting with +.',
    };
  }

  try {
    if (mode === 'sign-in') {
      const attempt = await actions.startSignIn(phoneNumber);
      const verificationPending =
        attempt.status === 'needs_first_factor' &&
        attempt.phoneVerificationStatus === 'unverified';
      if (!verificationPending) {
        return {
          ok: false,
          stage: 'response',
          message: getClerkAuthErrorMessage(null, mode, 'response'),
        };
      }
      return {
        ok: true,
        nextStep: 'code',
        phoneNumber,
        verificationPending,
      };
    }
    await actions.startSignUp(phoneNumber);
    return { ok: true, nextStep: 'code', phoneNumber };
  } catch (error) {
    return {
      ok: false,
      stage: getFailureStage(error, 'create'),
      message: getClerkAuthErrorMessage(error, mode, 'create'),
    };
  }
}

export async function resendClerkPhoneCode(
  mode: ClerkPhoneAuthMode,
  actions: ClerkPhoneAuthActions,
): Promise<ClerkPhoneAuthResult> {
  try {
    if (mode === 'sign-in') await actions.resendSignIn();
    else await actions.resendSignUp();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      stage: getFailureStage(error, 'resend'),
      message: getClerkAuthErrorMessage(error, mode, 'resend'),
    };
  }
}

export async function verifyClerkPhoneCode(
  mode: ClerkPhoneAuthMode,
  codeInput: string,
  actions: ClerkPhoneAuthActions,
): Promise<ClerkPhoneAuthResult> {
  const code = codeInput.trim();
  if (!/^\d{4,8}$/.test(code)) {
    return {
      ok: false,
      stage: 'verification',
      message: 'Enter the verification code from the SMS.',
    };
  }

  try {
    const attempt = mode === 'sign-in'
      ? await actions.attemptSignIn(code)
      : await actions.attemptSignUp(code);

    if (mode === 'sign-up' && attempt.phoneVerificationStatus !== 'verified') {
      return {
        ok: false,
        stage: 'verification',
        message: 'Clerk has not confirmed this phone number. You remain signed out. Request another code or ask the app owner to check the Clerk sign-up verification settings.',
      };
    }
    if (attempt.status !== 'complete' || !attempt.createdSessionId) {
      return {
        ok: false,
        stage: 'verification',
        message: mode === 'sign-in'
          ? 'Clerk needs another sign-in step that this screen cannot complete. You remain signed out; contact the app owner for help.'
          : 'Clerk requires additional sign-up information. You remain signed out; contact the app owner for help.',
      };
    }

    await actions.setActive(attempt.createdSessionId);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      stage: getFailureStage(error, 'verification'),
      message: getClerkAuthErrorMessage(error, mode, 'verification'),
    };
  }
}

function getClerkErrorCode(error: unknown): string | null {
  error = unwrapStageError(error);
  if (typeof error !== 'object' || error === null) return null;
  if ('code' in error && typeof error.code === 'string') return error.code;
  if ('errors' in error && Array.isArray(error.errors)) {
    const firstError: unknown = error.errors[0];
    if (
      typeof firstError === 'object' &&
      firstError !== null &&
      'code' in firstError &&
      typeof firstError.code === 'string'
    ) {
      return firstError.code;
    }
  }
  return null;
}

export function isClerkNetworkFailure(error: unknown): boolean {
  error = unwrapStageError(error);
  if (error instanceof TypeError) return true;
  if (typeof error !== 'object' || error === null) return false;
  if (
    'status' in error &&
    typeof error.status === 'number' &&
    (error.status === 0 || error.status >= 500)
  ) {
    return true;
  }
  const code = getClerkErrorCode(error);
  return code === 'network_error' || code === 'clerk_network_error' || code === 'fetch_failed';
}
