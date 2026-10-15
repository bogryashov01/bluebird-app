import React, { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth as useClerkAuth } from '@clerk/expo';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useDormantClerkProductionTokenProvider } from '@/lib/dormantClerkIntegration';
import { getClerkAuthErrorMessage, performClerkSignOut } from '@/lib/clerkAuthConfig';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth as useBluebirdAuth } from '@/context/AuthContext';
import { confirmDialog } from '@/lib/confirmDialog';
import {
  getClerkApiConnectionFailureGuidance,
  isClerkApiConnectionTestVisible,
  runClerkApiConnectionTest,
  type ClerkApiDiagnosticStage,
  type ClerkApiConnectionDiagnosticResult,
} from '@/lib/clerkApiConnectionDiagnostic';
import { createMainBluebirdApiIntegration } from '@/lib/mainBluebirdApi';
import {
  getMainBluebirdApiConfigurationOrNull,
  getMainBluebirdDevelopmentDiagnosticStatus,
} from '@/lib/mainBluebirdApiConfig';

export function ClerkSignedInScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { clerkMemberResolution, retryClerkMemberResolution } = useBluebirdAuth();
  const queryClient = useQueryClient();
  const clerkTokenProvider = useDormantClerkProductionTokenProvider();
  const mainApiConfiguration = getMainBluebirdApiConfigurationOrNull();
  const [error, setError] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isTestingApi, setIsTestingApi] = useState(false);
  const [apiDiagnostic, setApiDiagnostic] = useState<ClerkApiConnectionDiagnosticResult | null>(null);
  const [apiDiagnosticStages, setApiDiagnosticStages] = useState<ClerkApiDiagnosticStage[] | null>(null);
  const isDevelopment = typeof __DEV__ !== 'undefined' && __DEV__;
  const developmentDiagnosticStatus = getMainBluebirdDevelopmentDiagnosticStatus();
  const canRunApiConnectionTest = isClerkApiConnectionTestVisible({
    isDevelopment,
    environment: mainApiConfiguration?.environment ?? null,
    configurationValid: developmentDiagnosticStatus.developmentConfigurationValid,
    clerkInstanceMatchVerified: developmentDiagnosticStatus.clerkInstanceMatchVerified,
    clerkAuthEnabled: developmentDiagnosticStatus.clerkAuthEnabled,
    isLoaded,
    isSignedIn,
  });
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    setError(null);
    queryClient.clear();
    const result = await performClerkSignOut(() => clerkTokenProvider.clearClerkSession());
    setIsSigningOut(false);
    if (!result.ok) {
      setError(getClerkAuthErrorMessage(result.message));
      return;
    }
    router.replace('/(auth)/welcome');
  };

  const handleApiConnectionTest = async () => {
    if (
      isTestingApi ||
      !canRunApiConnectionTest ||
      !mainApiConfiguration ||
      mainApiConfiguration.environment !== 'development'
    ) return;
    setIsTestingApi(true);
    setApiDiagnostic(null);
    setApiDiagnosticStages(null);
    try {
      const result = await runClerkApiConnectionTest({
        isDevelopment,
        environment: mainApiConfiguration.environment,
        configuration: mainApiConfiguration,
        configurationValid: developmentDiagnosticStatus.developmentConfigurationValid,
        clerkInstanceMatchVerified: developmentDiagnosticStatus.clerkInstanceMatchVerified,
        clerkAuthEnabled: developmentDiagnosticStatus.clerkAuthEnabled,
        isLoaded,
        isSignedIn,
        confirm: confirmDialog,
        createApiClient: (diagnostic) => createMainBluebirdApiIntegration({
          configuration: mainApiConfiguration,
          tokenProvider: clerkTokenProvider,
          diagnostic,
        }).authenticated,
        onStages: setApiDiagnosticStages,
      });
      if (result) setApiDiagnostic(result);
    } catch {
      // The diagnostic helper sanitizes expected failures; never surface raw errors here.
    } finally {
      setIsTestingApi(false);
    }
  };

  if (!isLoaded) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.backgroundMid }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!isSignedIn) return <Redirect href="/(clerk-auth)/sign-in" />;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.backgroundMid, paddingTop: topPad, paddingBottom: bottomPad },
      ]}
    >
      <StatusBar style={colors.scheme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.content}>
        <Text style={[styles.eyebrow, { color: colors.paleBlue }]}>BLUEBIRD ACCOUNT</Text>
        <Text style={[styles.title, { color: colors.textOnBrand }]}>Bluebird member not linked</Text>
        <Text style={[styles.body, { color: colors.mutedOnBrand }]}>
          Your Clerk session is active, but Bluebird has not confirmed a matching member account. Member screens and cached member data stay unavailable until the backend can verify this connection.
        </Text>
        <Text style={[styles.pending, { color: colors.mutedOnBrand }]} testID="clerk-member-pending">
          {getResolutionMessage(clerkMemberResolution)}
        </Text>
        {isDevelopment && isLoaded && isSignedIn && (
          <View style={styles.diagnosticSection}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: isTestingApi || !canRunApiConnectionTest, busy: isTestingApi }}
              disabled={isTestingApi || !canRunApiConnectionTest}
              onPress={handleApiConnectionTest}
              style={[
                styles.retryButton,
                { borderColor: colors.border },
                (isTestingApi || !canRunApiConnectionTest) && styles.disabled,
              ]}
              testID="clerk-api-connection-test"
            >
              {isTestingApi ? (
                <ActivityIndicator color={colors.textOnBrand} />
              ) : (
                <Text style={[styles.retryButtonText, { color: colors.textOnBrand }]}>
                  Test Bluebird API Connection
                </Text>
              )}
            </Pressable>
            <View accessibilityLiveRegion="polite" style={styles.diagnosticResult} testID="clerk-api-connection-result">
              <DiagnosticResultText
                result={apiDiagnostic}
                stages={apiDiagnosticStages ?? apiDiagnostic?.stages ?? []}
                configurationStatus={developmentDiagnosticStatus}
                currentSessionExists={isSignedIn === true}
                currentEnvironment={mainApiConfiguration?.environment ?? null}
                color={colors.mutedOnBrand}
              />
            </View>
          </View>
        )}
        {clerkMemberResolution.status === 'error' && (
          <Pressable
            accessibilityRole="button"
            onPress={retryClerkMemberResolution}
            style={[styles.retryButton, { borderColor: colors.border }]}
            testID="clerk-member-retry"
          >
            <Text style={[styles.retryButtonText, { color: colors.textOnBrand }]}>Try membership check again</Text>
          </Pressable>
        )}
        {error && (
          <Text accessibilityLiveRegion="polite" style={[styles.error, { color: colors.destructive }]} testID="clerk-sign-out-error">
            {error}
          </Text>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: isSigningOut, busy: isSigningOut }}
          disabled={isSigningOut}
          onPress={handleSignOut}
          style={[styles.primaryButton, { backgroundColor: colors.primary }, isSigningOut && styles.disabled]}
          testID="clerk-sign-out"
        >
          {isSigningOut ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
              Sign out of Clerk
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function getResolutionMessage(resolution: ReturnType<typeof useBluebirdAuth>['clerkMemberResolution']): string {
  switch (resolution.status) {
    case 'signed_out':
      return 'Account status: signed out.';
    case 'not_checked':
      return 'Account status: member link has not been checked. Member access remains disabled.';
    case 'resolving':
      return 'Account status: checking for a confirmed Bluebird member link.';
    case 'linked':
      return 'Account status: a Bluebird member identity was confirmed.';
    case 'registration_required':
      return 'Account status: the backend confirmed that registration is required.';
    case 'onboarding_required':
      return 'Account status: the backend confirmed that onboarding is required.';
    case 'unresolved':
      return 'Account status: pending link confirmation. The current API response does not include an authoritative Bluebird member identity.';
    case 'error':
      return resolution.reason === 'unauthorized'
        ? 'Account status: the backend did not accept this session. No member identity was resolved.'
        : 'Account status: Bluebird could not verify the member link. No registration or member access was inferred.';
  }
}

function DiagnosticResultText({
  result,
  stages,
  configurationStatus,
  currentSessionExists,
  currentEnvironment,
  color,
}: {
  result: ClerkApiConnectionDiagnosticResult | null;
  stages: ClerkApiDiagnosticStage[];
  configurationStatus: ReturnType<typeof getMainBluebirdDevelopmentDiagnosticStatus>;
  currentSessionExists: boolean;
  currentEnvironment: 'development' | 'production' | null;
  color: string;
}) {
  const lines = [
    'Development connection prerequisites:',
    ...configurationStatus.checks.map(({ name, status }) => `${name}: ${status}`),
    `Development API configuration valid: ${formatBoolean(configurationStatus.developmentConfigurationValid)}`,
    `Development Clerk instance match verified: ${formatBoolean(configurationStatus.clerkInstanceMatchVerified)}`,
    ...(configurationStatus.missingPrerequisites.length
      ? ['Missing prerequisites:', ...configurationStatus.missingPrerequisites.map((item) => `• ${item}`)]
      : []),
    '',
    `API environment: ${result?.environment ?? currentEnvironment ?? 'Unavailable'}`,
    `Clerk session exists: ${formatBoolean(result?.clerkSessionExists ?? currentSessionExists)}`,
    ...(result ? [
      `Clerk token obtained: ${formatBoolean(result.tokenObtained)}`,
      `HTTP status: ${result.httpStatus ?? 'Unavailable'}`,
      `API response received: ${formatBoolean(result.apiResponseReceived)}`,
      `API authentication accepted: ${formatBoolean(result.authenticationAccepted)}`,
      'Bluebird member identity: unresolved',
      ...(result.failureCategory ? [`Failure: ${result.failureCategory}`] : []),
      ...(getClerkApiConnectionFailureGuidance(result.failureCategory) ?? []),
    ] : []),
    ...(stages.length ? ['', 'Execution stages:'] : []),
    ...stages.map(formatDiagnosticStage),
  ];
  return <Text style={[styles.diagnosticText, { color }]}>{lines.join('\n')}</Text>;
}

function formatDiagnosticStage(stage: ClerkApiDiagnosticStage): string {
  switch (stage.name) {
    case 'button':
      return `Button clicked: ${stage.status === 'clicked' ? 'Yes' : 'No'}`;
    case 'confirmation':
      return `Confirmation: ${stage.status}`;
    case 'client':
      return `API client: ${stage.status}`;
    case 'token':
      return `Clerk token obtained: ${formatBoolean(stage.tokenObtained ?? null)}${stage.status === 'failed' ? ' (acquisition failed)' : ''}`;
    case 'fetch':
      return `Fetch: ${stage.status}`;
  }
}

function formatBoolean(value: boolean | null): string {
  return value === null ? 'Unavailable' : value ? 'Yes' : 'No';
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24 },
  centered: { justifyContent: 'center', alignItems: 'center' },
  content: { flex: 1, justifyContent: 'center' },
  eyebrow: { fontSize: 12, fontFamily: 'Inter_600SemiBold', letterSpacing: 1.4, marginBottom: 10 },
  title: { fontSize: 28, fontFamily: 'Inter_700Bold', letterSpacing: -0.4 },
  body: { fontSize: 15, fontFamily: 'Inter_400Regular', lineHeight: 22, marginTop: 10, marginBottom: 24 },
  pending: { fontSize: 13, fontFamily: 'Inter_500Medium', lineHeight: 20, marginBottom: 24 },
  retryButton: { minHeight: 46, borderWidth: 1, borderRadius: 999, justifyContent: 'center', alignItems: 'center', marginBottom: 18 },
  retryButtonText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  diagnosticSection: { marginBottom: 18 },
  diagnosticResult: { marginTop: 10 },
  diagnosticText: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 18 },
  error: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 21, marginBottom: 14 },
  primaryButton: { minHeight: 50, borderRadius: 999, justifyContent: 'center', alignItems: 'center' },
  primaryButtonText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  disabled: { opacity: 0.55 },
});
