import React, { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth as useClerkAuth } from '@clerk/expo';
import { useColors } from '@/hooks/useColors';
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

export function ClerkDevelopmentToolsScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { isLoaded, isSignedIn, getToken } = useClerkAuth();
  const [isTesting, setIsTesting] = useState(false);
  const [result, setResult] = useState<ClerkApiConnectionDiagnosticResult | null>(null);
  const [stages, setStages] = useState<ClerkApiDiagnosticStage[]>([]);
  const isDevelopment = typeof __DEV__ !== 'undefined' && __DEV__;
  const configuration = getMainBluebirdApiConfigurationOrNull();
  const configurationStatus = getMainBluebirdDevelopmentDiagnosticStatus();
  const canTest = isClerkApiConnectionTestVisible({
    isDevelopment,
    environment: configuration?.environment ?? null,
    configurationValid: configurationStatus.developmentConfigurationValid,
    clerkInstanceMatchVerified: configurationStatus.clerkInstanceMatchVerified,
    clerkAuthEnabled: configurationStatus.clerkAuthEnabled,
    isLoaded,
    isSignedIn,
  });

  const runTest = async () => {
    if (!canTest || !configuration || isTesting) return;
    setIsTesting(true);
    setResult(null);
    setStages([]);
    try {
      const diagnostic = await runClerkApiConnectionTest({
        isDevelopment,
        environment: configuration.environment,
        configuration,
        configurationValid: configurationStatus.developmentConfigurationValid,
        clerkInstanceMatchVerified: configurationStatus.clerkInstanceMatchVerified,
        clerkAuthEnabled: configurationStatus.clerkAuthEnabled,
        isLoaded,
        isSignedIn,
        executionPlatform: Platform.OS,
        confirm: confirmDialog,
        createApiClient: (diagnosticHooks) => createMainBluebirdApiIntegration({
          configuration,
          tokenProvider: {
            environment: configuration.environment,
            getVerifiedAccessToken: getToken,
          },
          diagnostic: diagnosticHooks,
        }).authenticated,
        onStages: setStages,
      });
      if (diagnostic) setResult(diagnostic);
    } catch {
      // The diagnostic helper sanitizes expected failures; raw errors are never rendered.
    } finally {
      setIsTesting(false);
    }
  };

  if (!isDevelopment) return <Redirect href="/(clerk-auth)/signed-in" />;
  if (!isLoaded) {
    return (
      <View style={[styles.center, { backgroundColor: colors.backgroundMid }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!isSignedIn) return <Redirect href="/(clerk-auth)/sign-in" />;

  const topPad = (Platform.OS === 'web' ? 67 : insets.top) + 16;
  const bottomPad = (Platform.OS === 'web' ? 34 : insets.bottom) + 24;
  return (
    <ScrollView
      style={{ backgroundColor: colors.backgroundMid }}
      contentContainerStyle={[styles.content, { paddingTop: topPad, paddingBottom: bottomPad }]}
    >
      <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
        <Text style={[styles.backText, { color: colors.primary }]}>‹ Bluebird account</Text>
      </Pressable>
      <Text style={[styles.eyebrow, { color: colors.paleBlue }]}>DEVELOPMENT ONLY</Text>
      <Text style={[styles.title, { color: colors.textOnBrand }]}>API connection tools</Text>
      <Text style={[styles.body, { color: colors.mutedOnBrand }]}>
        This optional test checks whether the selected Development Main API accepts the current Clerk session. It does not resolve a Bluebird member identity or authorize member features.
      </Text>
      <View style={[styles.prerequisites, { borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.textOnBrand }]}>Development prerequisites</Text>
        {configurationStatus.checks.map(({ name, status }) => (
          <Text key={name} style={[styles.detail, { color: colors.mutedOnBrand }]}>{name}: {status}</Text>
        ))}
        {configurationStatus.missingPrerequisites.map((item) => (
          <Text key={item} style={[styles.detail, { color: colors.mutedOnBrand }]}>• {item}</Text>
        ))}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !canTest || isTesting, busy: isTesting }}
        disabled={!canTest || isTesting}
        onPress={runTest}
        style={[
          styles.button,
          { borderColor: colors.border, backgroundColor: canTest ? colors.primary : colors.surface },
          (!canTest || isTesting) && styles.disabled,
        ]}
        testID="clerk-api-connection-test"
      >
        {isTesting
          ? <ActivityIndicator color={canTest ? colors.primaryForeground : colors.mutedForeground} />
          : <Text style={[styles.buttonText, { color: canTest ? colors.primaryForeground : colors.mutedForeground }]}>
              Test Development API Connection
            </Text>}
      </Pressable>
      <View accessibilityLiveRegion="polite" style={styles.result} testID="clerk-api-connection-result">
        <DiagnosticResultText
          result={result}
          stages={stages}
          configurationStatus={configurationStatus}
          color={colors.mutedOnBrand}
        />
      </View>
    </ScrollView>
  );
}

function DiagnosticResultText({
  result,
  stages,
  configurationStatus,
  color,
}: {
  result: ClerkApiConnectionDiagnosticResult | null;
  stages: ClerkApiDiagnosticStage[];
  configurationStatus: ReturnType<typeof getMainBluebirdDevelopmentDiagnosticStatus>;
  color: string;
}) {
  const lines = [
    result ? `API environment: ${result.environment}` : 'No API test has been run.',
    ...(result ? [
      `Clerk session exists: ${formatBoolean(result.clerkSessionExists)}`,
      `Clerk token obtained: ${formatBoolean(result.tokenObtained)}`,
      `HTTP response: ${result.httpStatus ?? 'Unavailable'}`,
      `API authentication accepted: ${formatBoolean(result.authenticationAccepted)}`,
      'Bluebird member identity: unresolved',
      ...(result.failureCategory ? [`Failure: ${result.failureCategory}`] : []),
      ...(getClerkApiConnectionFailureGuidance(result.failureCategory) ?? []),
    ] : configurationStatus.missingPrerequisites),
    ...stages.map((stage) => `${stage.name}: ${stage.status}`),
  ];
  return <Text style={[styles.detail, { color }]}>{lines.join('\n')}</Text>;
}

function formatBoolean(value: boolean | null): string {
  return value === null ? 'Unavailable' : value ? 'Yes' : 'No';
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { flexGrow: 1, paddingHorizontal: 24 },
  back: { marginBottom: 18 },
  backText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  eyebrow: { fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 1.2, marginBottom: 8 },
  title: { fontSize: 26, fontFamily: 'Inter_700Bold', marginBottom: 8 },
  body: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_400Regular', marginBottom: 18 },
  prerequisites: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 16, gap: 4 },
  sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', marginBottom: 2 },
  detail: { fontSize: 11, lineHeight: 16, fontFamily: 'Inter_400Regular' },
  button: { minHeight: 48, borderWidth: 1, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  result: { marginTop: 16 },
  disabled: { opacity: 0.58 },
});
