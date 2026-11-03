import React from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MemberInitialsAvatar, MemberProfileSheet } from '@/components/MemberProfileSheet';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CurrentWinnerCelebration } from '@/components/CurrentWinnerCelebration';
import { PrimaryButton, SecondaryButton } from '@/components/PrimaryButton';
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
  QUEUE_SKIP_ALREADY_USED,
  QUEUE_SKIP_BALANCE_UNAVAILABLE,
  QUEUE_SKIP_NONE,
  QUEUE_SKIP_NOTE,
  QUEUE_SKIP_UNAVAILABLE,
  QUEUE_SKIP_WINNER,
  presentQueueSkipLineOffer,
  queueRosterLabel,
  queueRosterTierLabel,
  canSubmitProductionQueueJoin,
} from '@/lib/joinFlightPresentation';
import { mainBluebirdAuthenticatedQueryKey } from '@/lib/mainBluebirdApi';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import {
  loadDashboardSkipTheLinePasses,
  readFreshSkipTheLinePasses,
  rememberSkipTheLinePasses,
} from '@/lib/membershipDashboardRead';
import { fetchProductionFlight, parseProductionFlightId } from '@/lib/productionFlights';
import {
  dismissCurrentWinnerCelebration,
  readCurrentWinnerCelebration,
} from '@/lib/currentWinnerCelebration';
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
  const [selectedRow, setSelectedRow] = React.useState<number | null>(null);
  const rosterRow = queue.kind === 'participants' && selectedRow !== null
    ? queue.rows.find((row) => row.position === selectedRow) ?? null
    : null;
  const windowLabel = presentJoinQueueWindow(flightQuery.data?.queueClosesAt ?? null, Date.now()).label;
  const viewerRosterRow = queue.kind === 'participants'
    ? queue.rows.find((row) => row.isViewer) ?? null
    : null;
  const [passBalance, setPassBalance] = React.useState<'loading' | 'unavailable' | { count: number }>('loading');
  const [passAttempt, setPassAttempt] = React.useState(0);
  const passEnvironment = configuration?.environment ?? null;
  const passApiBaseUrl = configuration?.apiBaseUrl ?? null;
  React.useEffect(() => {
    if (!signedIn || !memberInQueue || !passEnvironment || !passApiBaseUrl || !clerkUserId) return undefined;
    const activeConfiguration = getMainBluebirdApiConfigurationOrNull();
    if (
      !activeConfiguration ||
      activeConfiguration.environment !== passEnvironment ||
      activeConfiguration.apiBaseUrl !== passApiBaseUrl
    ) return undefined;
    const requestedUserId = clerkUserId;
    const controller = new AbortController();
    const fresh = passAttempt === 0
      ? readFreshSkipTheLinePasses({
        environment: passEnvironment,
        apiBaseUrl: passApiBaseUrl,
        clerkUserId: requestedUserId,
      })
      : null;
    if (fresh) {
      setPassBalance({ count: fresh.count });
      return () => controller.abort();
    }
    setPassBalance('loading');
    void loadDashboardSkipTheLinePasses({
      signal: controller.signal,
      configuration: activeConfiguration,
      getAccessToken: async () => {
        const current = sessionRef.current;
        if (!current || current.userId !== requestedUserId || current.isSignedIn !== true) return null;
        return current.getToken();
      },
    }).then((loaded) => {
      if (controller.signal.aborted || sessionRef.current?.userId !== requestedUserId) return;
      if (loaded.kind !== 'loaded') {
        setPassBalance('unavailable');
        return;
      }
      rememberSkipTheLinePasses({
        environment: passEnvironment,
        apiBaseUrl: passApiBaseUrl,
        clerkUserId: requestedUserId,
        count: loaded.count,
      });
      setPassBalance({ count: loaded.count });
    });
    return () => controller.abort();
  }, [clerkUserId, memberInQueue, passApiBaseUrl, passAttempt, passEnvironment, signedIn]);
  React.useEffect(() => {
    if (!mutation.skipMessage) return;
    setPassAttempt((attempt) => attempt + 1);
  }, [mutation.skipMessage]);
  const [celebrationRevision, setCelebrationRevision] = React.useState(0);
  const currentWinner = celebrationRevision >= 0 && clerkUserId && flightId !== null
    ? readCurrentWinnerCelebration({ clerkUserId, flightId })
    : null;
  const skipOffer = presentQueueSkipLineOffer({
    inQueue: memberInQueue,
    mutationsEnabled: canSubmitProductionQueueJoin(),
    balance: passBalance,
    passAlreadyApplied: flightQuery.data?.viewerHasLineSkip === true || viewerRosterRow?.hasLineSkip === true,
    viewerIsEffectiveWinner: flightQuery.data?.viewerIsEffectiveWinner ?? null,
  });
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
            <View testID="join-flight-queue" style={[styles.card, { backgroundColor: colors.surface }]}>
              <Text style={[styles.cardTitle, { color: colors.textOnSurface }]}>
                {queue.kind === 'participants' ? `In this queue (${queue.participantCount})` : 'In this queue'}
              </Text>
              {queue.kind === 'loading' ? <ActivityIndicator color={colors.primary} /> : null}
              {queue.kind === 'participants' ? queue.rows.map((row, index) => {
                const label = queueRosterLabel(row.initials);
                return (
                  <TouchableOpacity
                    key={`${row.position}-${index}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Open queue profile for ${label}`}
                    testID={row.isViewer ? 'join-flight-queue-viewer' : `join-flight-queue-row-${row.position}`}
                    onPress={() => setSelectedRow(row.position)}
                    style={[styles.row, index > 0 ? { borderTopColor: colors.separator, borderTopWidth: StyleSheet.hairlineWidth } : null]}
                  >
                    <MemberInitialsAvatar name={label} />
                    <View style={styles.rowCopy}>
                      <Text style={[styles.rowName, { color: colors.textOnSurface }]} numberOfLines={1}>{label}</Text>
                      <Text style={[styles.rowTier, { color: colors.mutedForegroundLight }]} numberOfLines={1}>
                        {queueRosterTierLabel(row.tier)} · #{row.position}
                      </Text>
                    </View>
                    {row.isViewer ? <Text style={[styles.you, { color: colors.primary }]}>You</Text> : null}
                  </TouchableOpacity>
                );
              }) : (
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
        <View style={[styles.footer, { paddingBottom: bottomPad + 12, borderTopColor: colors.separator, backgroundColor: colors.offWhite }]}>
          {mutation.skipMessage ? (
            <Text testID="queue-status-skip-success" style={[styles.hint, { color: colors.textOnSurface }]}>{mutation.skipMessage}</Text>
          ) : null}
          {mutation.skipFailure ? (
            <Text testID="queue-status-skip-error" style={[styles.hint, { color: colors.textOnSurface }]}>{mutation.skipFailure.body}</Text>
          ) : null}
          {skipOffer.kind === 'loading' ? (
            <View testID="queue-status-skip-loading" accessibilityLabel="Checking Skip the Line passes" style={styles.skipLoading}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.hint, { color: colors.mutedForegroundLight }]}>Checking Skip the Line passes</Text>
            </View>
          ) : null}
          {skipOffer.kind === 'unavailable' ? (
            <View testID="queue-status-skip-unavailable">
              <Text style={[styles.hint, { color: colors.textOnSurface }]}>{QUEUE_SKIP_BALANCE_UNAVAILABLE}</Text>
              <TouchableOpacity accessibilityRole="button" onPress={() => setPassAttempt((attempt) => attempt + 1)} testID="queue-status-skip-retry">
                <Text style={[styles.back, { color: colors.primary, textAlign: 'center' }]}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {skipOffer.kind === 'none' ? (
            <Text testID="queue-status-skip-none" style={[styles.hint, { color: colors.mutedForegroundLight }]}>{QUEUE_SKIP_NONE}</Text>
          ) : null}
          {skipOffer.kind === 'already-used' ? (
            <Text testID="queue-status-skip-used" style={[styles.hint, { color: colors.textOnSurface }]}>{QUEUE_SKIP_ALREADY_USED}</Text>
          ) : null}
          {skipOffer.kind === 'winner' && !mutation.skipMessage ? (
            <Text testID="queue-status-skip-winner" style={[styles.hint, { color: colors.textOnSurface }]}>{QUEUE_SKIP_WINNER}</Text>
          ) : null}
          {skipOffer.kind === 'closed' ? (
            <Text testID="queue-status-skip-closed" style={[styles.hint, { color: colors.mutedForegroundLight }]}>{QUEUE_SKIP_UNAVAILABLE}</Text>
          ) : null}
          {skipOffer.kind === 'ready' && !mutation.skipMessage ? (
            <>
              <PrimaryButton
                label="Use Skip the Line Pass"
                testID="queue-status-skip-line"
                disabled={!canSubmitProductionQueueJoin() || mutation.submitting}
                loading={mutation.submitting && canSubmitProductionQueueJoin()}
                onPress={() => {
                  if (mutation.submitting || !canSubmitProductionQueueJoin() || skipOffer.kind !== 'ready') return;
                  void mutation.skip(skipOffer.count);
                }}
              />
              <Text testID="queue-status-skip-note" style={[styles.hint, { color: colors.mutedForegroundLight }]}>
                {`${skipOffer.count} available. ${QUEUE_SKIP_NOTE}`}
              </Text>
            </>
          ) : null}
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
      <MemberProfileSheet
        visible={rosterRow !== null}
        name={queueRosterLabel(rosterRow?.initials)}
        lines={rosterRow ? [
          queueRosterTierLabel(rosterRow.tier),
          `Queue position #${rosterRow.position}`,
          ...(rosterRow.isViewer ? ['You'] : []),
          ...(rosterRow.hasLineSkip ? ['Skip the Line'] : []),
        ] : []}
        onClose={() => setSelectedRow(null)}
      />
      {currentWinner ? (
        <CurrentWinnerCelebration
          queueClosesAt={
            typeof flightQuery.data?.queueClosesAt === 'string'
              ? flightQuery.data.queueClosesAt
              : currentWinner.queueClosesAt
          }
          onContinue={() => {
            if (!clerkUserId || flightId === null) return;
            dismissCurrentWinnerCelebration({ clerkUserId, flightId });
            setCelebrationRevision((revision) => revision + 1);
            void refetchFlight();
            if (configuration && clerkUserId) {
              void queryClient.invalidateQueries({
                queryKey: mainBluebirdAuthenticatedQueryKey(
                  configuration.environment,
                  clerkUserId,
                  'empty-leg-queue',
                  flightId,
                ),
              });
            }
          }}
        />
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
  card: { borderRadius: 22, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  cardTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 68 },
  rowCopy: { flex: 1, gap: 2 },
  rowName: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  rowTier: { fontFamily: 'Inter_400Regular', fontSize: 13 },
  you: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  footer: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  skipLoading: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  hint: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, textAlign: 'center' },
});
