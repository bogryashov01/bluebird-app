import type { VerifiedProductionTokenProvider } from './productionAuthApi';
import {
  getMainBluebirdApiConfigurationOrNull,
  type MainBluebirdApiEnvironment,
} from './mainBluebirdApiConfig';

export interface ClerkSessionSnapshot {
  isLoaded: boolean;
  isSignedIn: boolean | undefined;
  getToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
}

export interface ClerkSessionSource {
  getCurrentSession: () => ClerkSessionSnapshot;
}

export interface ClerkProductionTokenProvider extends VerifiedProductionTokenProvider {
  /** The Clerk instance is paired with exactly one Main API environment. */
  environment: MainBluebirdApiEnvironment;
  /** Calls Clerk signOut so Clerk can remove its own session and SecureStore state. */
  clearClerkSession: () => Promise<void>;
}

/**
 * Read only the Clerk key paired with the explicitly selected Main API
 * environment. Legacy single-key configuration is never used as a fallback.
 */
export function getClerkPublishableKey(): string | null {
  return getMainBluebirdApiConfigurationOrNull()?.clerkPublishableKey ?? null;
}

/**
 * Adapt Clerk's current session to the production API contract without
 * retaining tokens. The session source is read for every operation so a
 * provider kept by a future API client still observes Clerk state changes.
 */
export function createClerkProductionTokenProvider(
  sessionSource: ClerkSessionSource,
  environment: MainBluebirdApiEnvironment,
): ClerkProductionTokenProvider {
  return {
    environment,
    getVerifiedAccessToken: async () => {
      const session = sessionSource.getCurrentSession();
      if (!session.isLoaded || session.isSignedIn !== true) return null;

      const token = await session.getToken();
      return typeof token === 'string' && token.trim() ? token : null;
    },
    clearClerkSession: async () => {
      await sessionSource.getCurrentSession().signOut();
    },
  };
}
