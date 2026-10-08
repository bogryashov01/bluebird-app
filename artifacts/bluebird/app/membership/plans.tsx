import React from 'react';
import {
  ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGetMembership } from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { useProductionMembershipPlans } from '@/hooks/useProductionMembershipPlans';
import { getTierLabel, TIER_COLORS, TIER_ORDER } from '@/lib/membershipPlans';
import {
  formatProductionPlanPrice,
  productionPlanFeatureLabel,
  productionPlanPurchaseNotice,
} from '@/lib/productionMembershipPlans';

export default function AllPlansScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { user } = useAuth();
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const { data: membership } = useGetMembership({});
  const plansQuery = useProductionMembershipPlans();
  const currentTier: string | null = membership?.tier ?? user?.membershipTier ?? null;
  const currentIdx = currentTier ? (TIER_ORDER[currentTier] ?? -1) : -1;

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
        <Text style={[styles.errorTitle, { color: colors.textOnSurface }]}>Could not load production plans</Text>
        <Text style={[styles.errorBody, { color: colors.mutedForegroundLight }]}>
          Plan details are unavailable. Demo pricing is not shown.
        </Text>
        <TouchableOpacity
          style={[styles.retryBtn, { backgroundColor: colors.primary }]}
          onPress={() => plansQuery.refetch()}
        >
          <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const catalog = plansQuery.data;
  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: botPad + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {currentTier && (
          <Text style={[styles.currentMembership, { color: colors.mutedForegroundLight }]}>
            Current membership: {getTierLabel(currentTier, membership?.plans ?? [])}
          </Text>
        )}
        {catalog.plans.map((plan) => {
          const planColor = TIER_COLORS[plan.tier as keyof typeof TIER_COLORS] ?? colors.primary;
          const isCurrent = plan.tier === currentTier;
          const canUpgrade = !!currentTier && (TIER_ORDER[plan.tier] ?? -1) > currentIdx;
          return (
            <View
              key={plan.tier}
              style={[
                styles.tierCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
                isCurrent && { borderColor: planColor, borderWidth: 2 },
              ]}
            >
              <View style={styles.tierCardHeader}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.tierNameRow}>
                    <Text style={[styles.tierName, { color: planColor }]}>{plan.name}</Text>
                    {isCurrent && (
                      <View style={[styles.currentBadge, { backgroundColor: planColor + '20' }]}>
                        <Text style={[styles.currentBadgeText, { color: planColor }]}>Current</Text>
                      </View>
                    )}
                    {plan.highlight && (
                      <View style={[styles.currentBadge, { backgroundColor: colors.primary + '1A' }]}>
                        <Text style={[styles.currentBadgeText, { color: colors.primary }]}>Highlighted</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.tierPrice, { color: colors.textOnSurface }]}>
                    {formatProductionPlanPrice(plan)}
                  </Text>
                  <Text style={[styles.tierTagline, { color: colors.mutedForegroundLight }]}>
                    {plan.tagline}
                  </Text>
                </View>
              </View>

              <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight }]}>Plan features</Text>
              {catalog.features.map((feature) => (
                <View key={feature.label} style={styles.featureRow}>
                  <Text style={[styles.featureName, { color: colors.textOnSurface }]}>{feature.label}</Text>
                  <Text style={[styles.featureValue, { color: colors.mutedForegroundLight }]}>
                    {productionPlanFeatureLabel(feature.values[plan.tier])}
                  </Text>
                </View>
              ))}

              <Text style={[styles.sectionLabel, styles.cardFeaturesLabel, { color: colors.mutedForegroundLight }]}>
                Card features
              </Text>
              {catalog.cardFeatures[plan.tier].map((feature) => (
                <View key={feature} style={styles.cardFeatureRow}>
                  <Text style={[styles.featureCheck, { color: colors.primary }]}>✓</Text>
                  <Text style={[styles.cardFeatureText, { color: colors.textOnSurface }]}>{feature}</Text>
                </View>
              ))}
              {canUpgrade && (
                <Text style={[styles.purchaseUnavailable, { color: colors.mutedForegroundLight }]}>
                  Upgrade purchases are unavailable.
                </Text>
              )}
            </View>
          );
        })}
        <View style={[styles.availabilityCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.availabilityTitle, { color: colors.textOnSurface }]}>Availability</Text>
          <Text style={[styles.availabilityText, { color: colors.mutedForegroundLight }]}>
            Signups: {catalog.availability.signupsEnabled ? 'enabled' : 'unavailable'} · Charter:{' '}
            {catalog.availability.charterEnabled ? 'available' : 'unavailable'} · Buy now:{' '}
            {catalog.availability.buyNowEnabled ? 'enabled' : 'unavailable'}
          </Text>
          <Text style={[styles.availabilityText, { color: colors.mutedForegroundLight }]}>
            {productionPlanPurchaseNotice(catalog.availability)}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorState: { paddingHorizontal: 28 },
  errorTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 18, textAlign: 'center' },
  errorBody: { fontFamily: 'Inter_400Regular', fontSize: 14, textAlign: 'center', marginTop: 6 },
  retryBtn: { borderRadius: 999, paddingHorizontal: 22, paddingVertical: 11, marginTop: 16 },
  retryText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  scroll: { paddingHorizontal: 16, paddingTop: 16 },
  currentMembership: { fontFamily: 'Inter_500Medium', fontSize: 13, marginBottom: 12 },
  tierCard: {
    borderRadius: 18, borderWidth: 1, marginBottom: 12, overflow: 'hidden',
    paddingBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2,
  },
  tierCardHeader: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  tierNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' },
  tierName: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  tierPrice: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  tierTagline: { fontFamily: 'Inter_400Regular', fontSize: 12.5, lineHeight: 18, marginTop: 6 },
  currentBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  currentBadgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 10 },
  sectionLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 6 },
  cardFeaturesLabel: { paddingTop: 12 },
  featureRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  featureName: { fontFamily: 'Inter_400Regular', fontSize: 12.5, flex: 1 },
  featureValue: { fontFamily: 'Inter_500Medium', fontSize: 12.5, textAlign: 'right', flexShrink: 0 },
  cardFeatureRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 4 },
  featureCheck: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  cardFeatureText: { fontFamily: 'Inter_400Regular', fontSize: 12.5, flex: 1 },
  purchaseUnavailable: { fontFamily: 'Inter_600SemiBold', fontSize: 12, paddingHorizontal: 16, paddingTop: 12 },
  availabilityCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12 },
  availabilityTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14, marginBottom: 6 },
  availabilityText: { fontFamily: 'Inter_400Regular', fontSize: 12.5, lineHeight: 18, marginTop: 3 },
});
