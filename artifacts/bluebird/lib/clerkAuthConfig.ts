import { resolveMainBluebirdApiConfiguration } from './mainBluebirdApiConfig';

export interface ClerkAuthConfiguration {
  /** Indicates that this build must use Clerk rather than the legacy auth flow. */
  authExpected: boolean;
  enabled: boolean;
  environment: 'development' | 'production' | null;
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
    environment: enabled ? 'development' : null,
    publishableKey: enabled ? key : null,
    configurationError,
  };
}

export function resolveClerkAuthConfigurationFromEnvironment(
  environment: Record<string, unknown>,
  isDevelopment = false,
): ClerkAuthConfiguration {
  const selectedEnvironment = environment.EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT;
  if (isDevelopment) {
    if (environment.EXPO_PUBLIC_ENABLE_CLERK_AUTH !== 'true') {
      return resolveClerkAuthConfiguration(
        environment.EXPO_PUBLIC_ENABLE_CLERK_AUTH,
        environment.EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY,
        true,
      );
    }
    if (selectedEnvironment !== 'development') {
      return {
        authExpected: true,
        enabled: false,
        environment: null,
        publishableKey: null,
        configurationError: 'Development Clerk sign-in is enabled, but EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT must select development.',
      };
    }
    return resolveClerkAuthConfiguration(
      environment.EXPO_PUBLIC_ENABLE_CLERK_AUTH,
      environment.EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY,
      true,
    );
  }

  // Production builds always expect Clerk. If approval or its matching
  // Production API/Clerk pair is missing, auth remains blocked rather than
  // silently falling back to the legacy API/JWT flow.
  if (selectedEnvironment !== 'production') {
    return productionConfigurationError(
      'Production sign-in is blocked: EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT must select production.',
    );
  }
  if (environment.EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH !== 'true') {
    return productionConfigurationError(
      'Production sign-in is blocked until the API and Clerk owners approve the matching Production pair. Set EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH=true only after approval.',
    );
  }

  const productionKey = environment.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY;
  const issuer = getVerifiedIssuerHost(environment.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_CLERK_ISSUER);
  const keyHost = getClerkInstanceHost(productionKey, 'pk_live_');
  if (!issuer) {
    return productionConfigurationError(
      'Production sign-in is blocked: configure the API-owner-verified EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_CLERK_ISSUER.',
    );
  }
  if (!keyHost || issuer !== keyHost) {
    return productionConfigurationError(
      'Production sign-in is blocked: the Production API Clerk issuer does not match the configured Production Clerk key.',
    );
  }

  try {
    const apiConfiguration = resolveMainBluebirdApiConfiguration({
      environment: selectedEnvironment,
      productionApiBaseUrl: environment.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL,
      productionClerkPublishableKey: productionKey,
    });
    if (apiConfiguration.clerkPublishableKey !== (productionKey as string).trim()) {
      return productionConfigurationError(
        'Production sign-in is blocked: the selected Production API and Clerk settings do not match.',
      );
    }
    return {
      authExpected: true,
      enabled: true,
      environment: 'production',
      publishableKey: apiConfiguration.clerkPublishableKey,
      configurationError: null,
    };
  } catch {
    return productionConfigurationError(
      'Production sign-in is blocked: configure a valid Production API URL and matching pk_live_ Clerk key.',
    );
  }
}

function productionConfigurationError(message: string): ClerkAuthConfiguration {
  return {
    authExpected: true,
    enabled: false,
    environment: null,
    publishableKey: null,
    configurationError: message,
  };
}

function getVerifiedIssuerHost(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (
      parsed.protocol !== 'https:' ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (parsed.pathname !== '' && parsed.pathname !== '/')
    ) return null;
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function getClerkInstanceHost(value: unknown, requiredPrefix: 'pk_test_' | 'pk_live_'): string | null {
  if (!isValidClerkPublishableKey(value)) return null;
  const key = value.trim();
  if (!key.startsWith(requiredPrefix)) return null;
  const encoded = key.slice(requiredPrefix.length);
  let bits = 0;
  let accumulator = 0;
  let decoded = '';
  for (const character of encoded) {
    const code = character === '-' ? 62 : character === '_' ? 63 : 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.indexOf(character);
    if (code < 0) return null;
    accumulator = (accumulator << 6) | code;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      decoded += String.fromCharCode((accumulator >> bits) & 0xff);
    }
  }
  const host = decoded.replace(/\$$/, '').trim().toLowerCase();
  if (!host || !/^[a-z0-9.-]+$/.test(host) || host.startsWith('.') || host.endsWith('.') || host.includes('..')) {
    return null;
  }
  return host;
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
    {
      EXPO_PUBLIC_ENABLE_CLERK_AUTH: process.env.EXPO_PUBLIC_ENABLE_CLERK_AUTH,
      EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT: process.env.EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT,
      EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY,
      EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH: process.env.EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH,
      EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL: process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL,
      EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY,
      EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_CLERK_ISSUER: process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_CLERK_ISSUER,
    },
    typeof __DEV__ !== 'undefined' && __DEV__,
  ),
};
