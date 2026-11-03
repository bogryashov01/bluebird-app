import React from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BluebirdLogo } from '@/components/BluebirdLogo';
import { useColors } from '@/hooks/useColors';

export function ClerkAccountLoading() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  return (
    <View
      accessibilityLabel="Loading your account"
      style={[styles.screen, { backgroundColor: colors.backgroundMid, paddingTop: topPad }]}
      testID="clerk-account-loading"
    >
      <BluebirdLogo variant="symbol" size="medium" />
      <ActivityIndicator color={colors.primary} size="large" />
      <Text style={[styles.label, { color: colors.textOnBrand }]}>Loading your account</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  label: { fontFamily: 'Inter_500Medium', fontSize: 15 },
});
