import React from 'react';
import { AppState, Modal, StyleSheet, Text, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { PrimaryButton, SecondaryButton } from '@/components/PrimaryButton';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { createClerkProductionTokenProvider, type ClerkSessionSnapshot } from '@/lib/clerkProductionTokenProvider';
import {
  createMainBluebirdApiIntegration,
  mainBluebirdAuthenticatedQueryKey,
} from '@/lib/mainBluebirdApi';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import type { ProductionTrips } from '@/lib/productionAuthApi';
import {
  clearWinnerNoticesForAccount,
  nextWinnerNotice,
  pendingWinnerOfferFlightIdsFromTrips,
  rememberWinnerNotice,
  winnerCelebrationVisible,
  winnerOfferPollInterval,
} from '@/lib/memberFlightPlacement';

/**
 * One trips poll for the signed-in member. Queue Status keeps its own flight
 * refresh, so this interval pauses there. The poll never confirms or declines.
 *
 * Pending (unawarded) Trips after queue join are product-correct and are NOT
 * treated as winner offers here. Winner notices require pendingWinnerOfferFlightIdsFromTrips,
 * which stays empty until trips expose verified winner-selection fields.
 */
export function WinnerOfferObserver() {
  const colors = useColors();
  const pathname = usePathname();
  const { authMode, clerkUserId } = useAuth();
  const session = useClerkAuthSnapshot();
  const sessionRef = React.useRef(session);
  sessionRef.current = session;
  const configuration = getMainBluebirdApiConfigurationOrNull();
  const queryClient = useQueryClient();
  const [foreground, setForeground] = React.useState(AppState.currentState === 'active');
  const previousAccount = React.useRef<string | null>(null);
  const [noticeFlightId, setNoticeFlightId] = React.useState<number | null>(null);
  const signedIn = authMode === 'clerk' &&
    !!configuration &&
    session?.isLoaded === true &&
    session.isSignedIn === true &&
    !!session.userId &&
    session.userId === clerkUserId;
  const pollInterval = winnerOfferPollInterval({
    foreground,
    signedIn,
    pathname,
  });

  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      const active = state === 'active';
      setForeground(active);
      if (!active || !configuration || !clerkUserId) return;
      void queryClient.invalidateQueries({
        queryKey: mainBluebirdAuthenticatedQueryKey(configuration.environment, clerkUserId, 'trips'),
      });
    });
    return () => subscription.remove();
  }, [clerkUserId, configuration, queryClient]);

  React.useEffect(() => {
    const previous = previousAccount.current;
    if (previous && previous !== clerkUserId) {
      clearWinnerNoticesForAccount(previous);
      setNoticeFlightId(null);
    }
    previousAccount.current = clerkUserId;
  }, [clerkUserId]);

  const query = useQuery<ProductionTrips>({
    queryKey: configuration && clerkUserId
      ? mainBluebirdAuthenticatedQueryKey(configuration.environment, clerkUserId, 'trips')
      : ['main-bluebird-api', 'signed-out', 'trips'],
    enabled: signedIn,
    retry: false,
    refetchInterval: pollInterval,
    refetchIntervalInBackground: false,
    queryFn: async ({ signal }) => {
      if (!configuration || !clerkUserId) {
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
          return current;
        },
      }, configuration.environment);
      const api = createMainBluebirdApiIntegration({ configuration, tokenProvider });
      const trips = await api.authenticated.listTrips({ signal });
      if (sessionRef.current?.userId !== requestedUserId) {
        throw Object.assign(new Error('The signed-in account changed.'), { code: 'cancelled' });
      }
      return trips;
    },
  });

  const pendingIds = query.data ? pendingWinnerOfferFlightIdsFromTrips(query.data.current) : [];
  const pendingKey = pendingIds.join(',');
  const celebrationVisible = winnerCelebrationVisible(pathname);
  const tripsLoaded = query.data !== undefined;

  React.useEffect(() => {
    if (!signedIn || !clerkUserId) {
      setNoticeFlightId(null);
      return;
    }
    if (noticeFlightId !== null && pendingIds.includes(noticeFlightId)) return;
    const decision = nextWinnerNotice({
      accountKey: clerkUserId,
      pendingFlightIds: pendingIds,
      tripsLoaded,
      celebrationVisible,
    });
    if (!decision || decision.action === 'suppress') {
      if (noticeFlightId !== null && !pendingIds.includes(noticeFlightId)) setNoticeFlightId(null);
      return;
    }
    rememberWinnerNotice(clerkUserId, decision.flightId);
    setNoticeFlightId(decision.flightId);
  }, [celebrationVisible, clerkUserId, noticeFlightId, pendingKey, signedIn, tripsLoaded]);

  const dismiss = () => setNoticeFlightId(null);
  const viewFlight = () => {
    const flightId = noticeFlightId;
    setNoticeFlightId(null);
    if (flightId === null) return;
    router.push({ pathname: '/flight/winner', params: { flightId: String(flightId) } });
  };

  return (
    <Modal
      visible={noticeFlightId !== null}
      transparent
      animationType="fade"
      onRequestClose={dismiss}
    >
      <View style={styles.backdrop} testID="winner-offer-notice">
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={[styles.kicker, { color: colors.primary }]}>BLUEBIRD</Text>
          <Text style={[styles.title, { color: colors.foreground }]}>Congratulations! You've Been Selected!</Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            You've been selected for your Bluebird flight. Please review and confirm your trip.
          </Text>
          <PrimaryButton label="View Flight" testID="winner-offer-view" onPress={viewFlight} />
          <SecondaryButton label="Later" testID="winner-offer-later" onPress={dismiss} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(10, 17, 40, 0.45)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: { borderRadius: 24, padding: 24, gap: 14 },
  kicker: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 1.4 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 24, lineHeight: 30, letterSpacing: -0.4 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 23 },
});
