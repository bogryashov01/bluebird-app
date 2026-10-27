import React from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import {
  getClerkStartupDiagnosticLines,
  type ClerkStartupFailureReason,
  type ClerkStartupState,
} from '@/lib/clerkStartup';
import { isNativeProductionAuthTestEnabled, shouldShowNativeAuthStartupDiagnostics } from '@/lib/nativeAuthTestPolicy';

export function ClerkStartupDiagnosticDetails({
  failureReason,
  snapshotReceived,
  isLoaded,
}: {
  failureReason: ClerkStartupFailureReason;
  snapshotReceived: boolean;
  isLoaded: boolean;
}) {
  const colors = useColors();
  const visible = shouldShowNativeAuthStartupDiagnostics({
    platformOS: Platform.OS,
    nativeAuthTestEnabled: isNativeProductionAuthTestEnabled(),
    apiEnvironment: process.env.EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT,
    developmentBuild: typeof __DEV__ !== 'undefined' && __DEV__,
  });
  if (!visible) return null;

  return (
    <View
      accessibilityLabel="Clerk startup diagnostics"
      style={[styles.diagnosticsBox, { borderColor: colors.border }]}
      testID="clerk-startup-diagnostics"
    >
      <Text style={[styles.diagnosticsTitle, { color: colors.mutedOnBrand }]}>
        Startup diagnostics
      </Text>
      {getClerkStartupDiagnosticLines({ failureReason, snapshotReceived, isLoaded }).map((line) => (
        <Text key={line} style={[styles.diagnosticText, { color: colors.textOnBrand }]}>
          {line}
        </Text>
      ))}
    </View>
  );
}

export function ClerkStartupStateView({
  state,
  onRetry,
  failureReason = 'initialization_timeout',
  snapshotReceived = false,
  isLoaded = false,
}: {
  state: ClerkStartupState;
  onRetry: () => void;
  failureReason?: ClerkStartupFailureReason;
  snapshotReceived?: boolean;
  isLoaded?: boolean;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const failed = state === 'failed';
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.backgroundMid, paddingTop: topPad + 24, paddingBottom: bottomPad + 24 },
      ]}
    >
      <Text style={[styles.eyebrow, { color: colors.paleBlue }]}>BLUEBIRD ACCOUNT</Text>
      <Text style={[styles.title, { color: colors.textOnBrand }]}>
        Continue with your phone
      </Text>
      <Text style={[styles.subtitle, { color: colors.mutedOnBrand }]}>
        Sign-in is being prepared securely. Your account remains protected.
      </Text>
      <TextInput
        accessibilityLabel="Phone number"
        editable={false}
        placeholder="Phone number"
        placeholderTextColor={colors.mutedForeground}
        style={[
          styles.phoneInput,
          { backgroundColor: colors.input, borderColor: colors.border, color: colors.textOnBrand },
        ]}
        testID="clerk-phone-input"
      />
      {failed ? (
        <>
          <View
            accessibilityLiveRegion="polite"
            style={[styles.errorBox, { borderColor: colors.destructive }]}
            testID="clerk-startup-error"
          >
            <Text style={[styles.message, { color: colors.destructive }]}>
              Sign-in couldn’t start
            </Text>
            <Text style={[styles.message, { color: colors.textOnBrand }]}>
              Bluebird couldn’t initialize secure sign-in. Your account is protected. Please try again.
            </Text>
            <ClerkStartupDiagnosticDetails
              failureReason={failureReason}
              snapshotReceived={snapshotReceived}
              isLoaded={isLoaded}
            />
          </View>
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
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: true }}
        disabled
        style={[styles.disabledButton, { backgroundColor: colors.primary }]}
        testID="clerk-request-code"
      >
        <Text style={[styles.retryText, { color: colors.primaryForeground }]}>
          Preparing sign-in…
        </Text>
      </Pressable>
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
    paddingTop: 32,
    paddingBottom: 32,
  },
  eyebrow: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1.4,
  },
  subtitle: {
    maxWidth: 340,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    lineHeight: 22,
    textAlign: 'center',
  },
  phoneInput: {
    width: '100%',
    maxWidth: 400,
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    opacity: 0.72,
  },
  errorBox: {
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },
  diagnosticsBox: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    gap: 3,
  },
  diagnosticsTitle: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 2,
  },
  diagnosticText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    lineHeight: 17,
  },
  disabledButton: {
    width: '100%',
    maxWidth: 400,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    opacity: 0.55,
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
