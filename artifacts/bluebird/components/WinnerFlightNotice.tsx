import React from 'react';
import { Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
import type { ProductionTrip, ProductionTrips } from '@/lib/productionAuthApi';
import {
  BOARDING_PASS_SEND_DIALOG,
  BOARDING_PASS_SENT,
  awardStateForFlight,
  boardingPassActionBlock,
  canConfirmProductionWinner,
  canDeclineProductionWinner,
  checklistFullyComplete,
  listedTripForChecklist,
  presentBoardingPass,
  presentWinnerState,
  reviewWinnerConfirmation,
  reviewWinnerDecline,
  WINNER_DECLINE_DIALOG,
  winnerActionBlock,
} from '@/lib/winnerChecklist';
import { useWinnerActions } from '@/lib/useWinnerActions';

function CompletedChecklistActions({
  trip,
  actions,
  onOpenChecklist,
}: {
  trip: ProductionTrip;
  actions: ReturnType<typeof useWinnerActions>;
  onOpenChecklist: () => void;
}) {
  const colors = useColors();
  const boardingPassUrl = presentBoardingPass({
    awarded: trip.checklist.awarded,
    boardingPassUrl: trip.checklist.boardingPassUrl,
  });
  const sendBlock = boardingPassActionBlock({
    checklistAvailable: true,
    awarded: trip.checklist.awarded,
    boardingPassUrl: trip.checklist.boardingPassUrl,
    passLinkSentAt: trip.checklist.passLinkSentAt,
  });
  const send = () => {
    if (sendBlock) return;
    Alert.alert('Send boarding pass?', BOARDING_PASS_SEND_DIALOG, [
      { text: 'Not now', style: 'cancel' },
      { text: 'Send', onPress: () => { void actions.sendBoardingPass(null); } },
    ]);
  };
  return (
    <View style={styles.passSection}>
      <View style={styles.passRow}>
        <SecondaryButton
          label="Send Boarding Pass"
          testID="flight-send-boarding-pass"
          style={styles.passButton}
          loading={actions.boardingPassSubmitting}
          disabled={sendBlock !== null}
          onPress={send}
        />
        <PrimaryButton
          label="View Boarding Pass"
          testID="flight-view-boarding-pass"
          style={styles.passButton}
          disabled={!boardingPassUrl}
          onPress={() => {
            if (boardingPassUrl) void Linking.openURL(boardingPassUrl);
          }}
        />
      </View>
      {!boardingPassUrl ? (
        <Text testID="flight-boarding-pass-missing" style={[styles.note, { color: colors.mutedForegroundLight }]}>
          A boarding pass link is not available for this flight.
        </Text>
      ) : null}
      {sendBlock === 'already-sent' ? (
        <Text testID="flight-boarding-pass-sent" style={[styles.note, { color: colors.textOnSurface }]}>
          {BOARDING_PASS_SENT}
        </Text>
      ) : null}
      {actions.boardingPassFailure ? (
        <Text testID="flight-boarding-pass-error" style={[styles.note, { color: colors.destructive }]}>
          {actions.boardingPassFailure.title}. {actions.boardingPassFailure.body}
        </Text>
      ) : null}
      {actions.boardingPassMessage && sendBlock !== 'already-sent' ? (
        <Text testID="flight-boarding-pass-sent" style={[styles.note, { color: colors.textOnSurface }]}>
          {actions.boardingPassMessage}
        </Text>
      ) : null}
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Flight checklist"
        testID="winner-checklist-link"
        onPress={onOpenChecklist}
      >
        <Text style={[styles.checklistLink, { color: colors.primary }]}>Flight checklist</Text>
      </TouchableOpacity>
    </View>
  );
}

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
  const listedTrip = tripsQuery.isSuccess ? listedTripForChecklist(tripsQuery.data, flightId) : null;
  const checklistComplete = listedTrip !== null && checklistFullyComplete(listedTrip.checklist);
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
            label="Review & Confirm Flight"
            testID="winner-review"
            onPress={() => router.push({ pathname: '/flight/winner', params: { flightId: String(flightId) } })}
          />
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
        checklistComplete && listedTrip ? (
          <CompletedChecklistActions
            trip={listedTrip}
            actions={winnerActions}
            onOpenChecklist={openChecklist}
          />
        ) : (
          <SecondaryButton label="View checklist" testID="winner-view-checklist" onPress={openChecklist} />
        )
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
  passSection: { gap: 8 },
  passRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  passButton: { flex: 1, minHeight: 44, paddingHorizontal: 8 },
  checklistLink: { fontFamily: 'Inter_600SemiBold', fontSize: 14, textAlign: 'center' },
  note: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
});
