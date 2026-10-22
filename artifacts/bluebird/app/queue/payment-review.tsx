import React, { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { FloatingBackButton } from '@/components/FloatingBackButton';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ApplyingPassOverlay, ApplyingPassPhase } from '@/components/ApplyingPassOverlay';
import { FlightUnavailableState } from '@/components/FlightUnavailableState';
import { ProductionReadOnlyNotice } from '@/components/ProductionReadOnlyNotice';
import { useGetFlight, useJoinQueue } from '@workspace/api-client-react';
import { useQuery } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { usePersistedState } from '@/hooks/usePersistedState';
import { INITIAL_CARDS, type MockCard } from '@/lib/paymentMethods';
import { isLocalFlightReadMode } from '@/lib/productionFlights';
import * as Haptics from 'expo-haptics';
import { fetchFullAppDemoFlight } from '@/lib/fullAppDemoLiveReads';
import { parseProductionFlightId } from '@/lib/productionFlights';
import { useFullAppDemoQueueOptional } from '@/lib/fullAppDemoQueue';

type PaymentReviewParams = {
  flightId: string;
  fromCity?: string; toCity?: string; from?: string; to?: string;
  useLinePass?: string; feeUsd?: string;
  flightStatus?: string; departureDate?: string; departureTime?: string;
  duration?: string; aircraftType?: string; international?: string;
  bringingPet?: string; petFeeAcknowledged?: string;
  petWeightLbs?: string;
};

export default function InternationalPaymentReviewScreen() {
  const colors = useColors();
  const { user, updateUser, demoMode } = useAuth();
  const localDemoFlow = demoMode || isLocalFlightReadMode();
  const demoQueue = useFullAppDemoQueueOptional();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<PaymentReviewParams>();
  const queryClient = useQueryClient();
  const [cards, , cardsHydrated] = usePersistedState<MockCard[]>(
    localDemoFlow
      ? (user ? `bluebird.paymentMethods.${user.id}` : 'bluebird.paymentMethods.unavailable')
      : 'bluebird.paymentMethods.production-read-only',
    localDemoFlow ? INITIAL_CARDS : [],
  );
  const [joinError, setJoinError] = useState<string | null>(null);
  const [rejectedUnavailable, setRejectedUnavailable] = useState(false);
  const [overlayPhase, setOverlayPhase] = useState<ApplyingPassPhase | null>(null);
  const pendingNavRef = useRef<(() => void) | null>(null);

  const useLinePass = params.useLinePass === '1';
  const bringingPet = params.bringingPet === '1';
  const petFeeAcknowledged = params.petFeeAcknowledged === '1';
  const fee = parseInt(params.feeUsd ?? '1000', 10) || 1000;
  const routeFrom = params.fromCity ?? params.from ?? 'Origin';
  const routeTo = params.toCity ?? params.to ?? 'Destination';
  const defaultCard = cards.find((card) => card.isDefault) ?? cards[0];
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const { data: liveFlight } = useGetFlight(params.flightId!, {
    query: { enabled: localDemoFlow && !demoMode && !!params.flightId, queryKey: [`/api/flights/${params.flightId}`] },
  });
  const numericFlightId = parseProductionFlightId(params.flightId);
  const demoFlightQuery = useQuery({
    queryKey: ['full-app-demo-flight', numericFlightId],
    queryFn: ({ signal }) => fetchFullAppDemoFlight(numericFlightId!, { signal }),
    enabled: demoMode && numericFlightId !== null,
  });
  const currentFlightStatus = demoMode ? demoFlightQuery.data?.status : (liveFlight as any)?.status;
  const flightUnavailable =
    rejectedUnavailable || (!!currentFlightStatus && currentFlightStatus !== 'available' && currentFlightStatus !== 'published');

  const petMeasurements = bringingPet ? {
    petWeightLbs: Number(params.petWeightLbs),
  } : {};

  const joinMutation = useJoinQueue({
    mutation: {
      onSuccess: async (entry: any) => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        queryClient.invalidateQueries({ queryKey: ['/api/queue/status'] });
        queryClient.invalidateQueries({ queryKey: [`/api/flights/${params.flightId}/my-status`] });
        queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
        if (useLinePass && user) {
          updateUser({ ...user, linePassCount: Math.max(0, (user.linePassCount ?? 0) - 1) });
        }

        if (entry?.status === 'confirmed') {
          queryClient.invalidateQueries({ queryKey: ['/api/trips'] });
          const nav = () => router.replace({
            pathname: '/flight/confirmed',
            params: {
              ...params,
              ...(useLinePass ? { passUsed: '1' } : {}),
              petFeeUsd: bringingPet ? '500' : '0',
            },
          });
          if (useLinePass) {
            pendingNavRef.current = nav;
            setOverlayPhase('success');
          } else {
            nav();
          }
          return;
        }

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
          pendingNavRef.current = navJoined;
          setOverlayPhase('error');
        } else {
          navJoined();
        }
      },
      onError: (err: any) => {
        const code = err?.response?.data?.code || err?.data?.code;
        if (code === 'MEMBERSHIP_REQUIRED') {
          setOverlayPhase(null);
          router.replace({
            pathname: '/membership/join' as any,
            params,
          });
          return;
        }
        const msg = err?.response?.data?.error || err?.data?.error || err?.message || 'Failed to join queue';
        if (/no longer available/i.test(msg)) {
          setRejectedUnavailable(true);
        } else {
          setJoinError(msg);
        }
        setOverlayPhase((phase) => (phase ? 'error' : phase));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      },
    },
  });

  const [demoJoinPending, setDemoJoinPending] = useState(false);
  const handleConfirm = async () => {
    if (!localDemoFlow || !params.flightId || joinMutation.isPending || demoJoinPending || (!demoMode && !cardsHydrated)) return;
    setJoinError(null);
    if (demoMode) {
      if (!demoQueue?.hydrated || !demoFlightQuery.data || demoQueue.storageError) {
        setJoinError(demoQueue?.storageError ?? 'The selected flight is not ready. Try again when its details load.');
        return;
      }
      const existing = demoQueue.entries.find((entry) => entry.flightId === params.flightId);
      if (existing) {
        router.replace({ pathname: '/queue/status', params: { entryId: existing.id, flightId: existing.flightId } });
        return;
      }
      setDemoJoinPending(true);
      try {
        await demoQueue.joinFlight(demoFlightQuery.data);
        const position = demoQueue.entries.length + 1;
        router.replace({
          pathname: '/queue/joined',
          params: {
            ...params,
            entryId: `demo-${params.flightId}`,
            position: String(position),
            totalInQueue: String(position),
            flightStatus: demoFlightQuery.data.status ?? 'available',
          },
        } as any);
      } catch (error) {
        setJoinError(error instanceof Error ? error.message : 'The local demo queue could not be updated.');
      } finally {
        setDemoJoinPending(false);
      }
      return;
    }
    if (useLinePass) setOverlayPhase('applying');
    joinMutation.mutate({
      data: {
        flightId: params.flightId,
        useLinePass,
        acceptIntlFee: true,
        bringingPet,
        petFeeAcknowledged,
        ...petMeasurements,
      } as any,
    });
  };

  const handleOverlayDone = () => {
    setOverlayPhase(null);
    const nav = pendingNavRef.current;
    pendingNavRef.current = null;
    nav?.();
  };

  if (!localDemoFlow) {
    return <ProductionReadOnlyNotice flightId={params.flightId} />;
  }

  if (flightUnavailable) {
    return <FlightUnavailableState status={currentFlightStatus} bottomPad={bottomPad} />;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.offWhite }]}>
      {overlayPhase && <ApplyingPassOverlay phase={overlayPhase} onDone={handleOverlayDone} />}
      <FloatingBackButton />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: topPad + 70, paddingBottom: 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.eyebrowRow, { backgroundColor: colors.primary + '14' }]}>
          <Feather name="lock" size={13} color={colors.primary} />
          <Text style={[styles.eyebrow, { color: colors.primary }]}>PAYMENT REVIEW</Text>
        </View>
        <Text style={[styles.title, { color: colors.textOnSurface }]}>
          {demoMode ? 'Review the international demo step' : 'Review your international hold'}
        </Text>
        <Text style={[styles.subtitle, { color: colors.mutedForegroundLight }]}>
          {demoMode
            ? 'Continue to add this flight to the local Preview queue.'
            : 'Confirm the authorization hold before joining the waiting queue.'}
        </Text>
        <Text style={[styles.subtitle, { color: colors.mutedForegroundLight, fontWeight: '600' }]}>
          Local demo only — no real card authorization or charge is made.
        </Text>

        <View style={[styles.routeCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.routeIcon, { backgroundColor: colors.primary + '14' }]}>
            <Feather name="globe" size={19} color={colors.primary} />
          </View>
          <View style={styles.routeCopy}>
            <Text style={[styles.routeLabel, { color: colors.mutedForegroundLight }]}>SELECTED FLIGHT</Text>
            <Text style={[styles.routeText, { color: colors.textOnSurface }]}>{routeFrom} → {routeTo}</Text>
            {!!params.departureDate && (
              <Text style={[styles.routeMeta, { color: colors.mutedForegroundLight }]}>
                {params.departureDate}{params.departureTime ? ` · ${params.departureTime}` : ''}
              </Text>
            )}
          </View>
        </View>

        <View style={[styles.amountCard, { backgroundColor: colors.primary, borderColor: colors.primary }]}>
          <View style={styles.amountHeader}>
            <View style={[styles.amountIcon, { backgroundColor: colors.primaryForeground + '20' }]}>
              <Feather name="shield" size={21} color={colors.primaryForeground} />
            </View>
            <Text style={[styles.amountLabel, { color: colors.primaryForeground + 'CC' }]}>INTERNATIONAL FLIGHT</Text>
          </View>
          <Text style={[styles.amount, { color: colors.primaryForeground }]}>
            {demoMode ? `$${fee.toLocaleString()} demo-only fee` : `$${fee.toLocaleString()} authorization hold`}
          </Text>
          <Text style={[styles.amountSub, { color: colors.primaryForeground + 'D9' }]}>
            {demoMode ? 'No card authorization or charge is made in this Preview.' : 'Placed on your saved card when you join'}
          </Text>
        </View>

        <View style={[styles.explanationCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.textOnSurface }]}>
            {demoMode ? 'Local Preview outcome' : 'How the hold works'}
          </Text>
          <ExplanationRow
            colors={colors}
            icon={demoMode ? 'smartphone' : 'credit-card'}
            title={demoMode ? 'The fee is display-only' : 'The hold is placed now'}
            body={demoMode
              ? 'This screen stores a simulated queue entry only. It does not authorize a card or record a fee.'
              : `A ${`$${fee.toLocaleString()}`} authorization hold is placed on your card when you join the queue.`}
          />
          <ExplanationRow
            colors={colors}
            icon={demoMode ? 'check-circle' : 'check-circle'}
            title={demoMode ? 'No payment is processed' : 'You are charged only if you take the flight'}
            body={demoMode
              ? 'Continue to the Queue Success screen with no billing or membership changes.'
              : 'The hold becomes a charge only when you actually take this flight.'}
          />
          {!demoMode && (
            <ExplanationRow
              colors={colors}
              icon="rotate-ccw"
              title="The hold is released if you do not take the flight"
              body="If you do not take the flight, the authorization is released instead of becoming a charge."
              last
            />
          )}
        </View>

        {!demoMode && <View style={[styles.cardCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Text style={[styles.sectionTitle, { color: colors.textOnSurface }]}>Payment method</Text>
            <Feather name="credit-card" size={18} color={colors.mutedForegroundLight} />
          </View>
          {defaultCard ? (
            <View style={styles.savedCardRow}>
              <View style={[styles.cardChip, { backgroundColor: colors.primary + '14' }]}>
                <Text style={[styles.cardChipText, { color: colors.primary }]}>{defaultCard.brand}</Text>
              </View>
              <View style={styles.savedCardCopy}>
                <Text style={[styles.savedCardNumber, { color: colors.textOnSurface }]}>
                  •••• {defaultCard.last4}
                </Text>
                <Text style={[styles.savedCardMeta, { color: colors.mutedForegroundLight }]}>
                  Default · Expires {defaultCard.expiry}
                </Text>
              </View>
              <Feather name="check-circle" size={19} color={colors.success} />
            </View>
          ) : (
            <Text style={[styles.noCardText, { color: colors.mutedForegroundLight }]}>
              No saved card is selected. This demo review does not connect to a billing provider.
            </Text>
          )}
        </View>}

        <View style={[styles.plusCard, { backgroundColor: colors.primary + '0D', borderColor: colors.primary + '44' }]}>
          <View style={styles.plusCopy}>
            <Text style={[styles.plusTitle, { color: colors.textOnSurface }]}>Prefer no international hold?</Text>
            <Text style={[styles.plusBody, { color: colors.mutedForegroundLight }]}>
              Upgrade to Plus and this fee is waived.
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push(demoMode ? '/membership/plans' : '/upgrade/plus' as any)}
            activeOpacity={0.8}
            style={[styles.plusButton, { borderColor: colors.primary }]}
          >
            <Text style={[styles.plusButtonText, { color: colors.primary }]}>See Plus</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.demoNote, { color: colors.mutedForegroundLight }]}>
          Demo review only — no real authorization, charge, or release is performed without a billing provider.
        </Text>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: bottomPad + 12 }]}>
        {!!joinError && (
          <View style={[styles.errorBox, { backgroundColor: colors.coral + '1A', borderColor: colors.coral + '55' }]}>
            <Feather name="alert-circle" size={15} color={colors.coral} />
            <Text style={[styles.errorText, { color: colors.coral }]}>{joinError}</Text>
          </View>
        )}
        <PrimaryButton
          label={demoMode ? 'Continue — Demo Only' : `Confirm $${fee.toLocaleString()} hold & join queue`}
          testID={demoMode ? 'full-app-demo-confirm-international' : undefined}
          onPress={handleConfirm}
          loading={joinMutation.isPending || demoJoinPending}
          disabled={(!demoMode && !cardsHydrated) || joinMutation.isPending || demoJoinPending ||
            (demoMode && (!demoQueue?.hydrated || !!demoQueue.storageError || demoFlightQuery.isLoading))}
        />
      </View>
    </View>
  );
}

function ExplanationRow({
  colors, icon, title, body, last = false,
}: {
  colors: ReturnType<typeof useColors>;
  icon: React.ComponentProps<typeof Feather>['name'];
  title: string;
  body: string;
  last?: boolean;
}) {
  return (
    <View style={[styles.explanationRow, !last && styles.explanationBorder, !last && { borderBottomColor: colors.border }]}>
      <View style={[styles.explanationIcon, { backgroundColor: colors.primary + '14' }]}>
        <Feather name={icon} size={15} color={colors.primary} />
      </View>
      <View style={styles.explanationCopy}>
        <Text style={[styles.explanationTitle, { color: colors.textOnSurface }]}>{title}</Text>
        <Text style={[styles.explanationBody, { color: colors.mutedForegroundLight }]}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 22, gap: 14 },
  eyebrowRow: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center',
    gap: 6, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6,
  },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.8 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 26, lineHeight: 33, marginTop: -2 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, marginTop: -6 },
  routeCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 16, borderWidth: 1, padding: 15,
  },
  routeIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  routeCopy: { flex: 1, gap: 3 },
  routeLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.6 },
  routeText: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  routeMeta: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  amountCard: { borderRadius: 18, borderWidth: 1, padding: 18, gap: 8 },
  amountHeader: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  amountIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  amountLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.8 },
  amount: { fontFamily: 'Inter_700Bold', fontSize: 24, marginTop: 3 },
  amountSub: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  explanationCard: { borderRadius: 18, borderWidth: 1, padding: 17 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, marginBottom: 4 },
  explanationRow: { flexDirection: 'row', gap: 11, paddingVertical: 13 },
  explanationBorder: { borderBottomWidth: 1 },
  explanationIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  explanationCopy: { flex: 1, gap: 3 },
  explanationTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 13.5, lineHeight: 18 },
  explanationBody: { fontFamily: 'Inter_400Regular', fontSize: 12.5, lineHeight: 18 },
  cardCard: { borderRadius: 18, borderWidth: 1, padding: 17, gap: 13 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  savedCardRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  cardChip: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  cardChipText: { fontFamily: 'Inter_700Bold', fontSize: 11 },
  savedCardCopy: { flex: 1, gap: 2 },
  savedCardNumber: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  savedCardMeta: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  noCardText: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  plusCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, borderWidth: 1, padding: 15 },
  plusCopy: { flex: 1, gap: 3 },
  plusTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 13.5 },
  plusBody: { fontFamily: 'Inter_400Regular', fontSize: 12.5, lineHeight: 18 },
  plusButton: { borderRadius: 999, borderWidth: 1.5, paddingHorizontal: 13, paddingVertical: 8 },
  plusButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 12.5 },
  demoNote: { fontFamily: 'Inter_400Regular', fontSize: 11.5, lineHeight: 17, textAlign: 'center', marginTop: -2 },
  footer: { paddingHorizontal: 22, paddingTop: 12, gap: 10 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 11 },
  errorText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 },
});