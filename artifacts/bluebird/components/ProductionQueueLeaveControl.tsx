import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { SecondaryButton } from '@/components/PrimaryButton';
import { useColors } from '@/hooks/useColors';
import { canSubmitProductionQueueJoin, QUEUE_LEAVE_UNAVAILABLE } from '@/lib/joinFlightPresentation';
import { useProductionQueueMutation } from '@/lib/useProductionQueueMutation';

/** Leave control for a flight whose server detail says the signed-in member is in the queue. */
export function ProductionQueueLeaveControl({
  flightId,
  visible,
  label = 'Leave the Queue',
}: {
  flightId: number;
  visible: boolean;
  label?: string;
}) {
  const colors = useColors();
  const queueMutation = useProductionQueueMutation(flightId, null);
  if (!visible) return null;
  return (
    <>
      <SecondaryButton
        label={label}
        disabled={!canSubmitProductionQueueJoin() || queueMutation.submitting}
        loading={queueMutation.submitting && canSubmitProductionQueueJoin()}
        onPress={() => {
          if (queueMutation.submitting || !canSubmitProductionQueueJoin()) return;
          void queueMutation.leave();
        }}
        testID="flight-detail-leave-queue"
        accessibilityRole="button"
      />
      <Text testID="flight-detail-leave-note" style={[styles.note, { color: colors.mutedForegroundLight }]}>
        {queueMutation.leftMessage ?? (canSubmitProductionQueueJoin()
          ? 'Leaving removes you from this queue after you confirm.'
          : QUEUE_LEAVE_UNAVAILABLE)}
      </Text>
      {queueMutation.failure ? (
        <Text testID="flight-detail-leave-error" style={[styles.note, { color: colors.mutedForegroundLight }]}>
          {queueMutation.failure.body}
        </Text>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  note: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, textAlign: 'center' },
});
