import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import type { JoinFlightDisplay, QueueJoinSuccessModel } from '@/lib/joinFlightPresentation';
import { formatJoinFlightDate, formatJoinFlightTime } from '@/lib/joinFlightPresentation';

export function QueueJoinSuccess({
  flight,
  success,
  flightStatusLabel = null,
  demoNotice = null,
}: {
  flight: JoinFlightDisplay;
  success: QueueJoinSuccessModel;
  flightStatusLabel?: string | null;
  demoNotice?: string | null;
}) {
  const colors = useColors();
  const route = [flight.fromAirport, flight.toAirport].filter(Boolean).join(' → ');
  const when = [formatJoinFlightDate(flight.departureDate), formatJoinFlightTime(flight.departureTime)]
    .filter(Boolean)
    .join(' · ');

  return (
    <View testID="queue-join-success" style={styles.content}>
      {!!demoNotice && (
        <View style={[styles.demoPill, { backgroundColor: colors.primary + '14' }]}>
          <Text style={[styles.demoPillText, { color: colors.primary }]}>DEMO</Text>
        </View>
      )}
      <View style={[styles.iconRing, { backgroundColor: colors.primary + '1F' }]}>
        <Feather name="check" size={38} color={colors.primary} />
      </View>
      <Text style={[styles.title, { color: colors.textOnSurface }]}>You're in the queue</Text>
      <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>
        You joined the queue for this flight. This is not a confirmed seat, and it does not appear in Trips yet.
      </Text>
      {!!route && <Text style={[styles.route, { color: colors.textOnSurface }]}>{route}</Text>}
      {!!when && <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>{when}</Text>}
      {!!flight.aircraft && <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>{flight.aircraft}</Text>}
      <View style={styles.chipRow}>
        <View style={[styles.chip, { backgroundColor: colors.surface }]}>
          <Text testID="queue-join-success-position" style={[styles.chipValue, { color: colors.primary }]}>
            #{success.position}
          </Text>
          <Text style={[styles.chipLabel, { color: colors.mutedForegroundLight }]}>QUEUE POSITION</Text>
        </View>
        <View style={[styles.chip, { backgroundColor: colors.surface }]}>
          <Text testID="queue-join-success-count" style={[styles.chipValue, { color: flightStatusLabel ? colors.success : colors.textOnSurface }]}>
            {flightStatusLabel ?? success.participantCount}
          </Text>
          <Text style={[styles.chipLabel, { color: colors.mutedForegroundLight }]}>
            {flightStatusLabel ? 'FLIGHT STATUS' : 'IN QUEUE'}
          </Text>
        </View>
      </View>
      {!!demoNotice && (
        <Text testID="demo-join-notice" style={[styles.body, { color: colors.mutedForegroundLight }]}>{demoNotice}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { alignItems: 'center', gap: 12, paddingHorizontal: 8 },
  demoPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  demoPillText: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.8 },
  iconRing: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontFamily: 'Inter_700Bold', fontSize: 25, letterSpacing: -0.35, textAlign: 'center' },
  route: { fontFamily: 'Inter_700Bold', fontSize: 18, textAlign: 'center' },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  chipRow: { flexDirection: 'row', gap: 12, width: '100%', marginTop: 8 },
  chip: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 4,
  },
  chipValue: { fontFamily: 'Inter_700Bold', fontSize: 20 },
  chipLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 0.6 },
});
