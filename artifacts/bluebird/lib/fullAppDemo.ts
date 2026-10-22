import profileFixture from '../fixtures/full-app-demo-me.json';
import membershipFixture from '../fixtures/production-membership-base-active.json';
import memberOverviewFixture from '../fixtures/full-app-demo-membership.json';
import type { Membership } from '@workspace/api-client-react';
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

export function getFullAppDemoMemberOverview(): Membership {
  return memberOverviewFixture as Membership;
}

export function isFullAppDemoRoute(pathname: string, segments: readonly string[]): boolean {
  const normalizedPath = pathname.replace(/^\/bluebird(?:\/|$)/, '/');
  const pathMatch = normalizedPath === '/demo' || normalizedPath.startsWith('/demo/');
  const segmentMatch = segments[0] === 'demo';
  return pathMatch || segmentMatch;
}

export function isFullAppDemoAllowedRoute(pathname: string, segments: readonly string[]): boolean {
  const normalizedPath = pathname.replace(/^\/bluebird(?:\/|$)/, '/').replace(/\/+$/, '') || '/';
  const isAllowedPath = (path: string) =>
    path === '/' ||
    /^\/(?:discover|membership|profile|trips)(?:\/index)?$/.test(path) ||
    /^\/demo\/flight\/[1-9]\d*$/.test(path) ||
    /^\/flight\/[1-9]\d*$/.test(path) ||
    /^\/flight\/(?:policy|confirmed)$/.test(path) ||
    /^\/queue\/(?:join|intl-notice|payment-review|joined|status|pass|buy-pass)$/.test(path) ||
    /^\/upgrade\/(?:base|plus|family|corporate)$/.test(path) ||
    /^\/membership\/(?:plans|mock-preview(?:\/plans)?)$/.test(path);
  if (pathname) {
    return isAllowedPath(normalizedPath);
  }
  const route = segments[0];
  if (route === 'index' || (!route && normalizedPath === '/')) return true;
  if (route === 'demo' && segments[1] === 'flight' && segments.length === 3 &&
    (segments[2] === '[id]' || /^[1-9]\d*$/.test(segments[2] ?? ''))) return true;
  if (route === 'flight' && segments.length === 2 &&
    (segments[1] === 'policy' || segments[1] === 'confirmed' || segments[1] === '[id]' || /^[1-9]\d*$/.test(segments[1] ?? ''))) return true;
  if (route === 'queue' && segments.length === 2 &&
    ['join', 'intl-notice', 'payment-review', 'joined', 'status', 'pass', 'buy-pass'].includes(segments[1] ?? '')) return true;
  if (route === 'upgrade' && segments.length === 2 &&
    ['base', 'plus', 'family', 'corporate', '[tier]'].includes(segments[1] ?? '')) return true;
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
