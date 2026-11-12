import React from 'react';
import { ActivityIndicator, AppState, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { CurrentWinnerCelebration } from '@/components/CurrentWinnerCelebration';
import { PassCelebration } from '@/components/PassCelebration';
import { PrimaryButton, SecondaryButton } from '@/components/PrimaryButton';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { createClerkProductionTokenProvider, type ClerkSessionSnapshot } from '@/lib/clerkProductionTokenProvider';
import {
  FLIGHT_DETAIL_QUERY_BEHAVIOR,
  productionFlightDetailQueryKey,
  readProductionFlightDetailCache,
} from '@/lib/flightDetailPresentation';
import { MEMBER_MESSAGE_POLL_MS } from '@/lib/memberMessages';
import {
  QUEUE_LEAVE_UNAVAILABLE,
  QUEUE_LEFT_CONFIRMED,
  QUEUE_SKIP_ALREADY_USED,
  QUEUE_SKIP_BALANCE_UNAVAILABLE,
  QUEUE_SKIP_NONE,
  QUEUE_SKIP_NOTE,
  QUEUE_SKIP_UNAVAILABLE,
  QUEUE_SKIP_WINNER,
  presentQueueSkipLineOffer,
  canSubmitProductionQueueJoin,
} from '@/lib/joinFlightPresentation';
import { mainBluebirdAuthenticatedQueryKey } from '@/lib/mainBluebirdApi';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import {
  forgetSkipTheLinePasses,
  loadDashboardSkipTheLinePasses,
  readFreshSkipTheLinePasses,
  rememberSkipTheLinePasses,
} from '@/lib/membershipDashboardRead';
import { fetchProductionFlight, parseProductionFlightId } from '@/lib/productionFlights';
import {
  presentProductionQueueFlightStatus,
  presentQueueDecision,
  presentQueuePositionRing,
  resolveProductionQueuePosition,
} from '@/lib/productionQueueStatusPresentation';
import { QUEUE_ACKNOWLEDGEMENT_ITEMS } from '@/lib/queueAcknowledgements';
import {
  presentWinnerOffer,
  presentWinnerOfferCopy,
} from '@/lib/winnerOfferPresentation';
import {
  dismissCurrentWinnerCelebration,
  readCurrentWinnerCelebration,
} from '@/lib/currentWinnerCelebration';
import { useJoinFlightQueueRead } from '@/lib/useJoinFlightQueueRead';
import { useProductionQueueMutation } from '@/lib/useProductionQueueMutation';

const RING_CIRCUMFERENCE = 251;
const OPERATIONAL_NOTICE = QUEUE_ACKNOWLEDGEMENT_ITEMS[0].label;

function QueuePositionRing({
  positionText,
  totalText,
  fraction,
}: {
  positionText: string;
  totalText: string | null;
  fraction: number | null;
}) {
  const colors = useColors();
  const dashoffset = fraction === null ? RING_CIRCUMFERENCE : RING_CIRCUMFERENCE * (1 - fraction);
  return (
    <View style={styles.ringWrap} testID="queue-status-ring">
      <Svg width={168} height={168} viewBox="0 0 90 90">
        <Circle cx="45" cy="45" r="40" fill="none" stroke={colors.border} strokeWidth="7" />
        {fraction !== null ? (
          <Circle
            cx="45"
            cy="45"
            r="40"
            fill="none"
            stroke={colors.primary}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={dashoffset}
            transform="rotate(-90, 45, 45)"
          />
        ) : null}
      </Svg>
      <View style={styles.ringLabel}>
        <Text testID="queue-status-position" style={[styles.ringValue, { color: colors.textOnSurface }]}>
          {positionText}
          {totalText ? (
            <Text testID="queue-status-total" style={[styles.ringTotal, { color: colors.mutedForegroundLight }]}>
              {` / ${totalText}`}
            </Text>
          ) : null}
        </Text>
        <Text style={[styles.ringCaption, { color: colors.mutedForegroundLight }]}>YOUR POSITION</Text>
      </View>
    </View>
  );
}

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
  const [focused, setFocused] = React.useState(false);
  const [foreground, setForeground] = React.useState(AppState.currentState === 'active');
  useFocusEffect(
    React.useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active');
    });
    return () => subscription.remove();
  }, []);
  const shouldPoll = signedIn && !!configuration && flightId !== null && focused && foreground;
  const flightQuery = useQuery({
    queryKey: configuration && clerkUserId && flightId !== null
      ? productionFlightDetailQueryKey(flightId, clerkUserId)
      : ['production-empty-leg', flightId ?? 'invalid', 'signed-out'],
    enabled: signedIn && !!configuration && flightId !== null,
    retry: false,
    ...FLIGHT_DETAIL_QUERY_BEHAVIOR,
    refetchInterval: shouldPoll ? MEMBER_MESSAGE_POLL_MS : false,
    refetchIntervalInBackground: false,
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
      const flight = await fetchProductionFlight(flightId, { signal, accessToken: token });
      return { flight, viewerAuthenticated: true };
    },
  });
  const flight = readProductionFlightDetailCache(flightQuery.data)?.flight;
  const flightStatus = flight?.status === 'published' ? 'published' : null;
  const { panel: queue } = useJoinFlightQueueRead(flightId ?? 0, flightStatus);
  const mutation = useProductionQueueMutation(flightId ?? 0, flight?.internationalPassRequired ?? null);
  const route = flight
    ? [flight.fromAirport, flight.toAirport].filter(Boolean).join(' → ')
    : '';
  const rosterPosition = queue.kind === 'participants' ? queue.viewerPosition : null;
  const rosterCount = queue.kind === 'participants' ? queue.participantCount : null;
  const reading = resolveProductionQueuePosition({
    rosterPosition,
    rosterCount,
    flightPosition: flight?.viewerQueuePosition ?? null,
    flightCount: flight?.queueCount ?? null,
  });
  const ring = presentQueuePositionRing(reading.position, reading.total);
  const memberInQueue = flight?.userInQueue === true || reading.position !== null;
  const viewerRosterRow = queue.kind === 'participants'
    ? queue.rows.find((row) => row.isViewer) ?? null
    : null;
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const closesAt = typeof flight?.queueClosesAt === 'string' ? flight.queueClosesAt : null;
  React.useEffect(() => {
    if (!closesAt) return undefined;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [closesAt]);
  const decision = presentQueueDecision(closesAt, nowMs);
  const offer = presentWinnerOffer({
    viewerIsEffectiveWinner: flight?.viewerIsEffectiveWinner ?? null,
    viewerConfirmationStatus: flight?.viewerConfirmationStatus ?? null,
    queueClosed: decision.kind === 'closed' ? true : decision.kind === 'countdown' ? false : null,
    awarded: null,
    bookedPassenger: flight?.viewerIsBookedPassenger ?? null,
    flightStatus: flight?.status ?? null,
    deadlineIso: null,
    nowMs,
  });
  const offerCopy = presentWinnerOfferCopy(offer);
  const flightState = presentProductionQueueFlightStatus({
    status: flight?.status ?? null,
    queueClosesAt: closesAt,
    nowMs,
    viewerIsBookedPassenger: flight?.viewerIsBookedPassenger ?? null,
    viewerConfirmationStatus: flight?.viewerConfirmationStatus ?? null,
    viewerIsEffectiveWinner: flight?.viewerIsEffectiveWinner ?? null,
  });
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
  const [showSkipCelebration, setShowSkipCelebration] = React.useState(false);
  React.useEffect(() => {
    if (!mutation.skipMessage) return;
    setShowSkipCelebration(true);
    if (passEnvironment && passApiBaseUrl && clerkUserId) {
      forgetSkipTheLinePasses({
        environment: passEnvironment,
        apiBaseUrl: passApiBaseUrl,
        clerkUserId,
      });
    }
    setPassAttempt((attempt) => attempt + 1);
  }, [clerkUserId, mutation.skipMessage, passApiBaseUrl, passEnvironment]);
  const [celebrationRevision, setCelebrationRevision] = React.useState(0);
  const currentWinner = celebrationRevision >= 0 && clerkUserId && flightId !== null
    ? readCurrentWinnerCelebration({ clerkUserId, flightId })
    : null;
  const skipOffer = presentQueueSkipLineOffer({
    inQueue: memberInQueue,
    mutationsEnabled: canSubmitProductionQueueJoin(),
    balance: passBalance,
    passAlreadyApplied: flight?.viewerHasLineSkip === true || viewerRosterRow?.hasLineSkip === true,
  });
  const refetchFlight = flightQuery.refetch;
  React.useEffect(() => {
    if (!shouldPoll || flightId === null) return;
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
      void queryClient.invalidateQueries({
        queryKey: mainBluebirdAuthenticatedQueryKey(configuration.environment, clerkUserId, 'trips'),
      });
    }
  }, [clerkUserId, configuration, flightId, queryClient, refetchFlight, shouldPoll]);
  const closedRefresh = React.useRef(false);
  React.useEffect(() => {
    if (decision.kind !== 'closed' || closedRefresh.current || flightId === null) return;
    closedRefresh.current = true;
    void refetchFlight();
    if (configuration && clerkUserId) {
      void queryClient.invalidateQueries({
        queryKey: mainBluebirdAuthenticatedQueryKey(configuration.environment, clerkUserId, 'trips'),
      });
      void queryClient.invalidateQueries({
        queryKey: mainBluebirdAuthenticatedQueryKey(
          configuration.environment,
          clerkUserId,
          'empty-leg-queue',
          flightId,
        ),
      });
    }
  }, [clerkUserId, configuration, decision.kind, flightId, queryClient, refetchFlight]);
  // Closed countdown without a server winner field → wait; never invent a win.
  const winnerUnresolved =
    decision.kind === 'closed' && (offer.kind === 'unavailable' || offer.kind === 'waiting');
  React.useEffect(() => {
    if (!winnerUnresolved || flightId === null) return undefined;
    let attempts = 0;
    const refreshAuthoritative = () => {
      void refetchFlight();
      if (configuration && clerkUserId) {
        void queryClient.invalidateQueries({
          queryKey: mainBluebirdAuthenticatedQueryKey(configuration.environment, clerkUserId, 'trips'),
        });
        void queryClient.invalidateQueries({
          queryKey: mainBluebirdAuthenticatedQueryKey(
            configuration.environment,
            clerkUserId,
            'empty-leg-queue',
            flightId,
          ),
        });
      }
    };
    const timer = setInterval(() => {
      attempts += 1;
      if (attempts > 6) {
        clearInterval(timer);
        return;
      }
      refreshAuthoritative();
    }, MEMBER_MESSAGE_POLL_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshAuthoritative();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [clerkUserId, configuration, flightId, queryClient, refetchFlight, winnerUnresolved]);
  const celebratedFlight = React.useRef<string | null>(null);
  React.useEffect(() => {
    celebratedFlight.current = null;
  }, [clerkUserId]);
  React.useEffect(() => {
    // Navigate only when the backend marks this viewer as the effective winner.
    if (offer.kind !== 'pending' || !clerkUserId || flightId === null) return;
    const celebrationKey = `${clerkUserId}:${flightId}`;
    if (celebratedFlight.current === celebrationKey) return;
    celebratedFlight.current = celebrationKey;
    router.push({ pathname: '/flight/winner', params: { flightId: String(flightId) } });
  }, [clerkUserId, flightId, offer.kind]);
  const cardShadow = colors.scheme === 'light'
    ? { shadowColor: '#0A1128', shadowOffset: { width: 0, height: 8 }, shadowRadius: 18, shadowOpacity: 0.06, elevation: 2 }
    : null;
  const statusColor = flightState?.tone === 'open' || flightState?.tone === 'awarded'
    ? colors.success
    : flightState?.tone === 'cancelled'
      ? colors.destructive
      : flightState?.tone === 'pending'
        ? colors.primary
        : colors.mutedForegroundLight;

  return (
    <View style={[styles.screen, { backgroundColor: colors.offWhite }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 8, paddingBottom: bottomPad + 168 }]}>
        <View style={styles.header}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => router.back()}
            testID="queue-status-back"
            style={styles.backButton}
          >
            <Feather name="chevron-left" size={26} color={colors.textOnSurface} />
          </TouchableOpacity>
          <Text testID="queue-status-route" style={[styles.route, { color: colors.textOnSurface }]}>
            {flightId === null ? 'Flight unavailable' : route || (flightQuery.isPending ? 'Queue status' : 'Flight details unavailable')}
          </Text>
          <View style={styles.backButton} />
        </View>
        {flightId !== null && flightQuery.isPending ? (
          <ActivityIndicator color={colors.primary} style={styles.loading} />
        ) : null}
        {flightId !== null && flightQuery.isError ? (
          <View testID="queue-status-error" style={styles.errorBlock}>
            <Text style={[styles.body, { color: colors.textOnSurface }]}>Queue status could not be loaded.</Text>
            <TouchableOpacity accessibilityRole="button" onPress={() => { void flightQuery.refetch(); }}>
              <Text style={[styles.retry, { color: colors.primary }]}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {flightId !== null && !flightQuery.isPending && !flightQuery.isError ? (
          <>
            {ring.positionText ? (
              <QueuePositionRing
                positionText={ring.positionText}
                totalText={ring.totalText}
                fraction={ring.fraction}
              />
            ) : (
              <Text testID="queue-status-position" style={[styles.unavailablePosition, { color: colors.textOnSurface }]}>
                {memberInQueue ? 'Your position is not available for this flight.' : 'You are not in this queue.'}
              </Text>
            )}
            {decision.kind === 'unavailable' ? null : (
              <Text testID="queue-status-decision" style={[styles.decision, { color: colors.primary }]}>
                {decision.label}
              </Text>
            )}
            <View testID="queue-status-flight-status" style={[styles.card, styles.statusCard, cardShadow, { backgroundColor: colors.surface }]}>
              <View style={styles.statusRow}>
                <Text style={[styles.cardTitle, { color: colors.textOnSurface }]}>Flight Status</Text>
                {flightState ? (
                  <View style={styles.statusBadge}>
                    <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                    <Text style={[styles.statusText, { color: statusColor }]}>{flightState.label}</Text>
                  </View>
                ) : (
                  <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>Not available</Text>
                )}
              </View>
            </View>
            {offerCopy && offer.kind !== 'non-winner' && offer.kind !== 'unavailable' ? (
              <View testID="queue-status-winner" style={[styles.card, cardShadow, { backgroundColor: colors.surface }]}>
                <Text style={[styles.cardTitle, { color: colors.textOnSurface }]}>{offerCopy.title}</Text>
                <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>{offerCopy.body}</Text>
                {offer.kind === 'pending' ? (
                  <PrimaryButton
                    label="Review & Confirm Flight"
                    testID="queue-status-review-winner"
                    onPress={() => router.push({ pathname: '/flight/winner', params: { flightId: String(flightId) } })}
                  />
                ) : null}
              </View>
            ) : null}
            <View testID="queue-status-notice" style={[styles.notice, { backgroundColor: colors.primary + '14' }]}>
              <Text style={[styles.body, { color: colors.textOnSurface }]}>{OPERATIONAL_NOTICE}</Text>
            </View>
            {mutation.leftMessage === QUEUE_LEFT_CONFIRMED ? (
              <Text testID="queue-status-left" style={[styles.body, { color: colors.textOnSurface, textAlign: 'center' }]}>{mutation.leftMessage}</Text>
            ) : null}
            {mutation.failure ? (
              <Text testID="queue-status-leave-error" style={[styles.body, { color: colors.textOnSurface, textAlign: 'center' }]}>{mutation.failure.body}</Text>
            ) : null}
          </>
        ) : null}
      </ScrollView>
      {memberInQueue && mutation.leftMessage !== QUEUE_LEFT_CONFIRMED ? (
        <View style={[styles.footer, { paddingBottom: bottomPad + 12, backgroundColor: colors.offWhite }]}>
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
                <Text style={[styles.retry, { color: colors.primary, textAlign: 'center' }]}>Try again</Text>
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
          {!canSubmitProductionQueueJoin() ? (
            <Text style={[styles.hint, { color: colors.mutedForegroundLight }]}>
              {QUEUE_LEAVE_UNAVAILABLE}
            </Text>
          ) : null}
        </View>
      ) : null}
      {showSkipCelebration && mutation.skipMessage ? (
        <PassCelebration onDone={() => setShowSkipCelebration(false)} />
      ) : null}
      {currentWinner && !showSkipCelebration ? (
        <CurrentWinnerCelebration
          queueClosesAt={closesAt ?? currentWinner.queueClosesAt}
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
  content: { paddingHorizontal: 22, alignItems: 'center', gap: 18 },
  header: { width: '100%', minHeight: 44, flexDirection: 'row', alignItems: 'center' },
  backButton: { width: 44, height: 44, alignItems: 'flex-start', justifyContent: 'center' },
  route: { flex: 1, textAlign: 'center', fontFamily: 'Inter_700Bold', fontSize: 22, letterSpacing: -0.4 },
  loading: { marginTop: 32 },
  errorBlock: { alignItems: 'center', gap: 8, marginTop: 24 },
  ringWrap: { width: 168, height: 168, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  ringLabel: { position: 'absolute', alignItems: 'center' },
  ringValue: { fontFamily: 'Inter_700Bold', fontSize: 34, letterSpacing: -0.8 },
  ringTotal: { fontFamily: 'Inter_400Regular', fontSize: 18 },
  ringCaption: { fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 1.1, marginTop: 2 },
  unavailablePosition: { fontFamily: 'Inter_600SemiBold', fontSize: 16, lineHeight: 22, textAlign: 'center', marginTop: 24 },
  decision: { fontFamily: 'Inter_700Bold', fontSize: 16, marginTop: 4 },
  card: { width: '100%', borderRadius: 18, padding: 16, gap: 10 },
  statusCard: { marginTop: 8 },
  cardTitle: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  notice: { width: '100%', borderRadius: 16, padding: 14 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 22, paddingTop: 12, gap: 8 },
  skipLoading: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  hint: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, textAlign: 'center' },
  retry: { fontFamily: 'Inter_600SemiBold', fontSize: 16, paddingVertical: 8 },
});
