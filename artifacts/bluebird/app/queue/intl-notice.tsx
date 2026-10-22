import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { FloatingBackButton } from '@/components/FloatingBackButton';
import { PrimaryButton, SecondaryButton } from '@/components/PrimaryButton';
import { useGetFlight } from '@workspace/api-client-react';
import { useQuery } from '@tanstack/react-query';
import { FlightUnavailableState } from '@/components/FlightUnavailableState';
import { ProductionReadOnlyNotice } from '@/components/ProductionReadOnlyNotice';
import { isLocalFlightReadMode } from '@/lib/productionFlights';
import { useAuth } from '@/context/AuthContext';
import { fetchFullAppDemoFlight } from '@/lib/fullAppDemoLiveReads';
import { parseProductionFlightId } from '@/lib/productionFlights';

// Dark "International Flight Notice" — shown only to Base members joining an
// international flight. Plus waives the fee.
export default function InternationalNoticeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { demoMode } = useAuth();
  const params = useLocalSearchParams<{
    flightId: string; fromCity: string; toCity: string;
    from: string; to: string; useLinePass?: string;
    feeUsd?: string; flightStatus?: string; bringingPet?: string; petFeeAcknowledged?: string;
    petWeightLbs?: string;
  }>();
  const { flightId } = params;
  const localDemoFlow = demoMode || isLocalFlightReadMode();
  const bringingPet = params.bringingPet === '1';
  const fee = 1000;
  // Re-check the flight's current status when the screen loads so members
  // aren't offered fee/upgrade choices for a flight they can no longer join.
  const { data: liveFlight } = useGetFlight(flightId!, {
    query: { enabled: localDemoFlow && !demoMode && !!flightId, queryKey: [`/api/flights/${flightId}`] },
  });
  const numericFlightId = parseProductionFlightId(flightId);
  const demoFlightQuery = useQuery({
    queryKey: ['full-app-demo-flight', numericFlightId],
    queryFn: ({ signal }) => fetchFullAppDemoFlight(numericFlightId!, { signal }),
    enabled: demoMode && numericFlightId !== null,
  });
  const currentFlightStatus = demoMode ? demoFlightQuery.data?.status : (liveFlight as any)?.status;
  const flightUnavailable =
    !!currentFlightStatus && currentFlightStatus !== 'available' && currentFlightStatus !== 'published';

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  if (!localDemoFlow) {
    return <ProductionReadOnlyNotice flightId={flightId} />;
  }

  const handleContinueBase = () => {
    if (!localDemoFlow || !flightId) return;
    router.push({
      pathname: '/queue/payment-review',
      params: {
        ...params,
        bringingPet: bringingPet ? '1' : '0',
        petFeeAcknowledged: params.petFeeAcknowledged === '1' ? '1' : '0',
        ...(bringingPet ? {
          petWeightLbs: params.petWeightLbs ?? '',
        } : {}),
      },
    });
  };

  // ── Flight no longer available: friendly full-screen state ──
  if (flightUnavailable) {
    return <FlightUnavailableState status={currentFlightStatus} bottomPad={bottomPad} />;
  }

  // Brand-navy surface in both modes — textOnBrand/mutedOnBrand tokens apply.
  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundMid }]}>
      <FloatingBackButton variant="brand" />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: topPad + 76 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.globeBadge, { backgroundColor: colors.primary + '26' }]}>
          <Feather name="globe" size={20} color={colors.primary} />
        </View>

        <Text style={[styles.title, { color: colors.textOnBrand }]}>International Flight Notice</Text>
        <Text style={[styles.body, { color: colors.mutedOnBrand }]}>
          This flight crosses an international border. Base members can pay a one-time
          $1,000 fee or choose Plus, which includes five Skip the Line Passes.
        </Text>
        <Text style={[styles.demoNotice, { color: colors.mutedOnBrand }]}>
          Local demo only — continuing records no real card authorization or payment.
        </Text>

        <View style={[styles.feeRow, { backgroundColor: colors.textOnBrand + '0A', borderColor: colors.textOnBrand + '18' }]}>
          <Text style={[styles.feeLabel, { color: colors.mutedOnBrand }]}>One-time Base fee</Text>
          <Text style={[styles.feeValue, { color: colors.textOnBrand }]}>${fee.toLocaleString()}</Text>
        </View>

        <View style={[styles.plusCard, { backgroundColor: colors.primary + '24', borderColor: colors.primary + '66' }]}>
          <View style={[styles.plusIcon, { backgroundColor: colors.primary + '35' }]}>
            <Feather name="star" size={15} color={colors.primaryForeground} />
          </View>
          <Text style={[styles.plusTitle, { color: colors.textOnBrand }]}>Choose Plus instead</Text>
          <Text style={[styles.plusBody, { color: colors.mutedOnBrand }]}>
            Plus is the alternative to the one-time Base fee and includes five Skip the Line Passes.
          </Text>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: bottomPad + 12 }]}>
        <PrimaryButton
          label="Upgrade to Plus"
          testID={demoMode ? 'full-app-demo-upgrade-plus' : undefined}
          onPress={() => router.push(demoMode ? '/membership/plans' : '/upgrade/plus' as any)}
        />
        <SecondaryButton
          label={`Continue with $${fee.toLocaleString()} international fee`}
          testID={demoMode ? 'full-app-demo-intl-continue' : undefined}
          onPress={handleContinueBase}
          backgroundColor={colors.textOnBrand + '14'}
          textColor={colors.textOnBrand}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 22, paddingBottom: 24, gap: 17 },
  globeBadge: {
    width: 46, height: 46, borderRadius: 23,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontFamily: 'Inter_700Bold', fontSize: 25, letterSpacing: -0.35 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, marginTop: -7 },
  demoNotice: { fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 17, marginTop: -8 },
  feeRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderRadius: 16, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 17,
  },
  feeLabel: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  feeValue: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  plusCard: { borderRadius: 17, borderWidth: 1, padding: 17, gap: 7 },
  plusIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  plusTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  plusBody: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  footer: { paddingHorizontal: 22, paddingTop: 12, gap: 10 },
});
