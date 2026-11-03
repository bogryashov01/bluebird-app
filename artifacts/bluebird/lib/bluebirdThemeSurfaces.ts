import colors from '@/constants/colors';
import type { ResolvedScheme, ThemePreference } from '@/context/ThemeContext';

export function resolvedColorScheme(
  preference: ThemePreference,
  osScheme: string | null | undefined,
): ResolvedScheme {
  if (preference === 'light' || preference === 'dark') return preference;
  return osScheme === 'light' ? 'light' : 'dark';
}

export function bluebirdThemePalette(scheme: ResolvedScheme) {
  return scheme === 'dark' ? colors.dark : colors.light;
}

/** Screen fill for Discover. It is the active tab background, not a separate navy palette. */
export function discoverScreenBackground(scheme: ResolvedScheme): string {
  return bluebirdThemePalette(scheme).background;
}

export function bluebirdStackScreenOptions(scheme: ResolvedScheme): {
  contentStyle: { backgroundColor: string };
  headerStyle: { backgroundColor: string };
  headerTintColor: string;
  headerTitleStyle: { color: string };
  headerShadowVisible: false;
} {
  const palette = bluebirdThemePalette(scheme);
  return {
    contentStyle: { backgroundColor: palette.background },
    headerStyle: { backgroundColor: palette.headerBackground },
    headerTintColor: palette.headerForeground,
    headerTitleStyle: { color: palette.headerForeground },
    headerShadowVisible: false,
  };
}
