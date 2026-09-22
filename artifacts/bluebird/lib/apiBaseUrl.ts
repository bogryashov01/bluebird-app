/**
 * API origin for Expo bundles.
 *
 * EXPO_PUBLIC_API_URL is the portable override (local/dev/prod).
 * EXPO_PUBLIC_DOMAIN remains the Replit host fallback (https://$domain).
 * Neither value should include a trailing slash or the /api suffix.
 *
 * Development (__DEV__) allows localhost, LAN IPs, and Replit preview hosts.
 * Non-development builds fail closed unless the origin is a public https URL.
 */

export type ApiBaseUrlEnv = {
  EXPO_PUBLIC_API_URL?: string;
  EXPO_PUBLIC_DOMAIN?: string;
};

export type ApiBaseUrlOptions = {
  isDevelopment?: boolean;
  env?: ApiBaseUrlEnv;
};

export class ProductionApiUrlError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(
      `Production API URL is not configured correctly (${reason}). ` +
        'Set EXPO_PUBLIC_API_URL to a public https origin. ' +
        'Localhost, private/LAN addresses, and Replit development hosts are not allowed in production builds.',
    );
    this.name = 'ProductionApiUrlError';
    this.reason = reason;
  }
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

export function resolveRawApiBaseUrl(env?: ApiBaseUrlEnv): string | null {
  // Expo inlines these only on static process.env.EXPO_PUBLIC_* access.
  // Test callers pass `env` to override; app code omits it.
  const bundledApiUrl = process.env.EXPO_PUBLIC_API_URL;
  const bundledDomain = process.env.EXPO_PUBLIC_DOMAIN;
  const explicit = (env ? env.EXPO_PUBLIC_API_URL : bundledApiUrl)?.trim();
  if (explicit) {
    return stripTrailingSlashes(explicit);
  }

  const domain = (env ? env.EXPO_PUBLIC_DOMAIN : bundledDomain)?.trim();
  if (domain) {
    const host = domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    return host ? `https://${host}` : null;
  }

  return null;
}

function parseIPv4(hostname: string): [number, number, number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) return null;
  const parts = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])] as [
    number,
    number,
    number,
    number,
  ];
  if (parts.some((part) => part > 255)) return null;
  return parts;
}

export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  const ipv4 = parseIPv4(host);
  return ipv4 !== null && ipv4[0] === 127;
}

export function isPrivateIPv4Hostname(hostname: string): boolean {
  const ipv4 = parseIPv4(hostname);
  if (!ipv4) return false;
  const [a, b] = ipv4;
  if (a === 10) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export function isLocalMdnsHostname(hostname: string): boolean {
  return hostname.toLowerCase().endsWith('.local');
}

export function isReplitDevelopmentHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === 'replit.com' ||
    host === 'repl.co' ||
    host.endsWith('.replit.com') ||
    host.endsWith('.replit.dev') ||
    host.endsWith('.replit.app') ||
    host.endsWith('.repl.co')
  );
}

function defaultIsDevelopment(): boolean {
  if (typeof __DEV__ !== 'undefined') return __DEV__;
  return process.env.NODE_ENV !== 'production';
}

/**
 * Returns a rejection reason for a non-development API origin, or null if it is
 * a public https URL.
 */
export function productionApiUrlRejection(url: string | null): string | null {
  if (!url) return 'missing';

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'not a valid absolute URL';
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (!hostname) return 'missing hostname';
  if (isLoopbackHostname(hostname)) return 'localhost is not allowed';
  if (isPrivateIPv4Hostname(hostname)) return 'private/LAN address is not allowed';
  if (isLocalMdnsHostname(hostname)) return '.local hostname is not allowed';
  if (isReplitDevelopmentHostname(hostname)) return 'Replit development host is not allowed';
  if (parsed.protocol !== 'https:') {
    return 'https is required';
  }
  return null;
}

export function getApiBaseUrl(options: ApiBaseUrlOptions = {}): string | null {
  const isDevelopment = options.isDevelopment ?? defaultIsDevelopment();
  const resolved = resolveRawApiBaseUrl(options.env);

  if (isDevelopment) {
    return resolved;
  }

  const reason = productionApiUrlRejection(resolved);
  if (reason) {
    throw new ProductionApiUrlError(reason);
  }
  return resolved;
}
