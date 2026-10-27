const PRODUCTION_MAIN_API_ORIGIN = 'https://bluebirdjets.com';
const AUTH_TEST_READ_PATHS = new Set([
  '/api/me',
  '/api/me/profile',
  '/api/empty-legs',
  '/api/trips',
  '/api/me/referrals',
]);
const EMPTY_LEG_DETAIL_PATH = /^\/api\/empty-legs\/([1-9]\d*)$/;
const EMPTY_LEG_QUEUE_PATH = /^\/api\/empty-legs\/([1-9]\d*)\/queue$/;
const AIRPORT_CODE = /^[A-Z0-9-]{2,12}$/;
const MAX_AIRPORT_CODES = 200;

export function isNativeProductionAuthTestEnabled(): boolean {
  return process.env.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST === 'true';
}

export function shouldShowNativeAuthStartupDiagnostics(input: {
  platformOS: string;
  nativeAuthTestEnabled: boolean;
  apiEnvironment: unknown;
  developmentBuild: boolean;
}): boolean {
  return input.platformOS === 'ios' &&
    input.nativeAuthTestEnabled &&
    input.apiEnvironment === 'production' &&
    !input.developmentBuild;
}

function isEmptyLegDetailRead(url: URL): boolean {
  if (url.search !== '' || url.hash !== '') return false;
  const match = EMPTY_LEG_DETAIL_PATH.exec(url.pathname);
  if (!match) return false;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0;
}

function isEmptyLegQueueRead(url: URL): boolean {
  if (url.search !== '' || url.hash !== '') return false;
  const match = EMPTY_LEG_QUEUE_PATH.exec(url.pathname);
  if (!match) return false;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0;
}

function isAirportCodeLookup(url: URL): boolean {
  if (url.pathname !== '/api/airports' || url.hash !== '') return false;
  const params = [...url.searchParams.entries()];
  if (params.length !== 1 || params[0][0] !== 'codes') return false;
  const codes = params[0][1].split(',');
  if (codes.length === 0 || codes.length > MAX_AIRPORT_CODES) return false;
  const seen = new Set<string>();
  for (const code of codes) {
    if (!AIRPORT_CODE.test(code) || seen.has(code)) return false;
    seen.add(code);
  }
  return true;
}

/**
 * The native auth test may read identity, profile details, the empty-leg list,
 * one numeric empty leg, that leg's queue ranking, airport coordinates for
 * those legs, the signed-in member's trip list, and that member's referral
 * account. The queue read does not authorize a join or any other change.
 * Every other request, including other GETs, stays blocked.
 */
export function isNativeProductionAuthTestRequestAllowed(
  rawUrl: string | URL,
  method: string,
): boolean {
  if (method.toUpperCase() !== 'GET') return false;

  try {
    const url = new URL(rawUrl.toString(), PRODUCTION_MAIN_API_ORIGIN);
    if (url.origin !== PRODUCTION_MAIN_API_ORIGIN) return false;
    return (
      (AUTH_TEST_READ_PATHS.has(url.pathname) && url.search === '' && url.hash === '') ||
      isEmptyLegDetailRead(url) ||
      isEmptyLegQueueRead(url) ||
      isAirportCodeLookup(url)
    );
  } catch {
    return false;
  }
}
