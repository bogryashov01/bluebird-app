import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';

interface StatCardProps {
  label: string;
  value: string | number;
  /** 'light' (default) — white card on #FAFAF8 surface; 'dark' — card token on navy surface */
  variant?: 'light' | 'dark';
}

export function StatCard({ label, value, variant = 'light' }: StatCardProps) {
  const colors = useColors();
  const isLight = variant === 'light';
  return (
    <View style={[
      styles.card,
      { backgroundColor: isLight ? '#fff' : colors.card },
    ]}>
      <Text style={[styles.label, { color: isLight ? colors.mutedForegroundLight : colors.mutedForeground }]}>
        {label}
      </Text>
      <Text style={[styles.value, { color: isLight ? colors.backgroundMid : colors.foreground }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: 18,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 20,
    shadowOpacity: 0.05,
    elevation: 3,
  },
  label: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  value: {
    fontFamily: 'Inter_700Bold',
    fontSize: 22,
    marginTop: 2,
  },
});
