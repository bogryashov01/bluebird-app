import React from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { PrimaryButton } from '@/components/PrimaryButton';
import { QueueJoinSuccess } from '@/components/QueueJoinSuccess';
import {
  canSubmitProductionQueueJoin,
  formatJoinFlightDate,
  formatJoinFlightTime,
  JOIN_FLIGHT_QUEUE_EMPTY,
  JOIN_FLIGHT_QUEUE_FOOTNOTE,
  joinFlightDisclosures,
  joinFlightQueueCountLabel,
  joinFlightQueuePositionLabel,
  type JoinFlightDisplay,
  type JoinFlightQueuePanel,
  type QueueJoinSuccessModel,
} from '@/lib/joinFlightPresentation';
import { logJoinNav } from '@/lib/joinNavDiagnostics';

export function QueueJoinConfirmation({
  flight,
  success,
  queue,
  demoAvailable = false,
  demoEnabled = false,
  onDemoEnabledChange,
  onDemoConfirm,
}: {
  flight: JoinFlightDisplay;
  success: QueueJoinSuccessModel | null;
  queue: JoinFlightQueuePanel;
  demoAvailable?: boolean;
  demoEnabled?: boolean;
  onDemoEnabledChange?: (enabled: boolean) => void;
  onDemoConfirm?: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const route = [flight.fromAirport, flight.toAirport].filter(Boolean).join(' → ');
  const cities = [flight.fromCity, flight.toCity].filter(Boolean).join(' → ');
  const when = [formatJoinFlightDate(flight.departureDate), formatJoinFlightTime(flight.departureTime)]
    .filter(Boolean)
    .join(' · ');
  const disclosures = joinFlightDisclosures(flight.international);

  if (success) {
    return (
      <View style={[styles.screen, styles.successScreen, { backgroundColor: colors.offWhite, paddingBottom: bottomPad + 12 }]}>
        <QueueJoinSuccess flight={flight} success={success} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View
          testID="join-flight-confirmation"
          style={[styles.flightCard, { backgroundColor: colors.surface, borderColor: colors.separator }]}
        >
          <Text style={[styles.kicker, { color: colors.primary }]}>FLIGHT</Text>
          {route ? (
            <Text style={[styles.route, { color: colors.textOnSurface }]}>{route}</Text>
          ) : (
            <Text style={[styles.route, { color: colors.textOnSurface }]}>Flight details unavailable</Text>
          )}
          {!!cities && <Text style={[styles.meta, { color: colors.mutedForegroundLight }]}>{cities}</Text>}
          {!!when && <Text style={[styles.meta, { color: colors.mutedForegroundLight }]}>{when}</Text>}
          {!!flight.aircraft && <Text style={[styles.meta, { color: colors.mutedForegroundLight }]}>{flight.aircraft}</Text>}
        </View>

        <QueueInformation queue={queue} />

        <View style={styles.disclosures}>
          {disclosures.map((line) => (
            <View key={line} style={styles.disclosureRow}>
              <Feather name="info" size={16} color={colors.primary} />
              <Text style={[styles.disclosure, { color: colors.textOnSurface }]}>{line}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: colors.separator, backgroundColor: colors.offWhite, paddingBottom: bottomPad + 12 }]}>
        {demoAvailable ? (
          <View style={styles.demoSwitch}>
            <View style={styles.demoCopy}>
              <Text style={[styles.demoTitle, { color: colors.textOnSurface }]}>Demo Join Flow</Text>
              <Text style={[styles.note, styles.demoHint, { color: colors.mutedForegroundLight }]}>
                Development only. Simulated steps stay on this device.
              </Text>
            </View>
            <Switch
              testID="demo-join-flow-switch"
              value={demoEnabled}
              onValueChange={(value) => onDemoEnabledChange?.(value)}
            />
          </View>
        ) : null}
        <PrimaryButton
          label="Confirm queue join"
          disabled={!canSubmitProductionQueueJoin() && !demoEnabled}
          onPress={() => {
            logJoinNav('join-button', {
              screen: 'QueueJoinConfirmation',
              visibleLabel: 'Confirm queue join',
              demoEnabled: demoEnabled === true,
              routerMethod: 'none',
              targetPathname: 'none',
            });
            if (canSubmitProductionQueueJoin()) return;
            if (demoEnabled) onDemoConfirm?.();
          }}
          testID="join-flight-confirm"
          accessibilityRole="button"
        />
        <Text testID="join-flight-confirm-note" style={[styles.note, { color: colors.mutedForegroundLight }]}>
          {demoEnabled
            ? 'DEMO — No real queue entry will be created.'
            : 'Queue joining is not available in this build. No request is sent.'}
        </Text>
      </View>
    </View>
  );
}

function QueueInformation({ queue }: { queue: JoinFlightQueuePanel }) {
  const colors = useColors();
  const countLabel = queue.kind === 'participants' ? joinFlightQueueCountLabel(queue.participantCount) : null;
  const positionLabel = queue.kind === 'participants' && queue.viewerPosition !== null
    ? joinFlightQueuePositionLabel(queue.viewerPosition)
    : null;
  let body = 'Queue information is shown for published flights.';
  if (queue.kind === 'loading') body = 'Loading queue…';
  if (queue.kind === 'signed-out') body = 'Sign in to see this queue.';
  if (queue.kind === 'unavailable') body = 'Queue information is unavailable right now. No join request was sent.';
  if (queue.kind === 'empty') body = JOIN_FLIGHT_QUEUE_EMPTY;

  return (
    <View
      testID="join-flight-queue"
      style={[styles.flightCard, { backgroundColor: colors.surface, borderColor: colors.separator }]}
    >
      <Text style={[styles.kicker, { color: colors.primary }]}>QUEUE</Text>
      {queue.kind === 'loading' ? <ActivityIndicator color={colors.primary} /> : null}
      {queue.kind === 'participants' && countLabel ? (
        <Text testID="join-flight-queue-count" style={[styles.route, styles.queueCount, { color: colors.textOnSurface }]}>
          {countLabel}
        </Text>
      ) : (
        <Text style={[styles.meta, { color: colors.textOnSurface }]}>{body}</Text>
      )}
      {!!positionLabel && (
        <Text testID="join-flight-queue-position" style={[styles.meta, { color: colors.textOnSurface }]}>
          {positionLabel}
        </Text>
      )}
      {(queue.kind === 'empty' || queue.kind === 'participants') && (
        <Text testID="join-flight-queue-footnote" style={[styles.meta, { color: colors.mutedForegroundLight }]}>
          {JOIN_FLIGHT_QUEUE_FOOTNOTE}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  successScreen: { justifyContent: 'center' },
  content: { padding: 16, gap: 16, paddingBottom: 24 },
  flightCard: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 4,
  },
  kicker: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.7 },
  route: { fontFamily: 'Inter_700Bold', fontSize: 22, letterSpacing: -0.3 },
  queueCount: { fontSize: 18 },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
  disclosures: { gap: 14 },
  disclosureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  disclosure: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 },
  footer: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  demoSwitch: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  demoCopy: { flex: 1, gap: 2 },
  demoTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  demoHint: { textAlign: 'left' },
  note: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, textAlign: 'center' },
});
