export const MEMBERSHIP_PREVIEW_STATES = [
  'non-member',
  'active-member',
  'unavailable',
  'loading',
  'api-error',
] as const;

export type MembershipPreviewState = (typeof MEMBERSHIP_PREVIEW_STATES)[number];

export function isMembershipDevelopmentPreviewEnabled(isDev: boolean): boolean {
  return isDev;
}

export function isMembershipDevelopmentPreviewRoute(
  segments: readonly string[],
  isDev: boolean,
): boolean {
  return isMembershipDevelopmentPreviewEnabled(isDev) &&
    segments[0] === 'membership' &&
    segments[1] === 'dev-preview';
}

export function parseMembershipPreviewState(value: unknown): MembershipPreviewState {
  return typeof value === 'string' &&
    MEMBERSHIP_PREVIEW_STATES.includes(value as MembershipPreviewState)
    ? value as MembershipPreviewState
    : 'non-member';
}
