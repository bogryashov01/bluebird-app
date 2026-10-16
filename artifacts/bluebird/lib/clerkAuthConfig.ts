export interface ClerkAuthConfiguration {
  /** The Development flag requests Clerk, even if configuration is incomplete. */
  authExpected: boolean;
  enabled: boolean;
  publishableKey: string | null;
  configurationError: string | null;
}

export function shouldMountClerkProvider(configuration: ClerkAuthConfiguration): boolean {
  return configuration.enabled && isValidClerkPublishableKey(configuration.publishableKey);
}

export function canAccessClerkAuthRoutes(configuration: ClerkAuthConfiguration): boolean {
  return shouldMountClerkProvider(configuration);
}

export function shouldShowClerkConfigurationError(
  configuration: ClerkAuthConfiguration,
): boolean {
  return configuration.authExpected && !configuration.enabled;
}

export type ClerkAuthViewState =
  | 'loading'
  | 'error'
  | 'signed-in'
  | 'signed-out';

const PUBLISHABLE_KEY_PATTERN = /^pk_(test|live)_[A-Za-z0-9_-]{12,}$/;

export function isValidClerkPublishableKey(value: unknown): value is string {
  return typeof value === 'string' && PUBLISHABLE_KEY_PATTERN.test(value.trim());
}

export function resolveClerkAuthConfiguration(
  enabledFlag: unknown,
  publishableKey: unknown,
  isDevelopment = false,
): ClerkAuthConfiguration {
  const key = typeof publishableKey === 'string' ? publishableKey.trim() : '';
  const authExpected = isDevelopment && enabledFlag === 'true';
  const keyIsDevelopmentTestKey = isValidClerkPublishableKey(key) && key.startsWith('pk_test_');
  const enabled = authExpected && keyIsDevelopmentTestKey;
  const configurationError = !authExpected || enabled
    ? null
    : !key
      ? 'Development Clerk sign-in is enabled, but EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY is missing. Set it to the verified Development pk_test_ publishable key.'
      : 'Development Clerk sign-in is enabled, but EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY is invalid. Set it to the verified Development pk_test_ publishable key.';
  return {
    authExpected,
    enabled,
    publishableKey: enabled ? key : null,
    configurationError,
  };
}

export function resolveClerkAuthConfigurationFromEnvironment(
  environment: Record<string, unknown>,
  isDevelopment = false,
): ClerkAuthConfiguration {
  return resolveClerkAuthConfiguration(
    environment.EXPO_PUBLIC_ENABLE_CLERK_AUTH,
    environment.EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY,
    isDevelopment,
  );
}

export function getClerkAuthViewState(input: {
  isLoaded: boolean;
  isSignedIn: boolean | undefined;
  error?: unknown;
}): ClerkAuthViewState {
  if (!input.isLoaded) return 'loading';
  if (input.error) return 'error';
  return input.isSignedIn === true ? 'signed-in' : 'signed-out';
}

export function getClerkAuthErrorMessage(error: unknown): string {
  const code = getClerkErrorCode(error);
  if (code === 'form_code_incorrect') return 'That code is incorrect. Check the SMS and try again.';
  if (code === 'form_code_expired' || code === 'verification_expired') {
    return 'That code has expired. Request a new code and try again.';
  }
  if (code === 'too_many_requests' || code === 'rate_limit_exceeded') {
    return 'Too many attempts. Wait a moment, then try again.';
  }
  return 'Clerk authentication could not be completed. Please try again.';
}

function getClerkErrorCode(error: unknown): string | null {
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

export async function performClerkSignOut(
  signOut: () => Promise<unknown>,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await signOut();
    return { ok: true };
  } catch (error) {
    return { ok: false, message: getClerkAuthErrorMessage(error) };
  }
}

/**
 * Clerk startup is independent from Main API availability and issuer
 * verification. API requests apply those checks separately before using a
 * Clerk token.
 */
export const CLERK_AUTH_CONFIGURATION: ClerkAuthConfiguration = {
  ...resolveClerkAuthConfigurationFromEnvironment(
    process.env,
    typeof __DEV__ !== 'undefined' && __DEV__,
  ),
};
