import baseActiveFixture from '../fixtures/production-membership-base-active.json';
import type { ProductionMembership } from './productionAuthApi';

export type MembershipDataMode = 'mock' | 'production';

export interface MembershipDataModeConfiguration {
  mode: MembershipDataMode;
  mockPreviewAllowed: boolean;
  error: string | null;
}

const BASE_ACTIVE_MEMBERSHIP = baseActiveFixture as ProductionMembership;

export function resolveMembershipDataMode(
  value: unknown,
  isDevelopment: boolean,
): MembershipDataModeConfiguration {
  if (value === undefined || value === null || value === '' || value === 'production') {
    return { mode: 'production', mockPreviewAllowed: false, error: null };
  }
  if (value === 'mock') {
    return isDevelopment
      ? { mode: 'mock', mockPreviewAllowed: true, error: null }
      : {
          mode: 'production',
          mockPreviewAllowed: false,
          error: 'Membership mock preview is available only in development.',
        };
  }
  return {
    mode: 'production',
    mockPreviewAllowed: false,
    error: 'EXPO_PUBLIC_BLUEBIRD_MEMBERSHIP_DATA_MODE must be mock or production.',
  };
}

export function getMembershipDataModeConfiguration(): MembershipDataModeConfiguration {
  return resolveMembershipDataMode(
    process.env.EXPO_PUBLIC_BLUEBIRD_MEMBERSHIP_DATA_MODE,
    typeof __DEV__ !== 'undefined' && __DEV__,
  );
}

export function isMembershipMockPreviewLocation(
  pathname: string,
  segments: readonly string[],
): boolean {
  const pathMatch = /(?:^|\/)membership\/mock-preview(?:\/|$)/.test(pathname);
  const segmentMatch = segments[0] === 'membership' && segments[1] === 'mock-preview';
  return pathMatch || segmentMatch;
}

export function loadMembershipData<T>(
  mode: MembershipDataMode,
  loadProductionMembership: () => Promise<T>,
): Promise<ProductionMembership | T> {
  if (mode === 'mock') return Promise.resolve(BASE_ACTIVE_MEMBERSHIP);
  return loadProductionMembership();
}

export function getBaseActiveMembershipFixture(): ProductionMembership {
  return BASE_ACTIVE_MEMBERSHIP;
}
