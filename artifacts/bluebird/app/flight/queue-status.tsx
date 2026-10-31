import React from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SecondaryButton } from '@/components/PrimaryButton';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { createClerkProductionTokenProvider, type ClerkSessionSnapshot } from '@/lib/clerkProductionTokenProvider';
import { productionFlightDetailQueryKey } from '@/lib/flightDetailPresentation';
import {
  formatJoinFlightDate,
  formatJoinFlightTime,
  joinFlightQueueCountLabel,
  joinFlightQueuePositionLabel,
  presentJoinQueueWindow,
  QUEUE_LEAVE_UNAVAILABLE,
  QUEUE_LEFT_CONFIRMED,
  queueRosterTierLabel,
  canSubmitProductionQueueJoin,
} from '@/lib/joinFlightPresentation';
import { mainBluebirdAuthenticatedQueryKey } from '@/lib/mainBluebirdApi';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import { fetchProductionFlight, parseProductionFlightId } from '@/lib/productionFlights';
import { useJoinFlightQueueRead } from '@/lib/useJoinFlightQueueRead';
import { useProductionQueueMutation } from '@/lib/useProductionQueueMutation';

export default function ProductionQueueStatusScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const params = useLocalSearchParams<{ flightId?: string }>();
  const flightId = parseProductionFlightId(params.flightId);
  const { authMode, clerkUserId } = useAuth();
  const session = useClerkAuthSnapshot();
  const sessionRef = React.useRef(session);
  sessionRef.current = session;
  const queryClient = useQueryClient();
  const configuration = getMainBluebirdApiConfigurationOrNull();
  const signedIn = authMode === 'clerk' &&
    session?.isLoaded === true &&
    session.isSignedIn === true &&
    session.userId === clerkUserId &&
    !!clerkUserId;
  const flightQuery = useQuery({
    queryKey: configuration && clerkUserId && flightId !== null
      ? productionFlightDetailQueryKey(flightId, clerkUserId)
      : ['production-empty-leg', flightId ?? 'invalid', 'signed-out'],
    enabled: signedIn && !!configuration && flightId !== null,
    retry: false,
    queryFn: async ({ signal }) => {
      if (!configuration || flightId === null || !clerkUserId) {
        throw new Error('A signed-in account is required.');
      }
      const requestedUserId = clerkUserId;
      const tokenProvider = createClerkProductionTokenProvider({
        getCurrentSession: () => {
          const current = sessionRef.current;
          if (!current || current.userId !== requestedUserId || current.isSignedIn !== true) {
            return {
              isLoaded: true,
              isSignedIn: false,
              getToken: async () => null,
              signOut: async () => {},
            } satisfies ClerkSessionSnapshot;
          }
          return current as ClerkSessionSnapshot;
        },
      }, configuration.environment);
      const token = await tokenProvider.getVerifiedAccessToken();
      if (sessionRef.current?.userId !== requestedUserId) {
        throw Object.assign(new Error('The signed-in account changed.'), { code: 'cancelled' });
      }
      return fetchProductionFlight(flightId, { signal, accessToken: token });
    },
  });
  const flightStatus = flightQuery.data?.status === 'published' ? 'published' : null;
  const queue = useJoinFlightQueueRead(flightId ?? 0, flightStatus);
  const mutation = useProductionQueueMutation(flightId ?? 0, flightQuery.data?.internationalPassRequired ?? null);
  const route = flightQuery.data
    ? [flightQuery.data.fromAirport, flightQuery.data.toAirport].filter(Boolean).join(' → ')
    : '';
  const when = flightQuery.data
    ? [formatJoinFlightDate(flightQuery.data.departureDate), formatJoinFlightTime(flightQuery.data.departureTime)].filter(Boolean).join(' · ')
    : '';
  const viewerPosition = queue.kind === 'participants' ? queue.viewerPosition : null;
  const memberInQueue = flightQuery.data?.userInQueue === true || viewerPosition !== null;
  const positionLabel = viewerPosition !== null
    ? joinFlightQueuePositionLabel(viewerPosition)
    : flightQuery.data?.userInQueue === true &&
      typeof flightQuery.data.viewerQueuePosition === 'number' &&
      Number.isSafeInteger(flightQuery.data.viewerQueuePosition) &&
      flightQuery.data.viewerQueuePosition >= 1
      ? joinFlightQueuePositionLabel(flightQuery.data.viewerQueuePosition)
      : null;
  const countLabel = queue.kind === 'participants' ? joinFlightQueueCountLabel(queue.participantCount) : null;
  const windowLabel = presentJoinQueueWindow(flightQuery.data?.queueClosesAt ?? null, Date.now()).label;
  const refetchFlight = flightQuery.refetch;
  useFocusEffect(React.useCallback(() => {
    if (!signedIn || flightId === null || !configuration || !clerkUserId) return undefined;
    void refetchFlight();
    void queryClient.invalidateQueries({
      queryKey: mainBluebirdAuthenticatedQueryKey(configuration.environment, clerkUserId, 'empty-leg-queue', flightId),
    });
    return undefined;
  }, [clerkUserId, configuration, flightId, queryClient, refetchFlight, signedIn]));

  return (
    <View style={[styles.screen, { backgroundColor: colors.offWhite }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 16, paddingBottom: bottomPad + 120 }]}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} testID="queue-status-back">
          <Text style={[styles.back, { color: colors.primary }]}>Back</Text>
        </TouchableOpacity>
        <Text style={[styles.kicker, { color: colors.primary }]}>QUEUE STATUS</Text>
        {flightId === null ? (
          <Text style={[styles.title, { color: colors.textOnSurface }]}>Flight unavailable</Text>
        ) : flightQuery.isPending ? (
          <ActivityIndicator color={colors.primary} />
        ) : flightQuery.isError ? (
          <View testID="queue-status-error">
            <Text style={[styles.body, { color: colors.textOnSurface }]}>Queue status could not be loaded.</Text>
            <TouchableOpacity accessibilityRole="button" onPress={() => { void flightQuery.refetch(); }}>
              <Text style={[styles.back, { color: colors.primary }]}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text testID="queue-status-route" style={[styles.title, { color: colors.textOnSurface }]}>{route || 'Flight details unavailable'}</Text>
            {!!when && <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>{when}</Text>}
            {!!flightQuery.data?.aircraftTypeName && (
              <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>{flightQuery.data.aircraftTypeName}</Text>
            )}
            <Text testID="queue-status-window" style={[styles.body, { color: colors.textOnSurface }]}>{windowLabel}</Text>
            <Text testID="queue-status-position" style={[styles.position, { color: colors.textOnSurface }]}>
              {positionLabel ?? (memberInQueue ? 'Your position is not available for this flight.' : 'You are not in this queue.')}
            </Text>
            {!!countLabel && (
              <Text testID="join-flight-queue-count" style={[styles.body, { color: colors.textOnSurface }]}>{countLabel}</Text>
            )}
            <View testID="join-flight-queue" style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.separator }]}>
              {queue.kind === 'loading' ? <ActivityIndicator color={colors.primary} /> : null}
              {queue.kind === 'participants' ? queue.rows.map((row, index) => (
                <View
                  key={`${row.position}-${index}`}
                  testID={row.isViewer ? 'join-flight-queue-viewer' : `join-flight-queue-row-${row.position}`}
                  style={styles.row}
                >
                  <Text style={[styles.rowPosition, { color: colors.textOnSurface }]}>#{row.position}</Text>
                  <Text style={[styles.rowName, { color: colors.textOnSurface }]} numberOfLines={1}>{row.initials.trim()}</Text>
                  <Text style={[styles.rowTier, { color: colors.mutedForegroundLight }]} numberOfLines={1}>{queueRosterTierLabel(row.tier)}</Text>
                  {row.isViewer ? <Text style={[styles.you, { color: colors.primary }]}>You</Text> : null}
                </View>
              )) : (
                <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>
                  {queue.kind === 'empty'
                    ? 'No one is listed in this queue.'
                    : queue.kind === 'unavailable'
                      ? 'Queue participants are unavailable right now.'
                      : 'Queue participants are shown when Bluebird returns them.'}
                </Text>
              )}
            </View>
          </>
        )}
        {mutation.leftMessage === QUEUE_LEFT_CONFIRMED ? (
          <Text testID="queue-status-left" style={[styles.body, { color: colors.textOnSurface }]}>{mutation.leftMessage}</Text>
        ) : null}
        {mutation.failure ? (
          <Text testID="queue-status-leave-error" style={[styles.body, { color: colors.textOnSurface }]}>{mutation.failure.body}</Text>
        ) : null}
      </ScrollView>
      {memberInQueue && mutation.leftMessage !== QUEUE_LEFT_CONFIRMED ? (
        <View style={[styles.footer, { paddingBottom: bottomPad + 12, borderTopColor: colors.separator }]}>
          <SecondaryButton
            label="Leave the Queue"
            testID="queue-status-leave"
            disabled={!canSubmitProductionQueueJoin() || mutation.submitting}
            loading={mutation.submitting && canSubmitProductionQueueJoin()}
            onPress={() => {
              if (mutation.submitting || !canSubmitProductionQueueJoin()) return;
              void mutation.leave();
            }}
          />
          <Text style={[styles.hint, { color: colors.mutedForegroundLight }]}>
            {canSubmitProductionQueueJoin()
              ? 'Leaving removes you from this queue after you confirm.'
              : QUEUE_LEAVE_UNAVAILABLE}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20, gap: 12 },
  back: { fontFamily: 'Inter_600SemiBold', fontSize: 16, paddingVertical: 8 },
  kicker: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.7 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 26, lineHeight: 32 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22 },
  position: { fontFamily: 'Inter_700Bold', fontSize: 20, lineHeight: 26 },
  card: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36 },
  rowPosition: { fontFamily: 'Inter_700Bold', fontSize: 15, width: 36 },
  rowName: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  rowTier: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  you: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  footer: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  hint: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, textAlign: 'center' },
});
