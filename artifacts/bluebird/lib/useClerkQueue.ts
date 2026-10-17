import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import {
  createMainBluebirdApiIntegration,
  mainBluebirdAuthenticatedQueryKey,
} from '@/lib/mainBluebirdApi';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import {
  getProductionQueueVerificationBlockers,
  isProductionQueueVerified,
} from '@/lib/productionQueueReadiness';
import type {
  JoinProductionQueueRequest,
} from '@/lib/productionAuthApi';
import { createProductionQueueActions } from '@/lib/productionQueue';

const validFlightId = (id: number | null | undefined): id is number =>
  typeof id === 'number' && Number.isSafeInteger(id) && id > 0;

function useClerkQueueApi() {
  const session = useClerkAuthSnapshot();
  const sessionRef = React.useRef(session);
  sessionRef.current = session;
  const configuration = getMainBluebirdApiConfigurationOrNull();
  const authenticated = session?.isLoaded === true &&
    session.isSignedIn === true &&
    typeof session.userId === 'string' &&
    !!session.userId.trim();
  const queueVerified = isProductionQueueVerified();
  const ready = !!configuration &&
    queueVerified &&
    authenticated;

  const createApi = () => {
    if (!configuration || !queueVerified || !authenticated || !session?.userId) {
      const blockers = getProductionQueueVerificationBlockers();
      if (blockers.length > 0) {
        throw new Error(`Production queue is disabled: ${blockers.join('; ')}.`);
      }
      throw new Error('A signed-in Clerk session and matching Main API configuration are required.');
    }
    const requestedClerkUserId = session.userId;
    const api = createMainBluebirdApiIntegration({
      configuration,
      tokenProvider: {
        environment: configuration.environment,
        getVerifiedAccessToken: async () => {
          const activeSession = sessionRef.current;
          if (
            !activeSession ||
            activeSession.isLoaded !== true ||
            activeSession.isSignedIn !== true ||
            activeSession.userId !== requestedClerkUserId
          ) return null;
          return activeSession.getToken();
        },
      },
    });
    return api;
  };

  return {
    actions: () => createProductionQueueActions(createApi().authenticated),
    loadEligibility: async (signal?: AbortSignal) => {
      const api = createApi().authenticated;
      const [currentUser, membership] = await Promise.all([
        api.getMe({ signal }),
        api.getMembership({ signal }),
      ]);
      return {
        profileComplete: currentUser.isProfileComplete,
        activeMember: currentUser.isMember && membership.isMember && membership.status === 'active',
      };
    },
    environment: configuration?.environment ?? null,
    ready,
    authenticated,
    queueVerified,
    userId: session?.userId ?? null,
  };
}

function queueKey(environment: 'development' | 'production', userId: string, emptyLegId: number) {
  return mainBluebirdAuthenticatedQueryKey(environment, userId, 'queue', emptyLegId);
}

export type ClerkQueueAvailability =
  | 'ready'
  | 'configuration-required'
  | 'authentication-required'
  | 'verification-required'
  | 'invalid-flight-id';

function getAvailability(
  environment: 'development' | 'production' | null,
  authenticated: boolean,
  queueVerified: boolean,
  emptyLegId: number | null | undefined,
): ClerkQueueAvailability {
  if (!validFlightId(emptyLegId)) return 'invalid-flight-id';
  if (!environment) return 'configuration-required';
  if (!queueVerified) return 'verification-required';
  if (!authenticated) return 'authentication-required';
  return 'ready';
}

export function useClerkFlightQueue(
  emptyLegId: number | null | undefined,
  options: { enabled?: boolean; pollIntervalMs?: number } = {},
) {
  const context = useClerkQueueApi();
  const availability = getAvailability(
    context.environment,
    context.authenticated,
    context.queueVerified,
    emptyLegId,
  );
  const query = useQuery({
    queryKey: context.environment && context.userId && validFlightId(emptyLegId)
      ? queueKey(context.environment, context.userId, emptyLegId)
      : ['main-bluebird-api', context.environment ?? 'unconfigured', context.userId ?? 'signed-out', 'queue', emptyLegId ?? 'invalid'],
    enabled: availability === 'ready' && options.enabled !== false,
    retry: false,
    refetchInterval: options.pollIntervalMs ?? 10_000,
    queryFn: async ({ signal }) => {
      if (!validFlightId(emptyLegId)) throw new Error('A valid flight ID is required to read its queue.');
      const actions = context.actions();
      return actions.read(emptyLegId, { signal });
    },
  });

  return { ...query, availability };
}

export function useClerkQueueEligibility() {
  const context = useClerkQueueApi();
  const query = useQuery({
    queryKey: context.environment && context.userId
      ? ['main-bluebird-api', context.environment, context.userId, 'queue-eligibility']
      : ['main-bluebird-api', context.environment ?? 'unconfigured', context.userId ?? 'signed-out', 'queue-eligibility'],
    enabled: context.ready,
    retry: false,
    queryFn: ({ signal }) => context.loadEligibility(signal),
  });
  return query;
}

export function useJoinClerkFlightQueue(
  emptyLegId: number | null | undefined,
  request?: JoinProductionQueueRequest,
) {
  const context = useClerkQueueApi();
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async () => {
      if (!validFlightId(emptyLegId)) throw new Error('A valid flight ID is required to join its queue.');
      return context.actions().join(emptyLegId, request);
    },
    onSuccess: async () => {
      if (context.environment && context.userId && validFlightId(emptyLegId)) {
        await queryClient.invalidateQueries({ queryKey: queueKey(context.environment, context.userId, emptyLegId) });
      }
    },
  });
}

export function useLeaveClerkFlightQueue(emptyLegId: number | null | undefined) {
  const context = useClerkQueueApi();
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async () => {
      if (!validFlightId(emptyLegId)) throw new Error('A valid flight ID is required to leave its queue.');
      return context.actions().leave(emptyLegId);
    },
    onSuccess: async () => {
      if (context.environment && context.userId && validFlightId(emptyLegId)) {
        await queryClient.invalidateQueries({ queryKey: queueKey(context.environment, context.userId, emptyLegId) });
      }
    },
  });
}

export function useSkipClerkFlightLine(
  emptyLegId: number | null | undefined,
  existingCreditCount: number,
) {
  const context = useClerkQueueApi();
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (confirmed: boolean) => {
      if (!validFlightId(emptyLegId)) throw new Error('A valid flight ID is required to skip this flight’s queue.');
      return context.actions().skipLine(emptyLegId, existingCreditCount, confirmed);
    },
    onSuccess: async () => {
      if (context.environment && context.userId && validFlightId(emptyLegId)) {
        await queryClient.invalidateQueries({ queryKey: queueKey(context.environment, context.userId, emptyLegId) });
      }
    },
  });
}
