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
  productionPlanFeatureLabel,
  productionPlanPurchaseNotice,
} from '@/lib/productionMembershipPlans';
import { isLocalFlightReadMode } from '@/lib/productionFlights';
import { ProductionAuthenticatedUnavailableNotice } from '@/components/ProductionAuthenticatedUnavailableNotice';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { createMainBluebirdApiIntegration } from '@/lib/mainBluebirdApi';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import {
  getClerkBluebirdProfileEffectDependencies,
  isClerkBluebirdProfileResultCurrent,
  loadClerkBluebirdMembership,
} from '@/lib/clerkBluebirdProfile';
import type { ClerkBluebirdMembershipLoadResult } from '@/lib/clerkBluebirdProfile';
import { getFullAppDemoMemberOverview } from '@/lib/fullAppDemo';

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
  | { kind: 'error'; message: string }
  | { kind: 'not_authenticated' }
  | {
      kind: 'loaded' | 'refreshing' | 'stale_error';
      clerkUserId: string;
      result: ClerkBluebirdMembershipLoadResult;
      passBalance: number | null;
      message?: string;
    };

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
  const { user, authMode, demoMode } = useAuth();
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
    result: ClerkBluebirdMembershipLoadResult;
    passBalance: number | null;
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
  const createClerkApi = React.useCallback(() => {
    if (!mainApiConfiguration || !clerkSession || clerkSession.isSignedIn !== true || !clerkSession.userId) {
      throw new Error('Your signed-in Bluebird account is unavailable.');
    }
    const requestedClerkUserId = clerkSession.userId;
    return createMainBluebirdApiIntegration({
      configuration: mainApiConfiguration,
      tokenProvider: {
        environment: mainApiConfiguration.environment,
        getVerifiedAccessToken: async () => {
          const activeSession = currentClerkSession.current;
          if (
            !activeSession ||
            activeSession.isLoaded !== true ||
            activeSession.isSignedIn !== true ||
            activeSession.userId !== requestedClerkUserId
          ) return null;
          return activeSession.getToken();
        },
      },
    });
  }, [...membershipRequestDependencies]);
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
      const api = createClerkApi().authenticated;
      const result = await loadClerkBluebirdMembership(api, signal);
      if (!isClerkBluebirdProfileResultCurrent({
        requestedClerkUserId,
        currentClerkUserId: currentClerkIdentity.current,
        aborted: signal.aborted,
      })) return;
      if (result.kind === 'api_not_authenticated') {
        setClerkMembershipState({ kind: 'not_authenticated' });
        return;
      }
      let passBalance: number | null = null;
      if (
        result.kind === 'authenticated' &&
        result.membershipState === 'available' &&
        result.membership?.isMember === true
      ) {
        try {
          const profile = await api.getProfile({ signal });
          passBalance = profile.upgradeCreditBalances.skipTheLine;
        } catch {
          // The profile balance is optional for this screen. Membership remains
          // confirmed, but an unverified pass count must stay unavailable.
        }
      }
      if (!isClerkBluebirdProfileResultCurrent({
        requestedClerkUserId,
        currentClerkUserId: currentClerkIdentity.current,
        aborted: signal.aborted,
      })) return;
      const loaded = { clerkUserId: requestedClerkUserId, result, passBalance };
      cachedClerkMembership.current = loaded;
      setClerkMembershipState({ kind: 'loaded', ...loaded });
    } catch (error) {
      if (signal.aborted || currentClerkIdentity.current !== requestedClerkUserId) return;
      const typed = error as { code?: string; status?: number };
      const message = typed?.code === 'network' || typed?.code === 'timeout'
        ? 'Bluebird could not be reached. Check your connection and try again.'
        : typed?.code === 'session_expired' || typed?.status === 401
          ? 'Your sign-in has expired. Sign in again, then reopen Membership.'
          : 'Bluebird could not load your membership details.';
      setClerkMembershipState(cached
        ? { kind: 'stale_error', ...cached, message }
        : { kind: 'error', message });
    }
  }, [authMode, createClerkApi, ...membershipRequestDependencies]);
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
  const plansQuery = useProductionMembershipPlans({ enabled: !demoMode });
  const mem = demoMode ? getFullAppDemoMemberOverview() : membership;

  if (authMode === 'clerk') {
    const visibleState = 'clerkUserId' in clerkMembershipState &&
      clerkMembershipState.clerkUserId !== clerkSession?.userId
      ? { kind: 'loading' as const }
      : clerkMembershipState;
    const result = 'result' in visibleState ? visibleState.result : null;
    const passBalance = 'passBalance' in visibleState ? visibleState.passBalance : null;
    const currentUser = result?.kind === 'authenticated' ? result.currentUser : null;
    const membershipIsVerified = result?.kind === 'authenticated' &&
      result.membershipState === 'available' &&
      result.membership !== null;
    const confirmedMembership = result?.kind === 'authenticated' &&
      result.membershipState === 'available'
      ? result.membership
      : null;
    const confirmedMember = membershipIsVerified && confirmedMembership?.isMember === true &&
      !!confirmedMembership.tier;
    const tierLabel = confirmedMember && confirmedMembership?.tier
      ? TIER_META[confirmedMembership.tier]?.label ?? 'Unavailable'
      : 'Unavailable';
    const confirmedNonMember = membershipIsVerified &&
      confirmedMembership?.isMember === false &&
      confirmedMembership.tier === null;
    const membershipStatus = confirmedMembership
      ? confirmedMembership.status ?? (confirmedMembership.isMember ? 'Unavailable' : 'Not a member')
      : 'Unavailable';
    const clerkMemberPlan = confirmedMember
      ? plansQuery.data?.plans.find((plan) => plan.tier === confirmedMembership?.tier)
      : null;
    const clerkMemberFeatures = clerkMemberPlan && plansQuery.data
      ? [
          ...(plansQuery.data.cardFeatures[clerkMemberPlan.tier] ?? []),
          ...plansQuery.data.features
            .filter((feature) => {
              const value = feature.values[clerkMemberPlan.tier];
              return value === true || (typeof value === 'string' && value.trim().length > 0);
            })
            .map((feature) => `${feature.label}: ${productionPlanFeatureLabel(feature.values[clerkMemberPlan.tier])}`),
        ]
      : [];
    const detailRows = confirmedMembership ? [
      { label: 'Tier', value: confirmedMembership.tier ? TIER_META[confirmedMembership.tier]?.label ?? 'Unavailable' : confirmedNonMember ? 'Not a member' : 'Unavailable' },
      { label: 'Membership status', value: confirmedMembership.status ?? 'Unavailable' },
      { label: 'Started', value: formatMembershipDate(confirmedMembership.startedAt) },
      { label: 'Current period ends', value: formatMembershipDate(confirmedMembership.currentPeriodEnd) },
      { label: 'Payment status', value: confirmedMembership.paymentStatus ?? 'Unavailable' },
      {
        label: 'Cancellation',
        value: confirmedMembership.cancelAtPeriodEnd ? 'Scheduled at period end' : 'Not scheduled',
      },
      {
        label: 'Scheduled tier change',
        value: confirmedMembership.scheduledTierChange
          ? `${TIER_META[confirmedMembership.scheduledTierChange.to]?.label ?? confirmedMembership.scheduledTierChange.to} · ${formatMembershipDate(confirmedMembership.scheduledTierChange.at)}`
          : 'Unavailable',
      },
    ] : [];
    return (
      <View style={[styles.root, { backgroundColor: colors.offWhite }]} testID="clerk-membership">
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingTop: topPad + 16, paddingBottom: botPad + 80 }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.headerName, { color: colors.textOnSurface }]} numberOfLines={1}>
            Membership
          </Text>
          <View style={[styles.catalogStatusCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.usageTitle, { color: colors.textOnSurface }]}>Current status</Text>
            <Text
              style={[styles.catalogStatusText, { color: colors.mutedForegroundLight, marginTop: 8 }]}
              testID="clerk-membership-status"
            >
              {visibleState.kind === 'loading' || visibleState.kind === 'refreshing'
                ? 'Loading membership details'
                : visibleState.kind === 'not_authenticated' || !currentUser
                  ? 'Unavailable'
                  : confirmedNonMember
                    ? 'Not a member · Confirmed'
                    : confirmedMember
                      ? `${tierLabel} · ${membershipStatus}`
                    : 'Membership status unavailable'}
            </Text>
            {visibleState.kind === 'error' || visibleState.kind === 'stale_error' ? (
              <>
                <Text style={[styles.catalogStatusText, { color: colors.mutedForegroundLight, marginTop: 12 }]} testID="clerk-membership-error">
                  {visibleState.message}
                </Text>
                <TouchableOpacity
                  onPress={() => setClerkMembershipAttempt((attempt) => attempt + 1)}
                  accessibilityRole="button"
                  testID="clerk-membership-retry"
                  style={styles.plansLink}
                >
                  <Text style={[styles.plansLinkText, { color: colors.primary }]}>Try again</Text>
                </TouchableOpacity>
              </>
            ) : null}
            {visibleState.kind === 'not_authenticated' ? (
              <>
                <Text style={[styles.catalogStatusText, { color: colors.mutedForegroundLight, marginTop: 12 }]}>
                  We couldn’t confirm your membership details. Please try again.
                </Text>
                <TouchableOpacity
                  onPress={() => setClerkMembershipAttempt((attempt) => attempt + 1)}
                  accessibilityRole="button"
                  testID="clerk-membership-retry"
                  style={styles.plansLink}
                >
                  <Text style={[styles.plansLinkText, { color: colors.primary }]}>Try again</Text>
                </TouchableOpacity>
              </>
            ) : null}
            {result?.kind === 'authenticated' && result.membershipState === 'conflict' ? (
              <Text style={[styles.catalogStatusText, { color: colors.mutedForegroundLight, marginTop: 12 }]} testID="clerk-membership-conflict">
                Membership details are unavailable right now.
              </Text>
            ) : null}
            {result?.kind === 'authenticated' && result.membershipState === 'unavailable' ? (
              <Text style={[styles.catalogStatusText, { color: colors.mutedForegroundLight, marginTop: 12 }]} testID="clerk-membership-details-unavailable">
                Additional membership details are unavailable right now.
              </Text>
            ) : null}
            {visibleState.kind === 'refreshing' ? (
              <Text style={[styles.catalogStatusText, { color: colors.mutedForegroundLight, marginTop: 8 }]}>
                Refreshing confirmed account details…
              </Text>
            ) : null}
            {detailRows.length > 0 ? (
              <View
                style={[styles.clerkMembershipDetails, { borderTopColor: colors.separator }]}
                testID="clerk-membership-details"
              >
                {detailRows.map((row) => (
                  <View
                    key={row.label}
                    style={[styles.clerkMembershipDetailRow, { borderBottomColor: colors.separator }]}
                  >
                    <Text style={[styles.clerkMembershipDetailLabel, { color: colors.mutedForegroundLight }]}>{row.label}</Text>
                    <Text style={[styles.clerkMembershipDetailValue, { color: colors.textOnSurface }]}>{row.value}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {confirmedMembership?.recentEvents.length ? (
              <View style={styles.clerkMembershipEvents} testID="clerk-membership-events">
                <Text style={[styles.usageTitle, { color: colors.textOnSurface }]}>Recent membership activity</Text>
                {confirmedMembership.recentEvents.slice(0, 3).map((event) => (
                  <Text key={event.id} style={[styles.catalogStatusText, { color: colors.mutedForegroundLight }]}>
                    {event.eventType.split('_').join(' ')} · {formatMembershipDate(event.occurredAt)}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
          {confirmedMember && clerkMemberPlan ? (
            <View style={[styles.catalogStatusCard, { backgroundColor: colors.surface, borderColor: colors.border }]} testID="clerk-membership-benefits">
              <Text style={[styles.usageTitle, { color: colors.textOnSurface }]}>Available benefits</Text>
              {clerkMemberFeatures.length > 0
                ? clerkMemberFeatures.map((feature) => (
                    <View key={feature} style={styles.inlineFeatureRow}>
                      <Text style={[styles.inlineFeatureCheck, { color: colors.primary }]}>✓</Text>
                      <Text style={[styles.inlineFeatureText, { color: colors.textOnSurface }]}>{feature}</Text>
                    </View>
                  ))
                : <Text style={[styles.catalogStatusText, { color: colors.mutedForegroundLight }]}>
                    No benefits are listed for this tier in the public catalog.
                  </Text>}
            </View>
          ) : null}
          <View style={[styles.catalogStatusCard, { backgroundColor: colors.surface, borderColor: colors.border }]} testID="membership-skip-line">
            <Text style={[styles.usageTitle, { color: colors.textOnSurface }]}>Skip the Line Pass</Text>
            <Text style={[styles.catalogStatusText, { color: colors.mutedForegroundLight, marginTop: 8 }]}>
              {confirmedNonMember
                ? 'An active membership is required to join a queue or use a Skip the Line Pass.'
                : confirmedMember
                  ? passBalance === null
                    ? 'Pass balance unavailable. We could not verify an account-bound pass balance.'
                    : `${passBalance} available`
                  : 'Pass status unavailable until your membership and account balance are confirmed.'}
            </Text>
            {confirmedNonMember ? (
              <TouchableOpacity onPress={() => router.push('/membership/plans' as any)} style={styles.plansLink}>
                <Text style={[styles.plansLinkText, { color: colors.primary }]}>Browse public plans</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {plansQuery.isLoading ? (
            <View
              style={[styles.catalogStatusCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
              testID="membership-catalog-loading"
            >
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.catalogStatusText, { color: colors.mutedForegroundLight, marginTop: 8 }]}>
                Loading public plans…
              </Text>
            </View>
          ) : plansQuery.isError || !plansQuery.data ? (
            <View style={[styles.catalogStatusCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.catalogStatusText, { color: colors.mutedForegroundLight }]}>
                Public plan information is unavailable.
              </Text>
              <TouchableOpacity disabled={plansQuery.isFetching} onPress={() => plansQuery.refetch()}>
                <Text style={[styles.plansLinkText, { color: colors.primary }]}>
                  {plansQuery.isFetching ? 'Loading plans…' : 'Retry loading plans'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : plansQuery.data.plans.length === 0 ? (
            <View
              style={[styles.catalogStatusCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
              testID="membership-catalog-empty"
            >
              <Text style={[styles.catalogStatusText, { color: colors.mutedForegroundLight }]}>
                No public membership plans are currently listed. Prices, billing periods, and benefits are unavailable.
              </Text>
            </View>
          ) : confirmedMember && !clerkMemberPlan ? (
            <View
              style={[styles.catalogStatusCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
              testID="clerk-membership-catalog-missing-tier"
            >
              <Text style={[styles.catalogStatusText, { color: colors.mutedForegroundLight }]}>
                Public plan details for your confirmed membership tier are unavailable. No plan price or benefits are shown.
              </Text>
            </View>
          ) : null}
          {plansQuery.data?.plans.map((plan) => (
            <TouchableOpacity
              key={plan.tier}
              testID={`membership-plan-details-${plan.tier}`}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/upgrade/[tier]', params: { tier: plan.tier } } as any)}
              style={[styles.inlinePlanCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Text style={[styles.inlinePlanName, { color: TIER_COLORS[plan.tier as keyof typeof TIER_COLORS] ?? colors.primary }]}>
                {plan.name}
              </Text>
              <Text style={[styles.inlinePlanPrice, { color: colors.mutedForegroundLight }]}>
                {formatProductionPlanPrice(plan)}
              </Text>
              <Text style={[styles.plansLinkText, { color: colors.primary, marginTop: 8 }]}>View Details</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => router.push('/membership/plans' as any)}
            style={styles.plansLink}
          >
            <Text style={[styles.plansLinkText, { color: colors.primary }]}>Compare public plans</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

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
