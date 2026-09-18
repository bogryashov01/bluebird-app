/**
 * API origin for Expo bundles.
 *
 * EXPO_PUBLIC_API_URL is the portable override (local/dev/prod).
 * EXPO_PUBLIC_DOMAIN remains the Replit host fallback (https://$domain).
 * Neither value should include a trailing slash or the /api suffix.
 */
export function getApiBaseUrl(): string | null {
  const explicit = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, '');
  }

  const domain = process.env.EXPO_PUBLIC_DOMAIN?.trim();
  if (domain) {
    const host = domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    return host ? `https://${host}` : null;
  }

  return null;
}
