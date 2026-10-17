import React from 'react';
import { TripAvailabilityState } from '@/components/TripAvailabilityState';
import { PRODUCTION_AUTH_UNAVAILABLE_MESSAGE } from '@/lib/productionAuthState';

export function ProductionAuthenticatedUnavailableNotice({
  title = 'Account information unavailable',
  description,
  testID = 'production-auth-unavailable',
  actionLabel,
  onAction,
}: {
  title?: string;
  description?: string;
  testID?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <TripAvailabilityState
      title={title}
      description={description ?? PRODUCTION_AUTH_UNAVAILABLE_MESSAGE}
      testID={testID}
      actionLabel={actionLabel}
      onAction={onAction}
    />
  );
}
