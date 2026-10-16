import React, { useState } from 'react';
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
  useJoinClerkFlightQueue,
  useLeaveClerkFlightQueue,
  useSkipClerkFlightLine,
  type ClerkQueueAvailability,
} from '@/lib/useClerkQueue';
import type { ProductionAuthRequestError } from '@/lib/productionAuthApi';

export interface ClerkQueuePanelProps {
  emptyLegId: number;
  existingSkipLineCredits: number;
}

function availabilityMessage(availability: ClerkQueueAvailability): string | null {
  if (availability === 'configuration-required') {
    return 'The matching Main API and Clerk environment is not configured.';
  }
  if (availability === 'authentication-required') {
    return 'Sign in with Clerk to load this flight’s queue.';
  }
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
}: ClerkQueuePanelProps) {
  const colors = useColors();
  const queue = useClerkFlightQueue(emptyLegId);
  const join = useJoinClerkFlightQueue(emptyLegId);
  const leave = useLeaveClerkFlightQueue(emptyLegId);
  const skip = useSkipClerkFlightLine(emptyLegId, existingSkipLineCredits);
  const [actionError, setActionError] = useState<string | null>(null);
  const busy = join.isPending || leave.isPending || skip.isPending;
  const unavailable = availabilityMessage(queue.availability);

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
          <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>Your queue position</Text>
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
              onPress={() => void runAction(() => skip.mutateAsync())}
              loading={skip.isPending}
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
          {!join.isSuccess && (
            <PrimaryButton
              label="Join Queue"
              onPress={() => void runAction(() => join.mutateAsync())}
              loading={join.isPending}
              disabled={busy}
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
