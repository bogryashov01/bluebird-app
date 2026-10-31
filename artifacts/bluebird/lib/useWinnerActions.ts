import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { createClerkProductionTokenProvider, type ClerkSessionSnapshot } from '@/lib/clerkProductionTokenProvider';
import { createMainBluebirdApiIntegration, mainBluebirdAuthenticatedQueryKey } from '@/lib/mainBluebirdApi';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import {
  applyWinnerMutationRefresh,
  submitBoardingPassSend,
  submitFboVerification,
  submitManifestAcknowledgement,
  submitPolicyAcknowledgement,
  submitWinnerConfirmation,
  submitWinnerDecline,
  winnerMutationRefreshKeys,
} from '@/lib/winnerMutations';
import {
  canAcknowledgeProductionManifest,
  canAcknowledgeProductionPolicy,
  canConfirmProductionWinner,
  canDeclineProductionWinner,
  canVerifyProductionFbo,
  canSendProductionBoardingPass,
  BOARDING_PASS_SENT,
  FBO_VERIFIED,
  MANIFEST_ACKNOWLEDGED,
  POLICY_ACKNOWLEDGED,
  POLICY_CONSENT_REQUIRED,
  WINNER_CONFIRMED,
  WINNER_DECLINED,
  type BoardingPassActionBlock,
  type FboActionBlock,
  type ManifestActionBlock,
  type PolicyActionBlock,
  type TripActionFailure,
  type WinnerActionBlock,
} from '@/lib/winnerChecklist';

export function useWinnerActions(legId: number) {
  const queryClient = useQueryClient();
  const { authMode, clerkUserId } = useAuth();
  const session = useClerkAuthSnapshot();
  const sessionRef = React.useRef(session);
  sessionRef.current = session;
  const configuration = getMainBluebirdApiConfigurationOrNull();
  const inFlight = React.useRef(false);
  const fboInFlight = React.useRef(false);
  const manifestInFlight = React.useRef(false);
  const policyInFlight = React.useRef(false);
  const boardingPassInFlight = React.useRef(false);
  const legRef = React.useRef(legId);
  legRef.current = legId;
  const [submitting, setSubmitting] = React.useState(false);
  const [failure, setFailure] = React.useState<TripActionFailure | null>(null);
  const [confirmedMessage, setConfirmedMessage] = React.useState<string | null>(null);
  const [declinedMessage, setDeclinedMessage] = React.useState<string | null>(null);
  const [fboSubmitting, setFboSubmitting] = React.useState(false);
  const [fboFailure, setFboFailure] = React.useState<TripActionFailure | null>(null);
  const [fboMessage, setFboMessage] = React.useState<string | null>(null);
  const [manifestSubmitting, setManifestSubmitting] = React.useState(false);
  const [manifestFailure, setManifestFailure] = React.useState<TripActionFailure | null>(null);
  const [manifestMessage, setManifestMessage] = React.useState<string | null>(null);
  const [policySubmitting, setPolicySubmitting] = React.useState(false);
  const [policyFailure, setPolicyFailure] = React.useState<TripActionFailure | null>(null);
  const [policyMessage, setPolicyMessage] = React.useState<string | null>(null);
  const [policyResultScope, setPolicyResultScope] = React.useState<string | null>(null);
  const [boardingPassSubmitting, setBoardingPassSubmitting] = React.useState(false);
  const [boardingPassFailure, setBoardingPassFailure] = React.useState<TripActionFailure | null>(null);
  const [boardingPassMessage, setBoardingPassMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    setFailure(null);
    setConfirmedMessage(null);
    setDeclinedMessage(null);
    setFboFailure(null);
    setFboMessage(null);
    setManifestFailure(null);
    setManifestMessage(null);
    setPolicyFailure(null);
    setPolicyMessage(null);
    setPolicyResultScope(null);
    setBoardingPassFailure(null);
    setBoardingPassMessage(null);
  }, [clerkUserId]);

  React.useEffect(() => {
    setPolicyFailure(null);
    setPolicyMessage(null);
    setPolicyResultScope(null);
    setBoardingPassFailure(null);
    setBoardingPassMessage(null);
  }, [legId]);

  const signedIn = authMode === 'clerk' &&
    session?.isLoaded === true &&
    session.isSignedIn === true &&
    typeof session.userId === 'string' &&
    session.userId.trim().length > 0 &&
    session.userId === clerkUserId;

  const createClient = React.useCallback((requestedUserId: string) => {
    if (!configuration) throw new Error('The Main API is not configured.');
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
    return createMainBluebirdApiIntegration({ configuration, tokenProvider }).authenticated;
  }, [configuration]);

  const refresh = React.useCallback((requestedUserId: string, gateOpen: boolean) => {
    if (!configuration) return;
    const active = sessionRef.current;
    applyWinnerMutationRefresh({
      gateOpen,
      requestedUserId,
      activeUserId: active?.userId ?? null,
      signedIn: active?.isSignedIn === true && active.userId === requestedUserId,
      environment: configuration.environment,
      legId,
      invalidate: (key) => {
        void queryClient.invalidateQueries({ queryKey: key as readonly unknown[] });
      },
    });
  }, [configuration, legId, queryClient]);

  const confirm = React.useCallback(async (block: WinnerActionBlock | null) => {
    const requestedUserId = sessionRef.current?.userId ?? '';
    setSubmitting(true);
    try {
      const result = await submitWinnerConfirmation({
        gateOpen: canConfirmProductionWinner(),
        legId,
        signedIn,
        block,
        inFlight,
        createClient: () => createClient(requestedUserId),
      });
      if (sessionRef.current?.userId !== requestedUserId && requestedUserId) return;
      if (result.status === 'confirmed') {
        setFailure(null);
        setDeclinedMessage(null);
        setConfirmedMessage(WINNER_CONFIRMED);
        refresh(requestedUserId, canConfirmProductionWinner());
        return;
      }
      if (result.status === 'failed' || result.status === 'duplicate') {
        setConfirmedMessage(null);
        setFailure(result.failure);
      }
    } finally {
      setSubmitting(false);
    }
  }, [createClient, legId, refresh, signedIn]);

  const decline = React.useCallback(async (block: WinnerActionBlock | null) => {
    const requestedUserId = sessionRef.current?.userId ?? '';
    setSubmitting(true);
    try {
      const result = await submitWinnerDecline({
        gateOpen: canDeclineProductionWinner(),
        flightId: legId,
        explicitConfirm: true,
        signedIn,
        block,
        inFlight,
        createClient: () => createClient(requestedUserId),
      });
      if (sessionRef.current?.userId !== requestedUserId && requestedUserId) return;
      if (result.status === 'declined') {
        setFailure(null);
        setConfirmedMessage(null);
        setDeclinedMessage(WINNER_DECLINED);
        refresh(requestedUserId, canDeclineProductionWinner());
        return;
      }
      if (result.status === 'failed' || result.status === 'duplicate') {
        setDeclinedMessage(null);
        setFailure(result.failure);
      }
    } finally {
      setSubmitting(false);
    }
  }, [createClient, legId, refresh, signedIn]);

  const verifyFbo = React.useCallback(async (block: FboActionBlock | null) => {
    const requestedUserId = sessionRef.current?.userId ?? '';
    setFboSubmitting(true);
    try {
      const result = await submitFboVerification({
        gateOpen: canVerifyProductionFbo(),
        legId,
        explicitConfirm: true,
        signedIn,
        block,
        inFlight: fboInFlight,
        createClient: () => createClient(requestedUserId),
      });
      if (sessionRef.current?.userId !== requestedUserId && requestedUserId) return;
      if (result.status === 'verified') {
        setFboFailure(null);
        setFboMessage(FBO_VERIFIED);
        if (configuration) {
          const keys = winnerMutationRefreshKeys({
            environment: configuration.environment,
            clerkUserId: requestedUserId,
            legId,
          });
          if (keys && sessionRef.current?.userId === requestedUserId) {
            queryClient.setQueryData(keys.trip, result.trip);
          }
        }
        refresh(requestedUserId, canVerifyProductionFbo());
        return;
      }
      if (result.status === 'failed' || result.status === 'duplicate') {
        setFboMessage(null);
        setFboFailure(result.failure);
      }
    } finally {
      setFboSubmitting(false);
    }
  }, [configuration, createClient, legId, queryClient, refresh, signedIn]);

  const acknowledgeManifest = React.useCallback(async (block: ManifestActionBlock | null) => {
    const requestedUserId = sessionRef.current?.userId ?? '';
    setManifestSubmitting(true);
    try {
      const result = await submitManifestAcknowledgement({
        gateOpen: canAcknowledgeProductionManifest(),
        legId,
        explicitConfirm: true,
        signedIn,
        block,
        inFlight: manifestInFlight,
        createClient: () => createClient(requestedUserId),
      });
      if (sessionRef.current?.userId !== requestedUserId && requestedUserId) return;
      if (result.status === 'acknowledged') {
        setManifestFailure(null);
        setManifestMessage(MANIFEST_ACKNOWLEDGED);
        if (configuration && sessionRef.current?.userId === requestedUserId) {
          const keys = winnerMutationRefreshKeys({
            environment: configuration.environment,
            clerkUserId: requestedUserId,
            legId,
          });
          if (keys) queryClient.setQueryData(keys.trip, result.trip);
          void queryClient.invalidateQueries({
            queryKey: mainBluebirdAuthenticatedQueryKey(
              configuration.environment,
              requestedUserId,
              'empty-leg-passengers',
              legId,
            ),
          });
        }
        refresh(requestedUserId, canAcknowledgeProductionManifest());
        return;
      }
      if (result.status === 'failed' || result.status === 'duplicate') {
        setManifestMessage(null);
        setManifestFailure(result.failure);
      }
    } finally {
      setManifestSubmitting(false);
    }
  }, [configuration, createClient, legId, queryClient, refresh, signedIn]);

  const acknowledgePolicy = React.useCallback(async (
    block: PolicyActionBlock | null,
    consent: boolean,
    reviewScope: { current: string | null },
  ) => {
    const requestedUserId = sessionRef.current?.userId ?? '';
    const requestedLegId = legRef.current;
    const requestedScope = reviewScope.current;
    setPolicySubmitting(true);
    try {
      const result = await submitPolicyAcknowledgement({
        gateOpen: canAcknowledgeProductionPolicy(),
        legId: requestedLegId,
        explicitConfirm: consent === true,
        signedIn,
        block,
        inFlight: policyInFlight,
        createClient: () => createClient(requestedUserId),
      });
      if (sessionRef.current?.userId !== requestedUserId && requestedUserId) return;
      if (legRef.current !== requestedLegId) return;
      if (reviewScope.current !== requestedScope) return;
      if (result.status === 'policy-acknowledged') {
        setPolicyFailure(null);
        setPolicyMessage(POLICY_ACKNOWLEDGED);
        setPolicyResultScope(requestedScope);
        if (configuration && sessionRef.current?.userId === requestedUserId) {
          const keys = winnerMutationRefreshKeys({
            environment: configuration.environment,
            clerkUserId: requestedUserId,
            legId: requestedLegId,
          });
          if (keys) queryClient.setQueryData(keys.trip, result.trip);
        }
        refresh(requestedUserId, canAcknowledgeProductionPolicy());
        return;
      }
      if (result.status === 'needs-confirmation') {
        setPolicyMessage(null);
        setPolicyFailure({ title: 'Agreement required', body: POLICY_CONSENT_REQUIRED });
        setPolicyResultScope(requestedScope);
        return;
      }
      if (result.status === 'failed' || result.status === 'duplicate') {
        setPolicyMessage(null);
        setPolicyFailure(result.failure);
        setPolicyResultScope(requestedScope);
      }
    } finally {
      setPolicySubmitting(false);
    }
  }, [configuration, createClient, queryClient, refresh, signedIn]);

  const sendBoardingPass = React.useCallback(async (block: BoardingPassActionBlock | null) => {
    const requestedUserId = sessionRef.current?.userId ?? '';
    const requestedLegId = legRef.current;
    setBoardingPassSubmitting(true);
    try {
      const result = await submitBoardingPassSend({
        gateOpen: canSendProductionBoardingPass(),
        legId: requestedLegId,
        explicitConfirm: true,
        signedIn,
        block,
        inFlight: boardingPassInFlight,
        createClient: () => createClient(requestedUserId),
      });
      if (sessionRef.current?.userId !== requestedUserId && requestedUserId) return;
      if (legRef.current !== requestedLegId) return;
      if (result.status === 'pass-recorded') {
        setBoardingPassFailure(null);
        setBoardingPassMessage(BOARDING_PASS_SENT);
        if (configuration && sessionRef.current?.userId === requestedUserId) {
          const keys = winnerMutationRefreshKeys({
            environment: configuration.environment,
            clerkUserId: requestedUserId,
            legId: requestedLegId,
          });
          if (keys) queryClient.setQueryData(keys.trip, result.trip);
        }
        refresh(requestedUserId, canSendProductionBoardingPass());
        return;
      }
      if (result.status === 'failed' || result.status === 'duplicate') {
        setBoardingPassMessage(null);
        setBoardingPassFailure(result.failure);
      }
    } finally {
      setBoardingPassSubmitting(false);
    }
  }, [configuration, createClient, queryClient, refresh, signedIn]);

  return {
    submitting,
    failure,
    confirmedMessage,
    declinedMessage,
    confirm,
    decline,
    fboSubmitting,
    fboFailure,
    fboMessage,
    verifyFbo,
    manifestSubmitting,
    manifestFailure,
    manifestMessage,
    acknowledgeManifest,
    policySubmitting,
    policyFailure,
    policyMessage,
    policyResultScope,
    acknowledgePolicy,
    boardingPassSubmitting,
    boardingPassFailure,
    boardingPassMessage,
    sendBoardingPass,
  };
}
