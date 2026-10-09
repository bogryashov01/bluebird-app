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
          ? 'No authenticated boarding-pass contract is connected. This preview does not generate a QR code or pass, and Apple Wallet is unavailable.'
          : 'This trip reference is invalid. No boarding pass, QR code, or Apple Wallet pass can be opened.'
      }
      actionLabel={tripId ? 'Back to Trip Details' : 'Back to My Trips'}
      onAction={tripId ? backToTrip : backToTrips}
      testID="boarding-pass-unavailable"
    />
  );
}
