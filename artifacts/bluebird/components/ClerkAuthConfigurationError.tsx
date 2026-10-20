import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { CLERK_AUTH_CONFIGURATION } from '@/lib/clerkAuthConfig';

export function ClerkAuthConfigurationError() {
  const colors = useColors();

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundMid }]}>
      <Text style={[styles.title, { color: colors.textOnBrand }]}>
        Sign-in setup is incomplete
      </Text>
      <Text
        accessibilityLiveRegion="polite"
        style={[styles.message, { color: colors.mutedOnBrand }]}
        testID="clerk-configuration-error"
      >
        {CLERK_AUTH_CONFIGURATION.configurationError ??
          'Sign-in is temporarily unavailable. Please try again later.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    lineHeight: 22,
    textAlign: 'center',
  },
});
