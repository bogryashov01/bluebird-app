import React from 'react';
import { Platform, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';

/**
 * Uniform floating circular back button for full-bleed screens without a
 * stack header (queue flow, buy-pass, etc.). Identical geometry and top
 * spacing on every screen:
 *  - 38px circle, left 16, top = safe-area top (67 on web) + 14
 *  - `surface` variant for light/settings surfaces, `brand` for navy screens
 */
export function FloatingBackButton({
  variant = 'surface',
  onPress,
}: {
  variant?: 'surface' | 'brand';
  onPress?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bg = variant === 'brand' ? colors.textOnBrand + '14' : colors.muted;
  const fg = variant === 'brand' ? colors.textOnBrand : colors.textOnSurface;
  return (
    <TouchableOpacity
      style={[styles.btn, { top: topPad + 14, backgroundColor: bg }]}
      onPress={onPress ?? (() => router.back())}
      activeOpacity={0.75}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      testID="floating-back"
    >
      <Feather name="chevron-left" size={22} color={fg} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    position: 'absolute', zIndex: 20, left: 16,
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
  },
});
