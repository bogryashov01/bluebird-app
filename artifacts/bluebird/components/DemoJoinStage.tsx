import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { PrimaryButton } from '@/components/PrimaryButton';
import { DemoJoinBadge } from '@/components/DemoJoinBadge';
import { QueueJoinSuccess } from '@/components/QueueJoinSuccess';
import { useDemoJoinFlow } from '@/lib/demoJoinFlowStore';
import {
  formatJoinFlightDate,
  formatJoinFlightTime,
  type JoinFlightDisplay,
  type QueueJoinSuccessModel,
} from '@/lib/joinFlightPresentation';
import type { DemoJoinEntry } from '@/lib/demoJoinFlow';

export type DemoJoinStageName = 'joined' | 'status' | 'winner' | 'confirmed';

export function DemoJoinStage({ stage }: { stage: DemoJoinStageName }) {
  const colors = useColors();
  const demo = useDemoJoinFlow();
  const entry = demo.enabled ? demo.entry : null;

  if (!demo.available || !demo.enabled || !entry) {
    return (
      <View style={[styles.screen, styles.centered, { backgroundColor: colors.background }]}>
        <DemoJoinBadge notice="Demo Join Flow is off. No production request was sent." />
      </View>
    );
  }

  const flight = toFlightDisplay(entry);
  const success: QueueJoinSuccessModel = {
    flightId: entry.flightId,
    position: entry.position,
    participantCount: entry.participantCount,
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
    >
      <DemoJoinBadge notice={noticeFor(stage, entry.phase)} />
      {stage === 'joined' ? (
        <QueueJoinSuccess flight={flight} success={success} />
      ) : (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.separator }]}>
          <Text style={[styles.kicker, { color: colors.primary }]}>{kickerFor(stage, entry.phase)}</Text>
          <Text style={[styles.title, { color: colors.textOnSurface }]}>{titleFor(stage, entry.phase)}</Text>
          <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>{bodyFor(stage, entry.phase)}</Text>
          <Text style={[styles.route, { color: colors.textOnSurface }]}>
            {[entry.fromAirport, entry.toAirport].filter(Boolean).join(' → ') || 'Simulated flight'}
          </Text>
          {!!flightDetails(entry) && (
            <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>{flightDetails(entry)}</Text>
          )}
          <View style={styles.chips}>
            <View style={[styles.chip, { backgroundColor: colors.offWhite }]}>
              <Text style={[styles.chipValue, { color: colors.primary }]}>#{entry.position}</Text>
              <Text style={[styles.chipLabel, { color: colors.mutedForegroundLight }]}>QUEUE POSITION</Text>
            </View>
            <View style={[styles.chip, { backgroundColor: colors.offWhite }]}>
              <Text style={[styles.chipValue, { color: colors.textOnSurface }]}>{entry.participantCount}</Text>
              <Text style={[styles.chipLabel, { color: colors.mutedForegroundLight }]}>IN QUEUE</Text>
            </View>
          </View>
        </View>
      )}
      {actionFor(stage, entry, demo.simulateWinner, demo.confirmFlight)}
    </ScrollView>
  );
}

function actionFor(
  stage: DemoJoinStageName,
  entry: DemoJoinEntry,
  simulateWinner: () => DemoJoinEntry | null,
  confirmFlight: () => DemoJoinEntry | null,
) {
  if (stage === 'joined') {
    return (
      <PrimaryButton
        label="View queue status"
        testID="demo-join-view-status"
        onPress={() => router.push('/flight/demo-status')}
      />
    );
  }
  if (stage === 'status') {
    if (entry.phase === 'joined') {
      return (
        <PrimaryButton
          label="Simulate Queue Closure & Winner"
          testID="demo-join-simulate"
          onPress={() => {
            if (simulateWinner()) router.push('/flight/demo-winner');
          }}
        />
      );
    }
    return (
      <PrimaryButton
        label="View simulated winner"
        testID="demo-join-view-winner"
        onPress={() => router.push('/flight/demo-winner')}
      />
    );
  }
  if (stage === 'winner') {
    if (entry.phase === 'joined') {
      return (
        <PrimaryButton
          label="Return to queue status"
          testID="demo-join-back-status"
          onPress={() => router.push('/flight/demo-status')}
        />
      );
    }
    return (
      <PrimaryButton
        label="Confirm this flight"
        testID="demo-join-confirm-flight"
        onPress={() => {
          if (entry.phase === 'confirmed' || confirmFlight()) router.push('/flight/demo-confirmed');
        }}
      />
    );
  }
  return (
    <PrimaryButton
      label="View demo trip"
      testID="demo-join-view-trips"
      onPress={() => router.push('/(tabs)/trips')}
    />
  );
}

function noticeFor(stage: DemoJoinStageName, phase: DemoJoinEntry['phase']): string {
  if (stage === 'joined') return 'DEMO — No real queue entry created';
  if (stage === 'status') return 'DEMO — This queue status is only on this device';
  if (stage === 'winner') return phase === 'joined'
    ? 'DEMO — The queue is still waiting on this device'
    : 'DEMO — No winner request was sent';
  return 'DEMO — This flight was not booked';
}

function kickerFor(stage: DemoJoinStageName, phase: DemoJoinEntry['phase']): string {
  if (stage === 'status') return phase === 'joined' ? 'WAITING' : 'QUEUE CLOSED';
  if (stage === 'winner') return 'QUEUE CLOSED';
  return 'NOT BOOKED';
}

function titleFor(stage: DemoJoinStageName, phase: DemoJoinEntry['phase']): string {
  if (stage === 'status') return phase === 'joined' ? 'Waiting in the demo queue' : 'Demo queue closed';
  if (stage === 'winner') return 'Simulated winner';
  return 'Simulated confirmation';
}

function bodyFor(stage: DemoJoinStageName, phase: DemoJoinEntry['phase']): string {
  if (stage === 'status' && phase === 'joined') {
    return 'This position was generated on this device. The production queue was not changed.';
  }
  if (stage === 'status') return 'The simulated queue is closed on this device. The production queue was not changed.';
  if (stage === 'winner') return 'The demo queue is closed and this device is treating you as the winner. Nothing was awarded on the server.';
  return 'The confirmation stays on this device. No reservation, passenger record, trip checklist, or payment was created.';
}

function flightDetails(entry: DemoJoinEntry): string {
  return [
    [entry.fromCity, entry.toCity].filter(Boolean).join(' → '),
    [formatJoinFlightDate(entry.departureDate), formatJoinFlightTime(entry.departureTime)].filter(Boolean).join(' · '),
    entry.aircraft,
  ].filter(Boolean).join('\n');
}

function toFlightDisplay(entry: DemoJoinEntry): JoinFlightDisplay {
  return {
    flightId: entry.flightId,
    fromAirport: entry.fromAirport,
    toAirport: entry.toAirport,
    fromCity: entry.fromCity,
    toCity: entry.toCity,
    departureDate: entry.departureDate,
    departureTime: entry.departureTime,
    aircraft: entry.aircraft,
    international: entry.international,
    flightStatus: entry.flightStatus,
  };
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { justifyContent: 'center', padding: 24 },
  content: { padding: 20, gap: 20, paddingBottom: 40 },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 8 },
  kicker: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.7 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 24, letterSpacing: -0.3 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 },
  route: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  chips: { flexDirection: 'row', gap: 12, marginTop: 8 },
  chip: { flex: 1, borderRadius: 16, paddingVertical: 14, alignItems: 'center', gap: 4 },
  chipValue: { fontFamily: 'Inter_700Bold', fontSize: 20 },
  chipLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 0.6 },
});
