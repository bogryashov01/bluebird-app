import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { ProductionAuthHttpError, type ProductionEmptyLegPassengerList, type ProductionTrip, type ProductionTrips } from '@/lib/productionAuthApi';
import { parseProductionFlightId, presentTripDeparture } from '@/lib/productionFlights';
import { isNativeProductionAuthTestEnabled } from '@/lib/nativeAuthTestPolicy';
import { manifestMatchesFlight } from '@/lib/passengerManifest';
import {
  CHECKLIST_BACK_TO_TRIPS_LABEL,
  CHECKLIST_LIST_UNAVAILABLE_BODY,
  CHECKLIST_LIST_UNAVAILABLE_TITLE,
  PASSENGER_DETAILS_UNAVAILABLE_NOTE,
  PASSENGER_PLACEHOLDER_NOTE,
  POLICY_DOCUMENT_UNAVAILABLE_NOTE,
  POLICY_UNAVAILABLE_NOTE,
  TripChecklistMismatchError,
  TripChecklistSessionError,
  canAcknowledgeProductionManifest,
  canAcknowledgeProductionPolicy,
  canConfirmProductionWinner,
  canDeclineProductionWinner,
  canSendProductionBoardingPass,
  canVerifyProductionFbo,
  listedTripForChecklist,
  presentBoardingPass,
  presentChecklistSteps,
  presentTripActionFailure,
  presentTripChecklistStatus,
  reviewFboVerification,
  reviewManifestAcknowledgement,
  reviewPolicyAcknowledgement,
  BOARDING_PASS_SEND_DIALOG,
  BOARDING_PASS_SENT,
  boardingPassActionBlock,
  FBO_VERIFY_DIALOG,
  MANIFEST_ACK_DIALOG,
  fboActionBlock,
  manifestActionBlock,
  reviewWinnerConfirmation,
  reviewWinnerDecline,
  shouldApplyTripChecklist,
  tripMatchesFlight,
  WINNER_DECLINE_DIALOG,
  winnerActionBlock,
  winnerSelectionNotOpen,
} from '@/lib/winnerChecklist';
import { useWinnerActions } from '@/lib/useWinnerActions';

export default function FlightChecklistScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ legId?: string }>();
  const legId = parseProductionFlightId(params.legId);
  const { authMode, clerkUserId } = useAuth();
  const session = useClerkAuthSnapshot();
  const sessionRef = React.useRef(session);
  sessionRef.current = session;
  const configuration = getMainBluebirdApiConfigurationOrNull();
  const queryClient = useQueryClient();
  const winnerActions = useWinnerActions(legId ?? 0);
  const previousUserId = React.useRef<string | null>(null);

  React.useEffect(() => {
    const current = session?.isSignedIn === true ? session.userId : null;
    const previous = previousUserId.current;
    if (previous && previous !== current && configuration && legId !== null) {
      queryClient.removeQueries({
        queryKey: mainBluebirdAuthenticatedQueryKey(configuration.environment, previous, 'trip', legId),
      });
    }
    previousUserId.current = current;
  }, [configuration, legId, queryClient, session?.isSignedIn, session?.userId]);

  const ready = legId !== null &&
    authMode === 'clerk' &&
    !!configuration &&
    session?.isLoaded === true &&
    session.isSignedIn === true &&
    !!session.userId &&
    session.userId === clerkUserId;

  const authTest = isNativeProductionAuthTestEnabled();
  const listedTrip = authTest && configuration && clerkUserId && legId !== null
    ? listedTripForChecklist(
      queryClient.getQueryData<ProductionTrips>(
        mainBluebirdAuthenticatedQueryKey(configuration.environment, clerkUserId, 'trips'),
      ),
      legId,
    )
    : null;

  const query = useQuery<ProductionTrip>({
    queryKey: configuration && clerkUserId && legId !== null
      ? mainBluebirdAuthenticatedQueryKey(configuration.environment, clerkUserId, 'trip', legId)
      : ['main-bluebird-api', configuration?.environment ?? 'unconfigured', clerkUserId ?? 'signed-out', 'trip', legId ?? 'invalid'],
    enabled: ready && !authTest,
    retry: false,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async ({ signal }) => {
      if (!configuration || legId === null || !session?.userId || !ready) {
        throw new TripChecklistSessionError();
      }
      const requestedUserId = session.userId;
      const requestedLegId = legId;
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
      const trip = await api.authenticated.getTrip(requestedLegId, { signal });
      const current = sessionRef.current;
      if (!shouldApplyTripChecklist({
        requestedUserId,
        activeUserId: current?.isSignedIn === true ? current.userId : null,
        signedIn: current?.isSignedIn === true,
      })) {
        throw new TripChecklistSessionError();
      }
      if (!tripMatchesFlight(trip, requestedLegId)) throw new TripChecklistMismatchError();
      return trip;
    },
  });

  if (legId === null) {
    return <Message title="Flight unavailable" body="This flight is no longer available." colors={colors} />;
  }
  if (!session?.isLoaded || authMode !== 'clerk') {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!ready && (session.isSignedIn !== true || session.userId !== clerkUserId || !configuration)) {
    const failure = !configuration
      ? { title: 'Checklist unavailable', body: 'This checklist is unavailable right now.' }
      : presentTripActionFailure(401);
    return <Message title={failure.title} body={failure.body} colors={colors} />;
  }
  if (authTest) {
    if (!listedTrip) {
      return (
        <Message
          title={CHECKLIST_LIST_UNAVAILABLE_TITLE}
          body={CHECKLIST_LIST_UNAVAILABLE_BODY}
          colors={colors}
          actionLabel={CHECKLIST_BACK_TO_TRIPS_LABEL}
          buttonTestID="checklist-back-to-trips"
          onAction={backToTrips}
        />
      );
    }
  } else if (query.isPending || query.isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]} testID="checklist-loading">
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  } else if (query.isError || !query.data) {
    const failure = failureFor(query.error);
    const canRetry = query.error instanceof ProductionAuthHttpError
      ? ![400, 401, 403, 404, 409].includes(query.error.status)
      : !(query.error instanceof TripChecklistMismatchError);
    return (
      <Message
        title={failure.title}
        body={failure.body}
        colors={colors}
        actionLabel={canRetry ? 'Try again' : undefined}
        onAction={canRetry ? () => { void query.refetch(); } : undefined}
      />
    );
  }

  const trip = authTest ? listedTrip : query.data;
  if (!trip) {
    return (
      <Message
        title={CHECKLIST_LIST_UNAVAILABLE_TITLE}
        body={CHECKLIST_LIST_UNAVAILABLE_BODY}
        colors={colors}
        actionLabel={CHECKLIST_BACK_TO_TRIPS_LABEL}
        buttonTestID="checklist-back-to-trips"
        onAction={backToTrips}
      />
    );
  }
  const steps = presentChecklistSteps(trip.checklist, {
    passengerDetailsAvailable: !authTest,
    policyDocumentAvailable: !authTest,
  });
  const boardingPassUrl = presentBoardingPass({
    awarded: trip.checklist.awarded,
    boardingPassUrl: trip.checklist.boardingPassUrl,
  });
  const selectionNotOpen = winnerSelectionNotOpen(trip.leg.queueClosesAt, Date.now());
  const winnerSettled = winnerActions.confirmedMessage !== null || winnerActions.declinedMessage !== null;
  const showWinnerActions = trip.checklist.awarded !== true &&
    !hasServerTime(trip.checklist.confirmedAt) &&
    !selectionNotOpen &&
    !winnerSettled;
  const winnerBlock = winnerActionBlock({
    isWinner: true,
    awarded: trip.checklist.awarded,
    confirmed: false,
    confirmedAt: trip.checklist.confirmedAt,
    declined: winnerActions.declinedMessage !== null,
    queueClosesAt: trip.leg.queueClosesAt,
    nowMs: Date.now(),
  });
  const onConfirm = () => {
    const decision = reviewWinnerConfirmation(legId);
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
            const decision = reviewWinnerDecline(legId, true);
            if (decision.status !== 'ready') return;
            void winnerActions.decline(winnerBlock);
          },
        },
      ],
    );
  };

  return (
    <ScrollView
      testID="flight-checklist"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
    >
      <Text style={[styles.route, { color: colors.foreground }]} numberOfLines={2}>
        {trip.leg.originAirport || 'Origin unavailable'} → {trip.leg.destinationAirport || 'Destination unavailable'}
      </Text>
      <Text style={[styles.meta, { color: colors.mutedForeground }]}>
        {formatWhen(trip.leg.departureTime)}
        {trip.leg.aircraftType ? ` · ${trip.leg.aircraftType}` : ''}
      </Text>
      <Text style={[styles.status, { color: colors.foreground }]}>
        {presentTripChecklistStatus({
          list: 'current',
          awarded: trip.checklist.awarded,
          remainingSteps: trip.checklist.remainingSteps,
          status: trip.status ?? null,
        })}
      </Text>
      <View testID="checklist-progress" style={styles.progressBlock}>
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>
          {`${steps.filter((step) => step.complete).length} of ${steps.length} complete`}
        </Text>
        <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
          <View
            style={[
              styles.progressFill,
              {
                backgroundColor: colors.primary,
                width: `${Math.round((steps.filter((step) => step.complete).length / Math.max(steps.length, 1)) * 100)}%`,
              },
            ]}
          />
        </View>
      </View>
      {steps.map((step) => (
        <View key={step.id} testID={`checklist-step-${step.id}`} style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.stepTitle, { color: colors.foreground }]}>
            {step.complete ? 'Completed' : 'Not completed'} · {step.title}
          </Text>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>{step.detail}</Text>
        </View>
      ))}
      {showWinnerActions && (
        <View style={styles.actions}>
          <PrimaryButton
            label="Confirm Flight"
            testID="checklist-confirm"
            disabled={!canConfirmProductionWinner()}
            loading={winnerActions.submitting}
            onPress={onConfirm}
          />
          <SecondaryButton
            label="Decline Flight"
            testID="checklist-decline"
            disabled={!canDeclineProductionWinner()}
            loading={winnerActions.submitting}
            onPress={onDecline}
          />
          {!canConfirmProductionWinner() && (
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              Confirmation is not available in this build. No request is sent.
            </Text>
          )}
          {!canDeclineProductionWinner() && (
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              Declining is not available in this build. No request is sent.
            </Text>
          )}
          {winnerActions.failure && (
            <Text testID="checklist-winner-error" style={[styles.note, { color: colors.destructive }]}>
              {winnerActions.failure.title}. {winnerActions.failure.body}
            </Text>
          )}
        </View>
      )}
      {selectionNotOpen && !winnerSettled && (
        <Text testID="checklist-winner-not-open" style={[styles.note, { color: colors.mutedForeground }]}>
          This winner selection is not open. No request was sent.
        </Text>
      )}
      {winnerActions.confirmedMessage && (
        <Text testID="checklist-winner-confirmed" style={[styles.note, { color: colors.foreground }]}>
          {winnerActions.confirmedMessage}
        </Text>
      )}
      {winnerActions.declinedMessage && (
        <Text testID="checklist-winner-declined" style={[styles.note, { color: colors.foreground }]}>
          {winnerActions.declinedMessage}
        </Text>
      )}
      <View testID="checklist-fbo" style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={[styles.stepTitle, { color: colors.foreground }]}>FBO</Text>
        <FboLine label="Departure" name={trip.leg.originFboName} address={trip.leg.originFboAddress} colors={colors} />
        <FboLine label="Arrival" name={trip.leg.destinationFboName} address={trip.leg.destinationFboAddress} colors={colors} />
        {!hasFbo(trip) && (
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>FBO details are not available for this flight.</Text>
        )}
        {!hasServerTime(trip.checklist.fboVerifiedAt) && !winnerActions.fboMessage && (
          <>
            <SecondaryButton
              label="Verify FBO"
              testID="checklist-verify-fbo"
              disabled={!canVerifyProductionFbo()}
              loading={winnerActions.fboSubmitting}
              onPress={() => {
                const decision = reviewFboVerification(legId);
                if (decision.status !== 'ready') return;
                const block = fboActionBlock({
                  isWinner: true,
                  checklistAvailable: tripMatchesFlight(trip, legId),
                  fboVerifiedAt: trip.checklist.fboVerifiedAt,
                });
                Alert.alert(
                  'Verify this FBO?',
                  FBO_VERIFY_DIALOG,
                  [
                    { text: 'Not yet', style: 'cancel' },
                    {
                      text: 'Verify FBO',
                      onPress: () => { void winnerActions.verifyFbo(block); },
                    },
                  ],
                );
              }}
            />
            {!canVerifyProductionFbo() && (
              <Text style={[styles.note, { color: colors.mutedForeground }]}>
                FBO verification is not available in this build. No request is sent.
              </Text>
            )}
            {winnerActions.fboFailure && (
              <Text testID="checklist-fbo-error" style={[styles.note, { color: colors.destructive }]}>
                {winnerActions.fboFailure.title}. {winnerActions.fboFailure.body}
              </Text>
            )}
          </>
        )}
        {winnerActions.fboMessage && (
          <Text testID="checklist-fbo-verified" style={[styles.note, { color: colors.foreground }]}>
            {winnerActions.fboMessage}
          </Text>
        )}
      </View>
      <View testID="checklist-passengers" style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={[styles.stepTitle, { color: colors.foreground }]}>Passenger Information</Text>
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>
          {authTest ? PASSENGER_DETAILS_UNAVAILABLE_NOTE : PASSENGER_PLACEHOLDER_NOTE}
        </Text>
        {Number.isInteger(trip.checklist.passengerCount) ? (
          <Text style={[styles.meta, { color: colors.mutedForeground }]} testID="checklist-passenger-count">
            Passengers recorded on this checklist: {trip.checklist.passengerCount}
          </Text>
        ) : (
          <Text style={[styles.meta, { color: colors.mutedForeground }]} testID="checklist-passenger-count-unavailable">
            Passenger count is not available for this flight.
          </Text>
        )}
        <SecondaryButton
          label="Passenger Information"
          testID="checklist-open-passengers"
          disabled={authTest}
          onPress={() => {
            if (authTest) return;
            router.push({ pathname: '/flight/passengers', params: { legId: String(legId) } });
          }}
        />
        {!hasServerTime(trip.checklist.manifestAckAt) && trip.checklist.manifestLocked !== true && (
          <>
            <SecondaryButton
              label="Acknowledge passengers"
              testID="checklist-passengers-action"
              disabled={!canAcknowledgeProductionManifest()}
              loading={winnerActions.manifestSubmitting}
              onPress={() => {
                const decision = reviewManifestAcknowledgement(legId);
                if (decision.status !== 'ready') return;
                const passengerManifest = configuration && clerkUserId
                  ? queryClient.getQueryData<ProductionEmptyLegPassengerList>(
                    mainBluebirdAuthenticatedQueryKey(configuration.environment, clerkUserId, 'empty-leg-passengers', legId),
                  )
                  : undefined;
                const block = manifestActionBlock({
                  isWinner: true,
                  checklistAvailable: tripMatchesFlight(trip, legId),
                  manifestAvailable: !!passengerManifest && manifestMatchesFlight(
                    [...passengerManifest.passengers, ...passengerManifest.pets],
                    legId,
                  ),
                  manifestAckAt: trip.checklist.manifestAckAt,
                  manifestLocked: trip.checklist.manifestLocked,
                });
                Alert.alert(
                  'Acknowledge passengers?',
                  MANIFEST_ACK_DIALOG,
                  [
                    { text: 'Not yet', style: 'cancel' },
                    {
                      text: 'Acknowledge',
                      onPress: () => { void winnerActions.acknowledgeManifest(block); },
                    },
                  ],
                );
              }}
            />
            {!canAcknowledgeProductionManifest() && (
              <Text style={[styles.note, { color: colors.mutedForeground }]}>
                Passenger acknowledgement is not available in this build. No request is sent.
              </Text>
            )}
            {winnerActions.manifestFailure && (
              <Text testID="checklist-manifest-error" style={[styles.note, { color: colors.destructive }]}>
                {winnerActions.manifestFailure.title}. {winnerActions.manifestFailure.body}
              </Text>
            )}
          </>
        )}
        {trip.checklist.manifestLocked === true && !hasServerTime(trip.checklist.manifestAckAt) && (
          <Text testID="checklist-manifest-locked" style={[styles.note, { color: colors.mutedForeground }]}>
            This passenger manifest is locked.
          </Text>
        )}
        {winnerActions.manifestMessage && (
          <Text testID="checklist-manifest-acknowledged" style={[styles.note, { color: colors.foreground }]}>
            {winnerActions.manifestMessage}
          </Text>
        )}
      </View>
      <View testID="checklist-policy" style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={[styles.stepTitle, { color: colors.foreground }]}>Flight Policy</Text>
        <SecondaryButton
          label="Read flight policy"
          testID="checklist-open-policy"
          disabled={authTest}
          onPress={() => {
            if (authTest) return;
            router.push({ pathname: '/flight/policy-review', params: { legId: String(legId) } });
          }}
        />
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>
          {hasServerTime(trip.checklist.policyAckAt)
            ? 'Policy acknowledged.'
            : authTest
              ? POLICY_DOCUMENT_UNAVAILABLE_NOTE
              : canAcknowledgeProductionPolicy()
                ? 'Read the policy and agree.'
                : POLICY_UNAVAILABLE_NOTE}
        </Text>
        {!hasServerTime(trip.checklist.policyAckAt) && (
          <SecondaryButton
            label="Agree to flight policy"
            testID="checklist-policy-action"
            disabled={!canAcknowledgeProductionPolicy()}
            onPress={() => {
              const decision = reviewPolicyAcknowledgement(legId);
              if (decision.status !== 'ready') return;
              router.push({ pathname: '/flight/policy-review', params: { legId: String(legId) } });
            }}
          />
        )}
      </View>
      {boardingPassUrl && (
        <PrimaryButton
          label="Open boarding pass"
          testID="checklist-boarding-pass"
          onPress={() => { void Linking.openURL(boardingPassUrl); }}
        />
      )}
      {trip.checklist.awarded === true && !boardingPassUrl && (
        <Text testID="checklist-boarding-pass-missing" style={[styles.note, { color: colors.mutedForeground }]}>
          A boarding pass link is not available for this flight.
        </Text>
      )}
      {boardingPassUrl && !hasServerTime(trip.checklist.passLinkSentAt) && !winnerActions.boardingPassMessage && (
        <>
          <SecondaryButton
            label="Send boarding pass"
            testID="checklist-boarding-pass-send"
            disabled={!canSendProductionBoardingPass()}
            loading={winnerActions.boardingPassSubmitting}
            onPress={() => {
              if (!canSendProductionBoardingPass()) return;
              const block = boardingPassActionBlock({
                checklistAvailable: tripMatchesFlight(trip, legId),
                awarded: trip.checklist.awarded,
                boardingPassUrl: trip.checklist.boardingPassUrl,
                passLinkSentAt: trip.checklist.passLinkSentAt,
              });
              Alert.alert(
                'Send boarding pass?',
                BOARDING_PASS_SEND_DIALOG,
                [
                  { text: 'Not now', style: 'cancel' },
                  { text: 'Send', onPress: () => { void winnerActions.sendBoardingPass(block); } },
                ],
              );
            }}
          />
          {!canSendProductionBoardingPass() && (
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              Sending a boarding pass is not available in this build. No request is sent.
            </Text>
          )}
        </>
      )}
      {winnerActions.boardingPassFailure && (
        <Text testID="checklist-boarding-pass-error" style={[styles.note, { color: colors.destructive }]}>
          {winnerActions.boardingPassFailure.title}. {winnerActions.boardingPassFailure.body}
        </Text>
      )}
      {(winnerActions.boardingPassMessage || hasServerTime(trip.checklist.passLinkSentAt)) && (
        <Text testID="checklist-boarding-pass-recorded" style={[styles.note, { color: colors.foreground }]}>
          {winnerActions.boardingPassMessage ?? BOARDING_PASS_SENT}
        </Text>
      )}
    </ScrollView>
  );
}

function FboLine({
  label,
  name,
  address,
  colors,
}: {
  label: string;
  name: string | null;
  address: string | null;
  colors: ReturnType<typeof useColors>;
}) {
  if (!name?.trim() && !address?.trim()) return null;
  return (
    <View>
      <Text style={[styles.meta, { color: colors.foreground }]}>{label}</Text>
      {!!name?.trim() && <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={2}>{name.trim()}</Text>}
      {!!address?.trim() && <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={3}>{address.trim()}</Text>}
    </View>
  );
}

let checklistLeaving = false;

function backToTrips() {
  if (checklistLeaving) return;
  checklistLeaving = true;
  if (router.canGoBack()) router.back();
  else router.replace('/(tabs)/trips');
  setTimeout(() => {
    checklistLeaving = false;
  }, 600);
}

function Message({
  title,
  body,
  colors,
  actionLabel,
  onAction,
  buttonTestID = 'checklist-retry',
}: {
  title: string;
  body: string;
  colors: ReturnType<typeof useColors>;
  actionLabel?: string;
  onAction?: () => void;
  buttonTestID?: string;
}) {
  return (
    <View style={[styles.centered, { backgroundColor: colors.background }]} testID="checklist-message">
      <Text style={[styles.route, { color: colors.foreground, textAlign: 'center' }]}>{title}</Text>
      <Text style={[styles.meta, { color: colors.mutedForeground, textAlign: 'center' }]}>{body}</Text>
      {actionLabel && onAction ? (
        <SecondaryButton label={actionLabel} testID={buttonTestID} onPress={onAction} />
      ) : null}
    </View>
  );
}

function failureFor(error: unknown): { title: string; body: string } {
  if (error instanceof TripChecklistSessionError) return presentTripActionFailure(401);
  if (error instanceof TripChecklistMismatchError) {
    return {
      title: 'Trip unavailable',
      body: 'This checklist is not available for the signed-in account.',
    };
  }
  if (error instanceof ProductionAuthHttpError) return presentTripActionFailure(error.status);
  return presentTripActionFailure(null);
}

function hasFbo(trip: ProductionTrip): boolean {
  return [trip.leg.originFboName, trip.leg.originFboAddress, trip.leg.destinationFboName, trip.leg.destinationFboAddress]
    .some((value) => !!value?.trim());
}

function hasServerTime(value: string | null): boolean {
  return typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function formatWhen(value: string): string {
  return presentTripDeparture(value);
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 14, paddingBottom: 40 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  route: { fontFamily: 'Inter_700Bold', fontSize: 22, letterSpacing: -0.3 },
  status: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  progressBlock: { gap: 8 },
  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3 },
  card: { borderRadius: 18, padding: 16, gap: 8 },
  stepTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
  note: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  actions: { gap: 10 },
});
