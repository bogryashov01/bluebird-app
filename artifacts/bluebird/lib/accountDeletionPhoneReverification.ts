/**
 * Native phone OTP session reverification for account deletion.
 *
 * Uses Clerk Session startVerification / prepareFirstFactorVerification /
 * attemptFirstFactorVerification (and second-factor phone_code when required).
 * This is not the ordinary sign-in OTP flow.
 */

export type AccountDeletionSessionVerificationLevel =
  | 'first_factor'
  | 'second_factor'
  | 'multi_factor';

export type AccountDeletionPhoneCodeFactor = {
  strategy: 'phone_code';
  phoneNumberId: string;
  safeIdentifier?: string;
};

export type AccountDeletionSessionVerification = {
  status: 'needs_first_factor' | 'needs_second_factor' | 'complete' | string;
  supportedFirstFactors?: ReadonlyArray<{
    strategy: string;
    phoneNumberId?: string;
    safeIdentifier?: string;
  }> | null;
  supportedSecondFactors?: ReadonlyArray<{
    strategy: string;
    phoneNumberId?: string;
    safeIdentifier?: string;
  }> | null;
};

export type AccountDeletionReverificationSession = {
  startVerification: (params: {
    level: AccountDeletionSessionVerificationLevel;
  }) => Promise<AccountDeletionSessionVerification>;
  prepareFirstFactorVerification: (params: {
    strategy: 'phone_code';
    phoneNumberId: string;
  }) => Promise<AccountDeletionSessionVerification>;
  attemptFirstFactorVerification: (params: {
    strategy: 'phone_code';
    code: string;
  }) => Promise<AccountDeletionSessionVerification>;
  prepareSecondFactorVerification?: (params: {
    strategy: 'phone_code';
    phoneNumberId: string;
  }) => Promise<AccountDeletionSessionVerification>;
  attemptSecondFactorVerification?: (params: {
    strategy: 'phone_code';
    code: string;
  }) => Promise<AccountDeletionSessionVerification>;
};

export type PreparedPhoneReverification =
  | {
      kind: 'prepared';
      stage: 'first_factor' | 'second_factor';
      phoneNumberId: string;
      safeIdentifier: string | null;
    }
  | { kind: 'complete' }
  | { kind: 'unavailable'; reason: 'no_phone_factor' | 'session_missing' | 'prepare_failed' };

export type AttemptPhoneReverificationResult =
  | { kind: 'complete' }
  | { kind: 'needs_second_factor'; prepared: PreparedPhoneReverification & { kind: 'prepared' } }
  | { kind: 'invalid_code' }
  | { kind: 'unavailable'; reason: 'no_phone_factor' | 'session_missing' | 'attempt_failed' };

function asPhoneFactor(
  factors: AccountDeletionSessionVerification['supportedFirstFactors'],
): AccountDeletionPhoneCodeFactor | null {
  if (!factors) return null;
  for (const factor of factors) {
    if (
      factor.strategy === 'phone_code'
      && typeof factor.phoneNumberId === 'string'
      && factor.phoneNumberId.trim() !== ''
    ) {
      return {
        strategy: 'phone_code',
        phoneNumberId: factor.phoneNumberId.trim(),
        safeIdentifier: typeof factor.safeIdentifier === 'string' ? factor.safeIdentifier : undefined,
      };
    }
  }
  return null;
}

export function selectPhoneCodeReverificationFactor(
  factors: AccountDeletionSessionVerification['supportedFirstFactors'],
): AccountDeletionPhoneCodeFactor | null {
  return asPhoneFactor(factors);
}

export function resolveAccountDeletionReverificationLevel(
  level: AccountDeletionSessionVerificationLevel | undefined,
): AccountDeletionSessionVerificationLevel {
  // Account deletion is a strict sensitive action. Prefer first_factor phone OTP
  // when Clerk omits a level; callers still honor second_factor when returned.
  return level ?? 'first_factor';
}

/**
 * Starts Clerk session verification and prepares a phone_code SMS challenge.
 */
export async function prepareAccountDeletionPhoneReverification(input: {
  session: AccountDeletionReverificationSession | null | undefined;
  level: AccountDeletionSessionVerificationLevel | undefined;
}): Promise<PreparedPhoneReverification> {
  if (!input.session) return { kind: 'unavailable', reason: 'session_missing' };
  const level = resolveAccountDeletionReverificationLevel(input.level);

  let verification: AccountDeletionSessionVerification;
  try {
    verification = await input.session.startVerification({ level });
  } catch {
    return { kind: 'unavailable', reason: 'prepare_failed' };
  }

  if (verification.status === 'complete') return { kind: 'complete' };

  if (verification.status === 'needs_second_factor' || level === 'second_factor') {
    const second = asPhoneFactor(verification.supportedSecondFactors);
    if (!second || !input.session.prepareSecondFactorVerification) {
      return { kind: 'unavailable', reason: 'no_phone_factor' };
    }
    try {
      await input.session.prepareSecondFactorVerification({
        strategy: 'phone_code',
        phoneNumberId: second.phoneNumberId,
      });
      return {
        kind: 'prepared',
        stage: 'second_factor',
        phoneNumberId: second.phoneNumberId,
        safeIdentifier: second.safeIdentifier ?? null,
      };
    } catch {
      return { kind: 'unavailable', reason: 'prepare_failed' };
    }
  }

  const first = asPhoneFactor(verification.supportedFirstFactors);
  if (!first) return { kind: 'unavailable', reason: 'no_phone_factor' };

  try {
    await input.session.prepareFirstFactorVerification({
      strategy: 'phone_code',
      phoneNumberId: first.phoneNumberId,
    });
    return {
      kind: 'prepared',
      stage: 'first_factor',
      phoneNumberId: first.phoneNumberId,
      safeIdentifier: first.safeIdentifier ?? null,
    };
  } catch {
    return { kind: 'unavailable', reason: 'prepare_failed' };
  }
}

/**
 * Attempts the prepared phone OTP. When first-factor succeeds into
 * needs_second_factor with a phone factor, prepares that challenge next.
 */
export async function attemptAccountDeletionPhoneReverification(input: {
  session: AccountDeletionReverificationSession | null | undefined;
  stage: 'first_factor' | 'second_factor';
  code: string;
}): Promise<AttemptPhoneReverificationResult> {
  if (!input.session) return { kind: 'unavailable', reason: 'session_missing' };
  const code = input.code.replace(/\D/g, '').slice(0, 8);
  if (code.length < 4) return { kind: 'invalid_code' };

  try {
    const verification = input.stage === 'second_factor'
      ? await input.session.attemptSecondFactorVerification?.({
        strategy: 'phone_code',
        code,
      })
      : await input.session.attemptFirstFactorVerification({
        strategy: 'phone_code',
        code,
      });

    if (!verification) return { kind: 'unavailable', reason: 'attempt_failed' };
    if (verification.status === 'complete') return { kind: 'complete' };

    if (verification.status === 'needs_second_factor') {
      const second = asPhoneFactor(verification.supportedSecondFactors);
      if (!second || !input.session.prepareSecondFactorVerification) {
        return { kind: 'unavailable', reason: 'no_phone_factor' };
      }
      await input.session.prepareSecondFactorVerification({
        strategy: 'phone_code',
        phoneNumberId: second.phoneNumberId,
      });
      return {
        kind: 'needs_second_factor',
        prepared: {
          kind: 'prepared',
          stage: 'second_factor',
          phoneNumberId: second.phoneNumberId,
          safeIdentifier: second.safeIdentifier ?? null,
        },
      };
    }

    return { kind: 'invalid_code' };
  } catch {
    return { kind: 'invalid_code' };
  }
}

export function isAccountDeletionReverificationCancelledError(error: unknown): boolean {
  return !!error
    && typeof error === 'object'
    && (error as { code?: unknown }).code === 'reverification_cancelled';
}
