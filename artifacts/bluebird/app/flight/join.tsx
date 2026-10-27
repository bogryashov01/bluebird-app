import React, { useEffect } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { QueueJoinConfirmation } from '@/components/QueueJoinConfirmation';
import { DemoPolicyScreen } from '@/components/DemoJoinReference';
import { ProductionReadOnlyNotice } from '@/components/ProductionReadOnlyNotice';
import {
  parseJoinFlightDisplay,
  presentVerifiedQueueJoinSuccess,
} from '@/lib/joinFlightPresentation';
import { useJoinFlightQueueRead } from '@/lib/useJoinFlightQueueRead';
import { useDemoJoinFlow } from '@/lib/demoJoinFlowStore';
import { logJoinNav, useJoinNavMount } from '@/lib/joinNavDiagnostics';

export default function JoinFlightScreen() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const flight = parseJoinFlightDisplay(params);
  const queue = useJoinFlightQueueRead(flight?.flightId ?? 0, flight?.flightStatus ?? null);
  const demo = useDemoJoinFlow();
  const paramKeys = Object.keys(params)
    .filter((key) => /^[A-Za-z][A-Za-z0-9]{0,40}$/.test(key))
    .sort()
    .join(',') || 'none';
  const flightIdParam = Array.isArray(params.flightId) ? params.flightId[0] : params.flightId;
  const flightAvailable = flight !== null;
  const reviewBranch = !flightAvailable
    ? 'unavailable'
    : demo.available && demo.enabled
      ? 'demo-policy'
      : 'review';
  useJoinNavMount('flight/join');
  useEffect(() => {
    logJoinNav('join-review', {
      mounted: true,
      paramKeys,
      flightId: typeof flightIdParam === 'string' && /^[1-9]\d*$/.test(flightIdParam) ? flightIdParam : 'invalid',
      flightAvailable,
      demoEnabled: demo.enabled,
      branch: reviewBranch,
      navigationEffect: 'none',
    });
  }, [paramKeys, flightIdParam, flightAvailable, demo.enabled, reviewBranch]);
  if (!flight) {
    return <ProductionReadOnlyNotice flightId={null} title="Flight unavailable" description="Open a flight from Discover before reviewing the queue." />;
  }
  if (demo.available && demo.enabled) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <DemoPolicyScreen params={params} />
      </>
    );
  }

  return (
    <QueueJoinConfirmation
      flight={flight}
      queue={queue}
      demoAvailable={demo.available}
      demoEnabled={demo.enabled}
      onDemoEnabledChange={demo.setEnabled}
      success={presentVerifiedQueueJoinSuccess(flight.flightId, null)}
    />
  );
}
