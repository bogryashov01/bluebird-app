import React, { useEffect, useState } from 'react';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { QueueAcknowledgement } from '@/components/QueueAcknowledgement';
import { ProductionInternationalNotice } from '@/components/ProductionInternationalNotice';
import { ProductionQueueJoined } from '@/components/ProductionQueueJoined';
import { QueueJoinConfirmation } from '@/components/QueueJoinConfirmation';
import { DemoPolicyScreen } from '@/components/DemoJoinReference';
import { ProductionReadOnlyNotice } from '@/components/ProductionReadOnlyNotice';
import { JoinQueueLoading } from '@/components/JoinQueueLoading';
import { useAuth } from '@/context/AuthContext';
import { canSubmitProductionQueueJoin, formatInternationalPassPrice, parseJoinFlightDisplay, productionInternationalJoinStep, readInternationalUnlimited } from '@/lib/joinFlightPresentation';
import { useProductionMembershipPlans } from '@/hooks/useProductionMembershipPlans';
import { useJoinFlightQueueRead } from '@/lib/useJoinFlightQueueRead';
import { useProductionQueueMutation } from '@/lib/useProductionQueueMutation';
import { useDemoJoinFlow } from '@/lib/demoJoinFlowStore';
import { isProductionMemberDataSelected } from '@/lib/productionMemberRuntime';
import { logJoinNav, useJoinNavMount } from '@/lib/joinNavDiagnostics';

export default function JoinFlightScreen() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const flight = parseJoinFlightDisplay(params);
  const { panel: queue } = useJoinFlightQueueRead(flight?.flightId ?? 0, flight?.flightStatus ?? null);
  const { clerkMemberResolution } = useAuth();
  const plansQuery = useProductionMembershipPlans();
  const memberTier = clerkMemberResolution.status === 'profile_complete'
    || clerkMemberResolution.status === 'profile_incomplete'
    ? clerkMemberResolution.currentUser.memberTier
    : null;
  const entitlementPending = flight?.international === true && (
    plansQuery.isPending
    || clerkMemberResolution.status === 'resolving'
    || clerkMemberResolution.status === 'not_checked'
  );
  const internationalUnlimited = plansQuery.isSuccess
    ? readInternationalUnlimited(plansQuery.data.features, memberTier)
    : null;
  const internationalStep = productionInternationalJoinStep({
    isInternational: flight?.international ?? null,
    internationalUnlimited,
    entitlementPending,
  });
  const queueMutation = useProductionQueueMutation(
    flight?.flightId ?? 0,
    internationalStep === 'required',
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
    return <JoinQueueLoading />;
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
    return <JoinQueueLoading />;
  }
  if (!acknowledged) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: 'Before you join' }} />
        <QueueAcknowledgement flight={flight} onContinue={() => setAcknowledged(true)} />
      </>
    );
  }

  const showPassChoice = internationalStep === 'required'
    || queueMutation.failure?.code === 'international_pass_required';
  if (internationalStep !== 'skip') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <ProductionInternationalNotice
          step={internationalStep === 'pending' ? 'pending' : showPassChoice ? 'required' : internationalStep}
          priceLabel={formatInternationalPassPrice(flight.internationalPassPriceUsd)}
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
