import React, { useMemo, useRef } from 'react';
import { ClerkProvider, useAuth } from '@clerk/expo';
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

/**
 * The isolated Clerk UI can mount this provider only after both the explicit
 * feature flag and a structurally valid Expo-public key are present.
 */
export function DormantClerkProvider({ children }: { children: React.ReactNode }) {
  const { publishableKey } = CLERK_AUTH_CONFIGURATION;
  if (!shouldMountClerkProvider(CLERK_AUTH_CONFIGURATION) || !publishableKey) {
    return <>{children}</>;
  }

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      {children}
    </ClerkProvider>
  );
}

/**
 * Use only beneath DormantClerkProvider after authentication is separately
 * approved. getToken() is called afresh for each explicit production request.
 */
export function useDormantClerkProductionTokenProvider(): ClerkProductionTokenProvider {
  const auth = useAuth();
  const currentAuth = useRef(auth);
  currentAuth.current = auth;

  return useMemo(
    () => createClerkProductionTokenProvider({
      getCurrentSession: () => currentAuth.current as ClerkSessionSnapshot,
    }),
    [],
  );
}
