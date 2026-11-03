import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import { Appearance, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SystemUI from 'expo-system-ui';
import colors from '@/constants/colors';
import { resolvedColorScheme } from '@/lib/bluebirdThemeSurfaces';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedScheme = 'light' | 'dark';

const STORAGE_KEY = 'bluebird.themePreference';

interface ThemeContextValue {
  /** The user's saved preference (light / dark / system). */
  preference: ThemePreference;
  /** The active scheme after resolving 'system' against the OS setting. */
  scheme: ResolvedScheme;
  setPreference: (pref: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const osScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        setPreferenceState(stored);
      }
    }).catch(() => {});
  }, []);

  const setPreference = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref);
    AsyncStorage.setItem(STORAGE_KEY, pref).catch(() => {});
  }, []);

  const scheme: ResolvedScheme = resolvedColorScheme(preference, osScheme);

  useEffect(() => {
    try {
      Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
    } catch {
      // The native appearance override is unavailable outside iOS and Android.
    }
  }, [preference]);

  useEffect(() => {
    const background = scheme === 'dark' ? colors.dark.background : colors.light.background;
    SystemUI.setBackgroundColorAsync(background).catch(() => {});
  }, [scheme]);

  const value = useMemo(
    () => ({ preference, scheme, setPreference }),
    [preference, scheme, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}
