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

export interface MainBluebirdDevelopmentDiagnosticStatus {
  checks: {
    name: string;
    status: 'configured' | 'missing' | 'invalid' | 'enabled' | 'disabled' | 'selected' | 'not selected';
  }[];
  developmentConfigurationValid: boolean;
  clerkInstanceMatchVerified: boolean;
  clerkAuthEnabled: boolean;
  canTest: boolean;
  missingPrerequisites: string[];
}

export class MainBluebirdApiConfigurationError extends Error {
  constructor(readonly reason: 'environment' | 'api_url' | 'clerk_key') {
    super('Main Bluebird API configuration is incomplete or invalid.');
    this.name = 'MainBluebirdApiConfigurationError';
  }
}

const PRODUCTION_API_BASE_URL = 'https://bluebirdjets.com/api';
const CLERK_PUBLISHABLE_KEY_PATTERN = /^pk_(test|live)_[A-Za-z0-9_-]{12,}$/;
const DEVELOPMENT_API_CLERK_ISSUER_VARIABLE = 'EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_CLERK_ISSUER';

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

/**
 * Reports configuration readiness without returning or logging any configured
 * URL, key, issuer, or token. Instance match requires the API owner's verified
 * Development issuer to match the instance host encoded in the mobile key.
 */
export function getMainBluebirdDevelopmentDiagnosticStatus(
  environment: Record<string, unknown> = {
    EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT: process.env.EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT,
    EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_BASE_URL: process.env.EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_BASE_URL,
    EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY,
    EXPO_PUBLIC_ENABLE_CLERK_AUTH: process.env.EXPO_PUBLIC_ENABLE_CLERK_AUTH,
    EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_CLERK_ISSUER: process.env.EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_CLERK_ISSUER,
  },
): MainBluebirdDevelopmentDiagnosticStatus {
  const selectedDevelopment = environment.EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT === 'development';
  const rawApiUrl = environment.EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_BASE_URL;
  const rawClerkKey = environment.EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY;
  const clerkAuthEnabled = environment.EXPO_PUBLIC_ENABLE_CLERK_AUTH === 'true';
  const rawIssuer = environment[DEVELOPMENT_API_CLERK_ISSUER_VARIABLE];

  const apiUrlConfigured = hasText(rawApiUrl);
  const clerkKeyConfigured = hasText(rawClerkKey);
  const issuerConfigured = hasText(rawIssuer);
  const apiUrlValid = isValidDevelopmentApiUrl(rawApiUrl);
  const clerkKeyValid = isValidDevelopmentClerkKey(rawClerkKey);
  const expectedIssuerHost = getDevelopmentIssuerHost(rawIssuer);
  const clerkInstanceHost = getClerkInstanceHost(rawClerkKey);
  const clerkInstanceMatchVerified = !!expectedIssuerHost &&
    !!clerkInstanceHost &&
    expectedIssuerHost === clerkInstanceHost;

  const developmentConfigurationValid = selectedDevelopment && apiUrlValid && clerkKeyValid;
  const missingPrerequisites: string[] = [];
  if (!selectedDevelopment) missingPrerequisites.push('EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT must select development.');
  if (!apiUrlValid) missingPrerequisites.push('EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_BASE_URL must be a valid Development HTTPS /api URL.');
  if (!clerkKeyValid) missingPrerequisites.push('EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY must be a valid Development Clerk key.');
  if (!clerkAuthEnabled) missingPrerequisites.push('EXPO_PUBLIC_ENABLE_CLERK_AUTH must be true.');
  if (!issuerConfigured) {
    missingPrerequisites.push(`${DEVELOPMENT_API_CLERK_ISSUER_VARIABLE} is missing; configure the API owner's verified Development Clerk issuer.`);
  } else if (!expectedIssuerHost) {
    missingPrerequisites.push(`${DEVELOPMENT_API_CLERK_ISSUER_VARIABLE} must be a valid HTTPS issuer URL.`);
  } else if (!clerkInstanceHost) {
    missingPrerequisites.push('The Development Clerk key does not identify a verifiable instance host.');
  } else if (!clerkInstanceMatchVerified) {
    missingPrerequisites.push('The Development Clerk issuer does not match the instance encoded in the configured Development Clerk key.');
  }

  return {
    checks: [
      {
        name: 'EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT',
        status: selectedDevelopment ? 'selected' : 'not selected',
      },
      {
        name: 'EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_BASE_URL',
        status: !apiUrlConfigured ? 'missing' : apiUrlValid ? 'configured' : 'invalid',
      },
      {
        name: 'EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY',
        status: !clerkKeyConfigured ? 'missing' : clerkKeyValid ? 'configured' : 'invalid',
      },
      {
        name: 'EXPO_PUBLIC_ENABLE_CLERK_AUTH',
        status: clerkAuthEnabled ? 'enabled' : 'disabled',
      },
      {
        name: DEVELOPMENT_API_CLERK_ISSUER_VARIABLE,
        status: !issuerConfigured ? 'missing' : expectedIssuerHost ? 'configured' : 'invalid',
      },
    ],
    developmentConfigurationValid,
    clerkInstanceMatchVerified,
    clerkAuthEnabled,
    canTest: developmentConfigurationValid && clerkAuthEnabled && clerkInstanceMatchVerified,
    missingPrerequisites,
  };
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidDevelopmentApiUrl(value: unknown): boolean {
  try {
    validateMainBluebirdApiBaseUrl(value, 'development');
    return true;
  } catch {
    return false;
  }
}

function isValidDevelopmentClerkKey(value: unknown): boolean {
  if (!hasText(value)) return false;
  const key = (value as string).trim();
  return CLERK_PUBLISHABLE_KEY_PATTERN.test(key) && key.startsWith('pk_test_');
}

function getDevelopmentIssuerHost(value: unknown): string | null {
  if (!hasText(value)) return null;
  try {
    const parsed = new URL((value as string).trim());
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

function getClerkInstanceHost(value: unknown): string | null {
  if (!isValidDevelopmentClerkKey(value)) return null;
  const encoded = (value as string).trim().slice('pk_test_'.length);
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
  if (
    !host ||
    !/^[a-z0-9.-]+$/.test(host) ||
    host.startsWith('.') ||
    host.endsWith('.') ||
    host.includes('..')
  ) return null;
  return host;
}

export function isMainBluebirdApiEnvironment(
  value: unknown,
): value is MainBluebirdApiEnvironment {
  return value === 'development' || value === 'production';
}
