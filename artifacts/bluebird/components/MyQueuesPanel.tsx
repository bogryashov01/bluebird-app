import React from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useMyQueues } from '@/lib/useMyQueues';
import {
  MY_QUEUES_COVERAGE_NOTE,
  MY_QUEUES_DETAILS_UNAVAILABLE,
  MY_QUEUES_SERVER_EMPTY,
  MY_QUEUES_LISTED_ON_CURRENT,
  MY_QUEUES_LOAD_ERROR,
  MY_QUEUES_NOT_BOOKING,
  MY_QUEUES_POSITION_UNAVAILABLE,
  MY_QUEUES_SIGNED_OUT,
  MY_QUEUES_UNAVAILABLE,
  memberQueueCount,
  memberQueueFlightId,
  memberQueuePosition,
  presentQueueCountdown,
  presentQueueFlightMetadata,
  presentQueueLifecycle,
  queueClosingInstant,
  queueFlightDetailsTarget,
  queueFlightReference,
} from '@/lib/myQueuesPresentation';

export function MyQueuesPanel({
  awardedFlightIds = [],
  active = false,
}: {
  awardedFlightIds?: readonly number[];
  active?: boolean;
}) {
  const colors = useColors();
  const { listState, rows, refreshing, refresh } = useMyQueues();
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return undefined;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const refreshRef = React.useRef(refresh);
  refreshRef.current = refresh;
  useFocusEffect(React.useCallback(() => {
    if (!active) return undefined;
    refreshRef.current();
    return undefined;
  }, [active]));
  React.useEffect(() => {
    if (!active) return;
    refreshRef.current();
  }, [active]);
  const awarded = new Set(awardedFlightIds);
  const joinedRows = rows.filter((flight) => flight.userInQueue === true);
  const visibleRows = joinedRows.filter((flight) => {
    const flightId = memberQueueFlightId(flight.id);
    return flightId !== null && !awarded.has(flightId);
  });
  const listedOnCurrent = listState === 'ready' && joinedRows.length > 0 && visibleRows.length === 0;

  return (
    <ScrollView
      style={styles.body}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      testID="my-queues"
      refreshControl={(
        <RefreshControl
          testID="my-queues-pull-refresh"
          refreshing={refreshing}
          onRefresh={refresh}
          tintColor={colors.primary}
        />
      )}
    >
      <Text style={[styles.note, { color: colors.mutedForeground }]} testID="my-queues-coverage-note">
        {MY_QUEUES_COVERAGE_NOTE}
      </Text>
      {listState === 'loading' ? (
        <View style={styles.centered} testID="my-queues-loading" accessibilityLabel="Checking queues">
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : null}
      {listState === 'unavailable' ? (
        <View style={styles.state} testID="my-queues-unavailable">
          <Text style={[styles.stateTitle, { color: colors.foreground }]}>{MY_QUEUES_UNAVAILABLE}</Text>
        </View>
      ) : null}
      {listState === 'signed-out' ? (
        <View style={styles.state} testID="my-queues-signed-out">
          <Text style={[styles.stateTitle, { color: colors.foreground }]}>{MY_QUEUES_SIGNED_OUT}</Text>
        </View>
      ) : null}
      {listState === 'error' ? (
        <View style={styles.state} testID="my-queues-error">
          <Text style={[styles.stateTitle, { color: colors.foreground }]}>{MY_QUEUES_LOAD_ERROR}</Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Try again for upcoming queues"
            testID="my-queues-retry-list"
            style={[styles.refresh, { backgroundColor: colors.primary }]}
            onPress={refresh}
          >
            <Text style={[styles.refreshLabel, { color: colors.primaryForeground }]}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {listState === 'ready' && visibleRows.length === 0 ? (
        <View style={styles.state} testID="my-queues-empty">
          <Text style={[styles.stateTitle, { color: colors.foreground }]}>
            {listedOnCurrent ? MY_QUEUES_LISTED_ON_CURRENT : MY_QUEUES_SERVER_EMPTY}
          </Text>
        </View>
      ) : null}
      {listState === 'ready' ? visibleRows.map((flight) => {
        const flightId = memberQueueFlightId(flight.id);
        if (flightId === null) return null;
        const metadata = presentQueueFlightMetadata({
          fromAirport: flight.fromAirport,
          toAirport: flight.toAirport,
          fromCity: flight.fromCity,
          toCity: flight.toCity,
          departureDate: flight.departureDate,
          departureTime: flight.departureTime,
        });
        const reference = queueFlightReference(flightId, metadata);
        const detailsTarget = queueFlightDetailsTarget(flightId, metadata);
        const closingMs = queueClosingInstant({
          queueClosesAt: flight.queueClosesAt,
          departureInstant: flight.departureInstant,
        });
        const countdown = presentQueueCountdown(nowMs, closingMs);
        const lifecycle = presentQueueLifecycle({
          viewerFieldsAvailable: true,
          userInQueue: flight.userInQueue,
          viewerIsBookedPassenger: flight.viewerIsBookedPassenger,
          viewerIsEffectiveWinner: flight.viewerIsEffectiveWinner,
          viewerConfirmationStatus: flight.viewerConfirmationStatus,
          closingMs,
          nowMs,
        });
        const position = memberQueuePosition(flight);
        const participantCount = memberQueueCount(flight);
        const summary = `${reference}. ${lifecycle}. ${countdown}. ${MY_QUEUES_NOT_BOOKING}`;
        const body = (
          <>
            <View style={[styles.badge, { backgroundColor: colors.primary }]}>
              <Text style={[styles.badgeText, { color: colors.primaryForeground }]}>QUEUE</Text>
            </View>
            <Text style={[styles.route, { color: colors.foreground }]} numberOfLines={2}>{reference}</Text>
            {metadata.departureLabel ? (
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>{metadata.departureLabel}</Text>
            ) : null}
            <Text testID={`my-queues-status-${flightId}`} style={[styles.status, { color: colors.foreground }]}>
              {lifecycle}
            </Text>
            <Text testID={`my-queues-countdown-${flightId}`} style={[styles.meta, { color: colors.mutedForeground }]}>
              {countdown}
            </Text>
            <View style={styles.stats}>
              <View style={styles.stat}>
                <Text testID={`my-queues-position-${flightId}`} style={[styles.statValue, { color: colors.foreground }]}>
                  {position === null ? '—' : `#${position}`}
                </Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Your position</Text>
              </View>
              <View style={styles.stat}>
                <Text testID={`my-queues-count-${flightId}`} style={[styles.statValue, { color: colors.foreground }]}>
                  {participantCount === null ? '—' : participantCount}
                </Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>People in queue</Text>
              </View>
            </View>
            {position === null && flight.userInQueue === true ? (
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>{MY_QUEUES_POSITION_UNAVAILABLE}</Text>
            ) : null}
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>{MY_QUEUES_NOT_BOOKING}</Text>
            {detailsTarget ? null : (
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>{MY_QUEUES_DETAILS_UNAVAILABLE}</Text>
            )}
          </>
        );
        if (!detailsTarget) {
          return (
            <View
              key={flightId}
              testID={`my-queues-card-${flightId}`}
              accessibilityLabel={`${summary} ${MY_QUEUES_DETAILS_UNAVAILABLE}`}
              style={[styles.card, { backgroundColor: colors.card }]}
            >
              {body}
            </View>
          );
        }
        return (
          <TouchableOpacity
            key={flightId}
            accessibilityRole="button"
            accessibilityLabel={summary}
            accessibilityHint="Opens flight details"
            testID={`my-queues-card-${flightId}`}
            style={[styles.card, { backgroundColor: colors.card }]}
            activeOpacity={0.85}
            onPress={() => router.push(detailsTarget)}
          >
            {body}
          </TouchableOpacity>
        );
      }) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  content: { gap: 14, paddingHorizontal: 20, paddingBottom: 120 },
  note: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  card: { borderRadius: 20, padding: 16, gap: 8 },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  badgeText: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.5 },
  route: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  status: { fontFamily: 'Inter_600SemiBold', fontSize: 14, lineHeight: 20 },
  stats: { flexDirection: 'row', gap: 12 },
  stat: { flex: 1, gap: 2 },
  statValue: { fontFamily: 'Inter_700Bold', fontSize: 28, letterSpacing: -0.4 },
  statLabel: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
  centered: { minHeight: 120, alignItems: 'center', justifyContent: 'center' },
  state: { alignItems: 'center', gap: 10, paddingVertical: 24 },
  stateTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, lineHeight: 24, textAlign: 'center' },
  stateBody: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  refresh: { minHeight: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  refreshLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
});
