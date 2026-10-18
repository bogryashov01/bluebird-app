export const DEVELOPMENT_PREVIEW_PAGES = [
  'discover',
  'flight-details',
  'queue',
  'trips',
  'membership',
  'skip-line-pass',
  'profile',
  'notifications',
  'home-airport',
  'payment-methods',
] as const;

export type DevelopmentPreviewPage = (typeof DEVELOPMENT_PREVIEW_PAGES)[number];

export const DEVELOPMENT_PREVIEW_STATES: Record<DevelopmentPreviewPage, readonly string[]> = {
  discover: ['available', 'empty', 'loading', 'api-error'],
  'flight-details': ['default'],
  queue: ['not-joined', 'waiting', 'unavailable'],
  trips: ['empty', 'queued', 'confirmed'],
  membership: ['non-member', 'active-member', 'loading', 'api-error'],
  'skip-line-pass': ['non-member', 'member-no-pass', 'member-with-pass', 'unavailable'],
  profile: ['complete', 'missing-information'],
  notifications: ['off', 'all', 'specific'],
  'home-airport': ['default'],
  'payment-methods': ['default'],
};

export function isDevelopmentPreviewEnabled(isDev: boolean): boolean {
  return isDev;
}

export function isDevelopmentPreviewRoute(
  segments: readonly string[],
  isDev: boolean,
): boolean {
  if (!isDevelopmentPreviewEnabled(isDev)) return false;

  return (
    segments[0] === 'development-preview' ||
    (segments[0] === 'queue' && segments[1] === 'dev-preview') ||
    (segments[0] === 'membership' && segments[1] === 'dev-preview')
  );
}

export function parseDevelopmentPreviewPage(value: unknown): DevelopmentPreviewPage | null {
  return typeof value === 'string' &&
    DEVELOPMENT_PREVIEW_PAGES.includes(value as DevelopmentPreviewPage)
    ? value as DevelopmentPreviewPage
    : null;
}

export function parseDevelopmentPreviewState(
  page: DevelopmentPreviewPage,
  value: unknown,
): string {
  const states = DEVELOPMENT_PREVIEW_STATES[page];
  return typeof value === 'string' && states.includes(value)
    ? value
    : states[0];
}
