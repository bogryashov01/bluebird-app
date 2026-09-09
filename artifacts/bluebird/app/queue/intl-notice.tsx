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
import { FlightUnavailableState } from '@/components/FlightUnavailableState';

// Dark "International Flight Notice" — shown only to Base members joining an
// international flight. Plus waives the fee.
export default function InternationalNoticeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    flightId: string; fromCity: string; toCity: string;
    from: string; to: string; useLinePass?: string; passengers?: string;
    feeUsd?: string; flightStatus?: string; bringingPet?: string; petFeeAcknowledged?: string;
    petWeightLbs?: string; petCrateLengthIn?: string; petCrateWidthIn?: string; petCrateHeightIn?: string;
  }>();
  const { flightId } = params;
  const bringingPet = params.bringingPet === '1';
  const fee = parseInt(params.feeUsd ?? '1000', 10) || 1000;
  // Re-check the flight's current status when the screen loads so members
  // aren't offered fee/upgrade choices for a flight they can no longer join.
  const { data: liveFlight } = useGetFlight(flightId!, {
    query: { enabled: !!flightId, queryKey: [`/api/flights/${flightId}`] },
  });
  const flightUnavailable =
    !!liveFlight && (liveFlight as any).status !== 'available';

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const handleContinueBase = () => {
    if (!flightId) return;
    router.push({
      pathname: '/queue/payment-review',
      params: {
        ...params,
        bringingPet: bringingPet ? '1' : '0',
        petFeeAcknowledged: params.petFeeAcknowledged === '1' ? '1' : '0',
        ...(bringingPet ? {
          petWeightLbs: params.petWeightLbs ?? '',
          petCrateLengthIn: params.petCrateLengthIn ?? '',
          petCrateWidthIn: params.petCrateWidthIn ?? '',
          petCrateHeightIn: params.petCrateHeightIn ?? '',
        } : {}),
      },
    });
  };

  // ── Flight no longer available: friendly full-screen state ──
  if (flightUnavailable) {
    return <FlightUnavailableState status={(liveFlight as any)?.status} bottomPad={bottomPad} />;
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
          This flight crosses an international border. As a Base member, a one-time
          international hold applies — or upgrade to Plus to waive it and unlock more benefits.
        </Text>

        <View style={[styles.feeRow, { backgroundColor: colors.textOnBrand + '0A', borderColor: colors.textOnBrand + '14' }]}>
          <Text style={[styles.feeLabel, { color: colors.mutedOnBrand }]}>International Hold</Text>
          <Text style={[styles.feeValue, { color: colors.textOnBrand }]}>${fee.toLocaleString()}</Text>
        </View>

        <View style={[styles.plusCard, { backgroundColor: colors.primary + '1F', borderColor: colors.primary + '59' }]}>
          <Text style={[styles.plusTitle, { color: colors.textOnBrand }]}>Plus Membership waives this hold</Text>
          <Text style={[styles.plusBody, { color: colors.mutedOnBrand }]}>
            Plus unlocks priority notifications, earlier access and complimentary Skip the Line Passes.
          </Text>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: bottomPad + 12 }]}>
        <PrimaryButton label="Upgrade to Plus" onPress={() => router.push('/upgrade/plus')} />
        <SecondaryButton
          label={`Review $${fee.toLocaleString()} authorization hold`}
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
  content: { paddingHorizontal: 22, paddingBottom: 24, gap: 16 },
  globeBadge: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontFamily: 'Inter_700Bold', fontSize: 24 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, marginTop: -6 },
  feeRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderRadius: 14, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 16,
  },
  feeLabel: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  feeValue: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  plusCard: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 6 },
  plusTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14.5 },
  plusBody: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  footer: { paddingHorizontal: 22, paddingTop: 12, gap: 10 },
});
