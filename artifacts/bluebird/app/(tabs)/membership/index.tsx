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
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import {
  getClerkBluebirdProfileEffectDependencies,
  isClerkBluebirdProfileResultCurrent,
} from '@/lib/clerkBluebirdProfile';
import { getFullAppDemoMemberOverview } from '@/lib/fullAppDemo';
import { presentClerkMembershipDesign } from '@/lib/clerkMembershipDesign';
import {
  loadPreparedMobileMembership,
  type MobileMembershipErrorCode,
  type MobileMembershipSnapshot,
  type MobilePlanCatalog,
} from '@/lib/mobileMembership';

// ── Tier config ───────────────────────────────────────────────────────────────
const TIER_META: Record<string, { label: string }> = {
  base:      { label: 'Base' },
  plus:      { label: 'Plus' },
  concierge: { label: 'Family/Corporate' },
};

function fmtUsd(n: number) {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

type ClerkMembershipLoadState =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string }
  | { kind: 'not_authenticated' }
  | {
      kind: 'loaded' | 'refreshing' | 'stale_error';
      clerkUserId: string;
      membership: MobileMembershipSnapshot;
      plans: MobilePlanCatalog | null;
      message?: string;
    };

function membershipLoadErrorMessage(code: MobileMembershipErrorCode): string {
  if (code === 'network' || code === 'timeout') {
    return 'Bluebird could not be reached. Check your connection and try again.';
  }
  if (code === 'session_expired') {
    return 'Your sign-in has expired. Sign in again, then reopen Membership.';
  }
  return 'Bluebird could not load your membership details.';
}

function formatMembershipDate(value: string | null | undefined): string {
  if (!value) return 'Unavailable';
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function MembershipScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { user, authMode, demoMode, clerkMemberResolution } = useAuth();
  const clerkSession = useClerkAuthSnapshot();
  const mainApiConfiguration = getMainBluebirdApiConfigurationOrNull();
  const localDemoFlow = demoMode || isLocalFlightReadMode();
  const memberQueryEnabled = !demoMode && isLegacyMemberQueryEnabled({
    authMode,
    localDemoFlow,
    hasLegacyUser: !!user,
  });

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const { data: membership, isLoading, isFetching: membershipFetching, isError, refetch } = useGetMembership({
    query: {
      enabled: !demoMode && memberQueryEnabled,
      queryKey: ['/api/membership', user?.id ?? 'no-local-account'],
    },
  });
  const [clerkMembershipState, setClerkMembershipState] = React.useState<ClerkMembershipLoadState>({ kind: 'loading' });
  const [clerkMembershipAttempt, setClerkMembershipAttempt] = React.useState(0);
  const cachedClerkMembership = React.useRef<{
    clerkUserId: string;
    membership: MobileMembershipSnapshot;
    plans: MobilePlanCatalog | null;
  } | null>(null);
  const currentClerkIdentity = React.useRef<string | null>(clerkSession?.userId ?? null);
  currentClerkIdentity.current = clerkSession?.userId ?? null;
  const currentClerkSession = React.useRef(clerkSession);
  currentClerkSession.current = clerkSession;
  const membershipRequestDependencies = getClerkBluebirdProfileEffectDependencies({
    configuration: mainApiConfiguration,
    session: clerkSession,
    loadAttempt: clerkMembershipAttempt,
  });
  const loadClerkMembership = React.useCallback(async (signal: AbortSignal) => {
    if (
      authMode !== 'clerk' ||
      !clerkSession?.isLoaded ||
      clerkSession.isSignedIn !== true ||
      !clerkSession.userId
    ) return;
    const requestedClerkUserId = clerkSession.userId;
    const cached = cachedClerkMembership.current?.clerkUserId === requestedClerkUserId
      ? cachedClerkMembership.current
      : null;
    setClerkMembershipState(cached
      ? { kind: 'refreshing', ...cached }
      : { kind: 'loading' });
    try {
      const loaded = await loadPreparedMobileMembership({
        apiBaseUrl: mainApiConfiguration?.apiBaseUrl ?? null,
        signal,
        getAccessToken: async () => {
          const activeSession = currentClerkSession.current;
          if (
            !activeSession ||
            activeSession.isLoaded !== true ||
            activeSession.isSignedIn !== true ||
            activeSession.userId !== requestedClerkUserId
          ) return null;
          return activeSession.getToken();
        },
      });
      if (!isClerkBluebirdProfileResultCurrent({
        requestedClerkUserId,
        currentClerkUserId: currentClerkIdentity.current,
        aborted: signal.aborted,
      })) return;
      if (loaded.kind === 'cancelled') return;
      if (loaded.kind === 'not_authenticated') {
        cachedClerkMembership.current = null;
        setClerkMembershipState({ kind: 'not_authenticated' });
        return;
      }
      if (loaded.kind === 'unavailable') {
        cachedClerkMembership.current = null;
        setClerkMembershipState({ kind: 'unavailable' });
        return;
      }
      if (loaded.kind === 'error') {
        const message = membershipLoadErrorMessage(loaded.code);
        setClerkMembershipState(cached
          ? { kind: 'stale_error', ...cached, message }
          : { kind: 'error', message });
        return;
      }
      const confirmed = {
        clerkUserId: requestedClerkUserId,
        membership: loaded.membership,
        plans: loaded.plans,
      };
      cachedClerkMembership.current = confirmed;
      setClerkMembershipState({ kind: 'loaded', ...confirmed });
    } catch (error) {
      if (signal.aborted || currentClerkIdentity.current !== requestedClerkUserId) return;
      const typed = error as { code?: string; status?: number };
      const message = typed?.code === 'network' || typed?.code === 'timeout'
        ? membershipLoadErrorMessage('network')
        : typed?.code === 'session_expired' || typed?.status === 401
          ? membershipLoadErrorMessage('session_expired')
          : membershipLoadErrorMessage('unavailable');
      setClerkMembershipState(cached
        ? { kind: 'stale_error', ...cached, message }
        : { kind: 'error', message });
    }
  }, [authMode, ...membershipRequestDependencies]);
  React.useEffect(() => {
    if (authMode !== 'clerk') return;
    if (!clerkSession?.isLoaded || clerkSession.isSignedIn !== true || !clerkSession.userId) {
      setClerkMembershipState({ kind: 'not_authenticated' });
      return;
    }
    const controller = new AbortController();
    void loadClerkMembership(controller.signal);
    return () => controller.abort();
  }, [authMode, loadClerkMembership, ...membershipRequestDependencies]);
  const plansQuery = useProductionMembershipPlans({
    enabled: !demoMode && authMode !== 'clerk',
  });

  if (authMode === 'clerk') {
    const visibleState = 'clerkUserId' in clerkMembershipState &&
      clerkMembershipState.clerkUserId !== clerkSession?.userId
      ? { kind: 'loading' as const }
      : clerkMembershipState;
    const confirmedMembership = visibleState.kind === 'loaded' ||
      visibleState.kind === 'refreshing' ||
      visibleState.kind === 'stale_error'
      ? visibleState.membership
      : null;
    const verifiedAccount = 'currentUser' in clerkMemberResolution &&
      clerkMemberResolution.clerkUserId === clerkSession?.userId
      ? clerkMemberResolution.currentUser
      : null;
    const design = presentClerkMembershipDesign({
      verifiedFirstName: verifiedAccount?.firstName,
      verifiedLastName: verifiedAccount?.lastName,
      membership: confirmedMembership,
    });
    const clerkRows = [
      { label: 'AI Concierge', onPress: () => router.push('/concierge' as any) },
      { label: 'Referral Program', onPress: () => router.push('/referral' as any) },
      { label: 'Payment Methods', onPress: () => router.push('/account/payment-methods' as any) },
    ];
    return (
      <View style={[styles.root, { backgroundColor: colors.offWhite }]} testID="clerk-membership">
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingTop: topPad + 16, paddingBottom: botPad + 80 }]}
          showsVerticalScrollIndicator={false}
        >
          <Text
            style={[styles.headerName, { color: colors.textOnSurface }]}
            numberOfLines={1}
            testID="clerk-membership-name"
          >
            {design.displayName}
          </Text>
          <View style={[styles.tierPill, { backgroundColor: colors.backgroundMid }]}>
            <Text
              style={[styles.tierPillText, { color: colors.primaryForeground }]}
              numberOfLines={1}
              testID="clerk-membership-tier"
            >
              {design.tierBadge}
            </Text>
          </View>
          {visibleState.kind === 'loading' || visibleState.kind === 'refreshing' ? (
            <ActivityIndicator color={colors.primary} style={{ marginBottom: 12 }} testID="clerk-membership-loading" />
          ) : null}
          {visibleState.kind === 'error' || visibleState.kind === 'stale_error' ? (
            <>
              <Text style={[styles.catalogStatusText, { color: colors.mutedForegroundLight, marginBottom: 8 }]} testID="clerk-membership-error">
                {visibleState.message}
              </Text>
              <TouchableOpacity
                onPress={() => setClerkMembershipAttempt((attempt) => attempt + 1)}
                accessibilityRole="button"
                testID="clerk-membership-retry"
                style={[styles.plansLink, { alignSelf: 'flex-start', paddingTop: 0 }]}
              >
                <Text style={[styles.plansLinkText, { color: colors.primary }]}>Try again</Text>
              </TouchableOpacity>
            </>
          ) : null}
          {visibleState.kind === 'not_authenticated' ? (
            <>
              <Text style={[styles.catalogStatusText, { color: colors.mutedForegroundLight, marginBottom: 8 }]}>
                We couldn’t confirm your membership details. Please try again.
              </Text>
              <TouchableOpacity
                onPress={() => setClerkMembershipAttempt((attempt) => attempt + 1)}
                accessibilityRole="button"
                testID="clerk-membership-retry"
                style={[styles.plansLink, { alignSelf: 'flex-start', paddingTop: 0 }]}
              >
                <Text style={[styles.plansLinkText, { color: colors.primary }]}>Try again</Text>
              </TouchableOpacity>
            </>
          ) : null}
          {design.statusNote ? (
            <Text
              style={[styles.catalogStatusText, { color: colors.mutedForegroundLight, marginBottom: 16 }]}
              testID="clerk-membership-unverified"
            >
              {design.statusNote}
            </Text>
          ) : null}

          <View style={styles.statRow}>
            <StatCard label="Flights Flown" value={design.flightsFlown} />
            <StatCard label="Total Saved" value={design.totalSaved} />
          </View>
          <View style={[styles.statRow, { marginTop: 10 }]}>
            <StatCard label="Skip the Line Passes" value={design.skipTheLinePasses} />
            <StatCard label="Referral Balance" value={design.referralBalance} />
          </View>

          <View style={[styles.usageCard, { backgroundColor: colors.surface }]} testID="clerk-membership-usage">
            <View style={styles.usageHeader}>
              <Text style={[styles.usageTitle, { color: colors.textOnSurface }]}>This Year's Usage</Text>
              <Text style={[styles.usageCount, { color: colors.mutedForegroundLight }]}>
                {design.usageLabel}
              </Text>
            </View>
            <View style={[styles.usageTrack, { backgroundColor: colors.muted }]}>
              <View style={[styles.usageFill, { backgroundColor: colors.primary, width: `${design.usageProgress * 100}%` }]} />
            </View>
          </View>

          <View testID="clerk-membership-upgrade">
            <LinearGradient
              colors={['#0A1128', '#1259F2']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1.2 }}
              style={styles.upgradeCard}
            >
              <Text style={styles.upgradeEyebrow}>UPGRADE</Text>
              <Text style={styles.upgradeTitle}>{design.upgradeTitle}</Text>
              <Text style={styles.upgradeBody}>{design.upgradeBody}</Text>
            </LinearGradient>
          </View>

          <View style={[styles.linkCard, { backgroundColor: colors.surface }]}>
            {clerkRows.map((row, i) => (
              <TouchableOpacity
                key={row.label}
                testID={row.label === 'Referral Program' ? 'membership-referral-program' : row.label === 'AI Concierge' ? 'membership-concierge' : 'membership-payment-methods'}
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

  const mem = demoMode ? getFullAppDemoMemberOverview() : membership;
  const currentTier: string | null = mem?.tier ?? null;
  const currentIdx = currentTier ? TIER_ORDER[currentTier] ?? -1 : -1;
  const plans = plansQuery.data?.plans ?? [];
  const nextPublicPlan = currentTier
    ? plans.find((plan) => (TIER_ORDER[plan.tier] ?? -1) > currentIdx)
    : undefined;
  const family = mem?.family;

  const tierLabel = currentTier ? getTierLabel(currentTier, mem?.plans ?? []) : 'Membership';

  if (!localDemoFlow) {
    return (
      <ProductionAuthenticatedUnavailableNotice
        title="Membership status unavailable"
        description="Your membership details are unavailable right now. Public plan information is still available."
        testID="production-membership-unavailable"
        actionLabel="Compare all plans"
        onAction={() => router.push('/membership/plans' as any)}
      />
    );
  }

  if (isLoading && !mem) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.offWhite }]}>
        <ActivityIndicator testID="membership-loading" color={colors.primary} size="large" />
      </View>
    );
  }
  if (!mem) {
    return (
      <View style={[styles.centered, styles.errorState, { backgroundColor: colors.offWhite }]}>
        <Text style={[styles.errorTitle, { color: colors.textOnSurface }]}>
          {isError ? 'Membership status unavailable' : 'Membership details unavailable'}
        </Text>
        <Text style={[styles.errorBody, { color: colors.mutedForegroundLight }]}>
          {isError
            ? 'We could not confirm your membership. This does not mean your membership has ended.'
            : 'No account-bound membership details are available right now.'}
        </Text>
        {isError ? (
          <TouchableOpacity testID="legacy-membership-retry" style={[styles.retryBtn, { backgroundColor: colors.primary }]} onPress={() => refetch()}>
            <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Try Again</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity onPress={() => router.push('/membership/plans' as any)} style={styles.plansLink}>
          <Text style={[styles.plansLinkText, { color: colors.primary }]}>Browse public plans</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Non-member: "join Bluebird" state instead of member stats ──
  if (mem.tier === 'none') {
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
              <Text style={styles.upgradeTitle}>Bluebird Membership</Text>
              <Text style={styles.upgradeBody}>
                Your access to exclusive private aviation. Review verified public plans and benefits below.
              </Text>
              <View style={[styles.upgradeBtn, { backgroundColor: colors.surface }]}>
                <Text style={[styles.upgradeBtnText, { color: '#0A1128' }]}>Browse plans</Text>
              </View>
            </LinearGradient>
          </TouchableOpacity>

          <View style={[styles.catalogStatusCard, { backgroundColor: colors.surface, borderColor: colors.border }]} testID="membership-skip-line">
            <Text style={[styles.usageTitle, { color: colors.textOnSurface }]}>Skip the Line Pass</Text>
            <Text style={[styles.catalogStatusText, { color: colors.mutedForegroundLight, marginTop: 8 }]}>
              An active membership is required to join a flight queue or use a Skip the Line Pass.
            </Text>
          </View>

          <Text style={[styles.becomeMemberTitle, { color: colors.textOnSurface }]}>Become a member</Text>
          <View style={styles.inlinePlans}>
            {plansQuery.isLoading ? (
              <View testID="membership-catalog-loading" style={[styles.centered, { flex: 0, gap: 8 }]}>
                <ActivityIndicator color={colors.primary} size="large" />
                <Text style={[styles.catalogStatusText, { color: colors.mutedForegroundLight }]}>
                  Loading public plans…
                </Text>
              </View>
            ) : plansQuery.isError || !plansQuery.data ? (
              <View style={styles.planLoadError}>
                <Text style={[styles.planLoadErrorText, { color: colors.mutedForegroundLight }]}>
                  Could not load plan information. Please try again.
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
            ) : plans.length === 0 ? (
              <View
                style={[styles.catalogStatusCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                testID="membership-catalog-empty"
              >
                <Text style={[styles.catalogStatusText, { color: colors.mutedForegroundLight }]}>
                  No public membership plans are currently listed. Prices, billing periods, and benefits are unavailable.
                </Text>
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
                      <TouchableOpacity
                        testID={`membership-plan-details-${plan.tier}`}
                        accessibilityRole="button"
                        onPress={() => router.push({ pathname: '/upgrade/[tier]', params: { tier: plan.tier } } as any)}
                        style={styles.planDetailsButton}
                      >
                        <Text style={[styles.plansLinkText, { color: colors.primary }]}>View Details</Text>
                      </TouchableOpacity>
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

  if (!currentTier || TIER_ORDER[currentTier] === undefined) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.offWhite, padding: 28 }]}>
        <Text style={[styles.errorTitle, { color: colors.textOnSurface }]}>Membership status unavailable</Text>
        <Text style={[styles.errorBody, { color: colors.mutedForegroundLight }]}>
          Your account response did not confirm a supported membership plan.
        </Text>
        <TouchableOpacity onPress={() => router.push('/membership/plans' as any)} style={styles.plansLink}>
          <Text style={[styles.plansLinkText, { color: colors.primary }]}>Browse public plans</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const totalSaved: number = mem.totalSavedUsd ?? 0;
  const lifetimeFlights: number = mem.lifetimeCompletedFlights ?? 0;
  const familyMember = family?.members.find((member) => member.userId === user?.id);
  const linePasses: number | null = familyMember
    ? familyMember.availablePasses
    : Number.isSafeInteger(mem.linePassCount) && mem.linePassCount >= 0
      ? mem.linePassCount
      : null;
  const renewalDate = mem.renewalDate ? formatMembershipDate(mem.renewalDate) : 'Unavailable';
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
    <View
      testID={demoMode ? 'full-app-demo-membership' : undefined}
      style={[styles.root, { backgroundColor: colors.offWhite }]}
    >
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: topPad + 16, paddingBottom: botPad + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header: name + dark tier pill ── */}
        <Text style={[styles.headerName, { color: colors.textOnSurface }]} numberOfLines={1}>
          Membership
        </Text>
        {demoMode ? (
          <Text style={[styles.catalogStatusText, { color: colors.mutedForegroundLight }]}>
            Sample membership · Base · Active · Local demo data only
          </Text>
        ) : null}
        <View style={[styles.tierPill, { backgroundColor: colors.backgroundMid }]}>
          <Text style={[styles.tierPillText, { color: colors.primaryForeground }]} numberOfLines={1}>
            {tierLabel} Member
          </Text>
        </View>
        {membershipFetching ? (
          <Text style={[styles.catalogStatusText, { color: colors.mutedForegroundLight, marginBottom: 10 }]}>
            Refreshing account membership…
          </Text>
        ) : null}

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
          <StatCard label="Renewal" value={renewalDate} />
        </View>
        <View style={[styles.statRow, { marginTop: 10 }]}>
          <StatCard label="Skip the Line Passes" value={linePasses ?? 'Unavailable'} />
        </View>
        <View style={[styles.catalogStatusCard, { backgroundColor: colors.surface, borderColor: colors.border }]} testID="membership-skip-line">
          <Text style={[styles.usageTitle, { color: colors.textOnSurface }]}>Skip the Line Pass</Text>
          <Text style={[styles.catalogStatusText, { color: colors.mutedForegroundLight, marginTop: 8 }]}>
            {linePasses === null
              ? 'Pass balance unavailable. We could not verify an account-bound balance.'
              : linePasses === 0
                ? 'No passes are currently available on this account.'
                : `${linePasses} account-confirmed pass${linePasses === 1 ? '' : 'es'} available.`}
          </Text>
          <TouchableOpacity
            testID="membership-view-flights"
            accessibilityRole="button"
            onPress={() => router.push('/(tabs)/discover' as any)}
            style={styles.planDetailsButton}
          >
            <Text style={[styles.plansLinkText, { color: colors.primary }]}>View eligible flights</Text>
          </TouchableOpacity>
        </View>
        {Array.isArray(mem.features) && mem.features.length > 0 ? (
          <View style={[styles.catalogStatusCard, { backgroundColor: colors.surface, borderColor: colors.border }]} testID="membership-benefits">
            <Text style={[styles.usageTitle, { color: colors.textOnSurface }]}>Available benefits</Text>
            {mem.features.map((feature) => (
              <View key={feature} style={styles.inlineFeatureRow}>
                <Text style={[styles.inlineFeatureCheck, { color: colors.primary }]}>✓</Text>
                <Text style={[styles.inlineFeatureText, { color: colors.textOnSurface }]}>{feature}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {isError ? (
          <View style={[styles.catalogStatusCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.catalogStatusText, { color: colors.mutedForegroundLight }]}>
              Membership refresh failed. The last verified account details are still shown.
            </Text>
            <TouchableOpacity accessibilityRole="button" testID="legacy-membership-retry" onPress={() => refetch()}>
              <Text style={[styles.plansLinkText, { color: colors.primary }]}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : null}

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
        ) : !family && plansQuery.isLoading ? (
          <View style={[styles.catalogStatusCard, { backgroundColor: colors.surface, borderColor: colors.border }]} testID="membership-catalog-loading">
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.catalogStatusText, { color: colors.mutedForegroundLight }]}>
              Loading public plan details…
            </Text>
          </View>
        ) : !family && plansQuery.data?.plans.length === 0 ? (
          <View style={[styles.catalogStatusCard, { backgroundColor: colors.surface, borderColor: colors.border }]} testID="membership-catalog-empty">
            <Text style={[styles.catalogStatusText, { color: colors.mutedForegroundLight }]}>
              No public membership plans are currently listed. No higher plan price or benefits are available.
            </Text>
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
              testID={row.label === 'Referral Program' ? 'membership-referral-program' : undefined}
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
  planDetailsButton: { alignSelf: 'flex-start', paddingTop: 12, paddingBottom: 4 },

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
  clerkMembershipDetails: { marginTop: 14, borderTopWidth: 1 },
  clerkMembershipDetailRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    gap: 14, paddingVertical: 10, borderBottomWidth: 1,
  },
  clerkMembershipDetailLabel: { fontFamily: 'Inter_400Regular', fontSize: 12.5, flex: 1 },
  clerkMembershipDetailValue: { fontFamily: 'Inter_500Medium', fontSize: 13, flex: 1, textAlign: 'right' },
  clerkMembershipEvents: { marginTop: 16, gap: 7 },

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
