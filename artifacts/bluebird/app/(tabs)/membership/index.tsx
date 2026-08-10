import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGetMembership, useUpgradeMembership, useListTrips } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { StatCard } from '@/components/StatCard';

// ── Tier config ───────────────────────────────────────────────────────────────
const TIERS = [
  {
    id: 'base',
    label: 'Base',
    price: '$99 / mo',
    tagline: 'Get started with private aviation',
    features: ['Browse empty-leg flights', 'Join queue for any flight', 'Flight notifications', 'Community access'],
    color: '#8896B3',
  },
  {
    id: 'plus',
    label: 'Plus',
    price: '$299 / mo',
    tagline: 'More access, more freedom',
    features: ['Everything in Base', '2 Skip the Line passes / mo', 'Priority support', 'International flights', 'Guest pass'],
    color: '#1259F2',
  },
  {
    id: 'concierge',
    label: 'Concierge',
    price: '$799 / mo',
    tagline: 'The complete Bluebird experience',
    features: ['Everything in Plus', 'Unlimited Line passes', 'AI Concierge 24/7', 'Dedicated coordinator', 'Lounge access', 'Custom flights'],
    color: '#F59E0B',
  },
];

const TIER_IDX: Record<string, number> = { base: 0, plus: 1, concierge: 2 };

const UPGRADE_BG: Record<string, string> = {
  base:      '#1259F2',
  plus:      '#0A1128',
  concierge: '#92400E',
};

function tierDisplayName(t: string) {
  return TIERS.find((x) => x.id === t)?.label ?? t;
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function MembershipScreen() {
  const insets      = useSafeAreaInsets();
  const colors      = useColors();
  const { user, updateUser } = useAuth();
  const queryClient = useQueryClient();

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const { data: membership, isLoading: memLoading } = useGetMembership({});
  const { data: tripsRaw,   isLoading: tripsLoading } = useListTrips({});

  const upgradeMutation = useUpgradeMembership({
    mutation: {
      onSuccess: (data: any) => {
        queryClient.invalidateQueries({ queryKey: ['getMembership'] });
        if (user) updateUser({ ...user, membershipTier: data.tier, linePassCount: data.linePassCount });
        Alert.alert('Membership Upgraded! ✨', `Welcome to ${tierDisplayName(data.tier)} membership!`);
      },
      onError: (err: any) => Alert.alert('Error', err?.response?.data?.error ?? 'Upgrade failed'),
    },
  });

  const mem         = membership as any;
  const trips       = (tripsRaw as any[]) ?? [];
  const currentTier = mem?.tier ?? user?.membershipTier ?? 'base';
  const currentIdx  = TIER_IDX[currentTier] ?? 0;

  const flightsFlown = trips.filter((t) => t.status === 'completed').length;
  const linePasses   = mem?.linePassCount ?? user?.linePassCount ?? 0;
  const memberSince  = user?.createdAt ? new Date(user.createdAt).getFullYear() : '—';
  const tierLabel    = tierDisplayName(currentTier);

  const handleUpgrade = (tierId: string) => {
    if (tierId === currentTier || TIER_IDX[tierId] < currentIdx) return;
    Alert.alert(
      `Upgrade to ${tierDisplayName(tierId)}?`,
      "You'll receive bonus Skip the Line passes immediately.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Upgrade', onPress: () => upgradeMutation.mutate({ data: { tier: tierId as 'plus' | 'concierge' } }) },
      ],
    );
  };

  if (memLoading || tripsLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.offWhite }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const nextTier = TIERS[currentIdx + 1];

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: topPad + 16, paddingBottom: botPad + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Text style={[styles.headerName, { color: colors.backgroundMid }]} numberOfLines={1}>{user?.name ?? 'Member'}</Text>
            <Text style={[styles.headerSub, { color: colors.mutedForegroundLight }]}>Member since {memberSince}</Text>
          </View>
          <View style={[styles.tierPill, { backgroundColor: (TIERS.find(t => t.id === currentTier)?.color ?? colors.primary) + '18' }]}>
            <Text style={[styles.tierPillText, { color: TIERS.find(t => t.id === currentTier)?.color ?? colors.backgroundMid }]} numberOfLines={1}>
              {tierLabel}
            </Text>
          </View>
        </View>

        {/* ── 2×2 Stats grid ── */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight }]}>Activity</Text>
        <View style={styles.statRow}>
          <StatCard label="Flights Flown" value={flightsFlown} />
          <StatCard label="Line Passes"   value={linePasses} />
        </View>
        <View style={[styles.statRow, { marginTop: 10 }]}>
          <StatCard label="Member Since" value={memberSince} />
          <StatCard label="Membership"   value={tierLabel} />
        </View>

        {/* ── Upgrade card ── */}
        {nextTier && (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 28, color: colors.mutedForegroundLight }]}>Upgrade</Text>
            <TouchableOpacity activeOpacity={0.85} onPress={() => handleUpgrade(nextTier.id)}>
              <View style={[styles.upgradeCard, { backgroundColor: UPGRADE_BG[currentTier] }]}>
                <Text style={styles.upgradeCardTitle}>Upgrade to {nextTier.label}</Text>
                <Text style={styles.upgradeCardBody}>{nextTier.tagline}</Text>
                <View style={styles.upgradeChipRow}>
                  {nextTier.features.slice(1, 3).map((feat) => (
                    <View key={feat} style={styles.upgradeChip}>
                      <Text style={styles.upgradeChipText}>{feat}</Text>
                    </View>
                  ))}
                </View>
                <View style={styles.upgradeBtn}>
                  <Text style={styles.upgradeBtnText}>See {nextTier.label} → {nextTier.price}</Text>
                </View>
              </View>
            </TouchableOpacity>
          </>
        )}
        {!nextTier && (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 28, color: colors.mutedForegroundLight }]}>Status</Text>
            <View style={[styles.upgradeCard, { backgroundColor: '#92400E' }]}>
              <Text style={styles.upgradeCardTitle}>Concierge — Elite Status</Text>
              <Text style={styles.upgradeCardBody}>You're on the highest tier. Enjoy unlimited access and dedicated support.</Text>
            </View>
          </>
        )}

        {/* ── Tier comparison ── */}
        <Text style={[styles.sectionLabel, { marginTop: 28, color: colors.mutedForegroundLight }]}>All Plans</Text>
        {TIERS.map((tier) => {
          const isCurrent  = tier.id === currentTier;
          const canUpgrade = TIER_IDX[tier.id] > currentIdx;
          return (
            <View
              key={tier.id}
              style={[
                styles.tierCard,
                isCurrent && { borderColor: tier.color, borderWidth: 2 },
              ]}
            >
              <View style={styles.tierCardHeader}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.tierNameRow}>
                    <Text style={[styles.tierName, { color: tier.color }]} numberOfLines={1}>{tier.label}</Text>
                    {isCurrent && (
                      <View style={[styles.currentBadge, { backgroundColor: tier.color + '20' }]}>
                        <Text style={[styles.currentBadgeText, { color: tier.color }]}>Current</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.tierPrice, { color: colors.mutedForegroundLight }]}>{tier.price}</Text>
                </View>
                {canUpgrade && (
                  <TouchableOpacity
                    style={[styles.upgradeSmallBtn, { backgroundColor: tier.color }]}
                    onPress={() => handleUpgrade(tier.id)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.upgradeSmallBtnText}>Upgrade</Text>
                  </TouchableOpacity>
                )}
              </View>
              {tier.features.map((feat, i) => (
                <View key={feat} style={[
                  styles.featureRow,
                  i === 0 && { borderTopWidth: 1, borderTopColor: 'rgba(10,17,40,0.07)' },
                ]}>
                  <Text style={[styles.featureCheck, { color: colors.primary }]}>✓</Text>
                  <Text style={[styles.featureText, { color: colors.backgroundMid }]}>{feat}</Text>
                </View>
              ))}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll:   { paddingHorizontal: 16 },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, gap: 12 },
  headerLeft: { flex: 1, minWidth: 0 },
  headerName: { fontFamily: 'Inter_700Bold', fontSize: 27 },
  headerSub:  { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 2 },
  tierPill:   { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, flexShrink: 0, alignSelf: 'center' },
  tierPillText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },

  sectionLabel: {
    fontFamily: 'Inter_600SemiBold', fontSize: 12,
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10,
  },

  statRow: { flexDirection: 'row', gap: 10 },

  upgradeCard: { borderRadius: 24, padding: 20, marginBottom: 4 },
  upgradeCardTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, color: '#fff', marginBottom: 6 },
  upgradeCardBody:  { fontFamily: 'Inter_400Regular', fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 18, marginBottom: 14 },
  upgradeChipRow:   { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 16 },
  upgradeChip: {
    backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  upgradeChipText: { fontFamily: 'Inter_500Medium', fontSize: 12, color: '#fff' },
  upgradeBtn: {
    backgroundColor: 'rgba(255,255,255,0.20)', borderRadius: 999,
    paddingVertical: 13, alignItems: 'center',
  },
  upgradeBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: '#fff' },

  tierCard: {
    backgroundColor: '#fff', borderRadius: 18, borderWidth: 1,
    borderColor: 'rgba(10,17,40,0.08)', marginBottom: 12, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2,
  },
  tierCardHeader: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  tierNameRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' },
  tierName:       { fontFamily: 'Inter_700Bold', fontSize: 17 },
  tierPrice:      { fontFamily: 'Inter_400Regular', fontSize: 13 },
  currentBadge:   { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  currentBadgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  upgradeSmallBtn: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, flexShrink: 0 },
  upgradeSmallBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: '#fff' },
  featureRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 9,
    borderTopWidth: 0, borderTopColor: 'rgba(10,17,40,0.06)',
  },
  featureCheck: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  featureText:  { fontFamily: 'Inter_400Regular', fontSize: 13, flex: 1 },
});
