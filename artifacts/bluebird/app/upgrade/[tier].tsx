import React from 'react';
import {
  ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useProductionMembershipPlans } from '@/hooks/useProductionMembershipPlans';
import { TIER_COLORS } from '@/lib/membershipPlans';
import {
  formatProductionPlanPrice,
  productionPlanFeatureLabel,
  productionPlanPurchaseNotice,
} from '@/lib/productionMembershipPlans';

export default function UpgradeScreen() {
  const { tier } = useLocalSearchParams<{ tier: string }>();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const plansQuery = useProductionMembershipPlans();

  if (plansQuery.isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.offWhite }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }
  if (plansQuery.isError || !plansQuery.data) {
    return (
      <View style={[styles.centered, styles.errorState, { backgroundColor: colors.offWhite }]}>
        <Text style={[styles.errorTitle, { color: colors.textOnSurface }]}>Plan information unavailable</Text>
        <Text style={[styles.errorBody, { color: colors.mutedForegroundLight }]}>
          We couldn’t load plan details. Please try again.
        </Text>
        <TouchableOpacity
          style={[styles.retryBtn, { backgroundColor: colors.primary }]}
          disabled={plansQuery.isFetching}
          onPress={() => plansQuery.refetch()}
        >
          {plansQuery.isFetching
            ? <ActivityIndicator color={colors.primaryForeground} />
            : <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Try Again</Text>}
        </TouchableOpacity>
      </View>
    );
  }

  const plan = plansQuery.data.plans.find((entry) => entry.tier === tier);
  if (!plan) {
    return (
      <View style={[styles.centered, styles.errorState, { backgroundColor: colors.offWhite }]}>
        <Text style={[styles.errorTitle, { color: colors.textOnSurface }]}>Plan not listed</Text>
        <Text style={[styles.errorBody, { color: colors.mutedForegroundLight }]}>
          This plan is not in the current public production catalog.
        </Text>
        <TouchableOpacity
          style={[styles.retryBtn, { backgroundColor: colors.primary }]}
          onPress={() => router.replace('/membership/plans' as any)}
        >
          <Text style={[styles.retryText, { color: colors.primaryForeground }]}>View public plans</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const planColor = TIER_COLORS[plan.tier as keyof typeof TIER_COLORS] ?? colors.primary;
  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: botPad + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.planCard, { backgroundColor: planColor }]}>
          {plan.highlight && <Text style={styles.highlight}>HIGHLIGHTED</Text>}
          <Text style={[styles.planEyebrow, { color: colors.primaryForeground + 'BF' }]}>PUBLIC PRODUCTION PLAN</Text>
          <Text style={[styles.planLabel, { color: colors.primaryForeground }]}>{plan.name}</Text>
          <Text style={[styles.planPrice, { color: colors.primaryForeground + 'E6' }]}>
            {formatProductionPlanPrice(plan)}
          </Text>
          <Text style={[styles.planTagline, { color: colors.primaryForeground + 'BF' }]}>{plan.tagline}</Text>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight }]}>Plan features</Text>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          {plansQuery.data.features.map((feature, index) => (
            <View
              key={feature.label}
              style={[styles.featureRow, index > 0 && { borderTopWidth: 1, borderTopColor: colors.separator }]}
            >
              <Text style={[styles.featureName, { color: colors.textOnSurface }]}>{feature.label}</Text>
              <Text style={[styles.featureValue, { color: colors.mutedForegroundLight }]}>
                {productionPlanFeatureLabel(feature.values[plan.tier])}
              </Text>
            </View>
          ))}
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight }]}>Card features</Text>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          {plansQuery.data.cardFeatures[plan.tier].map((feature, index) => (
            <View
              key={feature}
              style={[styles.cardFeatureRow, index > 0 && { borderTopWidth: 1, borderTopColor: colors.separator }]}
            >
              <Text style={[styles.featureCheck, { color: planColor }]}>✓</Text>
              <Text style={[styles.cardFeatureText, { color: colors.textOnSurface }]}>{feature}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.unavailableCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.unavailableTitle, { color: colors.textOnSurface }]}>
            Membership purchase unavailable
          </Text>
          <Text style={[styles.unavailableBody, { color: colors.mutedForegroundLight }]}>
            {productionPlanPurchaseNotice(plansQuery.data.availability)} This screen only displays public plan details.
          </Text>
        </View>
        <TouchableOpacity
          style={styles.comparisonLink}
          activeOpacity={0.7}
          onPress={() => router.replace('/membership/plans' as any)}
        >
          <Text style={[styles.comparisonLinkText, { color: colors.primary }]}>View full plan comparison</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorState: { paddingHorizontal: 28 },
  errorTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 18, textAlign: 'center' },
  errorBody: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 6 },
  retryBtn: { borderRadius: 999, paddingHorizontal: 22, paddingVertical: 11, marginTop: 16 },
  retryText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  scroll: { paddingHorizontal: 16, paddingTop: 16 },
  planCard: { borderRadius: 24, padding: 22, marginBottom: 22 },
  highlight: { color: '#FFFFFF', fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.8, marginBottom: 8 },
  planEyebrow: { fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 1, marginBottom: 6 },
  planLabel: { fontFamily: 'Inter_700Bold', fontSize: 22 },
  planPrice: { fontFamily: 'Inter_600SemiBold', fontSize: 16, marginTop: 4 },
  planTagline: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, marginTop: 8 },
  sectionLabel: {
    fontFamily: 'Inter_600SemiBold', fontSize: 12,
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10,
  },
  card: {
    borderRadius: 18, overflow: 'hidden', marginBottom: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2,
  },
  featureRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  featureName: { fontFamily: 'Inter_400Regular', fontSize: 13, flex: 1 },
  featureValue: { fontFamily: 'Inter_500Medium', fontSize: 13, textAlign: 'right', flexShrink: 0 },
  cardFeatureRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 11 },
  featureCheck: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  cardFeatureText: { fontFamily: 'Inter_400Regular', fontSize: 13, flex: 1 },
  unavailableCard: { borderRadius: 18, borderWidth: 1, padding: 16, marginBottom: 10 },
  unavailableTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  unavailableBody: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, marginTop: 5 },
  comparisonLink: { alignSelf: 'center', paddingVertical: 14 },
  comparisonLinkText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, textDecorationLine: 'underline' },
});
