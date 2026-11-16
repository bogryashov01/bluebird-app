import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import {
  runConnectionDiagnostics,
  type ConnectionDiagnosticResult,
} from '@/lib/connectionDiagnostics';

export default function ConnectionDiagnosticsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const session = useClerkAuthSnapshot();
  const [running, setRunning] = React.useState(false);
  const [results, setResults] = React.useState<ConnectionDiagnosticResult[] | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const run = () => {
    if (!__DEV__ || running) return;
    const configuration = getMainBluebirdApiConfigurationOrNull();
    if (!configuration || session?.isSignedIn !== true) {
      setResults(null);
      setNotice('Sign in with the current Clerk session before running checks.');
      return;
    }
    setRunning(true);
    setNotice(null);
    const environment = configuration.environment;
    const baseUrl = configuration.apiBaseUrl;
    void runConnectionDiagnostics({
      environment,
      baseUrl,
      getAccessToken: () => session.getToken(),
    }).then((next) => {
      setResults(next);
    }).catch(() => {
      setResults(null);
      setNotice('The checks couldn’t be completed.');
    }).finally(() => {
      setRunning(false);
    });
  };

  if (!__DEV__) {
    return (
      <View style={[styles.root, { backgroundColor: colors.offWhite, paddingTop: insets.top }]}>
        <Text style={[styles.title, { color: colors.textOnSurface }]}>Not available</Text>
      </View>
    );
  }

  return (
    <ScrollView
      testID="connection-diagnostics-screen"
      style={{ backgroundColor: colors.offWhite }}
      contentContainerStyle={[styles.root, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}
    >
      <Pressable accessibilityRole="button" onPress={() => router.back()}>
        <Text style={[styles.back, { color: colors.primary }]}>Back</Text>
      </Pressable>
      <Text style={[styles.title, { color: colors.textOnSurface }]}>Connection diagnostics</Text>
      <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>
        Manual read-only checks. Nothing is sent until you tap the button.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Run Read-Only Checks"
        testID="connection-diagnostics-run"
        disabled={running}
        onPress={run}
        style={[styles.button, { backgroundColor: colors.primary, opacity: running ? 0.6 : 1 }]}
      >
        <Text style={[styles.buttonLabel, { color: colors.primaryForeground }]}>
          {running ? 'Running…' : 'Run Read-Only Checks'}
        </Text>
      </Pressable>
      {notice ? <Text style={[styles.body, { color: colors.textOnSurface }]}>{notice}</Text> : null}
      {results?.map((result) => (
        <View key={result.id} testID={`connection-diagnostics-${result.id}`} style={[styles.card, { borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.textOnSurface }]}>{result.label}</Text>
          <Text style={[styles.line, { color: colors.textOnSurface }]}>HTTP status: {result.status ?? 'none'}</Text>
          <Text style={[styles.line, { color: colors.textOnSurface }]}>Shape: {result.valid ? 'valid' : 'invalid'}</Text>
          <Text style={[styles.line, { color: colors.textOnSurface }]}>Records: {result.count ?? 'none'}</Text>
          {result.id === 'queue' ? (
            <Text style={[styles.line, { color: colors.textOnSurface }]}>
              Target reference present: {result.hasConnectionTargetReference === true ? 'yes' : result.hasConnectionTargetReference === false ? 'no' : 'unknown'}
            </Text>
          ) : null}
          <Text style={[styles.line, { color: colors.textOnSurface }]}>Error code: {result.errorCode ?? 'none'}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flexGrow: 1, paddingHorizontal: 20, gap: 12 },
  back: { fontFamily: 'Inter_500Medium', fontSize: 16 },
  title: { fontFamily: 'Inter_600SemiBold', fontSize: 24, lineHeight: 30 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22 },
  button: { alignSelf: 'flex-start', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12 },
  buttonLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 4 },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 16, marginBottom: 4 },
  line: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
});
