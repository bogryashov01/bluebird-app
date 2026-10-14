import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
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
  resolveClerkMember,
  type ClerkMemberResolution,
} from '@/lib/clerkMemberResolution';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';

const TOKEN_KEY = 'bluebird_token';
const USER_KEY = 'bluebird_user';
const AUTH_RESTORE_TIMEOUT_MS = 8_000;

export type AuthUser = User;
interface AuthContextType {
  token: string | null;
  user: AuthUser | null;
  isLoading: boolean;
  authMode: 'legacy' | 'clerk';
  clerkSignedIn: boolean;
  clerkUserId: string | null;
  clerkMemberResolution: ClerkMemberResolution;
  retryClerkMemberResolution: () => void;
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
  CLERK_AUTH_CONFIGURATION.enabled,
  async () => {
    try {
      return await AsyncStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
));

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const clerkSession = useClerkAuthSnapshot();
  const clerkMode = CLERK_AUTH_CONFIGURATION.enabled;
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingRegistrationGrant, setPendingRegistrationGrant] = useState<string | null>(null);
  const [clerkMemberResolution, setClerkMemberResolution] = useState<ClerkMemberResolution>({ status: 'resolving' });
  const [clerkResolutionRetry, setClerkResolutionRetry] = useState(0);
  const registerPushToken = useRegisterNetworkingPushToken();
  const previousClerkIdentity = useRef<string | null | undefined>(undefined);

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

    const controller = new AbortController();
    setClerkMemberResolution({ status: 'resolving', clerkUserId: clerkSession.userId });
    void resolveClerkMember({
      session: clerkSession,
      clerkUserId: clerkSession.userId,
      signal: controller.signal,
    }).then((resolution) => {
      if (!controller.signal.aborted) setClerkMemberResolution(resolution);
    });
    return () => controller.abort();
  }, [
    clerkMode,
    clerkSession?.isLoaded,
    clerkSession?.isSignedIn,
    clerkSession?.userId,
    clerkSession?.getToken,
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

  return (
    <AuthContext.Provider value={{
      token: clerkMode ? null : token,
      user: clerkMode ? null : user,
      isLoading: clerkMode ? !clerkSession?.isLoaded : isLoading,
      authMode: clerkMode ? 'clerk' : 'legacy',
      clerkSignedIn: clerkMode && clerkSession?.isLoaded ? clerkSession.isSignedIn === true : false,
      clerkUserId: clerkMode && clerkSession?.isLoaded && clerkSession.isSignedIn === true
        ? clerkSession.userId
        : null,
      clerkMemberResolution: clerkMode ? clerkMemberResolution : { status: 'signed_out' },
      retryClerkMemberResolution: () => setClerkResolutionRetry((attempt) => attempt + 1),
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
