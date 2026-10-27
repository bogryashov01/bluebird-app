import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import type { ClerkStartupState } from '@/lib/clerkStartup';

export function ClerkStartupStateView({
  state,
  onRetry,
}: {
  state: ClerkStartupState;
  onRetry: () => void;
}) {
  const colors = useColors();
  const failed = state === 'failed';

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundMid }]}>
      {failed ? (
        <>
          <Text style={[styles.title, { color: colors.textOnBrand }]}>
            Sign-in couldn’t start
          </Text>
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.message, { color: colors.mutedOnBrand }]}
            testID="clerk-startup-error"
          >
            Bluebird couldn’t initialize secure sign-in. Your account is protected. Please try again.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onRetry}
            style={[styles.retryButton, { backgroundColor: colors.primary }]}
            testID="clerk-startup-retry"
          >
            <Text style={[styles.retryText, { color: colors.textOnBrand }]}>Retry</Text>
          </Pressable>
        </>
      ) : (
        <>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.message, { color: colors.mutedOnBrand }]}>
            Starting secure sign-in…
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 14,
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
  retryButton: {
    minWidth: 120,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingHorizontal: 20,
  },
  retryText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
});
