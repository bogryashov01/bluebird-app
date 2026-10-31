import React from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { PrimaryButton, SecondaryButton } from '@/components/PrimaryButton';
import { useColors } from '@/hooks/useColors';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { createClerkProductionTokenProvider, type ClerkSessionSnapshot } from '@/lib/clerkProductionTokenProvider';
import {
  createMainBluebirdApiIntegration,
  mainBluebirdAuthenticatedQueryKey,
} from '@/lib/mainBluebirdApi';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import type { ProductionTrips } from '@/lib/productionAuthApi';
import {
  awardStateForFlight,
  canConfirmProductionWinner,
  canDeclineProductionWinner,
  presentWinnerState,
  reviewWinnerConfirmation,
  reviewWinnerDecline,
  WINNER_DECLINE_DIALOG,
  winnerActionBlock,
} from '@/lib/winnerChecklist';
import { useWinnerActions } from '@/lib/useWinnerActions';

export function WinnerFlightNotice({
  flightId,
  viewerIsEffectiveWinner,
  viewerConfirmationStatus,
  queueClosesAt,
  departureAirport,
  arrivalAirport,
  scheduleLabel,
  aircraft,
}: {
  flightId: number;
  viewerIsEffectiveWinner: boolean | null;
  viewerConfirmationStatus: string | null;
  queueClosesAt: string | null;
  departureAirport: string;
  arrivalAirport: string;
  scheduleLabel: string;
  aircraft: string | null;
}) {
  const colors = useColors();
  const { authMode, clerkUserId } = useAuth();
  const session = useClerkAuthSnapshot();
  const sessionRef = React.useRef(session);
  sessionRef.current = session;
  const configuration = getMainBluebirdApiConfigurationOrNull();
  const winnerActions = useWinnerActions(flightId);
  const ready = authMode === 'clerk' &&
    !!configuration &&
    session?.isLoaded === true &&
    session.isSignedIn === true &&
    !!session.userId &&
    session.userId === clerkUserId;

  const tripsQuery = useQuery<ProductionTrips>({
    queryKey: configuration && clerkUserId
      ? mainBluebirdAuthenticatedQueryKey(configuration.environment, clerkUserId, 'trips')
      : ['main-bluebird-api', configuration?.environment ?? 'unconfigured', clerkUserId ?? 'signed-out', 'trips'],
    enabled: ready,
    retry: false,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      if (!configuration || !session?.userId || !ready) {
        throw new Error('A signed-in Clerk session is required.');
      }
      const requestedUserId = session.userId;
      const tokenProvider = createClerkProductionTokenProvider({
        getCurrentSession: () => {
          const current = sessionRef.current;
          if (!current || current.userId !== requestedUserId) {
            return {
              isLoaded: true,
              isSignedIn: false,
              getToken: async () => null,
              signOut: async () => {},
            };
          }
          return current as ClerkSessionSnapshot;
        },
      }, configuration.environment);
      const api = createMainBluebirdApiIntegration({ configuration, tokenProvider });
      return api.authenticated.listTrips({ signal });
    },
  });

  const awarded = tripsQuery.isSuccess ? awardStateForFlight(tripsQuery.data, flightId) : null;
  const presentation = presentWinnerState({
    viewerAuthenticated: ready,
    viewerIsEffectiveWinner,
    viewerConfirmationStatus,
    queueClosesAt,
    nowMs: Date.now(),
    awarded,
  });
  if (presentation.kind === 'hidden') return null;

  const openChecklist = () => {
    router.push({ pathname: '/flight/checklist', params: { legId: String(flightId) } });
  };
  const locallyDeclined = winnerActions.declinedMessage !== null;
  const locallyConfirmed = winnerActions.confirmedMessage !== null;
  const winnerBlock = winnerActionBlock({
    isWinner: viewerIsEffectiveWinner === true,
    awarded: awarded === true,
    confirmed: viewerConfirmationStatus === 'confirmed' || locallyConfirmed,
    confirmedAt: null,
    declined: viewerConfirmationStatus === 'declined' || locallyDeclined,
    queueClosesAt,
    nowMs: Date.now(),
  });
  const onConfirm = () => {
    const decision = reviewWinnerConfirmation(flightId);
    if (decision.status !== 'ready') return;
    void winnerActions.confirm(winnerBlock);
  };
  const onDecline = () => {
    if (!canDeclineProductionWinner()) return;
    Alert.alert(
      'Decline this flight?',
      WINNER_DECLINE_DIALOG,
      [
        { text: 'Keep flight', style: 'cancel' },
        {
          text: 'Decline Flight',
          style: 'destructive',
          onPress: () => {
            const decision = reviewWinnerDecline(flightId, true);
            if (decision.status !== 'ready') return;
            void winnerActions.decline(winnerBlock);
          },
        },
      ],
    );
  };

  const title = locallyDeclined
    ? 'You declined this flight'
    : locallyConfirmed
      ? 'Confirmation recorded'
      : presentation.kind === 'awarded'
        ? 'Trip confirmed'
        : presentation.kind === 'declined'
          ? 'You declined this flight'
          : presentation.actions
            ? "You're Next to Fly"
            : 'Confirmation recorded';
  const body = locallyDeclined
    ? winnerActions.declinedMessage
    : locallyConfirmed
      ? winnerActions.confirmedMessage
      : presentation.kind === 'awarded'
        ? 'This flight is awarded. Continue with the checklist.'
        : presentation.kind === 'declined'
          ? 'No further action is available on this flight.'
          : presentation.actions
            ? "You've been selected for this flight. Confirm your trip to continue."
            : presentation.confirmationLabel;

  return (
    <View
      testID="winner-flight-notice"
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.separator }]}
    >
      <Text testID="winner-flight-title" style={[styles.title, { color: colors.textOnSurface }]}>{title}</Text>
      <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>{body}</Text>
      <Text style={[styles.route, { color: colors.textOnSurface }]} numberOfLines={2}>
        {departureAirport} → {arrivalAirport}
      </Text>
      <Text style={[styles.meta, { color: colors.mutedForegroundLight }]}>{scheduleLabel}</Text>
      {!!aircraft?.trim() && (
        <Text style={[styles.meta, { color: colors.mutedForegroundLight }]} numberOfLines={2}>{aircraft.trim()}</Text>
      )}
      {presentation.kind === 'selected' && (
        <Text testID="winner-confirmation-state" style={[styles.meta, { color: colors.textOnSurface }]}>
          {presentation.confirmationLabel}
        </Text>
      )}
      {presentation.kind === 'selected' && presentation.actions && !locallyDeclined && !locallyConfirmed && (
        <View style={styles.actions}>
          <PrimaryButton
            label="Confirm Flight"
            testID="winner-confirm"
            disabled={!canConfirmProductionWinner()}
            loading={winnerActions.submitting}
            onPress={onConfirm}
          />
          <SecondaryButton
            label="Decline Flight"
            testID="winner-decline"
            disabled={!canDeclineProductionWinner()}
            loading={winnerActions.submitting}
            onPress={onDecline}
          />
          {!canConfirmProductionWinner() && (
            <Text testID="winner-confirmation-unavailable" style={[styles.note, { color: colors.mutedForegroundLight }]}>
              Confirmation is not available in this build. No request is sent.
            </Text>
          )}
          {!canDeclineProductionWinner() && (
            <Text style={[styles.note, { color: colors.mutedForegroundLight }]}>
              Declining is not available in this build. No request is sent.
            </Text>
          )}
          {winnerActions.failure && (
            <Text testID="winner-action-error" style={[styles.note, { color: colors.destructive }]}>
              {winnerActions.failure.title}. {winnerActions.failure.body}
            </Text>
          )}
        </View>
      )}
      {presentation.kind !== 'declined' && !locallyDeclined && (
        <SecondaryButton label="View checklist" testID="winner-view-checklist" onPress={openChecklist} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 18,
    marginBottom: 12,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 8,
  },
  title: { fontFamily: 'Inter_700Bold', fontSize: 22, letterSpacing: -0.3 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 21 },
  route: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
  actions: { gap: 10, marginTop: 4 },
  note: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
});
