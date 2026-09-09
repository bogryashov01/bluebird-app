import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useGetMembership, type MembershipPlan } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { formatAnnualPrice, TIER_COLORS, TIER_TAGLINES } from '@/lib/membershipPlans';

// Membership-required paywall for non-members: shown when they try to join a
// queue, use a pass, or buy a pass. Explains that a plan purchase is needed
// and hands off to the (demo) purchase flow. The originating flightId is
// forwarded so the purchase success screen can return them to their flight.
export default function MembershipRequiredScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ flightId?: string }>();
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const { data: membership, isLoading, isError, refetch } = useGetMembership({});
  const plans: MembershipPlan[] = membership?.plans ?? [];

  const choosePlan = (tierId: string) => {
    router.push({
      pathname: `/upgrade/${tierId}` as any,
      params: params.flightId ? { returnFlightId: params.flightId } : {},
    });
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]}>
      {isLoading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : isError ? (
        <View style={styles.loadingState}>
          <Text style={[styles.errorText, { color: colors.textOnSurface }]}>Could not load plans.</Text>
          <TouchableOpacity style={[styles.retryBtn, { backgroundColor: colors.primary }]} onPress={() => refetch()}>
            <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : (
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: botPad + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.heroIcon, { backgroundColor: colors.primary + '1A' }]}>
          <Feather name="lock" size={26} color={colors.primary} />
        </View>
        <Text style={[styles.title, { color: colors.textOnSurface }]}>Membership required</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForegroundLight }]}>
          Joining flight queues and Skip the Line passes are member features.
          Choose a plan to join Bluebird and pick up right where you left off.
        </Text>

        {plans.map((plan) => {
          const isRecommended = plan.id === 'plus';
          const planColor = TIER_COLORS[plan.id];
          return (
          <View
            key={plan.id}
            style={[
              styles.planCard,
              { backgroundColor: colors.surface, borderColor: isRecommended ? colors.primary : colors.border },
              isRecommended && { borderWidth: 1.5 },
            ]}
          >
            {isRecommended && (
              <View style={[styles.recommendedPill, { backgroundColor: colors.primary + '1A' }]}>
                <Text style={[styles.recommendedText, { color: colors.primary }]}>RECOMMENDED</Text>
              </View>
            )}
            <View style={styles.planHeader}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.planName, { color: planColor }]}>{plan.label}</Text>
                <Text style={[styles.planPrice, { color: colors.mutedForegroundLight }]}>
                  {formatAnnualPrice(plan.priceAnnualUsd)}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.chooseBtn, { backgroundColor: planColor }]}
                onPress={() => choosePlan(plan.id)}
                activeOpacity={0.8}
              >
                <Text style={[styles.chooseBtnText, { color: colors.primaryForeground }]}>Choose</Text>
              </TouchableOpacity>
            </View>
            <Text style={[styles.planTagline, { color: colors.mutedForegroundLight }]}>{TIER_TAGLINES[plan.id]}</Text>
            {plan.features.map((feat) => (
              <View key={feat} style={styles.featureRow}>
                <Text style={[styles.featureCheck, { color: colors.primary }]}>✓</Text>
                <Text style={[styles.featureText, { color: colors.textOnSurface }]}>{feat}</Text>
              </View>
            ))}
          </View>
          );
        })}

        <Text style={[styles.demoNote, { color: colors.mutedForegroundLight }]}>
          Demo checkout — no real payment will be charged.
        </Text>
      </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loadingState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28 },
  errorText: { fontFamily: 'Inter_500Medium', fontSize: 15, textAlign: 'center' },
  retryBtn: { borderRadius: 999, paddingHorizontal: 22, paddingVertical: 11, marginTop: 16 },
  retryText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  scroll: { paddingHorizontal: 16, paddingTop: 20 },
  heroIcon: {
    width: 60, height: 60, borderRadius: 30, alignSelf: 'center',
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  title: { fontFamily: 'Inter_700Bold', fontSize: 24, textAlign: 'center', marginBottom: 8 },
  subtitle: {
    fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20,
    textAlign: 'center', marginBottom: 22, paddingHorizontal: 8,
  },
  planCard: {
    borderRadius: 18, borderWidth: 1, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2,
  },
  recommendedPill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 8 },
  recommendedText: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.8 },
  planHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  planName: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  planPrice: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 2 },
  chooseBtn: { borderRadius: 999, paddingHorizontal: 18, paddingVertical: 9, flexShrink: 0 },
  chooseBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  planTagline: { fontFamily: 'Inter_400Regular', fontSize: 12.5, marginTop: 6, marginBottom: 8 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  featureCheck: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  featureText: { fontFamily: 'Inter_400Regular', fontSize: 13, flex: 1 },
  demoNote: { fontFamily: 'Inter_400Regular', fontSize: 12, textAlign: 'center', marginTop: 6 },
});
