import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGetMembership, type MembershipPlan } from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { StatCard } from '@/components/StatCard';
import { formatAnnualPrice, getTierLabel, TIER_COLORS, TIER_ORDER } from '@/lib/membershipPlans';

// ── Tier config ───────────────────────────────────────────────────────────────
const TIER_META: Record<string, { label: string; blurb: string }> = {
  base:      { label: 'Base',      blurb: '' },
  plus:      { label: 'Plus',      blurb: '5 Skip the Line Passes, priority access to flights & international access.' },
  concierge: { label: 'Family/Corporate', blurb: '7 Skip the Line Passes, 4 memberships in 1 & charter flight aviation advisors.' },
};

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

  const { data: membership, isLoading, isError, refetch } = useGetMembership({});
  const mem = membership;

  const currentTier: string = mem?.tier ?? user?.membershipTier ?? 'base';
  const currentIdx = TIER_ORDER[currentTier] ?? -1;
  const nextTierId = ['base', 'plus', 'concierge'][currentIdx + 1];
  const plans: MembershipPlan[] = mem?.plans ?? [];
  const family = mem?.family;

  const tierLabel = getTierLabel(currentTier, plans);

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.offWhite }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }
  if (isError || !mem) {
    return (
      <View style={[styles.centered, styles.errorState, { backgroundColor: colors.offWhite }]}>
        <Text style={[styles.errorTitle, { color: colors.textOnSurface }]}>Could not load membership</Text>
        <Text style={[styles.errorBody, { color: colors.mutedForegroundLight }]}>Check your connection and try again.</Text>
        <TouchableOpacity style={[styles.retryBtn, { backgroundColor: colors.primary }]} onPress={() => refetch()}>
          <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Non-member: "join Bluebird" state instead of member stats ──
  if (currentTier === 'none') {
    return (
      <View style={[styles.root, { backgroundColor: colors.offWhite }]}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingTop: topPad + 16, paddingBottom: botPad + 80 }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.headerName, { color: colors.textOnSurface }]} numberOfLines={1}>
            {user?.name ?? 'Welcome'}
          </Text>
          <View style={[styles.tierPill, { backgroundColor: colors.muted }]}>
            <Text style={[styles.tierPillText, { color: colors.textOnSurface }]} numberOfLines={1}>
              Not a member yet
            </Text>
          </View>

          <TouchableOpacity activeOpacity={0.85} onPress={() => router.push('/membership/join' as any)}>
            <LinearGradient
              colors={['#0A1128', '#1259F2']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1.2 }}
              style={styles.upgradeCard}
            >
              <Text style={styles.upgradeEyebrow}>JOIN BLUEBIRD</Text>
              <Text style={styles.upgradeTitle}>
                One membership.{'\n'}Unlimited flights.
              </Text>
              <Text style={styles.upgradeBody}>
                You can join any flight, bring up to 5 friends with no additional costs per passenger.
              </Text>
              <View style={[styles.upgradeBtn, { backgroundColor: colors.surface }]}>
                <Text style={[styles.upgradeBtnText, { color: '#0A1128' }]}>See plans</Text>
              </View>
            </LinearGradient>
          </TouchableOpacity>

          <Text style={[styles.becomeMemberTitle, { color: colors.textOnSurface }]}>Become a member</Text>
          <View style={styles.inlinePlans}>
            {plans.map((plan) => (
              <View
                key={plan.id}
                style={[styles.inlinePlanCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <View style={styles.inlinePlanHeader}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.inlinePlanName, { color: TIER_COLORS[plan.id] }]}>{plan.label}</Text>
                    <Text style={[styles.inlinePlanPrice, { color: colors.mutedForegroundLight }]}>
                      {formatAnnualPrice(plan.priceAnnualUsd)}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.inlineJoinButton, { backgroundColor: TIER_COLORS[plan.id] }]}
                    activeOpacity={0.8}
                    onPress={() => router.push(`/upgrade/${plan.id}` as any)}
                  >
                    <Text style={[styles.inlineJoinText, { color: colors.primaryForeground }]}>Join</Text>
                  </TouchableOpacity>
                </View>
                {plan.features.map((feature) => (
                  <View key={feature} style={styles.inlineFeatureRow}>
                    <Text style={[styles.inlineFeatureCheck, { color: colors.primary }]}>✓</Text>
                    <Text style={[styles.inlineFeatureText, { color: colors.textOnSurface }]}>{feature}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => router.push('/membership/plans' as any)}
            style={styles.plansLink}
          >
            <Text style={[styles.plansLinkText, { color: colors.mutedForegroundLight }]}>View full plan comparison</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  const totalSaved: number = mem.totalSavedUsd ?? 0;
  const lifetimeFlights: number = mem.lifetimeCompletedFlights ?? 0;
  const familyMember = family?.members.find((member) => member.userId === user?.id);
  const linePasses: number = familyMember
    ? familyMember.availablePasses
    : mem.linePassCount ?? user?.linePassCount ?? 0;
  const memberSince = user?.createdAt
    ? new Date(user.createdAt).getFullYear().toString()
    : '—';
  const allowance: number = mem.annualFlightAllowance ?? 0;
  const usedThisYear: number = mem.flightsThisYear ?? 0;
  const usagePct = allowance > 0 ? Math.min(usedThisYear / allowance, 1) : 0;

  const rows = [
    ...(family ? [{ label: family.role === 'primary' ? 'Manage Family/Corporate' : 'View Family/Corporate', onPress: () => router.push('/membership/family' as any) }] : []),
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

        {/* ── Lifetime membership value ── */}
        <View style={[styles.valueCard, { backgroundColor: colors.backgroundMid }]}>
          <Text style={[styles.valueEyebrow, { color: colors.mutedOnBrand }]}>TOTAL SAVED</Text>
          <Text
            style={[styles.valueAmount, { color: colors.textOnBrand }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            {fmtUsd(totalSaved)}
          </Text>
          <Text style={[styles.valueCopy, { color: colors.mutedOnBrand }]}>
            Estimated private-flight value received on completed Bluebird flights, compared with
            booking those charter flights outside your membership. Not cash or referral credit.
          </Text>
        </View>

        {/* ── Supporting membership stats ── */}
        <View style={styles.statRow}>
          <StatCard label="Flights Taken" value={lifetimeFlights} />
          <StatCard label="Member Since" value={memberSince} />
        </View>
        <View style={[styles.statRow, { marginTop: 10 }]}>
          <StatCard label="Skip the Line Passes" value={linePasses} />
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
        {nextTierId && !family ? (
          <TouchableOpacity activeOpacity={0.85} onPress={() => router.push(`/upgrade/${nextTierId}` as any)}>
            <LinearGradient
              colors={['#0A1128', '#1259F2']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1.2 }}
              style={styles.upgradeCard}
            >
              <Text style={styles.upgradeEyebrow}>UPGRADE</Text>
              <Text style={styles.upgradeTitle}>{tierLabel} → {getTierLabel(nextTierId, plans)}</Text>
              <Text style={styles.upgradeBody}>{TIER_META[nextTierId]?.blurb ?? ''}</Text>
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
            <Text style={styles.upgradeTitle}>{family ? 'Family/Corporate household' : 'Family/Corporate'}</Text>
            <Text style={styles.upgradeBody}>
              {family
                ? family.role === 'primary'
                  ? 'Manage four total memberships and allocate one shared pool of seven annual Skip the Line passes.'
                  : `You have Family Plus access and ${family.members?.[0]?.availablePasses ?? 0} assigned Skip the Line passes.`
                : "You're on the highest tier. Enjoy four memberships and seven annual Skip the Line passes."}
            </Text>
            {family && (
              <View style={[styles.upgradeBtn, { backgroundColor: colors.surface }]}>
                <Text style={[styles.upgradeBtnText, { color: '#0A1128' }]}>Open Family management</Text>
              </View>
            )}
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
  errorState: { paddingHorizontal: 28 },
  errorTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 18, textAlign: 'center' },
  errorBody: { fontFamily: 'Inter_400Regular', fontSize: 14, textAlign: 'center', marginTop: 6 },
  retryBtn: { borderRadius: 999, paddingHorizontal: 22, paddingVertical: 11, marginTop: 16 },
  retryText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  scroll: { paddingHorizontal: 16 },

  headerName: { fontFamily: 'Inter_700Bold', fontSize: 28, letterSpacing: -0.4 },
  tierPill: {
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6,
    alignSelf: 'flex-start', marginTop: 8, marginBottom: 20,
  },
  tierPillText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },

  statRow: { flexDirection: 'row', gap: 10 },
  valueCard: {
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 22,
    marginBottom: 10,
  },
  valueEyebrow: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  valueAmount: {
    fontFamily: 'Inter_700Bold',
    fontSize: 42,
    letterSpacing: -1.2,
  },
  valueCopy: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12.5,
    lineHeight: 18,
    marginTop: 10,
    maxWidth: 520,
  },

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

  becomeMemberTitle: { fontFamily: 'Inter_700Bold', fontSize: 20, marginTop: 22, marginBottom: 10 },
  inlinePlans: { gap: 12 },
  inlinePlanCard: {
    borderRadius: 18, borderWidth: 1, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2,
  },
  inlinePlanHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  inlinePlanName: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  inlinePlanPrice: { fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 2 },
  inlineJoinButton: { borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
  inlineJoinText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  inlineFeatureRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  inlineFeatureCheck: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  inlineFeatureText: { fontFamily: 'Inter_400Regular', fontSize: 13, flex: 1 },

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
