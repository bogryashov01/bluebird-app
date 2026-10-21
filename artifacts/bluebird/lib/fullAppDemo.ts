import profileFixture from '../fixtures/full-app-demo-me.json';
import membershipFixture from '../fixtures/production-membership-base-active.json';
import type { ProductionCurrentUser, ProductionMembership } from './productionAuthApi';

export interface FullAppDemoConfiguration {
  enabled: boolean;
}

export function resolveFullAppDemoConfiguration(
  requested: unknown,
  isDevelopment: boolean,
): FullAppDemoConfiguration {
  return { enabled: isDevelopment && requested === 'true' };
}

export function getFullAppDemoConfiguration(): FullAppDemoConfiguration {
  return resolveFullAppDemoConfiguration(
    process.env.EXPO_PUBLIC_BLUEBIRD_FULL_APP_DEMO,
    typeof __DEV__ !== 'undefined' && __DEV__,
  );
}

export function getFullAppDemoProfile(): ProductionCurrentUser {
  return profileFixture as ProductionCurrentUser;
}

export function getFullAppDemoMembership(): ProductionMembership {
  return membershipFixture as ProductionMembership;
}

export function isFullAppDemoRoute(pathname: string, segments: readonly string[]): boolean {
  const normalizedPath = pathname.replace(/^\/bluebird(?:\/|$)/, '/');
  const pathMatch = normalizedPath === '/demo' || normalizedPath.startsWith('/demo/');
  const segmentMatch = segments[0] === 'demo';
  return pathMatch || segmentMatch;
}

export function isFullAppDemoAllowedRoute(pathname: string, segments: readonly string[]): boolean {
  const normalizedPath = pathname.replace(/^\/bluebird(?:\/|$)/, '/').replace(/\/+$/, '') || '/';
  if (pathname) {
    return normalizedPath === '/' ||
      /^\/(?:discover|membership|profile|trips)(?:\/index)?$/.test(normalizedPath) ||
      /^\/membership\/(?:plans|mock-preview(?:\/plans)?)$/.test(normalizedPath);
  }
  const route = segments[0];
  if (route === 'index' || (!route && normalizedPath === '/')) return true;
  if (route === '(tabs)') {
    return ['index', 'discover', 'membership', 'profile', 'trips'].includes(segments[1] ?? '');
  }
  if (route === 'membership') {
    return (segments[1] === 'plans' && segments.length === 2) ||
      (segments[1] === 'mock-preview' &&
        (segments.length === 2 ||
          (segments.length === 3 && (segments[2] === 'plans' || segments[2] === 'index'))));
  }
  return false;
}
