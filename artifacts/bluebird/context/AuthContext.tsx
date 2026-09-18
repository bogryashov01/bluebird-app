import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAuthTokenGetter, logout, type User } from '@workspace/api-client-react';
import { getApiBaseUrl } from '@/lib/apiBaseUrl';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';

const TOKEN_KEY = 'bluebird_token';
const USER_KEY = 'bluebird_user';

export type AuthUser = User;
interface AuthContextType {
  token: string | null;
  user: AuthUser | null;
  isLoading: boolean;
  signIn: (token: string, user: AuthUser) => Promise<void>;
  signOut: () => Promise<void>;
  updateUser: (user: AuthUser) => void;
  pendingRegistrationGrant: string | null;
  setPendingRegistrationGrant: (grant: string | null) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

// Register the token getter globally so every API request carries the bearer token
setAuthTokenGetter(async () => {
  try {
    return await AsyncStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingRegistrationGrant, setPendingRegistrationGrant] = useState<string | null>(null);

  useEffect(() => {
    async function loadAuth() {
      try {
        const [storedToken, storedUser] = await Promise.all([
          AsyncStorage.getItem(TOKEN_KEY),
          AsyncStorage.getItem(USER_KEY),
        ]);
        if (storedToken && storedUser) {
          // Validate the stored token against the server; stale/invalid tokens
          // (e.g. after a server secret change) are cleared so the user is
          // sent back to sign-in instead of seeing endless 401 errors.
          const baseUrl = getApiBaseUrl() ?? '';
          try {
            const resp = await fetch(`${baseUrl}/api/auth/me`, {
              headers: { Authorization: `Bearer ${storedToken}` },
            });
            if (resp.ok) {
              const freshUser = normalizeUser(await resp.json());
              setToken(storedToken);
              setUser(freshUser);
              AsyncStorage.setItem(USER_KEY, JSON.stringify(freshUser)).catch(() => {});
            } else if (resp.status === 401) {
              // Token no longer valid — clear the stale session
              await Promise.all([
                AsyncStorage.removeItem(TOKEN_KEY),
                AsyncStorage.removeItem(USER_KEY),
              ]);
            } else {
              // Server error — keep cached session, fail open
              setToken(storedToken);
              setUser(normalizeUser(JSON.parse(storedUser)));
            }
          } catch {
            // Network error — keep cached session so offline use still works
            setToken(storedToken);
            setUser(normalizeUser(JSON.parse(storedUser)));
          }
        }
      } catch {
        // ignore read errors
      } finally {
        setIsLoading(false);
      }
    }
    loadAuth();
  }, []);

  const signIn = async (newToken: string, newUser: AuthUser) => {
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
    const normalized = normalizeUser(updatedUser);
    setUser(normalized);
    AsyncStorage.setItem(USER_KEY, JSON.stringify(normalized)).catch(() => {});
  };

  return (
    <AuthContext.Provider value={{
      token,
      user,
      isLoading,
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
  const cached = value as User & { homeAirport?: string | null };
  return {
    ...cached,
    homeAirports: Array.isArray(cached.homeAirports)
      ? cached.homeAirports
      : cached.homeAirport
        ? [cached.homeAirport]
        : [],
  };
}
