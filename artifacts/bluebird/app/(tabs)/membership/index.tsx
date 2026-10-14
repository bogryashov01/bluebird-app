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
import { isLegacyMemberQueryEnabled } from '@/lib/clerkAuthSession';
import { useColors } from '@/hooks/useColors';
import { useProductionMembershipPlans } from '@/hooks/useProductionMembershipPlans';
import { StatCard } from '@/components/StatCard';
import {
  getTierLabel,
  TIER_COLORS,
  TIER_ORDER,
} from '@/lib/membershipPlans';
import {
  formatProductionPlanPrice,
  productionPlanPurchaseNotice,
} from '@/lib/productionMembershipPlans';
import { isLocalFlightReadMode } from '@/lib/productionFlights';
import { ProductionAuthenticatedUnavailableNotice } from '@/components/ProductionAuthenticatedUnavailableNotice';

// ── Tier config ───────────────────────────────────────────────────────────────
const TIER_META: Record<string, { label: string }> = {
  base:      { label: 'Base' },
  plus:      { label: 'Plus' },
  concierge: { label: 'Family/Corporate' },
};

function fmtUsd(n: number) {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function MembershipScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { user, authMode } = useAuth();
  const localDemoFlow = isLocalFlightReadMode();
  const memberQueryEnabled = isLegacyMemberQueryEnabled({
    authMode,
    localDemoFlow,
    hasLegacyUser: !!user,
  });

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const { data: membership, isLoading, isError, refetch } = useGetMembership({
    query: { enabled: memberQueryEnabled },
  });
  const plansQuery = useProductionMembershipPlans({ enabled: localDemoFlow });
  const mem = membership;

  const currentTier: string = mem?.tier ?? user?.membershipTier ?? 'base';
  const currentIdx = TIER_ORDER[currentTier] ?? -1;
  const plans = plansQuery.data?.plans ?? [];
  const nextPublicPlan = plans.find((plan) => (TIER_ORDER[plan.tier] ?? -1) > currentIdx);
  const family = mem?.family;

  const tierLabel = getTierLabel(currentTier, mem?.plans ?? []);

  if (!localDemoFlow) {
    return (
      <ProductionAuthenticatedUnavailableNotice
        title="Membership status unavailable"
        description="No member tier, pass balance, family status, or usage data is loaded in this production preview. Public plan details remain available on Compare all plans."
        testID="production-membership-unavailable"
        actionLabel="Compare all plans"
        onAction={() => router.push('/membership/plans' as any)}
      />
    );
  }

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
                Review the public membership plans and their current features. Membership purchases are unavailable.
              </Text>
              <View style={[styles.upgradeBtn, { backgroundColor: colors.surface }]}>
                <Text style={[styles.upgradeBtnText, { color: '#0A1128' }]}>Browse plans</Text>
              </View>
            </LinearGradient>
          </TouchableOpacity>

          <Text style={[styles.becomeMemberTitle, { color: colors.textOnSurface }]}>Become a member</Text>
          <View style={styles.inlinePlans}>
            {plansQuery.isLoading ? (
              <ActivityIndicator color={colors.primary} size="large" />
            ) : plansQuery.isError || !plansQuery.data ? (
              <View style={styles.planLoadError}>
                <Text style={[styles.planLoadErrorText, { color: colors.mutedForegroundLight }]}>
                  Could not load production plans. Demo pricing is not shown.
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
              <>
                {plans.map((plan) => {
                  const planColor = TIER_COLORS[plan.tier as keyof typeof TIER_COLORS] ?? colors.primary;
                  return (
                    <View
                      key={plan.tier}
                      style={[styles.inlinePlanCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                    >
                      <View style={styles.inlinePlanHeader}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={[styles.inlinePlanName, { color: planColor }]}>{plan.name}</Text>
                          <Text style={[styles.inlinePlanPrice, { color: colors.mutedForegroundLight }]}>
                            {formatProductionPlanPrice(plan)}
                          </Text>
                        </View>
                        {plan.highlight && (
                          <Text style={[styles.planHighlight, { color: colors.primary }]}>HIGHLIGHT</Text>
                        )}
                      </View>
                      <Text style={[styles.inlinePlanTagline, { color: colors.mutedForegroundLight }]}>
                        {plan.tagline}
                      </Text>
                      {(plansQuery.data.cardFeatures[plan.tier] ?? []).map((feature) => (
                        <View key={feature} style={styles.inlineFeatureRow}>
                          <Text style={[styles.inlineFeatureCheck, { color: colors.primary }]}>✓</Text>
                          <Text style={[styles.inlineFeatureText, { color: colors.textOnSurface }]}>{feature}</Text>
                        </View>
                      ))}
                      <Text style={[styles.purchaseUnavailable, { color: colors.mutedForegroundLight }]}>
                        Purchases unavailable
                      </Text>
                    </View>
                  );
                })}
                <Text style={[styles.planAvailability, { color: colors.mutedForegroundLight }]}>
                  {productionPlanPurchaseNotice(plansQuery.data.availability)}
                </Text>
              </>
            )}
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
        {!family && nextPublicPlan ? (
          <View>
            <LinearGradient
              colors={['#0A1128', '#1259F2']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1.2 }}
              style={styles.upgradeCard}
            >
              <Text style={styles.upgradeEyebrow}>UPGRADE</Text>
              <Text style={styles.upgradeTitle}>{tierLabel} → {nextPublicPlan.name}</Text>
              <Text style={styles.upgradeBody}>
                {formatProductionPlanPrice(nextPublicPlan)} · {nextPublicPlan.tagline}
              </Text>
              <Text style={[styles.upgradeUnavailable, { color: colors.primaryForeground }]}>
                Membership purchases are unavailable.
              </Text>
            </LinearGradient>
          </View>
        ) : !family && plansQuery.data ? (
          <View style={[styles.catalogStatusCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.catalogStatusText, { color: colors.textOnSurface }]}>
              No higher plan is currently listed in the public catalog.
            </Text>
          </View>
        ) : !family && plansQuery.isError ? (
          <View style={[styles.catalogStatusCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.catalogStatusText, { color: colors.mutedForegroundLight }]}>
              Production plan details could not be loaded.
            </Text>
            <TouchableOpacity disabled={plansQuery.isFetching} onPress={() => plansQuery.refetch()}>
              {plansQuery.isFetching
                ? <ActivityIndicator color={colors.primary} />
                : <Text style={[styles.plansLinkText, { color: colors.primary }]}>Retry loading plans</Text>}
            </TouchableOpacity>
          </View>
        ) : family ? (
          <LinearGradient
            colors={['#0A1128', '#1259F2']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1.2 }}
            style={styles.upgradeCard}
          >
            <Text style={styles.upgradeEyebrow}>ELITE STATUS</Text>
            <Text style={styles.upgradeTitle}>Family/Corporate household</Text>
            <Text style={styles.upgradeBody}>
              {family.role === 'primary'
                ? 'Manage four total memberships and allocate one shared pool of seven annual Skip the Line passes.'
                : `You have Family Plus access and ${family.members?.[0]?.availablePasses ?? 0} assigned Skip the Line passes.`}
            </Text>
            <View style={[styles.upgradeBtn, { backgroundColor: colors.surface }]}>
              <Text style={[styles.upgradeBtnText, { color: '#0A1128' }]}>Open Family management</Text>
            </View>
          </LinearGradient>
        ) : (
          <View style={styles.memberPlanLoading}>
            <ActivityIndicator color={colors.primary} />
          </View>
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
  inlinePlanTagline: { fontFamily: 'Inter_400Regular', fontSize: 12.5, lineHeight: 18, marginBottom: 8 },
  planHighlight: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.8 },
  inlineFeatureRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  inlineFeatureCheck: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  inlineFeatureText: { fontFamily: 'Inter_400Regular', fontSize: 13, flex: 1 },
  planLoadError: { alignItems: 'center', paddingVertical: 14 },
  planLoadErrorText: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center' },
  planAvailability: { fontFamily: 'Inter_500Medium', fontSize: 12, textAlign: 'center', paddingVertical: 6 },
  purchaseUnavailable: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginTop: 10 },
  upgradeUnavailable: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  catalogStatusCard: { borderRadius: 18, borderWidth: 1, padding: 16, marginTop: 18 },
  catalogStatusText: { fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 19 },
  memberPlanLoading: { alignItems: 'center', paddingVertical: 24 },

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
