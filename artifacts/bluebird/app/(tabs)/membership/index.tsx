import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useGetMembership, useUpgradeMembership } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';

const TIERS = [
  {
    id: 'base',
    name: 'Base',
    price: '$99/mo',
    description: 'Get started with private aviation',
    features: ['Browse empty leg flights', 'Join queue for any flight', 'Flight notifications', 'Community access'],
    color: '#8896B3',
  },
  {
    id: 'plus',
    name: 'Plus',
    price: '$299/mo',
    description: 'More access, more freedom',
    features: ['Everything in Base', '2 Skip the Line passes/mo', 'Priority support', 'International flights', 'Guest pass'],
    color: '#1259F2',
  },
  {
    id: 'concierge',
    name: 'Concierge',
    price: '$799/mo',
    description: 'The complete Bluebird experience',
    features: ['Everything in Plus', 'Unlimited Line passes', 'AI Concierge 24/7', 'Dedicated coordinator', 'Lounge access', 'Custom flights'],
    color: '#F59E0B',
  },
];

export default function MembershipScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, updateUser } = useAuth();
  const queryClient = useQueryClient();

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const { data: membership, isLoading, refetch } = useGetMembership({});
  const upgradeMutation = useUpgradeMembership({
    mutation: {
      onSuccess: (data) => {
        const d = data as any;
        queryClient.invalidateQueries({ queryKey: ['getMembership'] });
        // Sync the cached auth user so profile/header reflect the new tier and pass count immediately
        if (user) {
          updateUser({ ...user, membershipTier: d.tier, linePassCount: d.linePassCount });
        }
        Alert.alert('Membership Upgraded! ✨', `Welcome to ${d.tier} membership!`);
      },
      onError: (err: any) => {
        Alert.alert('Error', err?.response?.data?.error || 'Upgrade failed');
      },
    },
  });

  const currentTier = (membership as any)?.tier ?? user?.membershipTier ?? 'base';

  const handleUpgrade = (tierId: string) => {
    if (tierId === currentTier) return;
    Alert.alert(
      `Upgrade to ${tierId.charAt(0).toUpperCase() + tierId.slice(1)}?`,
      `This will upgrade your membership. You'll receive bonus Skip the Line passes immediately.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Upgrade', onPress: () => upgradeMutation.mutate({ data: { tier: tierId as 'plus' | 'concierge' } }) },
      ]
    );
  };

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: topPad + 16, paddingBottom: bottomPad + 80 }]} showsVerticalScrollIndicator={false}>
        <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Membership</Text>

        {/* Line passes badge */}
        {(membership as any)?.linePassCount !== undefined && (
          <View style={[styles.passCard, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '40' }]}>
            <Feather name="zap" size={20} color={colors.primary} />
            <View style={styles.passCardText}>
              <Text style={[styles.passCardNum, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
                {(membership as any).linePassCount}
              </Text>
              <Text style={[styles.passCardLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                Skip the Line passes remaining
              </Text>
            </View>
          </View>
        )}

        {/* Tier cards */}
        <View style={styles.tierList}>
          {TIERS.map((tier) => {
            const isCurrent = tier.id === currentTier;
            const isUpgrade = TIERS.findIndex(t => t.id === currentTier) < TIERS.findIndex(t => t.id === tier.id);
            return (
              <View
                key={tier.id}
                style={[
                  styles.tierCard,
                  { backgroundColor: colors.card, borderColor: isCurrent ? tier.color : colors.border, borderWidth: isCurrent ? 2 : 1 },
                ]}
              >
                {/* Header */}
                <View style={styles.tierCardHeader}>
                  <View>
                    <View style={styles.tierNameRow}>
                      <Text style={[styles.tierName, { color: tier.color, fontFamily: 'Inter_700Bold' }]}>{tier.name}</Text>
                      {isCurrent && (
                        <View style={[styles.currentBadge, { backgroundColor: tier.color + '20' }]}>
                          <Text style={[styles.currentBadgeText, { color: tier.color, fontFamily: 'Inter_500Medium' }]}>Current</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[styles.tierDesc, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{tier.description}</Text>
                  </View>
                  <Text style={[styles.tierPrice, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>{tier.price}</Text>
                </View>

                {/* Features */}
                <View style={[styles.featureList, { borderTopColor: colors.border }]}>
                  {tier.features.map((f) => (
                    <View key={f} style={styles.featureRow}>
                      <Feather name="check" size={14} color={tier.color} />
                      <Text style={[styles.featureText, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}>{f}</Text>
                    </View>
                  ))}
                </View>

                {/* CTA */}
                {isUpgrade && (
                  <TouchableOpacity
                    style={[styles.upgradeBtn, { backgroundColor: tier.color }, upgradeMutation.isPending && { opacity: 0.7 }]}
                    onPress={() => handleUpgrade(tier.id)}
                    disabled={upgradeMutation.isPending}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.upgradeBtnText, { fontFamily: 'Inter_600SemiBold' }]}>
                      Upgrade to {tier.name}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scrollContent: { paddingHorizontal: 16, gap: 20 },
  headerTitle: { fontSize: 28, paddingHorizontal: 4 },
  passCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 16, borderRadius: 14, borderWidth: 1,
  },
  passCardText: { gap: 2 },
  passCardNum: { fontSize: 24 },
  passCardLabel: { fontSize: 13 },
  tierList: { gap: 16 },
  tierCard: { borderRadius: 16, overflow: 'hidden', padding: 16 },
  tierCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  tierNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  tierName: { fontSize: 20 },
  currentBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  currentBadgeText: { fontSize: 11 },
  tierDesc: { fontSize: 13 },
  tierPrice: { fontSize: 18 },
  featureList: { borderTopWidth: 1, paddingTop: 14, gap: 10 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureText: { fontSize: 14 },
  upgradeBtn: {
    marginTop: 16, height: 48, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
  },
  upgradeBtnText: { color: '#fff', fontSize: 15 },
});
