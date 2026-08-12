import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { FloatingBackButton } from '@/components/FloatingBackButton';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useUseLinePassOnQueueEntry, useConfirmQueueEntry } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import * as Haptics from 'expo-haptics';
import { ApplyingPassOverlay, ApplyingPassPhase } from '@/components/ApplyingPassOverlay';

function shortDate(d?: string) {
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

// Dark "Skip the Line Pass" sheet — confirming uses a pass and wins the seat.
export default function SkipLinePassScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    entryId?: string; position?: string;
    from?: string; to?: string; fromCity?: string; toCity?: string;
    departureDate?: string; departureTime?: string; duration?: string;
    aircraftType?: string; flightId?: string;
  }>();
  const { user, updateUser } = useAuth();
  const queryClient = useQueryClient();
  const passCount = user?.linePassCount ?? 0;
  const [actionError, setActionError] = useState<string | null>(null);
  // Overlay shown while the pass is applied; null = hidden.
  const [overlayPhase, setOverlayPhase] = useState<ApplyingPassPhase | null>(null);
  // Navigation to run once the overlay's resolve animation completes.
  const pendingNavRef = useRef<(() => void) | null>(null);
  const position = parseInt(params.position ?? '0', 10) || 0;

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const goConfirmed = (viaPass: boolean) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    queryClient.invalidateQueries({ queryKey: ['/api/queue/status'] });
    queryClient.invalidateQueries({ queryKey: ['/api/trips'] });
    if (params.flightId) {
      queryClient.invalidateQueries({ queryKey: [`/api/flights/${params.flightId}/my-status`] });
    }
    router.replace({
      pathname: '/flight/confirmed',
      params: viaPass ? { ...params, passUsed: '1' } : params,
    });
  };

  const confirmMutation = useConfirmQueueEntry({
    mutation: {
      onSuccess: () => goConfirmed(false),
      onError: (err: any) => {
        setActionError(err?.data?.error || err?.response?.data?.error || err?.message || 'Failed to confirm seat');
        queryClient.invalidateQueries({ queryKey: ['/api/queue/status'] });
      },
    },
  });

  const usePassMutation = useUseLinePassOnQueueEntry({
    mutation: {
      onSuccess: (data: any) => {
        if (user && typeof data?.linePassCount === 'number') {
          updateUser({ ...user, linePassCount: data.linePassCount });
        }
        // The server consumes the pass and confirms the seat atomically —
        // the response comes back already confirmed. Let the applying
        // animation resolve before landing on the confirmed screen.
        pendingNavRef.current = () => goConfirmed(true);
        setOverlayPhase('success');
      },
      onError: (err: any) => {
        setActionError(err?.data?.error || err?.response?.data?.error || err?.message || 'Failed to use Skip the Line pass');
        setOverlayPhase('error');
      },
    },
  });

  const isPending = usePassMutation.isPending || confirmMutation.isPending;

  const handleConfirm = () => {
    if (!params.entryId || isPending) return;
    setActionError(null);
    if (position === 1) {
      // Already at the front — no pass needed to shift position; just confirm.
      confirmMutation.mutate({ id: params.entryId });
    } else {
      setOverlayPhase('applying');
      usePassMutation.mutate({ id: params.entryId });
    }
  };

  const handleOverlayDone = () => {
    setOverlayPhase(null);
    const nav = pendingNavRef.current;
    pendingNavRef.current = null;
    nav?.();
  };

  const routeLabel = `${params.from ?? '—'} → ${params.to ?? '—'}`;
  const canConfirm = passCount > 0 || position === 1;

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundMid, paddingTop: topPad }]}>
      {overlayPhase && <ApplyingPassOverlay phase={overlayPhase} onDone={handleOverlayDone} />}
      <FloatingBackButton variant="brand" />

      <View style={[styles.top, { paddingTop: 76 }]}>
        <Text style={[styles.title, { color: colors.mutedOnBrand }]}>
          <Text style={{ color: colors.textOnBrand }}>Skip the Line Pass</Text> instantly wins this flight
        </Text>
        <Text style={[styles.body, { color: colors.mutedOnBrand }]}>
          Using a Skip the Line Pass moves you to the front of the queue and
          confirms your seat immediately — no waiting for your turn.
        </Text>

        <View style={[styles.balanceCard, { backgroundColor: colors.textOnBrand + '0A', borderColor: colors.textOnBrand + '14' }]}>
          <View>
            <Text style={[styles.balanceLabel, { color: colors.mutedOnBrand }]}>SKIP THE LINE PASS BALANCE</Text>
            <Text style={[styles.balanceValue, { color: colors.textOnBrand }]}>
              {passCount} pass{passCount === 1 ? '' : 'es'}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.buyMoreBtn, { backgroundColor: colors.primary + '33' }]}
            onPress={() => router.push({ pathname: '/queue/buy-pass', params })}
            activeOpacity={0.8}
          >
            <Text style={[styles.buyMoreText, { color: colors.primaryForeground }]}>Buy More</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.sheet, { backgroundColor: colors.textOnBrand + '08', borderColor: colors.textOnBrand + '12', paddingBottom: bottomPad + 16 }]}>
        <Text style={[styles.sheetTitle, { color: colors.textOnBrand }]}>Use 1 Skip the Line Pass?</Text>
        <Text style={[styles.sheetBody, { color: colors.mutedOnBrand }]}>
          This immediately confirms your seat on {routeLabel}
          {params.departureDate ? `, ${shortDate(params.departureDate)}` : ''}. This action can't be undone.
        </Text>
        {!!actionError && (
          <Text style={[styles.noPasses, { color: colors.coral }]}>{actionError}</Text>
        )}
        {!canConfirm && (
          <Text style={[styles.noPasses, { color: colors.coral }]}>
            You don't have any passes — tap Buy More above to get one.
          </Text>
        )}
        <PrimaryButton
          label="Confirm — Use Skip the Line Pass"
          onPress={handleConfirm}
          loading={isPending}
          disabled={!canConfirm}
          style={{ marginTop: 4 }}
        />
        <TouchableOpacity style={styles.cancelBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Text style={[styles.cancelBtnText, { color: colors.mutedOnBrand }]}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  top: { flex: 1, paddingHorizontal: 22, gap: 16 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 24, lineHeight: 31 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 },
  balanceCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderRadius: 14, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 16,
  },
  balanceLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 0.6, marginBottom: 4 },
  balanceValue: { fontFamily: 'Inter_700Bold', fontSize: 20 },
  buyMoreBtn: { borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
  buyMoreText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  sheet: {
    borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1,
    paddingHorizontal: 22, paddingTop: 22, gap: 12,
  },
  sheetTitle: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  sheetBody: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  noPasses: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  cancelBtn: { alignItems: 'center', paddingVertical: 8 },
  cancelBtnText: { fontFamily: 'Inter_400Regular', fontSize: 14 },
});
