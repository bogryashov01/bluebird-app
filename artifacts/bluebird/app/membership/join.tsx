import React from 'react';
import {
  ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useProductionMembershipPlans } from '@/hooks/useProductionMembershipPlans';
import { TIER_COLORS } from '@/lib/membershipPlans';
import {
  formatProductionPlanPrice,
  productionPlanPurchaseNotice,
} from '@/lib/productionMembershipPlans';

export default function MembershipRequiredScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const plansQuery = useProductionMembershipPlans();

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]}>
      {plansQuery.isLoading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : plansQuery.isError || !plansQuery.data ? (
        <View style={styles.loadingState}>
          <Text style={[styles.errorText, { color: colors.textOnSurface }]}>Could not load production plans.</Text>
          <Text style={[styles.errorBody, { color: colors.mutedForegroundLight }]}>
            Plan details are unavailable. Demo pricing is not shown.
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
            Joining flight queues and Skip the Line passes are member features. Review the current public plans below.
          </Text>

          {plansQuery.data.plans.map((plan) => {
            const planColor = TIER_COLORS[plan.tier as keyof typeof TIER_COLORS] ?? colors.primary;
            return (
              <View
                key={plan.tier}
                style={[
                  styles.planCard,
                  { backgroundColor: colors.surface, borderColor: plan.highlight ? colors.primary : colors.border },
                  plan.highlight && { borderWidth: 1.5 },
                ]}
              >
                {plan.highlight && (
                  <View style={[styles.highlightPill, { backgroundColor: colors.primary + '1A' }]}>
                    <Text style={[styles.highlightText, { color: colors.primary }]}>HIGHLIGHTED</Text>
                  </View>
                )}
                <View style={styles.planHeader}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.planName, { color: planColor }]}>{plan.name}</Text>
                    <Text style={[styles.planPrice, { color: colors.textOnSurface }]}>
                      {formatProductionPlanPrice(plan)}
                    </Text>
                  </View>
                  <TouchableOpacity
                    testID={`plan-purchase-unavailable-${plan.tier}`}
                    disabled
                    accessibilityState={{ disabled: true }}
                    style={[styles.chooseBtn, { backgroundColor: colors.muted }]}
                  >
                    <Text style={[styles.chooseBtnText, { color: colors.mutedForegroundLight }]}>Unavailable</Text>
                  </TouchableOpacity>
                </View>
                <Text style={[styles.planTagline, { color: colors.mutedForegroundLight }]}>{plan.tagline}</Text>
                {(plansQuery.data.cardFeatures[plan.tier] ?? []).map((feature) => (
                  <View key={feature} style={styles.featureRow}>
                    <Text style={[styles.featureCheck, { color: colors.primary }]}>✓</Text>
                    <Text style={[styles.featureText, { color: colors.textOnSurface }]}>{feature}</Text>
                  </View>
                ))}
              </View>
            );
          })}
          <Text style={[styles.demoNote, { color: colors.mutedForegroundLight }]}>
            {productionPlanPurchaseNotice(plansQuery.data.availability)} No checkout or membership change is available.
          </Text>
          <TouchableOpacity
            style={styles.comparisonLink}
            activeOpacity={0.7}
            onPress={() => router.push('/membership/plans' as any)}
          >
            <Text style={[styles.comparisonLinkText, { color: colors.primary }]}>View full plan comparison</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loadingState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28 },
  errorText: { fontFamily: 'Inter_500Medium', fontSize: 15, textAlign: 'center' },
  errorBody: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 6 },
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
  highlightPill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 8 },
  highlightText: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.8 },
  planHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  planName: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  planPrice: { fontFamily: 'Inter_600SemiBold', fontSize: 13, marginTop: 2 },
  chooseBtn: { borderRadius: 999, paddingHorizontal: 15, paddingVertical: 9, flexShrink: 0 },
  chooseBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  planTagline: { fontFamily: 'Inter_400Regular', fontSize: 12.5, lineHeight: 18, marginTop: 7, marginBottom: 8 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  featureCheck: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  featureText: { fontFamily: 'Inter_400Regular', fontSize: 13, flex: 1 },
  demoNote: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 6 },
  comparisonLink: { alignSelf: 'center', paddingVertical: 14 },
  comparisonLinkText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, textDecorationLine: 'underline' },
});
