import React from 'react';
import {
  ActivityIndicator, View, Text, Image, StyleSheet, ScrollView, TouchableOpacity,
  Platform, Modal, Pressable,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { isLegacyMemberQueryEnabled } from '@/lib/clerkAuthSession';
import { useGetMembership, useListNotifications } from '@workspace/api-client-react';
import type { Notification } from '@workspace/api-client-react';
import { notificationRoute } from '@/lib/notificationRoute';
import { SettingsGroup } from '@/components/SettingsGroup';
import { confirmDialog } from '@/lib/confirmDialog';
import { useTheme, type ThemePreference } from '@/context/ThemeContext';
import { isLocalFlightReadMode } from '@/lib/productionFlights';
import { ProductionAuthenticatedUnavailableNotice } from '@/components/ProductionAuthenticatedUnavailableNotice';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { createMainBluebirdApiIntegration } from '@/lib/mainBluebirdApi';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import { getClerkBluebirdProfileEffectDependencies, isClerkBluebirdProfileResultCurrent } from '@/lib/clerkBluebirdProfile';
import { loadClerkPersonalInfo } from '@/lib/clerkPersonalInfo';
import type { ProductionUserProfile } from '@/lib/productionAuthApi';
import { getFullAppDemoProfile } from '@/lib/fullAppDemo';

const THEME_OPTIONS: { value: ThemePreference; label: string; hint: string }[] = [
  { value: 'light',  label: 'Light',  hint: 'Always use the light theme' },
  { value: 'dark',   label: 'Dark',   hint: 'Always use the dark theme' },
  { value: 'system', label: 'System', hint: 'Match your device setting' },
];

function AppearanceSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const colors = useColors();
  const { preference, setPreference } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.surface }]} onPress={(event) => event.stopPropagation()}>
          <Text style={[styles.sheetTitle, { color: colors.textOnSurface }]}>Appearance</Text>
          {THEME_OPTIONS.map((opt, i) => {
            const active = preference === opt.value;
            return (
              <React.Fragment key={opt.value}>
                {i > 0 && <View style={[styles.sheetSep, { backgroundColor: colors.separator }]} />}
                <TouchableOpacity
                  style={styles.sheetRow}
                  activeOpacity={0.6}
                  onPress={() => { setPreference(opt.value); onClose(); }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sheetRowLabel, { color: colors.textOnSurface }]}>{opt.label}</Text>
                    <Text style={[styles.sheetRowHint, { color: colors.mutedForegroundLight }]}>{opt.hint}</Text>
                  </View>
                  <View style={[
                    styles.radioOuter,
                    { borderColor: active ? colors.primary : colors.border },
                  ]}>
                    {active && <View style={[styles.radioInner, { backgroundColor: colors.primary }]} />}
                  </View>
                </TouchableOpacity>
              </React.Fragment>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function resolvePhotoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const baseUrl = process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : '';
  return `${baseUrl}${path.startsWith('/api/') ? path : `/api/storage${path}`}`;
}

type ClerkProfileLoadState =
  | { kind: 'loading' }
  | { kind: 'refreshing'; clerkUserId: string; profile: ProductionUserProfile }
  | { kind: 'error'; message: string; clerkUserId?: string; staleProfile?: ProductionUserProfile }
  | { kind: 'not_authenticated' }
  | { kind: 'loaded'; clerkUserId: string; profile: ProductionUserProfile };

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { user, signOut, authMode, clerkMemberResolution, demoMode } = useAuth();
  const { preference } = useTheme();
  const clerkSession = useClerkAuthSnapshot();
  const mainApiConfiguration = getMainBluebirdApiConfigurationOrNull();
  const localDemoFlow = demoMode || isLocalFlightReadMode();
  const memberQueryEnabled = !demoMode && isLegacyMemberQueryEnabled({
    authMode,
    localDemoFlow,
    hasLegacyUser: !!user,
  });
  const [appearanceOpen, setAppearanceOpen] = React.useState(false);
  const [profileLoadState, setProfileLoadState] = React.useState<ClerkProfileLoadState>({ kind: 'loading' });
  const [profileLoadAttempt, setProfileLoadAttempt] = React.useState(0);
  const cachedClerkProfile = React.useRef<{ clerkUserId: string; profile: ProductionUserProfile } | null>(null);
  const currentClerkIdentity = React.useRef<string | null>(clerkSession?.userId ?? null);
  currentClerkIdentity.current = clerkSession?.userId ?? null;
  const currentClerkSession = React.useRef(clerkSession);
  currentClerkSession.current = clerkSession;
  const profileRequestDependencies = getClerkBluebirdProfileEffectDependencies({
    configuration: mainApiConfiguration,
    session: clerkSession,
    loadAttempt: profileLoadAttempt,
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
  }, [...profileRequestDependencies]);
  const loadClerkProfile = React.useCallback(async (signal: AbortSignal) => {
    if (
      authMode !== 'clerk' ||
      !clerkSession?.isLoaded ||
      clerkSession.isSignedIn !== true ||
      !clerkSession.userId
    ) return;
    const requestedClerkUserId = clerkSession.userId;
    const cached = cachedClerkProfile.current;
    setProfileLoadState(cached?.clerkUserId === requestedClerkUserId
      ? { kind: 'refreshing', ...cached }
      : { kind: 'loading' });
    try {
      const result = await loadClerkPersonalInfo(createClerkApi().authenticated, signal);
      if (!isClerkBluebirdProfileResultCurrent({
        requestedClerkUserId,
        currentClerkUserId: currentClerkIdentity.current,
        aborted: signal.aborted,
      })) return;
      if (result.kind === 'api_not_authenticated') {
        setProfileLoadState({ kind: 'not_authenticated' });
        return;
      }
      setProfileLoadState({
        kind: 'loaded',
        clerkUserId: requestedClerkUserId,
        profile: result.profile,
      });
      cachedClerkProfile.current = {
        clerkUserId: requestedClerkUserId,
        profile: result.profile,
      };
    } catch (error) {
      if (signal.aborted || currentClerkIdentity.current !== requestedClerkUserId) return;
      const typed = error as { code?: string; status?: number };
      const message = typed?.code === 'network' || typed?.code === 'timeout'
        ? 'Bluebird could not be reached. Check your connection and try again.'
        : typed?.code === 'session_expired' || typed?.status === 401
          ? 'Your sign-in has expired. Sign in again, then reopen your profile.'
          : 'Bluebird could not load your profile details.';
      const retained = cachedClerkProfile.current?.clerkUserId === requestedClerkUserId
        ? cachedClerkProfile.current
        : null;
      setProfileLoadState({
        kind: 'error',
        message,
        ...(retained ? { clerkUserId: retained.clerkUserId, staleProfile: retained.profile } : {}),
      });
    }
  }, [authMode, createClerkApi, ...profileRequestDependencies]);

  React.useEffect(() => {
    if (authMode !== 'clerk') return;
    if (!clerkSession?.isLoaded || clerkSession.isSignedIn !== true || !clerkSession.userId) {
      setProfileLoadState({ kind: 'not_authenticated' });
      return;
    }
    const controller = new AbortController();
    void loadClerkProfile(controller.signal);
    return () => controller.abort();
  }, [authMode, loadClerkProfile, ...profileRequestDependencies]);
  const { data: membership } = useGetMembership({
    query: { enabled: memberQueryEnabled },
  });

  const topPad    = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const { data: notifications } = useListNotifications({
    query: {
      refetchInterval: 15000,
      refetchIntervalInBackground: false,
      enabled: !demoMode && memberQueryEnabled,
    },
  });
  const notifList = (notifications as Notification[]) ?? [];
  const recentActivity = notifList.slice(0, 5);
  const unreadCount = notifList.filter((n) => !n.read).length;

  if (authMode === 'clerk') {
    const visibleProfileState = 'clerkUserId' in profileLoadState &&
      profileLoadState.clerkUserId !== clerkSession?.userId
      ? { kind: 'loading' as const }
      : profileLoadState;
    if (!clerkSession?.isLoaded || visibleProfileState.kind === 'loading') {
      return (
        <View style={[styles.clerkProfileLoading, { backgroundColor: colors.offWhite, paddingTop: topPad }]} testID="clerk-profile-loading" accessibilityLabel="Loading your profile">
          <Image source={require('@/assets/images/bluebird-bird-mark.png')} style={styles.clerkProfileLoadingMark} resizeMode="contain" />
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      );
    }
    if (visibleProfileState.kind === 'not_authenticated') {
      return (
        <ProductionAuthenticatedUnavailableNotice
          title="Profile unavailable"
          description="We couldn’t confirm your account details. Please try again."
          testID="clerk-profile-unavailable"
          actionLabel="Try again"
          onAction={() => setProfileLoadAttempt((attempt) => attempt + 1)}
        />
      );
    }
    const profile = visibleProfileState.kind === 'loaded' || visibleProfileState.kind === 'refreshing'
      ? visibleProfileState.profile
      : visibleProfileState.kind === 'error' ? visibleProfileState.staleProfile ?? null : null;
    const firstName = profile?.firstName?.trim() || null;
    const lastName = profile?.lastName?.trim() || null;
    const email = profile?.email?.trim() || null;
    const fullName = [firstName, lastName]
      .filter((value): value is string => value !== null)
      .join(' ');
    const memberProjection =
      clerkMemberResolution.status === 'profile_complete' &&
      clerkMemberResolution.clerkUserId === clerkSession?.userId
        ? clerkMemberResolution.currentUser
        : null;
    const membershipStatus = !memberProjection
      ? 'Membership status unavailable'
      : !memberProjection.isMember
        ? 'Not a member'
        : memberProjection.memberTier === 'plus'
          ? 'Plus Member'
          : memberProjection.memberTier === 'base'
            ? 'Base Member'
            : 'Member tier unavailable';
    return (
      <View style={[styles.container, { backgroundColor: colors.offWhite }]} testID="clerk-profile">
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: topPad + 16, paddingBottom: bottomPad + 100 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.avatarRow}>
            <View style={[styles.avatar, { backgroundColor: colors.backgroundMid }]}>
              <Text style={[styles.avatarText, { color: colors.textOnBrand }]}>
                {fullName
                  ? fullName.split(/\s+/).map((part) => part[0]).join('').toUpperCase().slice(0, 2)
                  : '—'}
              </Text>
            </View>
            <View>
              <Text style={[styles.name, { color: colors.textOnSurface }]}>
                {fullName || 'Name unavailable'}
              </Text>
              <Text style={[styles.memberSince, { color: colors.mutedForegroundLight }]}>
                {membershipStatus}
              </Text>
            </View>
          </View>
          {email ? (
            <Text style={[styles.profileReadNote, { color: colors.mutedForegroundLight }]}>
              {email}
            </Text>
          ) : null}
          {visibleProfileState.kind === 'refreshing' ? (
            <View style={styles.clerkProfileRefreshing} accessibilityRole="progressbar" testID="clerk-profile-refreshing">
              <Image source={require('@/assets/images/bluebird-bird-mark.png')} style={styles.clerkProfileRefreshingMark} resizeMode="contain" />
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : null}
          <SettingsGroup
            title="Account"
            rows={[
              {
                label: 'Personal Information',
                hint: 'Account details',
                onPress: () => router.push('/account/personal-info' as any),
              },
              {
                label: 'Connect Contacts',
                hint: 'Unavailable for this account',
                onPress: () => router.push('/account/contacts' as any),
              },
              {
                label: 'Payment Methods',
                onPress: () => router.push('/account/payment-methods' as any),
              },
            ]}
          />
          {visibleProfileState.kind === 'error' && (
            <View style={[styles.profileError, { backgroundColor: colors.surface, borderColor: colors.border }]} testID="clerk-profile-error">
              <Text style={[styles.profileErrorText, { color: colors.mutedForegroundLight }]}>
                {visibleProfileState.message}
              </Text>
              <TouchableOpacity
                onPress={() => setProfileLoadAttempt((attempt) => attempt + 1)}
                accessibilityRole="button"
                testID="clerk-profile-retry"
              >
                <Text style={[styles.profileRetryText, { color: colors.primary }]}>Try again</Text>
              </TouchableOpacity>
            </View>
          )}
          <SettingsGroup
            title="Preferences"
            rows={[
              {
                label: 'Notification Settings',
                hint: 'Travel preferences and alerts',
                onPress: () => router.push('/notifications'),
              },
              {
                label: 'Appearance',
                hint: THEME_OPTIONS.find((option) => option.value === preference)?.label,
                onPress: () => setAppearanceOpen(true),
              },
            ]}
          />
          <SettingsGroup
            title="Support"
            rows={[
              {
                label: 'Community',
                hint: 'Unavailable for this account',
                onPress: () => router.push('/community'),
              },
              {
                label: 'AI Concierge',
                hint: 'Unavailable for this account',
                onPress: () => router.push('/concierge'),
              },
              { label: 'Help Center', onPress: () => router.push('/support/help-center' as any) },
              { label: 'Legal', onPress: () => router.push('/support/legal' as any) },
            ]}
          />
          <SettingsGroup
            rows={[
              {
                label: 'Sign Out',
                onPress: async () => {
                  const ok = await confirmDialog(
                    'Sign out?',
                    'Are you sure you want to sign out?',
                    'Sign out',
                    true,
                  );
                  if (ok) signOut();
                },
                right: <Text style={[styles.signOutChevron, { color: colors.mutedForegroundLight }]}>›</Text>,
              },
            ]}
          />
        </ScrollView>
        <AppearanceSheet visible={appearanceOpen} onClose={() => setAppearanceOpen(false)} />
      </View>
    );
  }

  const demoProfile = demoMode ? getFullAppDemoProfile() : null;
  const displayName = (user?.name ?? [demoProfile?.firstName, demoProfile?.lastName].filter(Boolean).join(' ')) || 'Member';
  const initials    = displayName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2) || '?';
  const accountPhotoUrl = resolvePhotoUrl(user?.photoUrl);
  const tierLabel   = {
    none:      'Not a member yet',
    base:      'Base Member',
    plus:      'Plus Member',
    concierge: 'Family/Corporate Member',
  }[user?.membershipTier ?? (demoProfile?.memberTier === 'plus' ? 'plus' : 'base')] ?? 'Base Member';
  const memberSince = user?.createdAt
    ? new Date(user.createdAt).getFullYear()
    : new Date().getFullYear();

  if (!localDemoFlow) {
    return (
      <ProductionAuthenticatedUnavailableNotice
        title="Profile unavailable"
          description="Member profile information is unavailable right now."
        testID="production-profile-unavailable"
      />
    );
  }

  return (
    <View
      testID={demoMode ? 'full-app-demo-profile-screen' : undefined}
      style={[styles.container, { backgroundColor: colors.offWhite }]}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: topPad + 16, paddingBottom: bottomPad + 100 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {demoMode ? (
          <Text testID="full-app-demo-profile" style={[styles.profileReadNote, { color: colors.mutedForegroundLight }]}>
            Sample profile · local demo data only
          </Text>
        ) : null}
        {/* ── Avatar + name ── */}
        <View style={styles.avatarRow}>
          {accountPhotoUrl
            ? <Image source={{ uri: accountPhotoUrl }} style={styles.avatar} accessibilityLabel="Profile photo" />
            : <View style={[styles.avatar, { backgroundColor: colors.backgroundMid }]}>
              <Text style={[styles.avatarText, { color: colors.textOnBrand }]}>{initials}</Text>
            </View>}
          <View>
            <Text style={[styles.name, { color: colors.textOnSurface }]}>{displayName}</Text>
            <Text style={[styles.memberSince, { color: colors.mutedForegroundLight }]}>
              {tierLabel} since {memberSince}
            </Text>
          </View>
        </View>

        {/* ── Account ── */}
        <SettingsGroup
          title="Account"
          rows={[
            {
              label: 'Personal Information',
              testID: demoMode ? 'full-app-demo-disabled-profile-row' : undefined,
              hint: demoMode ? 'Unavailable in demo' : undefined,
              disabled: demoMode,
              onPress: () => router.push('/account/personal-info' as any),
            },
            {
              label: membership?.family ? 'Manage Family/Corporate' : 'Family/Corporate',
              hint: demoMode
                ? 'Unavailable in demo'
                : membership?.family ? 'members & shared passes' : 'household membership',
              disabled: demoMode,
              onPress: () => router.push('/membership/family' as any),
            },
            {
              label: 'Payment Methods',
              hint: demoMode ? 'Unavailable in demo' : undefined,
              disabled: demoMode,
              onPress: () => router.push('/account/payment-methods' as any),
            },
            {
              label: 'Passengers',
              hint: demoMode ? 'Unavailable in demo' : 'saved traveler details',
              disabled: demoMode,
              onPress: () => router.push('/account/passengers' as any),
            },
          ]}
        />

        {/* ── Preferences ── */}
        <SettingsGroup
          title="Preferences"
          rows={[
            {
              label: 'Appearance',
              hint: THEME_OPTIONS.find((o) => o.value === preference)?.label,
              onPress: () => setAppearanceOpen(true),
            },
            {
              label: 'Notification Settings',
              hint: demoMode ? 'Unavailable in demo' : 'incl. travel preferences',
              disabled: demoMode,
              onPress: () => router.push('/notifications'),
              right: (
                <View style={styles.rowRight}>
                  {unreadCount > 0 && (
                    <View style={[styles.unreadBadge, { backgroundColor: colors.primary }]}>
                      <Text style={[styles.unreadBadgeText, { color: colors.textOnBrand }]}>
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </Text>
                    </View>
                  )}
                  <Text style={[styles.signOutChevron, { color: colors.mutedForegroundLight }]}>›</Text>
                </View>
              ),
            },
            {
              label: 'Community',
              disabled: demoMode,
              onPress: () => router.push('/community'),
            },
            {
              label: 'Connections',
              hint: demoMode ? 'Unavailable in demo' : 'members you’ve met',
              disabled: demoMode,
              onPress: () => router.push({ pathname: '/(tabs)/connections' as any, params: { view: 'connections' } }),
            },
            {
              label: 'Messages',
              hint: demoMode ? 'Unavailable in demo' : 'your recent conversations',
              disabled: demoMode,
              onPress: () => router.push({ pathname: '/(tabs)/connections' as any, params: { view: 'messages' } }),
            },
            {
              label: 'Connection Requests',
              disabled: demoMode,
              onPress: () => router.push('/networking/requests' as any),
            },
          ]}
        />

        {/* ── Support ── */}
        <SettingsGroup
          title="Support"
          rows={[
            { label: 'AI Concierge', disabled: demoMode, onPress: () => router.push('/concierge') },
            { label: 'Help Center', disabled: demoMode, onPress: () => router.push('/support/help-center' as any) },
            { label: 'Referral', disabled: demoMode, onPress: () => router.push('/referral') },
            { label: 'Legal', disabled: demoMode, onPress: () => router.push('/support/legal' as any) },
          ]}
        />

        {/* ── Sign out ── */}
        <SettingsGroup
          rows={[
            {
              label: 'Sign Out',
              disabled: demoMode,
              onPress: async () => {
                const ok = await confirmDialog(
                  'Sign out?',
                  'Are you sure you want to sign out?',
                  'Sign out',
                  true,
                );
                if (ok) signOut();
              },
              right: <Text style={[styles.signOutChevron, { color: colors.mutedForegroundLight }]}>›</Text>,
            },
          ]}
        />

        {/* ── Recent Activity ── */}
        {recentActivity.length > 0 && (
          <View style={styles.activitySection}>
            <Text style={[styles.activityTitle, { color: colors.mutedForegroundLight }]}>Recent Activity</Text>
            <View style={[styles.activityList, { backgroundColor: colors.surface }]}>
              {recentActivity.map((item, i) => (
                <TouchableOpacity
                  key={item.id}
                  activeOpacity={0.6}
                  onPress={() => router.push((notificationRoute(item) ?? '/notifications') as any)}
                  style={[
                    styles.activityRow,
                    i < recentActivity.length - 1 && [styles.activityRowBorder, { borderBottomColor: colors.separator }],
                  ]}
                >
                  <View style={[
                    styles.activityDot,
                    { backgroundColor: item.read ? colors.mutedForegroundLight : colors.primary },
                  ]} />
                  <View style={styles.activityContent}>
                    <Text style={[styles.activityLabel, { color: colors.textOnSurface }]}>{item.title}</Text>
                    <Text style={[styles.activityDate, { color: colors.mutedForegroundLight }]}>
                      {fmtDate(item.createdAt)}
                    </Text>
                  </View>
                  <Text style={[styles.signOutChevron, { color: colors.mutedForegroundLight }]}>›</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
      <AppearanceSheet visible={appearanceOpen} onClose={() => setAppearanceOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 20, gap: 18 },
  clerkProfileLoading: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  clerkProfileLoadingMark: { width: 44, height: 48 },
  clerkProfileRefreshing: {
    height: 24, flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  clerkProfileRefreshingMark: { width: 18, height: 18 },

  avatarRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 14, paddingBottom: 4,
  },
  avatar: {
    width: 58, height: 58, borderRadius: 29,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: { fontFamily: 'Inter_700Bold', fontSize: 20 },
  name: { fontFamily: 'Inter_700Bold', fontSize: 20, letterSpacing: -0.4 },
  memberSince: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 2 },

  signOutChevron: { fontSize: 20, lineHeight: 22 },

  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  unreadBadge: {
    minWidth: 20, height: 20, borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: 'center', justifyContent: 'center',
  },
  unreadBadgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },

  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  sheet: {
    borderRadius: 18,
    paddingVertical: 8,
    overflow: 'hidden',
  },
  sheetTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 6,
  },
  sheetSep: { height: 1, marginLeft: 18 },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 13,
    gap: 12,
  },
  sheetRowLabel: { fontFamily: 'Inter_500Medium', fontSize: 15 },
  sheetRowHint:  { fontFamily: 'Inter_400Regular', fontSize: 12.5, marginTop: 1 },
  radioOuter: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  radioInner: { width: 10, height: 10, borderRadius: 5 },

  activitySection: { gap: 10 },
  activityTitle: {
    fontFamily: 'Inter_700Bold', fontSize: 11,
    textTransform: 'uppercase', letterSpacing: 0.5,
    paddingHorizontal: 4,
  },
  activityList: {
    borderRadius: 18,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowRadius: 20, shadowOpacity: 0.05, elevation: 3,
    overflow: 'hidden', paddingHorizontal: 4, paddingVertical: 4,
  },
  activityRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13,
  },
  activityRowBorder: {
    borderBottomWidth: 1,
  },
  activityDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  activityContent: { flex: 1 },
  activityLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  activityDate:  { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 1 },
  profileError: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 10 },
  profileErrorText: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  profileRetryText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  profileReadNote: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
});
