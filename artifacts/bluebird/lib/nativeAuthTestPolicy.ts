const PRODUCTION_MAIN_API_ORIGIN = 'https://bluebirdjets.com';
const AUTH_TEST_READ_PATH = '/api/me';

export function isNativeProductionAuthTestEnabled(): boolean {
  return process.env.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST === 'true';
}

/**
 * The native auth test needs only the authenticated identity projection. All
 * other app API requests, including apparently read-only GETs, stay blocked.
 */
export function isNativeProductionAuthTestRequestAllowed(
  rawUrl: string | URL,
  method: string,
): boolean {
  if (method.toUpperCase() !== 'GET') return false;

  try {
    const url = new URL(rawUrl.toString(), PRODUCTION_MAIN_API_ORIGIN);
    return url.origin === PRODUCTION_MAIN_API_ORIGIN &&
      url.pathname === AUTH_TEST_READ_PATH &&
      url.search === '' &&
      url.hash === '';
  } catch {
    return false;
  }
}
