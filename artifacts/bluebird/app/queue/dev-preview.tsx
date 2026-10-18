import React from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { SecondaryButton } from '@/components/PrimaryButton';
import {
  isQueueDevelopmentPreviewEnabled,
  parseQueuePreviewState,
  QUEUE_PREVIEW_STATES,
  isPassPreviewState,
  type QueuePreviewState,
} from '@/lib/queueDevelopmentPreview';

const STATE_LABELS: Record<QueuePreviewState, string> = {
  'not-joined': 'Not joined',
  waiting: 'Waiting queue status',
  unavailable: 'Unavailable flight',
  'pass-non-member': 'Non-member · DEMO',
  'pass-no-pass': 'Member without a pass · DEMO',
  'pass-unavailable': 'Pass unavailable · DEMO',
  'pass-available': 'Pass available · DEMO',
};

function goToPreview(state: QueuePreviewState) {
  router.replace({ pathname: '/queue/dev-preview', params: { state } } as any);
}

export default function QueueDevelopmentPreviewScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { state: rawState } = useLocalSearchParams<{ state?: string }>();
  const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
  const state = parseQueuePreviewState(rawState);
  const isPassPreview = isPassPreviewState(state);
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  if (!isQueueDevelopmentPreviewEnabled(isDev)) {
    return <Redirect href="/(tabs)/discover" />;
  }

  const previewNote = isPassPreview
    ? 'DEMO fixture only. No live pass, account, membership, booking, or queue data is read or changed.'
    : 'Fixture-only preview. No live flight or member queue is read or changed.';

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <TouchableOpacity
          testID="queue-preview-back"
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/discover')}
          style={[styles.backButton, { backgroundColor: colors.card }]}
        >
          <Feather name="arrow-left" size={19} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>{isPassPreview ? 'Skip the Line Pass preview' : 'Queue preview'}</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{STATE_LABELS[state]}</Text>
        </View>
        <TouchableOpacity
          testID="queue-preview-hub"
          accessibilityRole="button"
          onPress={() => router.replace('/development-preview' as any)}
          style={[styles.hubButton, { backgroundColor: colors.card }]}
        >
          <Feather name="grid" size={17} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.demoBanner, { backgroundColor: colors.primary + '18', borderColor: colors.primary + '55' }]}>
          <Feather name="alert-triangle" size={17} color={colors.primary} />
          <Text testID="queue-preview-demo-label" style={[styles.demoBannerText, { color: colors.primary }]}>
            {isPassPreview ? 'DEMO / DEVELOPMENT PREVIEW · NOT A REAL PASS' : 'DEMO / DEVELOPMENT PREVIEW · NOT A REAL QUEUE'}
          </Text>
        </View>

        <View style={[styles.fixtureCard, { backgroundColor: colors.card }]}>
          <Text style={[styles.route, { color: colors.foreground }]}>DAL → SFO</Text>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>Dallas · San Francisco · Citation Latitude</Text>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>Saturday, November 7 · 10:00 AM</Text>
          <View style={[styles.statusPill, { backgroundColor: state === 'unavailable' || state === 'pass-unavailable' ? colors.muted : colors.primary + '18' }]}>
            <Text style={[styles.statusText, { color: state === 'unavailable' || state === 'pass-unavailable' ? colors.mutedForeground : colors.primary }]}>
              {isPassPreview
                ? state === 'pass-unavailable'
                  ? 'PASS STATUS UNAVAILABLE · DEMO'
                  : state === 'pass-no-pass'
                    ? 'NO PASS · DEMO'
                    : state === 'pass-non-member'
                      ? 'NON-MEMBER · DEMO'
                      : 'PASS AVAILABLE · DEMO'
                : state === 'unavailable'
                  ? 'UNAVAILABLE · DEMO'
                  : state === 'waiting' ? 'WAITING · DEMO' : 'NOT JOINED · DEMO'}
            </Text>
          </View>
          <Text style={[styles.note, { color: colors.mutedForeground }]}>{previewNote}</Text>
        </View>

        {isPassPreview ? (
          <View style={[styles.stateCard, { backgroundColor: colors.card }]}>
            <Feather
              name={state === 'pass-unavailable' ? 'slash' : state === 'pass-non-member' || state === 'pass-no-pass' ? 'minus-circle' : 'check-circle'}
              size={40}
              color={state === 'pass-available' ? colors.success : colors.mutedForeground}
            />
            <Text testID="pass-preview-state-title" style={[styles.stateTitle, { color: colors.foreground }]}>
              {state === 'pass-non-member' ? 'Non-member · DEMO'
                : state === 'pass-no-pass' ? 'Member without a pass · DEMO'
                  : state === 'pass-unavailable' ? 'Pass status unavailable · DEMO'
                    : 'Member with a pass · DEMO'}
            </Text>
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              {state === 'pass-non-member'
                ? 'Membership is required to use a Skip the Line Pass. This fixture does not offer activation.'
                : state === 'pass-no-pass'
                  ? 'This sample member has no pass. No account balance was inspected or changed.'
                  : state === 'pass-unavailable'
                    ? 'Pass ownership could not be verified in this sample. No action is available.'
                    : 'This sample member has a pass available. No redemption, booking, or payment is offered.'}
            </Text>
          </View>
        ) : state === 'waiting' ? (
          <View style={[styles.stateCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.position, { color: colors.primary }]}>#2</Text>
            <Text style={[styles.stateTitle, { color: colors.foreground }]}>Waiting · DEMO</Text>
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              Sample queue position only. This preview does not read or create a queue entry.
            </Text>
          </View>
        ) : state === 'unavailable' ? (
          <View style={[styles.stateCard, { backgroundColor: colors.card }]}>
            <Feather name="slash" size={38} color={colors.mutedForeground} />
            <Text style={[styles.stateTitle, { color: colors.foreground }]}>Flight unavailable</Text>
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              This sample flight is closed. No join action is available.
            </Text>
          </View>
        ) : (
          <View style={[styles.stateCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.stateTitle, { color: colors.foreground }]}>Not joined · DEMO</Text>
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              No queue entry exists for this sample. Account and membership state were not checked.
            </Text>
          </View>
        )}

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Preview states</Text>
        <View style={styles.stateList}>
          {QUEUE_PREVIEW_STATES.map((item) => (
            <SecondaryButton
              key={item}
              testID={`queue-preview-state-${item}`}
              label={STATE_LABELS[item]}
              onPress={() => goToPreview(item)}
              backgroundColor={item === state ? colors.primary : colors.card}
              textColor={item === state ? colors.primaryForeground : colors.foreground}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 16 },
  backButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  hubButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 23 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 2 },
  content: { paddingHorizontal: 20, gap: 14 },
  demoBanner: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 13, borderRadius: 13, borderWidth: 1 },
  demoBannerText: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.45 },
  fixtureCard: { padding: 18, borderRadius: 20, gap: 7 },
  route: { fontFamily: 'Inter_700Bold', fontSize: 24 },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 13 },
  statusPill: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, marginTop: 5 },
  statusText: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.4 },
  note: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  stateCard: { alignItems: 'center', gap: 12, padding: 20, borderRadius: 20 },
  stateTitle: { fontFamily: 'Inter_700Bold', fontSize: 19, textAlign: 'center' },
  position: { fontFamily: 'Inter_700Bold', fontSize: 36 },
  sectionLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 2 },
  stateList: { gap: 8 },
});
