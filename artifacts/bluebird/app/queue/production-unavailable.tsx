import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ProductionReadOnlyNotice } from '@/components/ProductionReadOnlyNotice';
import { parseProductionFlightId } from '@/lib/productionFlights';

export default function ProductionQueueUnavailableScreen() {
  const params = useLocalSearchParams<{ flightId?: string }>();
  const flightId = parseProductionFlightId(params.flightId);

  return <ProductionReadOnlyNotice flightId={flightId} />;
}
