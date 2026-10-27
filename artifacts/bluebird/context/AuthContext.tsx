import React, { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAuthTokenGetter, logout, type User } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useRegisterNetworkingPushToken } from '@workspace/api-client-react';
import { CLERK_AUTH_CONFIGURATION } from '@/lib/clerkAuthConfig';
import {
  clearClerkMemberCacheOnIdentityChange,
  createLegacyAuthTokenGetter,
} from '@/lib/clerkAuthSession';
import {
  getClerkResolutionForIdentity,
  isClerkMemberResolutionCurrent,
  resolveClerkMember,
  resolveProjection,
  shouldAutomaticallyResolveClerkMember,
  type ClerkMemberResolution,
} from '@/lib/clerkMemberResolution';
import {
  useClerkAuthSnapshot,
  useClerkProviderMounted,
  useClerkStartupSnapshotStatus,
} from '@/lib/dormantClerkIntegration';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import type { ProductionCurrentUser } from '@/lib/productionAuthApi';
import {
  CLERK_STARTUP_TIMEOUT_MS,
  getClerkStartupFailureReason,
  getClerkStartupState,
  logClerkStartupDiagnostic,
  startClerkStartupTimeout,
  type ClerkStartupFailureReason,
  type ClerkStartupState,
} from '@/lib/clerkStartup';

const TOKEN_KEY = 'bluebird_token';
const USER_KEY = 'bluebird_user';
const AUTH_RESTORE_TIMEOUT_MS = 8_000;

export type AuthUser = User;
interface AuthContextType {
  token: string | null;
  user: AuthUser | null;
  isLoading: boolean;
  demoMode: boolean;
  authMode: 'legacy' | 'clerk';
  clerkSignedIn: boolean;
  clerkUserId: string | null;
  clerkMemberResolution: ClerkMemberResolution;
  clerkStartupState: ClerkStartupState;
  clerkStartupFailureReason: ClerkStartupFailureReason | null;
  clerkStartupSnapshotReceived: boolean;
  clerkStartupIsLoaded: boolean;
  retryClerkStartup: () => void;
  retryClerkMemberResolution: () => void;
  confirmClerkProfileCompletion: (currentUser: ProductionCurrentUser) => boolean;
  memberAccessResolved: boolean;
  signIn: (token: string, user: AuthUser) => Promise<void>;
  signOut: () => Promise<void>;
  updateUser: (user: AuthUser) => void;
  pendingRegistrationGrant: string | null;
  setPendingRegistrationGrant: (grant: string | null) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

// Register the token getter globally so every API request carries the bearer token
setAuthTokenGetter(createLegacyAuthTokenGetter(
  CLERK_AUTH_CONFIGURATION.authExpected,
  async () => {
    try {
      return await AsyncStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
));

export function AuthProvider({
  children,
  clerkStartupAttempt = 0,
  onRetryClerkStartup = () => {},
}: {
  children: ReactNode;
  clerkStartupAttempt?: number;
  onRetryClerkStartup?: () => void;
}) {
  return (
    <ActiveAuthProvider
      clerkStartupAttempt={clerkStartupAttempt}
      onRetryClerkStartup={onRetryClerkStartup}
    >
      {children}
    </ActiveAuthProvider>
  );
}

/**
 * Identity-free context for the development-only full-app presentation demo.
 * It deliberately exposes no user, token, session restoration, or auth action.
 */
export function DemoAuthProvider({ children }: { children: ReactNode }) {
  const value: AuthContextType = {
    token: null,
    user: null,
    isLoading: false,
    demoMode: true,
    authMode: 'legacy',
    clerkSignedIn: false,
    clerkUserId: null,
    clerkMemberResolution: { status: 'signed_out' },
    clerkStartupState: 'ready',
    clerkStartupFailureReason: null,
    clerkStartupSnapshotReceived: false,
    clerkStartupIsLoaded: false,
    retryClerkStartup: () => {},
    retryClerkMemberResolution: () => {},
    confirmClerkProfileCompletion: () => false,
    memberAccessResolved: false,
    signIn: async () => {},
    signOut: async () => {},
    updateUser: () => {},
    pendingRegistrationGrant: null,
    setPendingRegistrationGrant: () => {},
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function ActiveAuthProvider({
  children,
  clerkStartupAttempt,
  onRetryClerkStartup,
}: {
  children: ReactNode;
  clerkStartupAttempt: number;
  onRetryClerkStartup: () => void;
}) {
  const queryClient = useQueryClient();
  const clerkSession = useClerkAuthSnapshot();
  const clerkProviderMounted = useClerkProviderMounted();
  const startupSnapshotStatus = useClerkStartupSnapshotStatus();
  // A requested-but-unconfigured Clerk environment remains closed; never
  // resurrect legacy tokens while showing the Clerk configuration blocker.
  const clerkMode = CLERK_AUTH_CONFIGURATION.authExpected;
  const clerkApiConfiguration = clerkMode ? getMainBluebirdApiConfigurationOrNull() : null;
  const clerkStartupConfigurationValid =
    CLERK_AUTH_CONFIGURATION.enabled &&
    !!CLERK_AUTH_CONFIGURATION.publishableKey &&
    (CLERK_AUTH_CONFIGURATION.environment !== 'production' ||
      (clerkApiConfiguration?.environment === 'production' &&
        clerkApiConfiguration.clerkPublishableKey === CLERK_AUTH_CONFIGURATION.publishableKey));
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [clerkStartupState, setClerkStartupState] = useState<ClerkStartupState>(() =>
    getClerkStartupState({
      authExpected: clerkMode,
      configurationValid: clerkStartupConfigurationValid,
      providerMounted: clerkProviderMounted,
      isLoaded: clerkSession?.isLoaded === true,
      timedOut: false,
    }),
  );
  const [clerkStartupFailureReason, setClerkStartupFailureReason] = useState<ClerkStartupFailureReason | null>(() =>
    getClerkStartupFailureReason({
      configurationValid: clerkStartupConfigurationValid,
      providerMounted: clerkProviderMounted,
      timedOut: false,
    }),
  );
  const [pendingRegistrationGrant, setPendingRegistrationGrant] = useState<string | null>(null);
  const [clerkMemberResolution, setClerkMemberResolution] = useState<ClerkMemberResolution>({ status: 'resolving' });
  const [clerkResolutionRetry, setClerkResolutionRetry] = useState(0);
  const registerPushToken = useRegisterNetworkingPushToken();
  const previousClerkIdentity = useRef<string | null | undefined>(undefined);
  const startupAttemptStartedRef = useRef<number | null>(null);
  const clerkSessionRef = useRef(clerkSession);
  clerkSessionRef.current = clerkSession;
  const verifiedProfileCompletionRef = useRef<{
    clerkUserId: string;
    currentUser: ProductionCurrentUser;
    revision: number;
  } | null>(null);
  const profileCompletionRevisionRef = useRef(0);

  useEffect(() => {
    if (!clerkMode) return;
    logClerkStartupDiagnostic({
      event: 'production_mode',
      production: CLERK_AUTH_CONFIGURATION.environment === 'production',
      attempt: clerkStartupAttempt,
      providerMounted: clerkProviderMounted,
    });
  }, [clerkMode, clerkStartupAttempt, clerkProviderMounted]);

  useEffect(() => {
    if (!clerkMode) {
      setClerkStartupState('ready');
      setClerkStartupFailureReason(null);
      return;
    }

    const production = CLERK_AUTH_CONFIGURATION.environment === 'production';
    const configurationValid = clerkStartupConfigurationValid;
    const isLoaded = clerkSession?.isLoaded === true;
    const state = getClerkStartupState({
      authExpected: true,
      configurationValid,
      providerMounted: clerkProviderMounted,
      isLoaded,
      timedOut: false,
    });
    if (startupAttemptStartedRef.current !== clerkStartupAttempt) {
      startupAttemptStartedRef.current = clerkStartupAttempt;
      logClerkStartupDiagnostic({
        event: 'initialization_start',
        production,
        attempt: clerkStartupAttempt,
        providerMounted: clerkProviderMounted,
      });
    }
    const failureReason = getClerkStartupFailureReason({
      configurationValid,
      providerMounted: clerkProviderMounted,
      timedOut: false,
    });
    if (failureReason) {
      setClerkStartupState('failed');
      setClerkStartupFailureReason(failureReason);
      logClerkStartupDiagnostic({
        event: 'initialization_error',
        production,
        attempt: clerkStartupAttempt,
        providerMounted: clerkProviderMounted,
        errorCategory: 'unknown',
      });
      return;
    }

    logClerkStartupDiagnostic({
      event: 'readiness_change',
      production,
      attempt: clerkStartupAttempt,
      providerMounted: clerkProviderMounted,
      isLoaded,
    });
    if (state === 'ready') {
      setClerkStartupState('ready');
      setClerkStartupFailureReason(null);
      return;
    }

    setClerkStartupState('loading');
    setClerkStartupFailureReason(null);
    if (!production) return;

    return startClerkStartupTimeout(() => {
      const timedOutState = getClerkStartupState({
        authExpected: true,
        configurationValid,
        providerMounted: clerkProviderMounted,
        isLoaded: false,
        timedOut: true,
      });
      if (timedOutState !== 'failed') return;
      setClerkStartupState('failed');
      setClerkStartupFailureReason('initialization_timeout');
      logClerkStartupDiagnostic({
        event: 'timeout',
        production: true,
        attempt: clerkStartupAttempt,
        providerMounted: clerkProviderMounted,
      });
      logClerkStartupDiagnostic({
        event: 'initialization_error',
        production: true,
        attempt: clerkStartupAttempt,
        providerMounted: clerkProviderMounted,
        errorCategory: 'timeout',
      });
    }, CLERK_STARTUP_TIMEOUT_MS);
  }, [
    clerkMode,
    clerkStartupAttempt,
    clerkProviderMounted,
    clerkSession?.isLoaded,
    clerkStartupConfigurationValid,
  ]);

  useEffect(() => {
    if (!clerkMode) return;
    // A demo JWT/profile must not survive as a fallback in the Clerk flow.
    void Promise.all([
      AsyncStorage.removeItem(TOKEN_KEY),
      AsyncStorage.removeItem(USER_KEY),
    ]);
  }, [clerkMode]);

  useEffect(() => {
    if (!clerkMode || !clerkSession?.isLoaded) return;
    const nextIdentity = clerkSession.isSignedIn === true ? clerkSession.userId : null;
    if (verifiedProfileCompletionRef.current?.clerkUserId !== nextIdentity) {
      verifiedProfileCompletionRef.current = null;
      profileCompletionRevisionRef.current += 1;
    }
    // Clear before member routes can be exposed for the new identity.
    if (clearClerkMemberCacheOnIdentityChange(
      queryClient,
      previousClerkIdentity.current,
      nextIdentity,
      clerkSession.isLoaded,
    )) {
      previousClerkIdentity.current = nextIdentity;
    }
    setToken(null);
    setUser(null);
    setPendingRegistrationGrant(null);
  }, [clerkMode, clerkSession?.isLoaded, clerkSession?.isSignedIn, clerkSession?.userId, queryClient]);

  useEffect(() => {
    if (!clerkMode) {
      setClerkMemberResolution({ status: 'signed_out' });
      return;
    }
    if (!clerkSession?.isLoaded) {
      setClerkMemberResolution({ status: 'resolving' });
      return;
    }
    if (clerkSession.isSignedIn !== true) {
      setClerkMemberResolution({ status: 'signed_out' });
      return;
    }
    if (!shouldAutomaticallyResolveClerkMember({
      isClerkMode: clerkMode,
      isLoaded: clerkSession.isLoaded,
      isSignedIn: clerkSession.isSignedIn,
    })) {
      setClerkMemberResolution({ status: 'signed_out' });
      return;
    }

    const requestedClerkUserId = clerkSession.userId;
    if (!requestedClerkUserId) {
      setClerkMemberResolution({
        status: 'unresolved',
        reason: 'missing_authoritative_decision',
      });
      return;
    }
    const configuration = clerkApiConfiguration;
    if (!configuration) {
      setClerkMemberResolution({ status: 'error', reason: 'unknown' });
      return;
    }
    const controller = new AbortController();
    const requestProfileRevision = profileCompletionRevisionRef.current;
    setClerkMemberResolution({ status: 'resolving', clerkUserId: requestedClerkUserId });
    void resolveClerkMember({
      session: clerkSession,
      configuration,
      clerkUserId: requestedClerkUserId,
      signal: controller.signal,
    }).then((resolution) => {
      const currentSession = clerkSessionRef.current;
      if (isClerkMemberResolutionCurrent({
        requestedClerkUserId,
        currentClerkUserId: currentSession?.isLoaded && currentSession.isSignedIn === true
          ? currentSession.userId
          : null,
        aborted: controller.signal.aborted,
      })) {
        const accepted = verifiedProfileCompletionRef.current;
        if (
          accepted?.clerkUserId === requestedClerkUserId &&
          accepted.revision > requestProfileRevision
        ) {
          setClerkMemberResolution(resolveProjection(accepted.currentUser, requestedClerkUserId));
        } else {
          setClerkMemberResolution(resolution);
        }
      }
    });
    return () => controller.abort();
  }, [
    clerkMode,
    clerkSession?.isLoaded,
    clerkSession?.isSignedIn,
    clerkSession?.userId,
    clerkApiConfiguration?.environment,
    clerkApiConfiguration?.apiBaseUrl,
    clerkApiConfiguration?.clerkPublishableKey,
    clerkResolutionRetry,
  ]);

  useEffect(() => {
    async function loadAuth() {
      if (clerkMode) return;
      try {
        const [storedToken, storedUser] = await Promise.all([
          AsyncStorage.getItem(TOKEN_KEY),
          AsyncStorage.getItem(USER_KEY),
        ]);
        const sessionToken = storedToken?.trim() ?? '';

        if (!!sessionToken !== !!storedUser) {
          await clearStoredSession();
          return;
        }

        if (sessionToken && storedUser) {
          let cachedUser: AuthUser;
          try {
            cachedUser = normalizeUser(JSON.parse(storedUser));
          } catch {
            await clearStoredSession();
            return;
          }

          // Validate the stored token against the server; stale/invalid tokens
          // (e.g. after a server secret change) are cleared so the user is
          // sent back to sign-in instead of seeing endless 401 errors. A
          // bounded request also lets a cached local session recover when the
          // auth service is slow or temporarily unreachable.
          const baseUrl = process.env.EXPO_PUBLIC_DOMAIN
            ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
            : '';
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), AUTH_RESTORE_TIMEOUT_MS);
          try {
            const resp = await fetch(`${baseUrl}/api/auth/me`, {
              headers: { Authorization: `Bearer ${sessionToken}` },
              signal: controller.signal,
            });
            if (resp.ok) {
              const freshUser = normalizeUser(await resp.json());
              setToken(sessionToken);
              setUser(freshUser);
              AsyncStorage.setItem(USER_KEY, JSON.stringify(freshUser)).catch(() => {});
            } else if (resp.status === 401) {
              // Token no longer valid — clear the stale session
              setToken(null);
              setUser(null);
              await clearStoredSession();
            } else {
              // Server error — keep cached session, fail open
              setToken(sessionToken);
              setUser(cachedUser);
            }
          } catch {
            // Network error — keep cached session so offline use still works
            setToken(sessionToken);
            setUser(cachedUser);
          } finally {
            clearTimeout(timeoutId);
          }
        }
      } catch {
        // ignore read errors
      } finally {
        setIsLoading(false);
      }
    }
    loadAuth();
  }, [clerkMode]);

  useEffect(() => {
    if (!user || !token || user.membershipTier === 'none' || Platform.OS === 'web') return;
    let cancelled = false;
    (async () => {
      try {
        const current = await Notifications.getPermissionsAsync();
        let status = current.status;
        if (status !== 'granted') {
          status = (await Notifications.requestPermissionsAsync()).status;
        }
        if (status !== 'granted' || cancelled) return;
        const push = await Notifications.getExpoPushTokenAsync();
        if (!cancelled && push.data) {
          registerPushToken.mutate({
            data: {
              token: push.data,
              platform: Platform.OS,
            },
          });
        }
      } catch {
        // Push permission is optional; networking notifications remain in-app.
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, user?.membershipTier, token]);

  const signIn = async (newToken: string, newUser: AuthUser) => {
    if (clerkMode) throw new Error('Legacy Bluebird sign-in is disabled while Clerk migration mode is active.');
    const normalized = normalizeUser(newUser);
    await Promise.all([
      AsyncStorage.setItem(TOKEN_KEY, newToken),
      AsyncStorage.setItem(USER_KEY, JSON.stringify(normalized)),
    ]);
    setToken(newToken);
    setUser(normalized);
    setPendingRegistrationGrant(null);
  };

  const signOut = async () => {
    if (clerkMode) {
      queryClient.clear();
      setClerkMemberResolution({ status: 'signed_out' });
      await clerkSession?.signOut();
      setToken(null);
      setUser(null);
      setPendingRegistrationGrant(null);
      router.replace('/(auth)/welcome');
      return;
    }
    // Best-effort server-side token revocation. Must happen before the token
    // is cleared locally (the request needs it), but never blocks sign-out:
    // offline or failed calls still complete the local sign-out.
    try {
      await logout();
    } catch {
      // ignore — token will still expire naturally server-side
    }
    await Promise.all([
      AsyncStorage.removeItem(TOKEN_KEY),
      AsyncStorage.removeItem(USER_KEY),
    ]);
    setToken(null);
    setUser(null);
    setPendingRegistrationGrant(null);
    // Wipe all cached member data (flights, queues, notifications, profile)
    // so a different account signing in on this device sees nothing stale.
    queryClient.clear();
    router.replace('/(auth)/welcome');
  };

  const updateUser = (updatedUser: AuthUser) => {
    if (clerkMode) return;
    const normalized = normalizeUser(updatedUser);
    setUser(normalized);
    AsyncStorage.setItem(USER_KEY, JSON.stringify(normalized)).catch(() => {});
  };
  const confirmClerkProfileCompletion = useCallback((currentUser: ProductionCurrentUser) => {
    const activeSession = clerkSessionRef.current;
    if (
      !clerkMode ||
      !activeSession?.isLoaded ||
      activeSession.isSignedIn !== true ||
      !activeSession.userId ||
      currentUser.isAuthenticated !== true ||
      currentUser.isProfileComplete !== true
    ) return false;
    verifiedProfileCompletionRef.current = {
      clerkUserId: activeSession.userId,
      currentUser,
      revision: ++profileCompletionRevisionRef.current,
    };
    setClerkMemberResolution(resolveProjection(currentUser, activeSession.userId));
    return true;
  }, [clerkMode]);

  const currentClerkUserId = clerkMode &&
    clerkSession?.isLoaded &&
    clerkSession.isSignedIn === true
    ? clerkSession.userId
    : null;
  const currentClerkMemberResolution = getClerkResolutionForIdentity(
    clerkMemberResolution,
    currentClerkUserId,
  );

  return (
    <AuthContext.Provider value={{
      token: clerkMode ? null : token,
      user: clerkMode ? null : user,
      isLoading: clerkMode ? clerkStartupState === 'loading' : isLoading,
      demoMode: false,
      authMode: clerkMode ? 'clerk' : 'legacy',
      clerkStartupState,
      clerkStartupFailureReason,
      clerkStartupSnapshotReceived: clerkSession !== null || startupSnapshotStatus.snapshotReceived,
      clerkStartupIsLoaded: clerkSession
        ? clerkSession.isLoaded === true
        : startupSnapshotStatus.isLoaded,
      retryClerkStartup: () => {
        if (clerkStartupState !== 'failed') return;
        setClerkStartupState('loading');
        setClerkStartupFailureReason(null);
        onRetryClerkStartup();
      },
      clerkSignedIn: clerkMode && clerkSession?.isLoaded ? clerkSession.isSignedIn === true : false,
      clerkUserId: clerkMode && clerkSession?.isLoaded && clerkSession.isSignedIn === true
        ? clerkSession.userId
        : null,
      clerkMemberResolution: clerkMode ? currentClerkMemberResolution : { status: 'signed_out' },
      retryClerkMemberResolution: () => setClerkResolutionRetry((attempt) => attempt + 1),
      confirmClerkProfileCompletion,
      memberAccessResolved: !clerkMode && !!token && !!user,
      signIn,
      signOut,
      updateUser,
      pendingRegistrationGrant,
      setPendingRegistrationGrant,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

function normalizeUser(value: unknown): User {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Stored member session is not an object.');
  }

  const cached = value as Record<string, unknown>;
  const validTiers: readonly string[] = ['none', 'base', 'plus', 'concierge'];
  if (
    typeof cached.id !== 'string' ||
    !cached.id.trim() ||
    typeof cached.name !== 'string' ||
    !cached.name.trim() ||
    typeof cached.membershipTier !== 'string' ||
    !validTiers.includes(cached.membershipTier)
  ) {
    throw new Error('Stored member session is missing required identity fields.');
  }

  return {
    ...cached,
    notificationChannel: cached.notificationChannel === 'email' || cached.notificationChannel === 'both'
      ? cached.notificationChannel
      : 'app',
    homeAirports: Array.isArray(cached.homeAirports)
      ? cached.homeAirports.filter((airport): airport is string => typeof airport === 'string')
      : typeof cached.homeAirport === 'string' && cached.homeAirport
        ? [cached.homeAirport]
        : [],
  } as User;
}

async function clearStoredSession() {
  await Promise.all([
    AsyncStorage.removeItem(TOKEN_KEY),
    AsyncStorage.removeItem(USER_KEY),
  ]);
}
