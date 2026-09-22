import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGetMembership, type MembershipPlan } from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { formatAnnualPrice, TIER_COLORS, TIER_ORDER } from '@/lib/membershipPlans';

export default function AllPlansScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { user } = useAuth();
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const { data: membership, isLoading, isError, refetch } = useGetMembership({});
  const mem = membership as any;
  const currentTier: string = mem?.tier ?? user?.membershipTier ?? 'base';
  const currentIdx = TIER_ORDER[currentTier] ?? 0;
  const isNonMember = currentTier === 'none';
  const plans: MembershipPlan[] = membership?.plans ?? [];

  const handleUpgrade = (tierId: string) => {
    if (TIER_ORDER[tierId] <= currentIdx) return;
    router.push(`/upgrade/${tierId}` as any);
  };

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.offWhite }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }
  if (isError || !membership) {
    return (
      <View style={[styles.centered, styles.errorState, { backgroundColor: colors.offWhite }]}>
        <Text style={[styles.errorTitle, { color: colors.textOnSurface }]}>Could not load plans</Text>
        <Text style={[styles.errorBody, { color: colors.mutedForegroundLight }]}>Check your connection and try again.</Text>
        <TouchableOpacity style={[styles.retryBtn, { backgroundColor: colors.primary }]} onPress={() => refetch()}>
          <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: botPad + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {plans.map((tier) => {
          const isCurrent = tier.id === currentTier;
          const canUpgrade = TIER_ORDER[tier.id] > currentIdx;
          const tierColor = TIER_COLORS[tier.id];
          return (
            <View
              key={tier.id}
              style={[
                styles.tierCard,
                 { backgroundColor: colors.surface, borderColor: colors.border },
                 isCurrent && { borderColor: tierColor, borderWidth: 2 },
              ]}
            >
              <View style={styles.tierCardHeader}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.tierNameRow}>
                    <Text style={[styles.tierName, { color: tierColor }]} numberOfLines={1}>{tier.label}</Text>
                    {isCurrent && (
                      <View style={[styles.currentBadge, { backgroundColor: tierColor + '20' }]}>
                        <Text style={[styles.currentBadgeText, { color: tierColor }]}>Current</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.tierPrice, { color: colors.mutedForegroundLight }]}>
                    {formatAnnualPrice(tier.priceAnnualUsd)}
                  </Text>
                </View>
                {canUpgrade && (
                  <TouchableOpacity
                     style={[styles.upgradeSmallBtn, { backgroundColor: tierColor }]}
                    onPress={() => handleUpgrade(tier.id)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.upgradeSmallBtnText, { color: colors.primaryForeground }]}>
                      {isNonMember ? 'Join' : 'Upgrade'}
                    </Text>
                  </TouchableOpacity>
                )}
                {isCurrent && (
                  <TouchableOpacity
                    style={[styles.manageBtn, { borderColor: colors.border }]}
                    onPress={() => router.push('/membership/manage' as any)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.manageBtnText, { color: colors.textOnSurface }]}>Manage plan</Text>
                  </TouchableOpacity>
                )}
              </View>
               {tier.features.map((feat, i) => (
                <View key={feat} style={[
                  styles.featureRow,
                  i === 0 && { borderTopWidth: 1, borderTopColor: colors.separator },
                ]}>
                  <Text style={[styles.featureCheck, { color: colors.primary }]}>✓</Text>
                  <Text style={[styles.featureText, { color: colors.textOnSurface }]}>{feat}</Text>
                </View>
              ))}
                {tier.id === 'concierge' && (
                  <Text style={[styles.familyNote, { color: colors.mutedForegroundLight }]}>
                    Four memberships in one · seven annual Skip the Line passes · $13,995 billed annually
                  </Text>
                )}
            </View>
          );
        })}
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

  tierCard: {
    borderRadius: 18, borderWidth: 1,
    marginBottom: 12, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2,
  },
  tierCardHeader: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  tierNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' },
  tierName: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  tierPrice: { fontFamily: 'Inter_400Regular', fontSize: 13 },
  currentBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  currentBadgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  upgradeSmallBtn: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, flexShrink: 0 },
  upgradeSmallBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  manageBtn: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, flexShrink: 0, borderWidth: 1 },
  manageBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  featureRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 9,
  },
  featureCheck: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  featureText: { fontFamily: 'Inter_400Regular', fontSize: 13, flex: 1 },
  familyNote: { fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 18, paddingHorizontal: 16, paddingBottom: 14 },
});
