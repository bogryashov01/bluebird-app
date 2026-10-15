import React, { createContext, useContext, useMemo, useRef } from 'react';
import { ClerkProvider, useAuth, useUser } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import {
  createClerkProductionTokenProvider,
  type ClerkProductionTokenProvider,
  type ClerkSessionSnapshot,
} from './clerkProductionTokenProvider';
import {
  CLERK_AUTH_CONFIGURATION,
  shouldMountClerkProvider,
} from './clerkAuthConfig';
import { getMainBluebirdApiConfigurationOrNull } from './mainBluebirdApiConfig';

export interface ClerkAuthSnapshot extends ClerkSessionSnapshot {
  userId: string | null;
  verifiedPhoneNumber: string | null;
}

const ClerkAuthSnapshotContext = createContext<ClerkAuthSnapshot | null>(null);

function ClerkAuthSnapshotBridge({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const { isLoaded: isUserLoaded, user } = useUser();
  const phone = user?.primaryPhoneNumber;
  const verifiedPhoneNumber =
    isUserLoaded &&
    user?.id === auth.userId &&
    phone?.verification.status === 'verified'
      ? phone.phoneNumber
      : null;
  const snapshot = useMemo<ClerkAuthSnapshot>(() => ({
    isLoaded: auth.isLoaded,
    isSignedIn: auth.isSignedIn,
    userId: auth.userId ?? null,
    verifiedPhoneNumber,
    getToken: auth.getToken,
    signOut: async () => { await auth.signOut(); },
  }), [auth.isLoaded, auth.isSignedIn, auth.userId, auth.getToken, auth.signOut, verifiedPhoneNumber]);

  return (
    <ClerkAuthSnapshotContext.Provider value={snapshot}>
      {children}
    </ClerkAuthSnapshotContext.Provider>
  );
}

/**
 * The Development migration flow mounts Clerk only behind its explicit flag
 * and a test publishable key. Clerk's SDK owns session persistence.
 */
export function DormantClerkProvider({ children }: { children: React.ReactNode }) {
  const { publishableKey } = CLERK_AUTH_CONFIGURATION;
  if (!shouldMountClerkProvider(CLERK_AUTH_CONFIGURATION) || !publishableKey) {
    return <>{children}</>;
  }

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <ClerkAuthSnapshotBridge>{children}</ClerkAuthSnapshotBridge>
    </ClerkProvider>
  );
}

export function useClerkAuthSnapshot(): ClerkAuthSnapshot | null {
  return useContext(ClerkAuthSnapshotContext);
}

/**
 * Use only beneath DormantClerkProvider after authentication is separately
 * approved. getToken() is called afresh for each explicit production request.
 */
export function useDormantClerkProductionTokenProvider(): ClerkProductionTokenProvider {
  const auth = useAuth();
  const configuration = getMainBluebirdApiConfigurationOrNull();
  const currentAuth = useRef(auth);
  currentAuth.current = auth;

  if (!configuration) {
    throw new Error('Main Bluebird API and Clerk environment configuration is unavailable.');
  }
  return useMemo(
    () => createClerkProductionTokenProvider({
      getCurrentSession: () => currentAuth.current as ClerkSessionSnapshot,
    }, configuration.environment),
    [configuration.environment],
  );
}
