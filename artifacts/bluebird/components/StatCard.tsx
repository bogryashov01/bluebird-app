import React from 'react';
import { ActivityIndicator, View, Text, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';

interface StatCardProps {
  label: string;
  value: string | number;
  /** 'light' (default) — white card on #FAFAF8 surface; 'dark' — card token on navy surface */
  variant?: 'light' | 'dark';
  accessibilityLabel?: string;
  testID?: string;
  pending?: boolean;
  icon?: React.ReactNode;
}

export function StatCard({
  label,
  value,
  variant = 'light',
  accessibilityLabel,
  testID,
  pending = false,
  icon,
}: StatCardProps) {
  const colors = useColors();
  const isLight = variant === 'light';
  return (
    <View
      testID={testID}
      accessibilityLabel={accessibilityLabel ?? `${label}, ${value}`}
      style={[
      styles.card,
      { backgroundColor: isLight ? colors.surface : colors.card },
    ]}>
      {icon ? (
        <View style={[styles.iconWrap, { backgroundColor: colors.secondary }]}>
          {icon}
        </View>
      ) : null}
      <Text style={[styles.label, { color: isLight ? colors.mutedForegroundLight : colors.mutedForeground }]} numberOfLines={2}>
        {label}
      </Text>
      {pending ? (
        <ActivityIndicator
          color={isLight ? colors.textOnSurface : colors.foreground}
          style={styles.pending}
          accessibilityLabel={accessibilityLabel}
        />
      ) : (
        <Text style={[styles.value, { color: isLight ? colors.textOnSurface : colors.foreground }]}>
          {value}
        </Text>
      )}
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
  pending: { alignSelf: 'flex-start', marginTop: 8 },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
});
