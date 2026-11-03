import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { confirmDialog } from '@/lib/confirmDialog';
import { markCurrentWinnerCelebration } from '@/lib/currentWinnerCelebration';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { createClerkProductionTokenProvider, type ClerkSessionSnapshot } from '@/lib/clerkProductionTokenProvider';
import { createMainBluebirdApiIntegration } from '@/lib/mainBluebirdApi';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import {
  applyQueueMutationRefresh,
  canSubmitProductionQueueJoin,
  queueJoinSuccessModel,
  QUEUE_LEFT_CONFIRMED,
  QUEUE_SKIP_CONFIRMED,
  type JoinFlightFailure,
  type QueueJoinConsent,
  type QueueJoinSuccessModel,
} from '@/lib/joinFlightPresentation';
import {
  submitProductionQueueJoin,
  submitProductionQueueLeave,
  submitProductionQueueSkipLine,
} from '@/lib/productionQueueMutations';

export function useProductionQueueMutation(
  flightId: number,
  internationalPassRequired: boolean | null,
) {
  const queryClient = useQueryClient();
  const { authMode, clerkUserId } = useAuth();
  const session = useClerkAuthSnapshot();
  const sessionRef = React.useRef(session);
  sessionRef.current = session;
  const configuration = getMainBluebirdApiConfigurationOrNull();
  const inFlight = React.useRef(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [failure, setFailure] = React.useState<JoinFlightFailure | null>(null);
  const [success, setSuccess] = React.useState<QueueJoinSuccessModel | null>(null);
  const [leftMessage, setLeftMessage] = React.useState<string | null>(null);
  const [skipMessage, setSkipMessage] = React.useState<string | null>(null);
  const [skipFailure, setSkipFailure] = React.useState<JoinFlightFailure | null>(null);

  React.useEffect(() => {
    setFailure(null);
    setSuccess(null);
    setLeftMessage(null);
    setSkipMessage(null);
    setSkipFailure(null);
  }, [clerkUserId]);

  const signedIn = authMode === 'clerk' &&
    session?.isLoaded === true &&
    session.isSignedIn === true &&
    typeof session.userId === 'string' &&
    session.userId.trim().length > 0 &&
    session.userId === clerkUserId;

  const createClient = React.useCallback((requestedUserId: string) => {
    if (!configuration) {
      throw new Error('The Main API is not configured.');
    }
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
    return createMainBluebirdApiIntegration({
      configuration,
      tokenProvider,
    }).authenticated;
  }, [configuration]);

  const refresh = React.useCallback((requestedUserId: string) => {
    if (!configuration) return;
    const active = sessionRef.current;
    applyQueueMutationRefresh({
      gateOpen: canSubmitProductionQueueJoin(),
      requestedUserId,
      activeUserId: active?.userId ?? null,
      signedIn: active?.isSignedIn === true && active.userId === requestedUserId,
      environment: configuration.environment,
      flightId,
      invalidate: (key) => {
        void queryClient.invalidateQueries({ queryKey: key as readonly unknown[] });
      },
    });
  }, [configuration, flightId, queryClient]);

  const join = React.useCallback(async (consent: QueueJoinConsent, creditConfirmed = false) => {
    const requestedUserId = sessionRef.current?.userId ?? '';
    setSubmitting(true);
    try {
      const result = await submitProductionQueueJoin({
        gateOpen: canSubmitProductionQueueJoin(),
        flightId,
        consent,
        creditConfirmed,
        internationalPassRequired,
        signedIn,
        inFlight,
        createClient: () => createClient(requestedUserId),
      });
      if (sessionRef.current?.userId !== requestedUserId && requestedUserId) return;
      if (result.status === 'joined') {
        const model = queueJoinSuccessModel(flightId, result.entry);
        if (!model) {
          setSuccess(null);
          setFailure({
            status: null,
            code: 'invalid_transition',
            title: 'Queue not confirmed',
            body: 'Bluebird did not confirm a queue position. No position was saved on this device.',
            conflict: null,
            keepsExistingQueue: false,
          });
          return;
        }
        setFailure(null);
        setLeftMessage(null);
        setSuccess(model);
        refresh(requestedUserId);
        return;
      }
      if (result.status === 'failed' || result.status === 'duplicate') {
        setSuccess(null);
        setFailure(result.failure);
      }
    } finally {
      setSubmitting(false);
    }
  }, [createClient, flightId, internationalPassRequired, refresh, signedIn]);

  const leave = React.useCallback(async () => {
    if (!canSubmitProductionQueueJoin()) return;
    const confirmed = await confirmDialog(
      'Leave Queue?',
      'You will lose your position in the queue.',
      'Leave Queue',
      true,
    );
    if (!confirmed) return;
    const requestedUserId = sessionRef.current?.userId ?? '';
    setSubmitting(true);
    try {
      const result = await submitProductionQueueLeave({
        gateOpen: canSubmitProductionQueueJoin(),
        flightId,
        explicitConfirm: true,
        signedIn,
        inFlight,
        createClient: () => createClient(requestedUserId),
      });
      if (sessionRef.current?.userId !== requestedUserId && requestedUserId) return;
      if (result.status === 'left') {
        setSuccess(null);
        setFailure(null);
        setLeftMessage(QUEUE_LEFT_CONFIRMED);
        setSkipMessage(null);
        setSkipFailure(null);
        refresh(requestedUserId);
        return;
      }
      if (result.status === 'failed' || result.status === 'duplicate') {
        setLeftMessage(null);
        setFailure(result.failure);
      }
    } finally {
      setSubmitting(false);
    }
  }, [createClient, flightId, refresh, signedIn]);

  const skip = React.useCallback(async (existingCreditCount: number) => {
    if (!canSubmitProductionQueueJoin()) return;
    if (!Number.isSafeInteger(existingCreditCount) || existingCreditCount < 1) return;
    const confirmed = await confirmDialog(
      'Use 1 Skip the Line Pass?',
      'This uses one existing pass for this flight. Bluebird confirms the pass by making you the current winner. It does not award the flight, confirm the seat, or only change your queue number.',
      'Use Pass',
    );
    if (!confirmed) return;
    const requestedUserId = sessionRef.current?.userId ?? '';
    setSubmitting(true);
    try {
      const result = await submitProductionQueueSkipLine({
        gateOpen: canSubmitProductionQueueJoin(),
        flightId,
        explicitConfirm: true,
        existingCreditCount,
        signedIn,
        inFlight,
        createClient: () => createClient(requestedUserId),
      });
      if (sessionRef.current?.userId !== requestedUserId && requestedUserId) return;
      if (result.status === 'applied') {
        const closing = result.flight.queueClosesAt;
        markCurrentWinnerCelebration({
          clerkUserId: requestedUserId,
          flightId: result.flight.id,
          queueClosesAt: typeof closing === 'string' && closing.trim() ? closing : null,
          viewerIsEffectiveWinner: result.flight.viewerIsEffectiveWinner === true,
        });
        setFailure(null);
        setSkipFailure(null);
        setLeftMessage(null);
        setSkipMessage(QUEUE_SKIP_CONFIRMED);
        refresh(requestedUserId);
        return;
      }
      if (result.status === 'failed' || result.status === 'duplicate') {
        setSkipMessage(null);
        setSkipFailure(result.failure);
      }
    } finally {
      setSubmitting(false);
    }
  }, [createClient, flightId, refresh, signedIn]);

  return { submitting, failure, success, leftMessage, skipMessage, skipFailure, join, leave, skip };
}
