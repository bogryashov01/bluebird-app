import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { BluebirdLogo } from '@/components/BluebirdLogo';
import { useColors } from '@/hooks/useColors';

/** Compact branded wait while the signed-in queue membership is loaded. */
export function JoinQueueLoading() {
  const colors = useColors();
  return (
    <View
      testID="join-flight-queue-loading"
      style={[styles.screen, { backgroundColor: colors.offWhite }]}
    >
      <BluebirdLogo variant="symbol" size="medium" />
      <ActivityIndicator color={colors.primary} />
      <Text style={[styles.label, { color: colors.textOnSurface }]}>Checking your queue</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
  },
});
