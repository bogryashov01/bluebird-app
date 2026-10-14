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
): ClerkAuthConfiguration {
  const key = typeof publishableKey === 'string' ? publishableKey.trim() : '';
  const enabled = enabledFlag === 'true' && isValidClerkPublishableKey(key);
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
  if (error instanceof Error && error.message.trim()) return error.message;
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.trim()
  ) {
    return error.message;
  }
  return 'Clerk authentication could not be completed. Please try again.';
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

export const CLERK_AUTH_CONFIGURATION = resolveClerkAuthConfiguration(
  process.env.EXPO_PUBLIC_ENABLE_CLERK_AUTH,
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY,
);
