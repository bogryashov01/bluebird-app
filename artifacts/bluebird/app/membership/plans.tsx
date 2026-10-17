import React from 'react';
import { router } from 'expo-router';
import {
  ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGetMembership } from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { useProductionMembershipPlans } from '@/hooks/useProductionMembershipPlans';
import { getTierLabel, TIER_COLORS, TIER_ORDER } from '@/lib/membershipPlans';
import { isLegacyMemberQueryEnabled } from '@/lib/clerkAuthSession';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { createMainBluebirdApiIntegration } from '@/lib/mainBluebirdApi';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import {
  getClerkBluebirdProfileEffectDependencies,
  isClerkBluebirdProfileResultCurrent,
  loadClerkBluebirdMembership,
} from '@/lib/clerkBluebirdProfile';
import type { ClerkBluebirdMembershipLoadResult } from '@/lib/clerkBluebirdProfile';
import {
  formatProductionPlanPrice,
  productionPlanFeatureLabel,
  productionPlanPurchaseNotice,
} from '@/lib/productionMembershipPlans';
import { isLocalFlightReadMode } from '@/lib/productionFlights';

type ClerkMembershipState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'not_authenticated' }
  | { kind: 'loaded'; clerkUserId: string; result: ClerkBluebirdMembershipLoadResult };

export default function AllPlansScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { user, authMode } = useAuth();
  const clerkSession = useClerkAuthSnapshot();
  const mainApiConfiguration = getMainBluebirdApiConfigurationOrNull();
  const localDemoFlow = isLocalFlightReadMode();
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const legacyMembershipEnabled = isLegacyMemberQueryEnabled({
    authMode,
    localDemoFlow,
    hasLegacyUser: !!user,
  });
  const {
    data: membership,
    isLoading: legacyMembershipLoading,
    isError: legacyMembershipError,
    refetch: refetchLegacyMembership,
  } = useGetMembership({
    query: {
      enabled: legacyMembershipEnabled,
      queryKey: ['/api/membership', user?.id ?? 'no-local-account'],
    },
  });
  const [clerkMembershipState, setClerkMembershipState] =
    React.useState<ClerkMembershipState>({ kind: 'loading' });
  const [clerkMembershipAttempt, setClerkMembershipAttempt] = React.useState(0);
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
    setClerkMembershipState({ kind: 'loading' });
    try {
      const result = await loadClerkBluebirdMembership(createClerkApi().authenticated, signal);
      if (!isClerkBluebirdProfileResultCurrent({
        requestedClerkUserId,
        currentClerkUserId: currentClerkIdentity.current,
        aborted: signal.aborted,
      })) return;
      if (result.kind === 'api_not_authenticated') {
        setClerkMembershipState({ kind: 'not_authenticated' });
        return;
      }
      setClerkMembershipState({ kind: 'loaded', clerkUserId: requestedClerkUserId, result });
    } catch (error) {
      if (signal.aborted || currentClerkIdentity.current !== requestedClerkUserId) return;
      const typed = error as { code?: string; status?: number };
      const message = typed?.code === 'network' || typed?.code === 'timeout'
        ? 'Bluebird could not be reached. Check your connection and try again.'
        : typed?.code === 'session_expired' || typed?.status === 401
          ? 'Your sign-in has expired. Sign in again, then reopen Plans.'
          : 'Bluebird could not load your membership details.';
      setClerkMembershipState({ kind: 'error', message });
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
  const plansQuery = useProductionMembershipPlans();
  const visibleClerkState = clerkMembershipState.kind === 'loaded' &&
    clerkMembershipState.clerkUserId !== clerkSession?.userId
    ? { kind: 'loading' as const }
    : clerkMembershipState;
  const clerkResult = visibleClerkState.kind === 'loaded' ? visibleClerkState.result : null;
  const clerkConfirmedMembership = clerkResult?.kind === 'authenticated' &&
    clerkResult.membershipState === 'available'
    ? clerkResult.membership
    : null;
  const legacyTier = membership?.tier;
  const currentTier: string | null = authMode === 'clerk'
    ? clerkConfirmedMembership?.isMember === true ? clerkConfirmedMembership.tier : null
    : legacyMembershipEnabled && !legacyMembershipError && legacyTier && TIER_ORDER[legacyTier] >= 0
      ? legacyTier
      : null;
  const currentIdx = currentTier ? (TIER_ORDER[currentTier] ?? -1) : -1;
  const currentTierLabel = currentTier
    ? plansQuery.data?.plans.find((plan) => plan.tier === currentTier)?.name ?? getTierLabel(currentTier)
    : null;
  const currentMembershipLabel = authMode === 'clerk'
    ? visibleClerkState.kind === 'loading'
      ? 'Loading membership details'
      : visibleClerkState.kind === 'not_authenticated'
        ? 'Sign in to see your current membership.'
        : visibleClerkState.kind === 'error'
          ? 'Membership status unavailable'
          : clerkConfirmedMembership?.isMember === false && clerkConfirmedMembership.tier === null
            ? 'Not a member yet'
            : currentTier
              ? currentTierLabel
              : 'Membership status unavailable'
    : !legacyMembershipEnabled
      ? 'Sign in to see your current membership.'
      : legacyMembershipLoading
        ? 'Loading membership details'
        : legacyMembershipError
          ? 'Membership status unavailable'
          : legacyTier === 'none'
            ? 'Not a member yet'
            : currentTier
              ? currentTierLabel
              : 'Membership status unavailable';
  const currentMembershipDetail = authMode === 'clerk'
    ? visibleClerkState.kind === 'error'
      ? visibleClerkState.message
      : visibleClerkState.kind === 'not_authenticated'
        ? 'No authenticated membership details were loaded.'
        : clerkResult?.kind === 'authenticated'
          ? clerkResult.membershipState === 'available'
            ? clerkConfirmedMembership?.status ?? (clerkConfirmedMembership?.isMember ? 'Active' : 'Not a member')
            : clerkResult.membershipState === 'conflict'
              ? 'Membership details did not match the authenticated account and are hidden.'
              : 'Membership details are unavailable.'
          : null
    : legacyMembershipError
      ? 'Your membership details could not be loaded. Public plan pricing remains available.'
    : legacyMembershipEnabled && !legacyMembershipLoading
      ? legacyTier === 'none'
        ? 'Not a member'
        : currentTier ? 'Member' : 'Membership status unavailable'
      : null;
  const clerkMembershipNeedsRetry = visibleClerkState.kind === 'error' ||
    (clerkResult?.kind === 'authenticated' &&
      (clerkResult.membershipState === 'unavailable' || clerkResult.membershipState === 'conflict'));

  if (plansQuery.isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.offWhite }]} testID="membership-catalog-loading">
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={[styles.errorBody, { color: colors.mutedForegroundLight }]}>Loading public plan catalog…</Text>
      </View>
    );
  }
  if (plansQuery.isError || !plansQuery.data) {
    return (
      <View style={[styles.centered, styles.errorState, { backgroundColor: colors.offWhite }]}>
        <Text style={[styles.errorTitle, { color: colors.textOnSurface }]}>Plan information unavailable</Text>
        <Text style={[styles.errorBody, { color: colors.mutedForegroundLight }]}>
          We couldn’t load plan details. Please try again.
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
    );
  }

  if (plansQuery.data.plans.length === 0) {
    return (
      <View style={[styles.centered, styles.errorState, { backgroundColor: colors.offWhite }]} testID="membership-catalog-empty">
        <Text style={[styles.errorTitle, { color: colors.textOnSurface }]}>No public membership plans are listed</Text>
        <Text style={[styles.errorBody, { color: colors.mutedForegroundLight }]}>
          Prices, billing periods, and benefits are unavailable until the public catalog lists a plan.
        </Text>
        <TouchableOpacity
          style={[styles.retryBtn, { backgroundColor: colors.primary }]}
          onPress={() => router.back()}
          accessibilityRole="button"
        >
          <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Go Back</Text>
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
        <View
          style={[styles.membershipStatusCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
          testID="current-membership"
        >
          <Text style={[styles.membershipStatusTitle, { color: colors.textOnSurface }]}>Your membership</Text>
          <Text
            style={[styles.currentMembership, { color: colors.mutedForegroundLight }]}
            testID="current-membership-status"
          >
            {currentTier
              ? `Current membership: ${currentMembershipLabel}`
              : currentMembershipLabel}
          </Text>
          {currentMembershipDetail ? (
            <Text style={[styles.membershipStatusDetail, { color: colors.mutedForegroundLight }]}>
              {currentMembershipDetail}
            </Text>
          ) : null}
          {authMode === 'clerk' && clerkMembershipNeedsRetry ? (
            <TouchableOpacity
              onPress={() => setClerkMembershipAttempt((attempt) => attempt + 1)}
              accessibilityRole="button"
              testID="clerk-membership-retry"
              style={styles.membershipRetry}
            >
              <Text style={[styles.membershipRetryText, { color: colors.primary }]}>Try again</Text>
            </TouchableOpacity>
          ) : null}
          {authMode !== 'clerk' && legacyMembershipEnabled && legacyMembershipError ? (
            <TouchableOpacity
              onPress={() => void refetchLegacyMembership()}
              accessibilityRole="button"
              testID="legacy-membership-retry"
              style={styles.membershipRetry}
            >
              <Text style={[styles.membershipRetryText, { color: colors.primary }]}>Try again</Text>
            </TouchableOpacity>
          ) : null}
        </View>
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
                    <Text
                      style={[styles.tierName, { color: planColor }]}
                      testID={`membership-plan-${plan.tier}`}
                    >
                      {plan.name}
                    </Text>
                    {isCurrent && (
                      <View style={[styles.currentBadge, { backgroundColor: planColor + '20' }]}>
                        <Text style={[styles.currentBadgeText, { color: planColor }]} testID="current-plan-badge">
                          Current
                        </Text>
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
              <TouchableOpacity
                testID={`membership-plan-details-${plan.tier}`}
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/upgrade/[tier]', params: { tier: plan.tier } } as any)}
                style={styles.planDetailsButton}
              >
                <Text style={[styles.membershipRetryText, { color: colors.primary }]}>View Details</Text>
              </TouchableOpacity>
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
  membershipStatusCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12 },
  membershipStatusTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14, marginBottom: 6 },
  currentMembership: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  membershipStatusDetail: { fontFamily: 'Inter_400Regular', fontSize: 12.5, lineHeight: 18, marginTop: 5 },
  membershipRetry: { alignSelf: 'flex-start', paddingVertical: 10 },
  membershipRetryText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
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
  planDetailsButton: { alignSelf: 'flex-start', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },
  availabilityCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12 },
  availabilityTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14, marginBottom: 6 },
  availabilityText: { fontFamily: 'Inter_400Regular', fontSize: 12.5, lineHeight: 18, marginTop: 3 },
});
