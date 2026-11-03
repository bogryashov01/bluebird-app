import { useMemo } from 'react';
import { DarkTheme, DefaultTheme } from 'expo-router';
import { useTheme, type ResolvedScheme } from '@/context/ThemeContext';
import { bluebirdStackScreenOptions, bluebirdThemePalette } from '@/lib/bluebirdThemeSurfaces';

type NavigationTheme = typeof DarkTheme;

/**
 * Maps the existing Bluebird palette onto React Navigation chrome.
 * Screen content, headers, and the native stack use these tokens
 * instead of Navigation's default light surfaces.
 */
export function bluebirdNavigationTheme(scheme: ResolvedScheme): NavigationTheme {
  const palette = bluebirdThemePalette(scheme);
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  return {
    ...base,
    dark: scheme === 'dark',
    colors: {
      ...base.colors,
      primary: palette.primary,
      background: palette.background,
      card: palette.headerBackground,
      text: palette.foreground,
      border: palette.border,
      notification: palette.destructive,
    },
  };
}

export function useBluebirdStackScreenOptions() {
  const { scheme } = useTheme();
  return useMemo(() => bluebirdStackScreenOptions(scheme), [scheme]);
}

export { bluebirdStackScreenOptions };
