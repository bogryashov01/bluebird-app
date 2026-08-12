import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGetMembership } from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { StatCard } from '@/components/StatCard';

// ── Tier config ───────────────────────────────────────────────────────────────
const TIER_META: Record<string, { label: string; blurb: string }> = {
  base:      { label: 'Base',      blurb: '' },
  plus:      { label: 'Plus',      blurb: '5 Skip the Line Passes, priority notifications & exclusive flights.' },
  concierge: { label: 'Concierge', blurb: 'Unlimited Line Passes, AI Concierge 24/7 & custom flight requests.' },
};
const TIER_ORDER = ['base', 'plus', 'concierge'];

function fmtUsd(n: number) {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function MembershipScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { user } = useAuth();

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const { data: membership, isLoading } = useGetMembership({});
  const mem = membership as any;

  const currentTier: string = mem?.tier ?? user?.membershipTier ?? 'base';
  const currentIdx = TIER_ORDER.indexOf(currentTier);
  const nextTierId = TIER_ORDER[currentIdx + 1];

  const tierLabel = TIER_META[currentTier]?.label ?? currentTier;

  if (isLoading || !mem) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.offWhite }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const totalSaved: number = mem.totalSavedUsd ?? 0;
  const referralBalance: number = mem.referralBalanceUsd ?? 0;
  const linePasses: number = mem.linePassCount ?? user?.linePassCount ?? 0;
  const allowance: number = mem.annualFlightAllowance ?? 0;
  const usedThisYear: number = mem.flightsThisYear ?? 0;
  const usagePct = allowance > 0 ? Math.min(usedThisYear / allowance, 1) : 0;

  const rows = [
    { label: 'AI Concierge',     onPress: () => router.push('/concierge' as any) },
    { label: 'Referral Program', onPress: () => router.push('/referral' as any) },
    { label: 'Payment Methods',  onPress: () => router.push('/account/payment-methods' as any) },
  ];

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: topPad + 16, paddingBottom: botPad + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header: name + dark tier pill ── */}
        <Text style={[styles.headerName, { color: colors.textOnSurface }]} numberOfLines={1}>
          {user?.name ?? 'Member'}
        </Text>
        <View style={[styles.tierPill, { backgroundColor: colors.backgroundMid }]}>
          <Text style={[styles.tierPillText, { color: colors.primaryForeground }]} numberOfLines={1}>
            {tierLabel} Member
          </Text>
        </View>

        {/* ── 2×2 Stats grid ── */}
        <View style={styles.statRow}>
          <StatCard label="Flights Flown" value={usedThisYear} />
          <StatCard label="Total Saved" value={fmtUsd(totalSaved)} />
        </View>
        <View style={[styles.statRow, { marginTop: 10 }]}>
          <StatCard label="Skip the Line Passes" value={linePasses} />
          <StatCard label="Referral Balance" value={fmtUsd(referralBalance)} />
        </View>

        {/* ── This Year's Usage ── */}
        <View style={[styles.usageCard, { backgroundColor: colors.surface }]}>
          <View style={styles.usageHeader}>
            <Text style={[styles.usageTitle, { color: colors.textOnSurface }]}>This Year's Usage</Text>
            <Text style={[styles.usageCount, { color: colors.mutedForegroundLight }]}>
              {usedThisYear} / {allowance} flights
            </Text>
          </View>
          <View style={[styles.usageTrack, { backgroundColor: colors.muted }]}>
            <View style={[styles.usageFill, { backgroundColor: colors.primary, width: `${usagePct * 100}%` }]} />
          </View>
        </View>

        {/* ── Pending change banner ── */}
        {mem.pendingTier && (
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => router.push('/membership/manage' as any)}
            style={[styles.pendingBanner, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Text style={[styles.pendingBannerTitle, { color: colors.textOnSurface }]}>
              {mem.pendingTier === 'cancelled'
                ? `Membership cancels on ${mem.renewalDate}`
                : `Changes to ${TIER_META[mem.pendingTier]?.label ?? mem.pendingTier} on ${mem.renewalDate}`}
            </Text>
            <Text style={[styles.pendingBannerSub, { color: colors.mutedForegroundLight }]}>
              You keep your {tierLabel} benefits until then. Tap to review or keep your plan.
            </Text>
          </TouchableOpacity>
        )}

        {/* ── Upgrade / status card ── */}
        {nextTierId ? (
          <TouchableOpacity activeOpacity={0.85} onPress={() => router.push(`/upgrade/${nextTierId}` as any)}>
            <LinearGradient
              colors={['#0A1128', '#1259F2']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1.2 }}
              style={styles.upgradeCard}
            >
              <Text style={styles.upgradeEyebrow}>UPGRADE</Text>
              <Text style={styles.upgradeTitle}>{tierLabel} → {TIER_META[nextTierId].label}</Text>
              <Text style={styles.upgradeBody}>{TIER_META[nextTierId].blurb}</Text>
              <View style={[styles.upgradeBtn, { backgroundColor: colors.surface }]}>
                <Text style={[styles.upgradeBtnText, { color: '#0A1128' }]}>Upgrade Now</Text>
              </View>
            </LinearGradient>
          </TouchableOpacity>
        ) : (
          <LinearGradient
            colors={['#0A1128', '#1259F2']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1.2 }}
            style={styles.upgradeCard}
          >
            <Text style={styles.upgradeEyebrow}>ELITE STATUS</Text>
            <Text style={styles.upgradeTitle}>Concierge</Text>
            <Text style={styles.upgradeBody}>
              You're on the highest tier. Enjoy unlimited access and dedicated support.
            </Text>
          </LinearGradient>
        )}

        {/* ── Compare plans link ── */}
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => router.push('/membership/plans' as any)}
          style={styles.plansLink}
        >
          <Text style={[styles.plansLinkText, { color: colors.mutedForegroundLight }]}>Compare all plans</Text>
        </TouchableOpacity>

        {/* ── Grouped link list ── */}
        <View style={[styles.linkCard, { backgroundColor: colors.surface }]}>
          {rows.map((row, i) => (
            <TouchableOpacity
              key={row.label}
              activeOpacity={0.7}
              onPress={row.onPress}
              style={[styles.linkRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.separator }]}
            >
              <Text style={[styles.linkLabel, { color: colors.textOnSurface }]}>{row.label}</Text>
              <Text style={[styles.linkChevron, { color: colors.mutedForegroundLight }]}>›</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { paddingHorizontal: 16 },

  headerName: { fontFamily: 'Inter_700Bold', fontSize: 28, letterSpacing: -0.4 },
  tierPill: {
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6,
    alignSelf: 'flex-start', marginTop: 8, marginBottom: 20,
  },
  tierPillText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },

  statRow: { flexDirection: 'row', gap: 10 },

  usageCard: {
    borderRadius: 18, padding: 16, marginTop: 18,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2,
  },
  usageHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  usageTitle: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  usageCount: { fontFamily: 'Inter_500Medium', fontSize: 12.5 },
  usageTrack: { height: 8, borderRadius: 999, overflow: 'hidden' },
  usageFill: { height: 8, borderRadius: 999 },

  pendingBanner: { borderRadius: 18, borderWidth: 1, padding: 16, marginTop: 18 },
  pendingBannerTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14.5, marginBottom: 4 },
  pendingBannerSub: { fontFamily: 'Inter_400Regular', fontSize: 12.5, lineHeight: 18 },

  upgradeCard: { borderRadius: 24, padding: 22, marginTop: 18 },
  upgradeEyebrow: {
    fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 1.4,
    color: 'rgba(255,255,255,0.65)', marginBottom: 8,
  },
  upgradeTitle: { fontFamily: 'Inter_700Bold', fontSize: 22, color: '#FFFFFF', marginBottom: 6 },
  upgradeBody: {
    fontFamily: 'Inter_400Regular', fontSize: 13.5, lineHeight: 19,
    color: 'rgba(255,255,255,0.78)', marginBottom: 18,
  },
  upgradeBtn: { borderRadius: 999, paddingVertical: 13, paddingHorizontal: 24, alignSelf: 'flex-start' },
  upgradeBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },

  plansLink: { alignSelf: 'center', paddingVertical: 14 },
  plansLinkText: { fontFamily: 'Inter_500Medium', fontSize: 13, textDecorationLine: 'underline' },

  linkCard: {
    borderRadius: 18, overflow: 'hidden', marginTop: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2,
  },
  linkRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 16,
  },
  linkLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14.5 },
  linkChevron: { fontSize: 22, fontFamily: 'Inter_400Regular', lineHeight: 22 },
});
