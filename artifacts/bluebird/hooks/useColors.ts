import colors from '@/constants/colors';
import { useTheme } from '@/context/ThemeContext';

/**
 * Returns the design tokens for the active theme.
 *
 * The active theme is resolved by ThemeProvider from the user's saved
 * preference (Light / Dark / System); System follows the OS scheme.
 * The returned object contains all color tokens for the active palette
 * plus scheme-independent values like `radius`.
 */
export function useColors() {
  const { scheme } = useTheme();
  const palette = scheme === 'dark' ? colors.dark : colors.light;
  return {
    ...palette,
    radius: colors.radius,
    /** 'light' | 'dark' — the resolved scheme, for conditional styling. */
    scheme,
  };
}
