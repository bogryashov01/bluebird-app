import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { FloatingBackButton } from '@/components/FloatingBackButton';
import { FlightUnavailableState } from '@/components/FlightUnavailableState';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useJoinQueue, useGetFlightMyStatus, useGetFlight } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import * as Haptics from 'expo-haptics';
import { ApplyingPassOverlay, ApplyingPassPhase } from '@/components/ApplyingPassOverlay';

const POLICY_ITEMS = [
  'Flights may be cancelled or changed due to operational requirements.',
  'Baggage restrictions apply based on aircraft type and available space.',
  'Pet policies apply — please confirm your pet meets carrier requirements.',
];

// "Before you join the queue" — policy acknowledgment step of the join flow.
export default function JoinQueueAcknowledgeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    flightId: string; fromCity: string; toCity: string;
    from: string; to: string; useLinePass?: string; passengers?: string;
    departureDate?: string; departureTime?: string; duration?: string;
    aircraftType?: string; international?: string; feeUsd?: string;
    flightStatus?: string;
  }>();
  const { flightId, fromCity, toCity, from, to } = params;
  const passengers = Math.max(1, parseInt(params.passengers ?? '1', 10) || 1);
  const useLinePass = params.useLinePass === '1';
  const isInternational = params.international === '1';
  const { user, updateUser } = useAuth();
  const queryClient = useQueryClient();
  const [checked, setChecked] = useState([false, false, false]);
  const [punctualityChecked, setPunctualityChecked] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
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
    query: { enabled: !!user && !!flightId },
  });
  const isConfirmed = myStatus?.status === 'confirmed';

  // Re-check the flight's current status when the screen loads — if it became
  // unavailable (departed, cancelled, …) we show a friendly full-screen state
  // instead of letting the member fill out acknowledgments for nothing.
  const { data: liveFlight } = useGetFlight(flightId!, {
    query: { enabled: !!flightId },
  });
  const flightUnavailable =
    rejectedUnavailable || (!!liveFlight && (liveFlight as any).status !== 'available');
  useEffect(() => {
    if (isConfirmed && flightId) router.replace(`/flight/${flightId}`);
  }, [isConfirmed, flightId]);

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
            params: useLinePass ? { ...params, passUsed: '1' } : params,
          });
          if (useLinePass) {
            // Let the applying animation resolve before landing on confirmed.
            pendingNavRef.current = nav;
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
        const msg = err?.response?.data?.error || err?.data?.error || err?.message || 'Failed to join queue';
        if (/no longer available/i.test(msg)) {
          setRejectedUnavailable(true);
        } else {
          setJoinError(msg);
        }
        setOverlayPhase((p) => (p ? 'error' : p));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      },
    },
  });

  const allChecked = checked.every(Boolean) && punctualityChecked;
  const needsIntlNotice = isInternational && user?.membershipTier === 'base';

  const handleContinue = () => {
    if (!allChecked || !flightId || isConfirmed || joinMutation.isPending) return;
    setJoinError(null);
    if (needsIntlNotice) {
      router.push({ pathname: '/queue/intl-notice', params });
      return;
    }
    if (useLinePass) setOverlayPhase('applying');
    joinMutation.mutate({ data: { flightId, useLinePass, passengers } });
  };

  const handleOverlayDone = () => {
    setOverlayPhase(null);
    const nav = pendingNavRef.current;
    pendingNavRef.current = null;
    nav?.();
  };

  // Note: a failed status lookup (statusError) does NOT disable the CTA — the
  // server re-checks eligibility on join, so the member is never locked out.
  const ctaDisabled = !allChecked || joinMutation.isPending || (statusLoading && !statusError) || isConfirmed;

  // ── Flight no longer available: friendly full-screen state ──
  if (flightUnavailable) {
    return <FlightUnavailableState status={(liveFlight as any)?.status} bottomPad={bottomPad} />;
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
            key={i}
            style={[styles.checkRow, { backgroundColor: colors.surface }]}
            onPress={() => setChecked((prev) => prev.map((c, j) => (j === i ? !c : c)))}
            activeOpacity={0.8}
          >
            <View style={[
              styles.checkbox,
              { borderColor: checked[i] ? colors.primary : colors.border, backgroundColor: checked[i] ? colors.primary : 'transparent' },
            ]}>
              {checked[i] && <Feather name="check" size={14} color={colors.primaryForeground} />}
            </View>
            <Text style={[styles.checkText, { color: colors.textOnSurface }]}>{item}</Text>
          </TouchableOpacity>
        ))}

        <TouchableOpacity
          style={[styles.punctualityCard, { backgroundColor: colors.surface, borderColor: punctualityChecked ? colors.primary : colors.border }]}
          onPress={() => setPunctualityChecked((v) => !v)}
          activeOpacity={0.8}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: punctualityChecked }}
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
        <PrimaryButton
          label="I Acknowledge — Continue"
          onPress={handleContinue}
          loading={joinMutation.isPending}
          disabled={ctaDisabled}
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
    borderRadius: 14, padding: 16,
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
