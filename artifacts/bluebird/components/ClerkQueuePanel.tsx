import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { PrimaryButton, SecondaryButton } from '@/components/PrimaryButton';
import {
  useClerkFlightQueue,
  useClerkQueueEligibility,
  useJoinClerkFlightQueue,
  useLeaveClerkFlightQueue,
  useSkipClerkFlightLine,
  type ClerkQueueAvailability,
} from '@/lib/useClerkQueue';
import type { ProductionAuthRequestError } from '@/lib/productionAuthApi';
import { confirmDialog } from '@/lib/confirmDialog';
import { getProductionQueueReadOnlyMessage } from '@/lib/productionQueueReadiness';
import { canJoinProductionQueue, canStartQueueJoin } from '@/lib/queueJoinGuards';

export interface ClerkQueuePanelProps {
  emptyLegId: number;
  existingSkipLineCredits: number;
  flightStatus: string | null;
}

function availabilityMessage(availability: ClerkQueueAvailability): string | null {
  if (availability === 'configuration-required') {
    return 'The matching Main API and Clerk environment is not configured.';
  }
  if (availability === 'authentication-required') {
    return 'Sign in with Clerk to load this flight’s queue.';
  }
  if (availability === 'verification-required') return getProductionQueueReadOnlyMessage();
  if (availability === 'invalid-flight-id') return 'This flight does not have a valid Main API ID.';
  return null;
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number') {
    const status = (error as ProductionAuthRequestError & { status: number }).status;
    if (status === 401) return 'The Main API rejected the Clerk session (HTTP 401). Sign in again before retrying.';
    if (status === 403) return 'The Main API denied this queue action (HTTP 403).';
    if (status === 404) return 'This queue endpoint is unavailable on the selected Main API (HTTP 404).';
    if (status === 409) return 'The queue changed before this action completed (HTTP 409). Refresh the queue and try again.';
    return `The Main API queue request failed (HTTP ${status}).`;
  }
  return error instanceof Error ? error.message : 'The Main API queue request failed.';
}

export function ClerkQueuePanel({
  emptyLegId,
  existingSkipLineCredits,
  flightStatus,
}: ClerkQueuePanelProps) {
  const colors = useColors();
  const queue = useClerkFlightQueue(emptyLegId);
  const eligibility = useClerkQueueEligibility();
  const join = useJoinClerkFlightQueue(emptyLegId);
  const leave = useLeaveClerkFlightQueue(emptyLegId);
  const skip = useSkipClerkFlightLine(emptyLegId, existingSkipLineCredits);
  const [actionError, setActionError] = useState<string | null>(null);
  const [skipConfirmationPending, setSkipConfirmationPending] = useState(false);
  const joinLock = useRef(false);
  const busy = join.isPending || leave.isPending || skip.isPending || skipConfirmationPending;
  const unavailable = availabilityMessage(queue.availability);
  const flightPublished = flightStatus === 'published';
  const mayJoin = canJoinProductionQueue({
    isAlreadyInQueue: queue.data?.viewer.status === 'in-queue',
    flightPublished,
    profileComplete: eligibility.data?.profileComplete === true,
    activeMember: eligibility.data?.activeMember === true,
  });

  const runAction = async (action: () => Promise<unknown>) => {
    join.reset();
    leave.reset();
    skip.reset();
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  const confirmAndSkip = async () => {
    if (busy) return;
    setSkipConfirmationPending(true);
    try {
      const confirmed = await confirmDialog(
        'Use a Skip the Line credit?',
        'This will use one existing credit for this flight. This action cannot be undone.',
        'Use Credit',
      );
      if (confirmed) await runAction(() => skip.mutateAsync(true));
    } finally {
      setSkipConfirmationPending(false);
    }
  };
  const joinQueue = async () => {
    if (!canStartQueueJoin(joinLock.current, busy)) return;
    joinLock.current = true;
    try {
      await runAction(() => join.mutateAsync());
    } finally {
      joinLock.current = false;
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <Text style={[styles.title, { color: colors.textOnSurface }]}>Flight queue</Text>

      {skip.isSuccess ? (
        <Text style={[styles.body, { color: colors.success }]}>
          Skip the Line was confirmed by the Main API.
        </Text>
      ) : leave.isSuccess ? (
        <Text style={[styles.body, { color: colors.success }]}>
          The Main API confirmed that you left this queue.
        </Text>
      ) : unavailable ? (
        <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>{unavailable}</Text>
      ) : queue.isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>Loading queue…</Text>
        </View>
      ) : queue.isError ? (
        <View style={styles.content}>
          <Text style={[styles.body, { color: colors.coral }]}>{errorMessage(queue.error)}</Text>
          <SecondaryButton
            label="Try Again"
            onPress={() => void queue.refetch()}
            backgroundColor={colors.primary}
            textColor={colors.primaryForeground}
            testID="clerk-queue-retry"
          />
        </View>
      ) : queue.data?.viewer.status === 'in-queue' ? (
        <View style={styles.content}>
          <Text style={[styles.position, { color: colors.primary }]}>
            #{queue.data.viewer.position}
          </Text>
          <Text testID="clerk-queue-position" style={[styles.body, { color: colors.mutedForegroundLight }]}>
            {join.isSuccess
              ? `Joined at position #${join.data.position}.`
              : 'Your queue position'}
          </Text>
          {!!actionError && <Text style={[styles.body, { color: colors.coral }]}>{actionError}</Text>}
          <SecondaryButton
            label="Leave Queue"
            onPress={() => void runAction(() => leave.mutateAsync())}
            disabled={busy}
            testID="clerk-queue-leave"
          />
          {Number.isSafeInteger(existingSkipLineCredits) && existingSkipLineCredits > 0 && (
            <PrimaryButton
              label={`Skip the Line — Use Credit (${existingSkipLineCredits})`}
              onPress={() => void confirmAndSkip()}
              loading={skip.isPending || skipConfirmationPending}
              disabled={busy}
              testID="clerk-queue-skip-line"
            />
          )}
          {skip.isSuccess && (
            <Text style={[styles.body, { color: colors.success }]}>
              Skip the Line was confirmed by the Main API.
            </Text>
          )}
        </View>
      ) : queue.data ? (
        <View style={styles.content}>
          <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>
            {queue.data.entries.length === 0
              ? 'No one is currently waiting for this flight.'
              : `${queue.data.entries.length} ${queue.data.entries.length === 1 ? 'person' : 'people'} waiting`}
          </Text>
          {!!actionError && <Text style={[styles.body, { color: colors.coral }]}>{actionError}</Text>}
          {eligibility.isLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} size="small" />
              <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>Checking membership and profile…</Text>
            </View>
          ) : eligibility.isError ? (
            <View style={styles.content}>
              <Text style={[styles.body, { color: colors.coral }]}>
                We could not verify your membership and profile. No join request was sent.
              </Text>
              <SecondaryButton label="Try Again" onPress={() => void eligibility.refetch()} testID="clerk-queue-eligibility-retry" />
            </View>
          ) : !flightPublished ? (
            <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>
              This flight is not published for queue requests.
            </Text>
          ) : !eligibility.data?.profileComplete ? (
            <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>
              Complete your profile before joining a queue.
            </Text>
          ) : !eligibility.data?.activeMember ? (
            <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>
              An active Bluebird membership is required to join this queue.
            </Text>
          ) : null}
          {!join.isSuccess && (
            <PrimaryButton
              label="Join Queue"
              onPress={() => void joinQueue()}
              loading={join.isPending}
              disabled={busy || eligibility.isLoading || eligibility.isError || !mayJoin}
              testID="clerk-queue-join"
            />
          )}
          {join.isSuccess && (
            <Text style={[styles.body, { color: colors.success }]}>
              Joined at position #{join.data.position}.
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    borderRadius: 18,
    padding: 18,
    gap: 12,
  },
  title: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  content: { gap: 10, alignItems: 'flex-start' },
  loading: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  position: { fontFamily: 'Inter_700Bold', fontSize: 28 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
});
