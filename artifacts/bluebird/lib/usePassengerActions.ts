import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { createClerkProductionTokenProvider, type ClerkSessionSnapshot } from '@/lib/clerkProductionTokenProvider';
import { createMainBluebirdApiIntegration } from '@/lib/mainBluebirdApi';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import {
  applyPassengerMutationRefresh,
  passengerMutationRefreshKeys,
  submitPassengerCreate,
  submitPassengerDelete,
  submitPassengerUpdate,
  type PassengerWriteResult,
} from '@/lib/passengerMutations';
import {
  canCreateProductionPassenger,
  canDeleteProductionPassenger,
  canUpdateProductionPassenger,
  type PassengerFormValues,
} from '@/lib/passengerManifest';

export function usePassengerActions(flightId: number) {
  const queryClient = useQueryClient();
  const { authMode, clerkUserId } = useAuth();
  const session = useClerkAuthSnapshot();
  const sessionRef = React.useRef(session);
  sessionRef.current = session;
  const configuration = getMainBluebirdApiConfigurationOrNull();
  const inFlight = React.useRef(false);
  const [submitting, setSubmitting] = React.useState(false);

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

  const publish = React.useCallback((
    requestedUserId: string,
    gateOpen: boolean,
    result: PassengerWriteResult,
  ): PassengerWriteResult | null => {
    if (sessionRef.current?.userId !== requestedUserId && requestedUserId) return null;
    if ((result.status === 'saved' || result.status === 'removed') && configuration) {
      const keys = passengerMutationRefreshKeys({
        environment: configuration.environment,
        clerkUserId: requestedUserId,
        flightId,
      });
      if (keys && sessionRef.current?.userId === requestedUserId) {
        queryClient.setQueryData(keys.passengers, result.list);
      }
      applyPassengerMutationRefresh({
        gateOpen,
        requestedUserId,
        activeUserId: sessionRef.current?.userId ?? null,
        signedIn: sessionRef.current?.isSignedIn === true && sessionRef.current.userId === requestedUserId,
        environment: configuration.environment,
        flightId,
        invalidate: (key) => {
          void queryClient.invalidateQueries({ queryKey: key as readonly unknown[] });
        },
      });
    }
    return result;
  }, [configuration, flightId, queryClient]);

  const createPassenger = React.useCallback(async (input: {
    values: PassengerFormValues;
    editsLocked: boolean;
    passengerCount: number;
    guestCount: number;
    passengerCap: number;
  }) => {
    const requestedUserId = sessionRef.current?.userId ?? '';
    setSubmitting(true);
    try {
      const result = await submitPassengerCreate({
        gateOpen: canCreateProductionPassenger(),
        flightId,
        values: input.values,
        signedIn,
        editsLocked: input.editsLocked,
        passengerCount: input.passengerCount,
        guestCount: input.guestCount,
        passengerCap: input.passengerCap,
        inFlight,
        createClient: () => createClient(requestedUserId),
      });
      return publish(requestedUserId, canCreateProductionPassenger(), result);
    } finally {
      setSubmitting(false);
    }
  }, [createClient, flightId, publish, signedIn]);

  const updatePassenger = React.useCallback(async (input: {
    passengerId: number;
    values: PassengerFormValues;
    editsLocked: boolean;
    passengerPresent: boolean;
  }) => {
    const requestedUserId = sessionRef.current?.userId ?? '';
    setSubmitting(true);
    try {
      const result = await submitPassengerUpdate({
        gateOpen: canUpdateProductionPassenger(),
        flightId,
        passengerId: input.passengerId,
        values: input.values,
        signedIn,
        editsLocked: input.editsLocked,
        passengerPresent: input.passengerPresent,
        inFlight,
        createClient: () => createClient(requestedUserId),
      });
      return publish(requestedUserId, canUpdateProductionPassenger(), result);
    } finally {
      setSubmitting(false);
    }
  }, [createClient, flightId, publish, signedIn]);

  const deletePassenger = React.useCallback(async (input: {
    passengerId: number;
    isAccountHolder: boolean;
    editsLocked: boolean;
    passengerPresent: boolean;
  }) => {
    const requestedUserId = sessionRef.current?.userId ?? '';
    setSubmitting(true);
    try {
      const result = await submitPassengerDelete({
        gateOpen: canDeleteProductionPassenger(),
        flightId,
        passengerId: input.passengerId,
        isAccountHolder: input.isAccountHolder,
        explicitConfirm: true,
        signedIn,
        editsLocked: input.editsLocked,
        passengerPresent: input.passengerPresent,
        inFlight,
        createClient: () => createClient(requestedUserId),
      });
      return publish(requestedUserId, canDeleteProductionPassenger(), result);
    } finally {
      setSubmitting(false);
    }
  }, [createClient, flightId, publish, signedIn]);

  return { submitting, createPassenger, updatePassenger, deletePassenger };
}
