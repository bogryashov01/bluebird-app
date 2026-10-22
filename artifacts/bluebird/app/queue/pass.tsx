import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Platform, Modal, Pressable,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { FloatingBackButton } from '@/components/FloatingBackButton';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import * as Haptics from 'expo-haptics';
import { ApplyingPassOverlay, ApplyingPassPhase } from '@/components/ApplyingPassOverlay';
import { ProductionReadOnlyNotice } from '@/components/ProductionReadOnlyNotice';
import { useUseLinePassOnQueueEntry } from '@workspace/api-client-react';
import { markQueueEntryCelebrated } from '@/lib/queueCelebration';
import { isLocalFlightReadMode } from '@/lib/productionFlights';
import { useFullAppDemoQueueOptional } from '@/lib/fullAppDemoQueue';

function shortDate(d?: string) {
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

// Dark pass screen with a bottom-sheet confirmation — confirming uses a pass and wins the seat.
export default function SkipLinePassScreen() {
  const colors = useColors();
  const { user, updateUser, demoMode } = useAuth();
  const localDemoFlow = demoMode || isLocalFlightReadMode();
  const demoQueue = useFullAppDemoQueueOptional();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
        entryId?: string; position?: string; bringingPet?: string;
    from?: string; to?: string; fromCity?: string; toCity?: string;
    departureDate?: string; departureTime?: string; duration?: string;
    aircraftType?: string; flightId?: string;
  }>();
  const queryClient = useQueryClient();
  const passCount = demoMode ? demoQueue?.passCount ?? 0 : user?.linePassCount ?? 0;
  const [actionError, setActionError] = useState<string | null>(null);
  // Overlay shown while the pass is applied; null = hidden.
  const [overlayPhase, setOverlayPhase] = useState<ApplyingPassPhase | null>(null);
  // Navigation to run once the overlay's resolve animation completes.
  const pendingNavRef = useRef<(() => void) | null>(null);
  // True when the server reported the seat was already confirmed — a positive
  // outcome where no pass was spent; the overlay copy changes to match.
  const [alreadyConfirmed, setAlreadyConfirmed] = useState(false);
  const [demoActionPending, setDemoActionPending] = useState(false);
  const demoEntry = demoQueue?.entries.find((entry) => entry.flightId === params.flightId);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const goConfirmed = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    queryClient.invalidateQueries({ queryKey: ['/api/queue/status'] });
    queryClient.invalidateQueries({ queryKey: ['/api/trips'] });
    if (params.flightId) {
      queryClient.invalidateQueries({ queryKey: [`/api/flights/${params.flightId}/my-status`] });
    }
    router.replace({
      pathname: '/flight/confirmed',
      params: { ...params, passUsed: '1', petFeeUsd: params.bringingPet === '1' ? '500' : '0' },
    });
  };

  const usePassMutation = useUseLinePassOnQueueEntry({
    mutation: {
      onSuccess: (data: any) => {
        // This flow shows its own celebration (or reassurance) — keep the
        // shared waiting→confirmed watchers from firing a duplicate one when
        // the next poll reveals this entry flipped to confirmed.
        if (params.entryId) markQueueEntryCelebrated(params.entryId);
        if (user && typeof data?.linePassCount === 'number') {
          updateUser({ ...user, linePassCount: data.linePassCount });
        }
        if (data?.alreadyConfirmed) {
          // Race with the queue engine: the seat was confirmed while this
          // sheet was open. Good news — no pass was spent. Reassure and land
          // on the confirmed queue status view.
          setAlreadyConfirmed(true);
          pendingNavRef.current = () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            queryClient.invalidateQueries({ queryKey: ['/api/queue/status'] });
            queryClient.invalidateQueries({ queryKey: ['/api/trips'] });
            if (params.flightId) {
              queryClient.invalidateQueries({ queryKey: [`/api/flights/${params.flightId}/my-status`] });
            }
            router.replace({
              pathname: '/queue/status',
              params: params.entryId ? { entryId: params.entryId } : {},
            });
          };
          setOverlayPhase('success');
          return;
        }
        // The server consumes the pass and confirms the seat atomically —
        // the response comes back already confirmed. Let the applying
        // animation resolve before landing on the confirmed screen.
        pendingNavRef.current = () => goConfirmed();
        setOverlayPhase('success');
      },
      onError: (err: any) => {
        setActionError(err?.data?.error || err?.response?.data?.error || err?.message || 'Failed to use Skip the Line pass');
        setOverlayPhase('error');
      },
    },
  });

  const isPending = usePassMutation.isPending || demoActionPending;

  const handleConfirm = async () => {
    if (!localDemoFlow || !params.entryId || isPending) return;
    setActionError(null);
    if (demoMode) {
      if (!params.flightId || !demoQueue || demoQueue.storageError) {
        setActionError(demoQueue?.storageError ?? 'This local queue is unavailable.');
        return;
      }
      setDemoActionPending(true);
      try {
        await demoQueue.usePass(params.flightId);
        pendingNavRef.current = goConfirmed;
        setOverlayPhase('success');
      } catch (error) {
        setActionError(error instanceof Error ? error.message : 'The local demo pass could not be used.');
      } finally {
        setDemoActionPending(false);
      }
      return;
    }
    setOverlayPhase('applying');
    usePassMutation.mutate({ id: params.entryId });
  };

  const handleOverlayDone = () => {
    setOverlayPhase(null);
    const nav = pendingNavRef.current;
    pendingNavRef.current = null;
    nav?.();
  };

  const routeLabel = `${params.from ?? '—'} → ${params.to ?? '—'}`;
  const canConfirm = passCount > 0 &&
    (!demoMode || (demoEntry?.status === 'waiting' && !demoQueue?.storageError));

  if (!localDemoFlow) {
    return <ProductionReadOnlyNotice flightId={params.flightId} />;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundMid, paddingTop: topPad }]}>
      {overlayPhase && (
        <ApplyingPassOverlay
          phase={overlayPhase}
          onDone={handleOverlayDone}
          successHeadline={alreadyConfirmed ? 'Your seat is already confirmed' : undefined}
          subline={alreadyConfirmed ? 'No pass was used — you were confirmed while waiting' : undefined}
        />
      )}
      <FloatingBackButton variant="brand" />

      <View style={[styles.top, { paddingTop: 76 }]}>
        <Text style={[styles.title, { color: colors.mutedOnBrand }]}>
          <Text style={{ color: colors.textOnBrand }}>Skip the Line Pass</Text> immediately wins this flight and closes its queue
        </Text>
        <Text style={[styles.body, { color: colors.mutedOnBrand }]}>
          A pass skips the waiting list, awards the seat to you, and closes this flight's queue.
        </Text>

        <View style={[styles.balanceCard, { backgroundColor: colors.textOnBrand + '0A', borderColor: colors.textOnBrand + '14' }]}>
          <View>
            <Text style={[styles.balanceLabel, { color: colors.mutedOnBrand }]}>SKIP THE LINE PASS BALANCE</Text>
            <Text
              testID={demoMode ? 'full-app-demo-pass-balance-confirmation' : undefined}
              style={[styles.balanceValue, { color: colors.textOnBrand }]}
            >
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

      <Modal
        visible={!overlayPhase}
        transparent
        animationType="slide"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => router.back()}
      >
        <Pressable
          style={[styles.modalBackdrop, { backgroundColor: colors.backgroundMid + 'CC' }]}
          onPress={() => router.back()}
          accessibilityLabel="Dismiss pass confirmation"
        >
          <Pressable
            style={[styles.sheet, { backgroundColor: colors.backgroundMid, borderColor: colors.textOnBrand + '18', paddingBottom: bottomPad + 16 }]}
            onPress={(event) => event.stopPropagation()}
          >
            <View style={[styles.sheetHandle, { backgroundColor: colors.mutedOnBrand + '66' }]} />
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
              testID={demoMode ? 'full-app-demo-confirm-pass' : undefined}
              onPress={handleConfirm}
              loading={isPending}
              disabled={!canConfirm}
              style={{ marginTop: 4 }}
            />
            <TouchableOpacity style={styles.cancelBtn} onPress={() => router.back()} activeOpacity={0.7}>
              <Text style={[styles.cancelBtnText, { color: colors.mutedOnBrand }]}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  top: { flex: 1, paddingHorizontal: 22, gap: 16 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 23, lineHeight: 30, letterSpacing: -0.35 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 },
  balanceCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderRadius: 14, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 16,
  },
  balanceLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 0.6, marginBottom: 4 },
  balanceValue: { fontFamily: 'Inter_700Bold', fontSize: 20 },
  buyMoreBtn: { borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
  buyMoreText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1,
    paddingHorizontal: 22, paddingTop: 13, gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: -8 }, shadowRadius: 24, shadowOpacity: 0.24, elevation: 16,
  },
  sheetHandle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, marginBottom: 7 },
  sheetTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, letterSpacing: -0.2 },
  sheetBody: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  noPasses: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  cancelBtn: { alignItems: 'center', paddingVertical: 8 },
  cancelBtnText: { fontFamily: 'Inter_400Regular', fontSize: 14 },
});
