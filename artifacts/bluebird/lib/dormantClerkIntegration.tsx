import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { ClerkProvider, useAuth, useUser } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import type { ErrorFallbackProps } from '@/components/ErrorFallback';
import { ClerkStartupStateView } from '@/components/ClerkStartupStateView';
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
import {
  logClerkStartupDiagnostic,
  sanitizeClerkStartupError,
} from './clerkStartup';

export interface ClerkAuthSnapshot extends ClerkSessionSnapshot {
  userId: string | null;
  verifiedPhoneNumber: string | null;
}

const ClerkAuthSnapshotContext = createContext<ClerkAuthSnapshot | null>(null);
const ClerkProviderMountedContext = createContext(false);
const ClerkStartupRetryContext = createContext<() => void>(() => {});

function ClerkProviderStartupFailure({ resetError }: ErrorFallbackProps) {
  const retry = useContext(ClerkStartupRetryContext);
  return (
    <ClerkStartupStateView
      state="failed"
      onRetry={() => {
        resetError();
        retry();
      }}
    />
  );
}

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
 * Clerk mounts only after the selected environment's independent enable gate
 * and API/Clerk pairing checks pass. Clerk's SDK owns session persistence.
 */
export function DormantClerkProvider({
  children,
  attempt = 0,
  onRetryClerkStartup = () => {},
}: {
  children: React.ReactNode;
  attempt?: number;
  onRetryClerkStartup?: () => void;
}) {
  const { publishableKey } = CLERK_AUTH_CONFIGURATION;
  let canMountProvider = shouldMountClerkProvider(CLERK_AUTH_CONFIGURATION) && !!publishableKey;
  if (CLERK_AUTH_CONFIGURATION.environment === 'production') {
    const apiConfiguration = getMainBluebirdApiConfigurationOrNull();
    if (
      !apiConfiguration ||
      apiConfiguration.environment !== 'production' ||
      apiConfiguration.clerkPublishableKey !== publishableKey
    ) {
      canMountProvider = false;
    }
  }

  useEffect(() => {
    if (!canMountProvider) return;
    logClerkStartupDiagnostic({
      event: 'provider_mount',
      production: CLERK_AUTH_CONFIGURATION.environment === 'production',
      attempt,
      providerMounted: true,
    });
  }, [attempt, canMountProvider]);

  if (!canMountProvider || !publishableKey) {
    return (
      <ClerkProviderMountedContext.Provider value={false}>
        {children}
      </ClerkProviderMountedContext.Provider>
    );
  }

  return (
    <ClerkProviderMountedContext.Provider value>
      <ClerkStartupRetryContext.Provider value={onRetryClerkStartup}>
        <ErrorBoundary
          FallbackComponent={ClerkProviderStartupFailure}
          onError={(error) => {
            logClerkStartupDiagnostic({
              event: 'initialization_error',
              production: CLERK_AUTH_CONFIGURATION.environment === 'production',
              attempt,
              providerMounted: true,
              errorCategory: sanitizeClerkStartupError(error),
            });
          }}
        >
          <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
            <ClerkAuthSnapshotBridge>{children}</ClerkAuthSnapshotBridge>
          </ClerkProvider>
        </ErrorBoundary>
      </ClerkStartupRetryContext.Provider>
    </ClerkProviderMountedContext.Provider>
  );
}

export function useClerkAuthSnapshot(): ClerkAuthSnapshot | null {
  return useContext(ClerkAuthSnapshotContext);
}

export function useClerkProviderMounted(): boolean {
  return useContext(ClerkProviderMountedContext);
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
