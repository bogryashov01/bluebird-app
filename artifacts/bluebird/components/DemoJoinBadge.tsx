import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

export function DemoJoinBadge({ notice }: { notice: string }) {
  const colors = useColors();
  return (
    <View style={styles.wrap}>
      <View style={[styles.badge, { backgroundColor: colors.backgroundMid }]}>
        <Text style={[styles.badgeText, { color: colors.textOnBrand }]}>DEMO</Text>
      </View>
      <Text testID="demo-join-notice" style={[styles.notice, { color: colors.textOnSurface }]}>{notice}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 10, paddingHorizontal: 8 },
  badge: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  badgeText: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.8 },
  notice: { fontFamily: 'Inter_600SemiBold', fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
