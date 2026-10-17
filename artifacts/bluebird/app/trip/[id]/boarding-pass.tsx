import React from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { TripAvailabilityState } from '@/components/TripAvailabilityState';
import { parseTripRouteId } from '@/lib/tripRoutes';

export default function BoardingPassScreen() {
  const { id: rawId } = useLocalSearchParams<{ id?: string | string[] }>();
  const tripId = parseTripRouteId(rawId);
  const backToTrips = () => router.dismissTo('/(tabs)/trips');
  const backToTrip = () => {
    if (tripId) router.replace(`/trip/${tripId}` as any);
    else backToTrips();
  };

  return (
    <TripAvailabilityState
      title="Boarding pass unavailable"
      description={
        tripId
          ? 'Boarding passes are unavailable right now. No pass or QR code has been created, and Apple Wallet is unavailable.'
          : 'We couldn’t find this trip. Go back to My Trips and try again.'
      }
      actionLabel={tripId ? 'Back to Trip Details' : 'Back to My Trips'}
      onAction={tripId ? backToTrip : backToTrips}
      testID="boarding-pass-unavailable"
    />
  );
}
