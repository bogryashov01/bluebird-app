import React from 'react';
import {
  ActivityIndicator, StyleSheet, Text, TouchableOpacity,
  type StyleProp, type ViewStyle,
} from 'react-native';
import { useColors } from '@/hooks/useColors';

/**
 * Shared CTA buttons matching the established app convention:
 *  - Primary:   54px fully-rounded pill, Inter 600 @ 16pt.
 *  - Secondary: 48px fully-rounded pill, Inter 600 @ 15pt.
 * Colors default to the theme primary; pass overrides for branded surfaces.
 */
interface ButtonProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** Background override (defaults to colors.primary). */
  backgroundColor?: string;
  /** Label/spinner color override (defaults to colors.primaryForeground). */
  textColor?: string;
  style?: StyleProp<ViewStyle>;
}

export function PrimaryButton({
  label, onPress, loading, disabled, backgroundColor, textColor, style,
}: ButtonProps) {
  const colors = useColors();
  const bg = backgroundColor ?? colors.primary;
  const fg = textColor ?? colors.primaryForeground;
  return (
    <TouchableOpacity
      style={[styles.primary, { backgroundColor: bg }, (disabled || loading) && styles.dimmed, style]}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityState={{ disabled: !!(disabled || loading) }}
      activeOpacity={0.85}
    >
      {loading
        ? <ActivityIndicator color={fg} />
        : <Text style={[styles.primaryText, { color: fg }]}>{label}</Text>}
    </TouchableOpacity>
  );
}

export function SecondaryButton({
  label, onPress, loading, disabled, backgroundColor, textColor, style,
}: ButtonProps) {
  const colors = useColors();
  const bg = backgroundColor ?? colors.muted;
  const fg = textColor ?? colors.textOnSurface;
  return (
    <TouchableOpacity
      style={[styles.secondary, { backgroundColor: bg }, (disabled || loading) && styles.dimmed, style]}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityState={{ disabled: !!(disabled || loading) }}
      activeOpacity={0.85}
    >
      {loading
        ? <ActivityIndicator color={fg} size="small" />
        : <Text style={[styles.secondaryText, { color: fg }]}>{label}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  primary: {
    height: 54, borderRadius: 999,
    justifyContent: 'center', alignItems: 'center',
  },
  primaryText: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  secondary: {
    height: 48, borderRadius: 999,
    justifyContent: 'center', alignItems: 'center',
  },
  secondaryText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  dimmed: { opacity: 0.6 },
});
