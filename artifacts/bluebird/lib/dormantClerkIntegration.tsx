import React, { useMemo, useRef } from 'react';
import { ClerkProvider, useAuth } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import {
  createClerkProductionTokenProvider,
  getClerkPublishableKey,
  type ClerkProductionTokenProvider,
  type ClerkSessionSnapshot,
} from './clerkProductionTokenProvider';

/**
 * Prepared integration entry point for a separately approved activation.
 * Intentionally not mounted from app/_layout.tsx.
 */
export function DormantClerkProvider({ children }: { children: React.ReactNode }) {
  const publishableKey = getClerkPublishableKey();
  if (!publishableKey) {
    throw new Error('Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY for Clerk integration.');
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
