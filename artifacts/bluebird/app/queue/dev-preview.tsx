import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
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
import { PrimaryButton, SecondaryButton } from '@/components/PrimaryButton';
import {
  isQueueDevelopmentPreviewEnabled,
  parseQueuePreviewState,
  QUEUE_PREVIEW_STATES,
  isPassPreviewState,
  type PassPreviewState,
  type QueuePreviewState,
} from '@/lib/queueDevelopmentPreview';

const STATE_LABELS: Record<QueuePreviewState, string> = {
  'eligible-flight': 'Eligible flight details',
  'join-loading': 'Join loading',
  confirmation: 'Queue confirmation',
  waiting: 'Waiting queue status',
  unavailable: 'Unavailable flight',
  selected: 'Selected (simulated)',
  winner: 'Winner (simulated)',
  'pass-no-pass': 'Member without a pass · DEMO',
  'pass-unavailable': 'Pass unavailable · DEMO',
  'pass-available': 'Pass available · DEMO',
  'pass-loading': 'Redemption loading · DEMO',
  'pass-success': 'Simulated booking success · DEMO',
  'pass-failure': 'Simulated booking failure · DEMO',
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
  const passTransitionLock = useRef(false);
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  useEffect(() => {
    passTransitionLock.current = false;
  }, [state]);

  if (!isQueueDevelopmentPreviewEnabled(isDev)) {
    return <Redirect href="/(tabs)/discover" />;
  }

  const isSimulation = state === 'selected' || state === 'winner';
  const previewNote = isPassPreview
    ? 'DEMO fixture only. No live pass, account, membership, booking, or queue data is read or changed.'
    : isSimulation
      ? 'This selected/winner state is simulated for UI review. No selection, award, booking, or payment exists.'
      : 'Fixture-only preview. No live flight or member queue is read or changed.';

  const advancePassPreview = (nextState: PassPreviewState) => {
    if (passTransitionLock.current) return;
    passTransitionLock.current = true;
    goToPreview(nextState);
  };

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
          <Text style={[styles.title, { color: colors.foreground }]}>Queue preview</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{STATE_LABELS[state]}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.demoBanner, { backgroundColor: colors.primary + '18', borderColor: colors.primary + '55' }]}>
          <Feather name="alert-triangle" size={17} color={colors.primary} />
          <Text testID="queue-preview-demo-label" style={[styles.demoBannerText, { color: colors.primary }]}>
            {isPassPreview ? 'DEMO — NOT A REAL BOOKING' : 'DEMO PREVIEW · NOT A REAL QUEUE'}
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
                    : 'PASS FLOW · DEMO'
                : state === 'unavailable'
                  ? 'UNAVAILABLE · DEMO'
                  : 'SIMULATED FLIGHT · DEMO'}
            </Text>
          </View>
          <Text style={[styles.note, { color: colors.mutedForeground }]}>{previewNote}</Text>
        </View>

        {isPassPreview ? (
          state === 'pass-no-pass' ? (
            <View style={[styles.stateCard, { backgroundColor: colors.card }]}>
              <Feather name="minus-circle" size={40} color={colors.mutedForeground} />
              <Text testID="pass-preview-state-title" style={[styles.stateTitle, { color: colors.foreground }]}>No pass on this fixture · DEMO</Text>
              <Text style={[styles.note, { color: colors.mutedForeground }]}>
                No pass is available in this simulated member state. This preview does not inspect or change a real balance.
              </Text>
            </View>
          ) : state === 'pass-unavailable' ? (
            <View style={[styles.stateCard, { backgroundColor: colors.card }]}>
              <Feather name="slash" size={38} color={colors.mutedForeground} />
              <Text testID="pass-preview-state-title" style={[styles.stateTitle, { color: colors.foreground }]}>Pass or flight unavailable · DEMO</Text>
              <Text style={[styles.note, { color: colors.mutedForeground }]}>
                The fixture cannot verify pass ownership or flight eligibility. No booking action is offered.
              </Text>
            </View>
          ) : state === 'pass-available' ? (
            <View style={[styles.stateCard, { backgroundColor: colors.card }]}>
              <Feather name="check-circle" size={40} color={colors.success} />
              <Text testID="pass-preview-state-title" style={[styles.stateTitle, { color: colors.foreground }]}>Pass available · DEMO</Text>
              <Text style={[styles.note, { color: colors.mutedForeground }]}>
                Pass ownership and flight eligibility are simulated for this fixture only.
              </Text>
              <PrimaryButton
                testID="pass-preview-start-redemption"
                label="Simulate pass redemption"
                onPress={() => advancePassPreview('pass-loading')}
              />
            </View>
          ) : state === 'pass-loading' ? (
            <View style={[styles.stateCard, { backgroundColor: colors.card }]}>
              <ActivityIndicator color={colors.primary} size="large" />
              <Text testID="pass-preview-state-title" style={[styles.stateTitle, { color: colors.foreground }]}>Redemption loading · DEMO</Text>
              <Text style={[styles.note, { color: colors.mutedForeground }]}>
                Simulated loading only. No API request or pass use occurs.
              </Text>
              <PrimaryButton
                label="Preview simulated success"
                onPress={() => advancePassPreview('pass-success')}
              />
              <SecondaryButton
                label="Preview simulated failure"
                onPress={() => advancePassPreview('pass-failure')}
                backgroundColor={colors.muted}
                textColor={colors.foreground}
              />
            </View>
          ) : state === 'pass-success' ? (
            <View style={[styles.stateCard, { backgroundColor: colors.card }]}>
              <Feather name="check-circle" size={42} color={colors.success} />
              <Text style={[styles.stateTitle, { color: colors.foreground }]}>Booking simulation complete · DEMO</Text>
              <Text testID="pass-preview-demo-booking-label" style={[styles.demoBookingLabel, { color: colors.destructive }]}>
                DEMO — NOT A REAL BOOKING
              </Text>
              <Text style={[styles.note, { color: colors.mutedForeground }]}>
                DAL → SFO · Citation Latitude · Saturday, November 7 at 10:00 AM
              </Text>
              <Text style={[styles.note, { color: colors.mutedForeground }]}>
                No trip, queue entry, identity, membership, or pass balance was created or changed.
              </Text>
            </View>
          ) : (
            <View style={[styles.stateCard, { backgroundColor: colors.card }]}>
              <Feather name="alert-circle" size={40} color={colors.destructive} />
              <Text testID="pass-preview-state-title" style={[styles.stateTitle, { color: colors.foreground }]}>Simulated booking failure · DEMO</Text>
              <Text style={[styles.note, { color: colors.mutedForeground }]}>
                This failure is a preview fixture. No booking, pass use, or API request occurred.
              </Text>
            </View>
          )
        ) : state === 'join-loading' ? (
          <View style={[styles.stateCard, { backgroundColor: colors.card }]}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={[styles.stateTitle, { color: colors.foreground }]}>Joining queue…</Text>
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              Simulated loading state. This preview does not send a request.
            </Text>
            <PrimaryButton label="Preview confirmed response" onPress={() => goToPreview('confirmation')} />
          </View>
        ) : state === 'confirmation' ? (
          <View style={[styles.stateCard, { backgroundColor: colors.card }]}>
            <Feather name="check-circle" size={42} color={colors.success} />
            <Text style={[styles.stateTitle, { color: colors.foreground }]}>You're in the queue</Text>
            <Text style={[styles.note, { color: colors.mutedForeground }]}>DEMO ONLY · simulated response · not a real queue entry</Text>
            <PrimaryButton label="Preview waiting status" onPress={() => goToPreview('waiting')} />
          </View>
        ) : state === 'waiting' ? (
          <View style={[styles.stateCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.position, { color: colors.primary }]}>#2</Text>
            <Text style={[styles.stateTitle, { color: colors.foreground }]}>Waiting · DEMO</Text>
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              Position and queue details are simulated only.
            </Text>
          </View>
        ) : state === 'selected' ? (
          <View style={[styles.stateCard, { backgroundColor: colors.card }]}>
            <Feather name="award" size={42} color={colors.primary} />
            <Text style={[styles.stateTitle, { color: colors.foreground }]}>Selected · simulated</Text>
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              DEMO ONLY · this is not a real selection, winner notification, or booking.
            </Text>
            <PrimaryButton label="Preview simulated winner" onPress={() => goToPreview('winner')} />
          </View>
        ) : state === 'winner' ? (
          <View style={[styles.stateCard, { backgroundColor: colors.card }]}>
            <Feather name="check-circle" size={42} color={colors.success} />
            <Text style={[styles.stateTitle, { color: colors.foreground }]}>Winner · simulated</Text>
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              DEMO ONLY · no flight was awarded and no reservation or payment was created.
            </Text>
          </View>
        ) : state === 'unavailable' ? (
          <View style={[styles.stateCard, { backgroundColor: colors.card }]}>
            <Feather name="slash" size={38} color={colors.mutedForeground} />
            <Text style={[styles.stateTitle, { color: colors.foreground }]}>Flight unavailable</Text>
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              This simulated flight is closed. No join action is available.
            </Text>
          </View>
        ) : (
          <View style={[styles.stateCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.stateTitle, { color: colors.foreground }]}>Queue eligible · simulated</Text>
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              Eligibility is only a preview fixture here; this does not check account or membership state.
            </Text>
            <PrimaryButton label="Preview join loading" onPress={() => goToPreview('join-loading')} />
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
  demoBookingLabel: { fontFamily: 'Inter_700Bold', fontSize: 14, textAlign: 'center', letterSpacing: 0.25 },
  position: { fontFamily: 'Inter_700Bold', fontSize: 36 },
  sectionLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 2 },
  stateList: { gap: 8 },
});
