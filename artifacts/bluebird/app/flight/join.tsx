import React, { useEffect, useState } from 'react';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { QueueAcknowledgement } from '@/components/QueueAcknowledgement';
import { ProductionInternationalNotice } from '@/components/ProductionInternationalNotice';
import { ProductionQueueJoined } from '@/components/ProductionQueueJoined';
import { QueueJoinConfirmation } from '@/components/QueueJoinConfirmation';
import { DemoPolicyScreen } from '@/components/DemoJoinReference';
import { ProductionReadOnlyNotice } from '@/components/ProductionReadOnlyNotice';
import { canSubmitProductionQueueJoin, parseJoinFlightDisplay, productionInternationalJoinStep } from '@/lib/joinFlightPresentation';
import { useJoinFlightQueueRead } from '@/lib/useJoinFlightQueueRead';
import { useProductionQueueMutation } from '@/lib/useProductionQueueMutation';
import { useDemoJoinFlow } from '@/lib/demoJoinFlowStore';
import { isProductionMemberDataSelected } from '@/lib/productionMemberRuntime';
import { logJoinNav, useJoinNavMount } from '@/lib/joinNavDiagnostics';

export default function JoinFlightScreen() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const flight = parseJoinFlightDisplay(params);
  const queue = useJoinFlightQueueRead(flight?.flightId ?? 0, flight?.flightStatus ?? null);
  const queueMutation = useProductionQueueMutation(
    flight?.flightId ?? 0,
    flight?.internationalPassRequired ?? null,
  );
  const demo = useDemoJoinFlow();
  const productionMemberData = isProductionMemberDataSelected();
  const demoJoinVisible = demo.available && demo.enabled && !productionMemberData && !canSubmitProductionQueueJoin();
  const [acknowledged, setAcknowledged] = useState(false);
  const viewerInQueue = queue.kind === 'participants' && queue.viewerPosition !== null;
  const paramKeys = Object.keys(params)
    .filter((key) => /^[A-Za-z][A-Za-z0-9]{0,40}$/.test(key))
    .sort()
    .join(',') || 'none';
  const flightIdParam = Array.isArray(params.flightId) ? params.flightId[0] : params.flightId;
  const flightAvailable = flight !== null;
  const reviewBranch = !flightAvailable
    ? 'unavailable'
    : demoJoinVisible
      ? 'demo-policy'
      : 'review';
  useJoinNavMount('flight/join');
  useEffect(() => {
    if (!flight || demoJoinVisible || queueMutation.success || !viewerInQueue) return;
    router.replace({ pathname: '/flight/queue-status', params: { flightId: String(flight.flightId) } });
  }, [demoJoinVisible, flight, queueMutation.success, viewerInQueue]);
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
  }, [paramKeys, flightIdParam, flightAvailable, demo.enabled, reviewBranch, demoJoinVisible]);
  if (!flight) {
    return <ProductionReadOnlyNotice flightId={null} title="Flight unavailable" description="Open a flight from Discover before reviewing the queue." />;
  }
  if (demoJoinVisible) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <DemoPolicyScreen params={params} />
      </>
    );
  }
  if (queue.kind === 'loading') {
    return <ProductionReadOnlyNotice flightId={flight.flightId} title="Checking your queue" description="Bluebird is checking whether you are already in this queue." />;
  }
  if (queueMutation.success) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <ProductionQueueJoined
          flight={flight}
          success={queueMutation.success}
          onViewStatus={() => router.replace({ pathname: '/flight/queue-status', params: { flightId: String(flight.flightId) } })}
        />
      </>
    );
  }
  if (viewerInQueue) {
    return <ProductionReadOnlyNotice flightId={flight.flightId} title="Opening queue status" description="Your place in this queue is loaded from Bluebird." />;
  }
  if (!acknowledged) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: 'Before you join' }} />
        <QueueAcknowledgement flight={flight} onContinue={() => setAcknowledged(true)} />
      </>
    );
  }

  const internationalStep = productionInternationalJoinStep({
    international: flight.international,
    internationalPassRequired: flight.internationalPassRequired,
  });
  if (internationalStep !== 'skip') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <ProductionInternationalNotice
          step={internationalStep}
          submitting={queueMutation.submitting}
          failure={queueMutation.failure}
          onJoin={(consent, creditConfirmed) => { void queueMutation.join(consent, creditConfirmed); }}
        />
      </>
    );
  }

  return (
    <QueueJoinConfirmation
      flight={flight}
      demoAvailable={demo.available && !productionMemberData}
      demoEnabled={demo.enabled}
      onDemoEnabledChange={demo.setEnabled}
      success={queueMutation.success}
      failure={queueMutation.failure}
      submitting={queueMutation.submitting}
      leftMessage={queueMutation.leftMessage}
      onJoin={(consent, creditConfirmed) => { void queueMutation.join(consent, creditConfirmed); }}
    />
  );
}
