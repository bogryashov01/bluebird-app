export type MainBluebirdApiEnvironment = 'development' | 'production';

export interface MainBluebirdApiConfiguration {
  environment: MainBluebirdApiEnvironment;
  apiBaseUrl: string;
  clerkPublishableKey: string;
}

export interface MainBluebirdApiConfigurationInput {
  environment: unknown;
  developmentApiBaseUrl?: unknown;
  productionApiBaseUrl?: unknown;
  developmentClerkPublishableKey?: unknown;
  productionClerkPublishableKey?: unknown;
}

export class MainBluebirdApiConfigurationError extends Error {
  constructor(readonly reason: 'environment' | 'api_url' | 'clerk_key') {
    super('Main Bluebird API configuration is incomplete or invalid.');
    this.name = 'MainBluebirdApiConfigurationError';
  }
}

const PRODUCTION_API_BASE_URL = 'https://bluebirdjets.com/api';
const CLERK_PUBLISHABLE_KEY_PATTERN = /^pk_(test|live)_[A-Za-z0-9_-]{12,}$/;

/**
 * Resolves exactly the explicitly selected API/Clerk pair. It never infers an
 * environment, substitutes a URL, or falls back to the legacy local API.
 */
export function resolveMainBluebirdApiConfiguration(
  input: MainBluebirdApiConfigurationInput,
): MainBluebirdApiConfiguration {
  if (input.environment !== 'development' && input.environment !== 'production') {
    throw new MainBluebirdApiConfigurationError('environment');
  }

  const environment = input.environment;
  const rawApiUrl = environment === 'development'
    ? input.developmentApiBaseUrl
    : input.productionApiBaseUrl;
  const rawClerkKey = environment === 'development'
    ? input.developmentClerkPublishableKey
    : input.productionClerkPublishableKey;

  const apiBaseUrl = validateMainBluebirdApiBaseUrl(rawApiUrl, environment);
  const clerkPublishableKey = typeof rawClerkKey === 'string' ? rawClerkKey.trim() : '';
  const matchingClerkPrefix = environment === 'development' ? 'pk_test_' : 'pk_live_';
  if (
    !CLERK_PUBLISHABLE_KEY_PATTERN.test(clerkPublishableKey) ||
    !clerkPublishableKey.startsWith(matchingClerkPrefix)
  ) {
    throw new MainBluebirdApiConfigurationError('clerk_key');
  }

  return { environment, apiBaseUrl, clerkPublishableKey };
}

export function validateMainBluebirdApiBaseUrl(
  rawValue: unknown,
  environment: MainBluebirdApiEnvironment,
): string {
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    throw new MainBluebirdApiConfigurationError('api_url');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawValue.trim());
  } catch {
    throw new MainBluebirdApiConfigurationError('api_url');
  }

  const pathname = parsed.pathname.replace(/\/+$/, '');
  if (
    parsed.protocol !== 'https:' ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    pathname !== '/api'
  ) {
    throw new MainBluebirdApiConfigurationError('api_url');
  }

  const normalized = `${parsed.origin}/api`;
  if (
    environment === 'production' &&
    normalized !== PRODUCTION_API_BASE_URL
  ) {
    throw new MainBluebirdApiConfigurationError('api_url');
  }
  if (
    environment === 'development' &&
    normalized === PRODUCTION_API_BASE_URL
  ) {
    throw new MainBluebirdApiConfigurationError('api_url');
  }
  return normalized;
}

/** Reads only the explicit Main API variables; legacy Clerk/API vars are ignored. */
export function getMainBluebirdApiConfiguration(): MainBluebirdApiConfiguration {
  return resolveMainBluebirdApiConfiguration({
    environment: process.env.EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT,
    developmentApiBaseUrl: process.env.EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_BASE_URL,
    productionApiBaseUrl: process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL,
    developmentClerkPublishableKey: process.env.EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY,
    productionClerkPublishableKey: process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY,
  });
}

export function getMainBluebirdApiConfigurationOrNull(): MainBluebirdApiConfiguration | null {
  try {
    return getMainBluebirdApiConfiguration();
  } catch {
    return null;
  }
}

export function isMainBluebirdApiEnvironment(
  value: unknown,
): value is MainBluebirdApiEnvironment {
  return value === 'development' || value === 'production';
}
