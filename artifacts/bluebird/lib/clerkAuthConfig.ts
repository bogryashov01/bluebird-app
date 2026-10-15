import { getMainBluebirdApiConfigurationOrNull } from './mainBluebirdApiConfig';

export interface ClerkAuthConfiguration {
  enabled: boolean;
  publishableKey: string | null;
}

export function shouldMountClerkProvider(configuration: ClerkAuthConfiguration): boolean {
  return configuration.enabled && isValidClerkPublishableKey(configuration.publishableKey);
}

export function canAccessClerkAuthRoutes(configuration: ClerkAuthConfiguration): boolean {
  return shouldMountClerkProvider(configuration);
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
  const enabled =
    isDevelopment &&
    enabledFlag === 'true' &&
    isValidClerkPublishableKey(key) &&
    key.startsWith('pk_test_');
  return {
    enabled,
    publishableKey: enabled ? key : null,
  };
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

const selectedMainApiConfiguration = getMainBluebirdApiConfigurationOrNull();

/**
 * Clerk is mounted only when the selected Main API and its corresponding
 * Clerk publishable key are both valid. Legacy single-key variables are not
 * used as a fallback.
 */
export const CLERK_AUTH_CONFIGURATION: ClerkAuthConfiguration = {
  ...resolveClerkAuthConfiguration(
    process.env.EXPO_PUBLIC_ENABLE_CLERK_AUTH,
    selectedMainApiConfiguration?.clerkPublishableKey,
    typeof __DEV__ !== 'undefined' &&
      __DEV__ &&
      selectedMainApiConfiguration?.environment === 'development',
  ),
};
