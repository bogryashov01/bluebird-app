import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Platform, TextInput,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { FloatingBackButton } from '@/components/FloatingBackButton';
import { FlightUnavailableState } from '@/components/FlightUnavailableState';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useJoinQueue, useGetFlightMyStatus, useGetFlight } from '@workspace/api-client-react';
import { useQuery } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import * as Haptics from 'expo-haptics';
import { ApplyingPassOverlay, ApplyingPassPhase } from '@/components/ApplyingPassOverlay';
import { ProductionReadOnlyNotice } from '@/components/ProductionReadOnlyNotice';
import { isLocalFlightReadMode } from '@/lib/productionFlights';
import { logJoinNav } from '@/lib/joinNavDiagnostics';
import { fetchFullAppDemoFlight } from '@/lib/fullAppDemoLiveReads';
import { useFullAppDemoQueueOptional } from '@/lib/fullAppDemoQueue';
import { parseProductionFlightId } from '@/lib/productionFlights';
import { markFlightWinCelebration } from '@/lib/flightWinCelebration';

const POLICY_ITEMS = [
  {
    id: 'pet-policy',
    label: 'I have reviewed the pet policy and will indicate below whether I am bringing a pet.',
  },
  {
    id: 'cancellation-risk',
    label: 'Flights may be cancelled or changed due to operational requirements.',
  },
  {
    id: 'baggage-limit',
    label: 'Baggage allowance is 25 kg per passenger, subject to aircraft capacity and operational limitations.',
  },
];

// "Before you join the queue" — policy acknowledgment step of the join flow.
export default function JoinQueueAcknowledgeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    flightId: string; fromCity: string; toCity: string;
    from: string; to: string; useLinePass?: string;
    departureDate?: string; departureTime?: string; duration?: string;
    aircraftType?: string; international?: string; feeUsd?: string;
    flightStatus?: string;
  }>();
  const { flightId, fromCity, toCity, from, to } = params;
  const useLinePass = params.useLinePass === '1';
  const isInternational = params.international === '1';
  const { user, updateUser, demoMode } = useAuth();
  const localDemoFlow = demoMode || isLocalFlightReadMode();
  const demoQueue = useFullAppDemoQueueOptional();
  const queryClient = useQueryClient();
  const [checked, setChecked] = useState([false, false, false]);
  const [punctualityChecked, setPunctualityChecked] = useState(false);
  const [bringingPet, setBringingPet] = useState<boolean | null>(null);
  const [petFeeAcknowledged, setPetFeeAcknowledged] = useState(false);
  const [petWeightLbs, setPetWeightLbs] = useState('');
  const joinLock = useRef(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [demoQueueActionPending, setDemoQueueActionPending] = useState(false);
  // Set when the server rejects the join because the flight is gone — drives
  // the full-screen "no longer available" state instead of an inline error.
  const [rejectedUnavailable, setRejectedUnavailable] = useState(false);
  // Skip-the-line applying overlay; null = hidden.
  const [overlayPhase, setOverlayPhase] = useState<ApplyingPassPhase | null>(null);
  // Navigation to run once the overlay's resolve animation completes.
  const pendingNavRef = useRef<(() => void) | null>(null);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  // Guard: a user already confirmed on this flight cannot join again.
  // If this lookup fails, we do NOT lock the button — the server enforces the
  // duplicate-entry guard authoritatively on join anyway.
  const { data: myStatus, isLoading: statusLoading, isError: statusError } = useGetFlightMyStatus(flightId!, {
    query: { enabled: localDemoFlow && !demoMode && !!user && !!flightId },
  });
  const demoEntry = demoQueue?.entries.find((entry) => entry.flightId === flightId);
  const isConfirmed = demoMode ? demoEntry?.status === 'won' : myStatus?.status === 'confirmed';

  // Re-check the flight's current status when the screen loads — if it became
  // unavailable (departed, cancelled, …) we show a friendly full-screen state
  // instead of letting the member fill out acknowledgments for nothing.
  const { data: liveFlight } = useGetFlight(flightId!, {
    query: { enabled: localDemoFlow && !demoMode && !!flightId },
  });
  const demoFlightId = parseProductionFlightId(flightId);
  const demoFlightQuery = useQuery({
    queryKey: ['full-app-demo-flight', demoFlightId],
    queryFn: ({ signal }) => fetchFullAppDemoFlight(demoFlightId!, { signal }),
    enabled: demoMode && demoFlightId !== null,
  });
  const currentFlightStatus = demoMode ? demoFlightQuery.data?.status : (liveFlight as any)?.status;
  const flightUnavailable =
    rejectedUnavailable || (!!currentFlightStatus && currentFlightStatus !== 'available' && currentFlightStatus !== 'published');
  useEffect(() => {
    if (localDemoFlow && !demoMode && isConfirmed && flightId) router.replace(`/flight/${flightId}`);
  }, [isConfirmed, flightId, localDemoFlow, demoMode]);

  const joinMutation = useJoinQueue({
    mutation: {
      onSuccess: async (entry: any) => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        if (useLinePass && user) {
          updateUser({ ...user, linePassCount: Math.max(0, (user.linePassCount ?? 0) - 1) });
        }
        // Skip the Line: the server confirms the seat atomically with the
        // pass — the join response comes back already confirmed.
        if (entry?.status === 'confirmed') {
          queryClient.invalidateQueries({ queryKey: ['/api/queue/status'] });
          queryClient.invalidateQueries({ queryKey: ['/api/trips'] });
          queryClient.invalidateQueries({ queryKey: [`/api/flights/${flightId}/my-status`] });
          const nav = () => router.replace({
            pathname: '/flight/confirmed',
            params: {
              ...params,
              petFeeUsd: bringingPet ? '500' : '0',
            },
          });
          if (useLinePass) {
            // Let the applying animation resolve before landing on confirmed.
            pendingNavRef.current = () => {
              markFlightWinCelebration(flightId);
              nav();
            };
            setOverlayPhase('success');
          } else {
            nav();
          }
          return;
        }
        queryClient.invalidateQueries({ queryKey: ['/api/queue/status'] });
        queryClient.invalidateQueries({ queryKey: [`/api/flights/${flightId}/my-status`] });
        const navJoined = () => router.replace({
          pathname: '/queue/joined',
          params: {
            ...params,
            entryId: entry?.id ?? '',
            position: String(entry?.position ?? ''),
            totalInQueue: String(entry?.totalInQueue ?? ''),
            flightStatus: entry?.flight?.status ?? params.flightStatus ?? 'available',
          },
        });
        if (useLinePass) {
          // Edge case: pass didn't confirm — dismiss the overlay quietly.
          pendingNavRef.current = navJoined;
          setOverlayPhase('error');
        } else {
          navJoined();
        }
      },
      onError: (err: any) => {
        const code = err?.response?.data?.code || err?.data?.code;
        if (code === 'MEMBERSHIP_REQUIRED') {
          // Keep the member on this screen after a rejected request. A paywall
          // redirect would hide the API failure and discard their acknowledgments.
          setOverlayPhase(null);
          setJoinError('An active membership is required to join this queue. No queue entry was created.');
          return;
        }
        const msg = err?.response?.data?.error || err?.data?.error || err?.message || 'Failed to join queue';
        if (/no longer available/i.test(msg)) {
          setRejectedUnavailable(true);
        } else {
          setJoinError(msg);
        }
        setOverlayPhase((p) => (p ? 'error' : p));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      },
      onSettled: () => {
        joinLock.current = false;
      },
    },
  });

  const positiveNumber = (value: string) => Number.isFinite(Number(value)) && Number(value) > 0;
  const petComplete = bringingPet !== null && (!bringingPet || (petFeeAcknowledged && positiveNumber(petWeightLbs)));
  const allChecked = checked.every(Boolean) && punctualityChecked && petComplete;
  const membershipTier = demoMode ? 'base' : user?.membershipTier;
  const needsIntlNotice = isInternational && membershipTier === 'base';

  const handleContinue = async () => {
    logJoinNav('join-button', {
      screen: 'queue/join',
      visibleLabel: 'I Acknowledge — Continue',
      routerMethod: 'pending',
      targetPathname: 'pending',
    });
    if (!localDemoFlow || !flightId) return;
    if (demoMode && demoEntry && ['waiting', 'changed-position'].includes(demoEntry.status)) {
      router.replace({ pathname: '/queue/status', params: { entryId: demoEntry.id, flightId } });
      return;
    }
    if (demoMode && demoEntry?.status === 'won') {
      router.replace(`/flight/${flightId}` as any);
      return;
    }
    if (demoMode && demoEntry) {
      router.replace({ pathname: '/queue/status', params: { entryId: demoEntry.id, flightId } });
      return;
    }
    if (myStatus?.status === 'waiting' && myStatus.queueEntryId) {
      router.replace({ pathname: '/queue/status', params: { entryId: myStatus.queueEntryId, flightId } });
      return;
    }
    if (!allChecked || isConfirmed || joinMutation.isPending || demoQueueActionPending || joinLock.current) return;
    if (demoMode && (!demoQueue?.hydrated || !demoFlightQuery.data || demoQueue.storageError)) {
      setJoinError(demoQueue?.storageError ?? 'The selected flight is not ready. Try again when its details load.');
      return;
    }
    if (user?.membershipTier === 'none') {
      // Non-member reached the join flow (e.g. deep link) — route to the paywall.
      router.replace({ pathname: '/membership/join' as any, params: { flightId } });
      return;
    }
    setJoinError(null);
    if (needsIntlNotice) {
      router.push({
        pathname: '/queue/intl-notice',
        params: {
          ...params,
          bringingPet: bringingPet ? '1' : '0',
          petFeeAcknowledged: petFeeAcknowledged ? '1' : '0',
          petWeightLbs,
        },
      });
      return;
    }
    if (demoMode) {
      joinLock.current = true;
      setDemoQueueActionPending(true);
      setJoinError(null);
      try {
        await demoQueue!.joinFlight(demoFlightQuery.data!);
        const entry = demoQueue!.entries.length + 1;
        router.replace({
          pathname: '/queue/joined',
          params: {
            ...params,
            entryId: `demo-${flightId}`,
            position: String(entry),
            totalInQueue: String(entry),
            flightStatus: demoFlightQuery.data!.status ?? 'available',
          },
        } as any);
      } catch (error) {
        setJoinError(error instanceof Error ? error.message : 'The local demo queue could not be updated.');
      } finally {
        joinLock.current = false;
        setDemoQueueActionPending(false);
      }
      return;
    }
    if (useLinePass) setOverlayPhase('applying');
    joinLock.current = true;
    joinMutation.mutate({
      data: {
        flightId, useLinePass, bringingPet: bringingPet === true,
        petFeeAcknowledged: bringingPet === true && petFeeAcknowledged,
        ...(bringingPet ? {
          petWeightLbs: Number(petWeightLbs),
        } : {}),
      },
    });
  };

  const handleOverlayDone = () => {
    setOverlayPhase(null);
    const nav = pendingNavRef.current;
    pendingNavRef.current = null;
    nav?.();
  };

  // Note: a failed status lookup (statusError) does NOT disable the CTA — the
  // server re-checks eligibility on join, so the member is never locked out.
  const ctaDisabled = !allChecked || joinMutation.isPending || demoQueueActionPending ||
    (statusLoading && !statusError) || (demoMode && (demoFlightQuery.isLoading || !demoQueue?.hydrated)) || isConfirmed;
  const alreadyWaiting = demoMode
    ? demoEntry?.status === 'waiting' || demoEntry?.status === 'changed-position'
    : myStatus?.status === 'waiting';
  const hasExistingDemoEntry = demoMode && !!demoEntry;

  if (!localDemoFlow) {
    return <ProductionReadOnlyNotice flightId={flightId} />;
  }

  // ── Flight no longer available: friendly full-screen state ──
  if (flightUnavailable) {
    return <FlightUnavailableState status={currentFlightStatus} bottomPad={bottomPad} />;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.offWhite }]}>
      {overlayPhase && <ApplyingPassOverlay phase={overlayPhase} onDone={handleOverlayDone} />}
      <FloatingBackButton />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: topPad + 72 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.title, { color: colors.textOnSurface }]}>Before you join{'\n'}the queue</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForegroundLight }]}>
          Please review and confirm the following for {fromCity ?? from} → {toCity ?? to}.
        </Text>

        {POLICY_ITEMS.map((item, i) => (
          <TouchableOpacity
            key={item.id}
            testID={`queue-ack-${item.id}`}
            style={[styles.checkRow, { backgroundColor: colors.surface, borderColor: colors.separator }]}
            onPress={() => setChecked((prev) => prev.map((c, j) => (j === i ? !c : c)))}
            activeOpacity={0.8}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: checked[i] }}
            aria-checked={checked[i]}
          >
            <View style={[
              styles.checkbox,
              { borderColor: checked[i] ? colors.primary : colors.border, backgroundColor: checked[i] ? colors.primary : 'transparent' },
            ]}>
              {checked[i] && <Feather name="check" size={14} color={colors.primaryForeground} />}
            </View>
            <Text style={[styles.checkText, { color: colors.textOnSurface }]}>{item.label}</Text>
          </TouchableOpacity>
        ))}

        <TouchableOpacity
          style={[styles.punctualityCard, { backgroundColor: colors.surface, borderColor: punctualityChecked ? colors.primary : colors.border }]}
          onPress={() => setPunctualityChecked((v) => !v)}
          activeOpacity={0.8}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: punctualityChecked }}
          aria-checked={punctualityChecked}
          testID="queue-ack-punctuality"
        >
          <View style={styles.punctualityHeader}>
            <Feather name="clock" size={16} color={colors.primary} />
            <Text style={[styles.punctualityTitle, { color: colors.textOnSurface }]}>Punctuality</Text>
          </View>
          <View style={styles.punctualityRow}>
            <View style={[
              styles.checkbox,
              { borderColor: punctualityChecked ? colors.primary : colors.border, backgroundColor: punctualityChecked ? colors.primary : 'transparent' },
            ]}>
              {punctualityChecked && <Feather name="check" size={14} color={colors.primaryForeground} />}
            </View>
            <Text style={[styles.checkText, { color: colors.textOnSurface }]}>
              I understand the aircraft departs at the scheduled time. If I arrive late, the aircraft may leave without me and repeated late arrivals may affect my membership.
            </Text>
          </View>
        </TouchableOpacity>

        <View style={[styles.petCard, { backgroundColor: colors.surface, borderColor: bringingPet !== null ? colors.primary : colors.border }]}>
          <View style={styles.punctualityHeader}>
            <Feather name="heart" size={16} color={colors.primary} />
            <Text style={[styles.punctualityTitle, { color: colors.textOnSurface }]}>Bringing a pet?</Text>
          </View>
          <View style={styles.choiceRow} accessibilityRole="radiogroup">
            {([true, false] as const).map((value) => {
              const selected = bringingPet === value;
              return (
                <TouchableOpacity
                  key={String(value)}
                  style={[
                    styles.choiceButton,
                    { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary + '14' : colors.surface },
                  ]}
                  onPress={() => {
                    setBringingPet(value);
                    if (!value) setPetFeeAcknowledged(false);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  testID={`bringing-pet-${value ? 'yes' : 'no'}`}
                >
                  <Text style={[styles.choiceText, { color: selected ? colors.primary : colors.textOnSurface }]}>
                    {value ? 'Yes' : 'No'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {bringingPet && (
            <View style={styles.petInformation}>
              <Text style={[styles.sectionLabel, { color: colors.textOnSurface }]}>Pet Information</Text>
              <Text style={[styles.fieldLabel, { color: colors.mutedForegroundLight }]}>Pet weight (lbs)</Text>
              <TextInput
                value={petWeightLbs}
                onChangeText={setPetWeightLbs}
                keyboardType="decimal-pad"
                placeholder="e.g. 25"
                placeholderTextColor={colors.mutedForegroundLight}
                style={[styles.measurementInput, { color: colors.textOnSurface, borderColor: colors.border, backgroundColor: colors.offWhite }]}
                testID="pet-weight-lbs"
              />
            </View>
          )}
          {bringingPet && (
            <TouchableOpacity
              style={styles.punctualityRow}
              onPress={() => setPetFeeAcknowledged((value) => !value)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: petFeeAcknowledged }}
              testID="pet-fee-acknowledgement"
            >
              <View style={[
                styles.checkbox,
                { borderColor: petFeeAcknowledged ? colors.primary : colors.border, backgroundColor: petFeeAcknowledged ? colors.primary : 'transparent' },
              ]}>
                {petFeeAcknowledged && <Feather name="check" size={14} color={colors.primaryForeground} />}
              </View>
              <Text style={[styles.checkText, { color: colors.textOnSurface }]}>
                I understand the $500 cleaning fee applies only if this flight is awarded. Joining the waiting queue does not create or charge this fee.
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <Text style={[styles.legal, { color: colors.mutedForegroundLight }]}>
          By continuing, you acknowledge and accept these terms for this flight.
        </Text>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: bottomPad + 12 }]}>
        {!!joinError && (
          <View style={[styles.errorBox, { backgroundColor: colors.coral + '1A', borderColor: colors.coral + '55' }]}>
            <Feather name="alert-circle" size={15} color={colors.coral} />
            <Text style={[styles.errorText, { color: colors.coral }]}>{joinError}</Text>
          </View>
        )}
        {!allChecked && !joinError && (
          <Text style={[styles.hint, { color: colors.mutedForegroundLight }]}>
            Check all items above to continue
          </Text>
        )}
        {allChecked && statusLoading && !statusError && !joinError && (
          <Text style={[styles.hint, { color: colors.mutedForegroundLight }]}>
            Checking your booking status…
          </Text>
        )}
        {alreadyWaiting && (
          <Text style={[styles.hint, { color: colors.primary }]}>
            You are already in this queue. Open your current status instead of joining again.
          </Text>
        )}
        <PrimaryButton
          label={alreadyWaiting || hasExistingDemoEntry ? 'View Queue Status' : 'I Acknowledge — Continue'}
          testID="queue-continue-button"
          accessibilityRole="button"
          onPress={handleContinue}
          loading={!alreadyWaiting && !hasExistingDemoEntry && (joinMutation.isPending || demoQueueActionPending)}
          disabled={alreadyWaiting || hasExistingDemoEntry ? false : ctaDisabled}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 22, paddingBottom: 24, gap: 12 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 26, lineHeight: 33, marginBottom: 2 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, marginBottom: 10 },
  checkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: 16, borderWidth: 1, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2,
  },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  checkText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 13.5, lineHeight: 19 },
  punctualityCard: {
    borderRadius: 14, padding: 16, borderWidth: 1.5, gap: 12, marginTop: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2,
  },
  petCard: {
    borderRadius: 14, padding: 16, borderWidth: 1.5, gap: 12, marginTop: 4,
  },
  choiceRow: { flexDirection: 'row', gap: 10 },
  choiceButton: {
    flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  choiceText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  petInformation: { gap: 8 },
  sectionLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14, marginTop: 2 },
  fieldLabel: { fontFamily: 'Inter_500Medium', fontSize: 12.5 },
  measurementInput: {
    minHeight: 44, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12,
    fontFamily: 'Inter_500Medium', fontSize: 14,
  },
  punctualityHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  punctualityTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  punctualityRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  legal: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17, marginTop: 6 },
  footer: { paddingHorizontal: 22, paddingTop: 12, gap: 10 },
  hint: { fontFamily: 'Inter_500Medium', fontSize: 12.5, textAlign: 'center' },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 11,
  },
  errorText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 },
});
