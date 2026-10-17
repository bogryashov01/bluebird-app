import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  useListNotifications, useMarkNotificationRead, getListNotificationsQueryKey, useUpdateMe,
} from '@workspace/api-client-react';
import type { Notification, User } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import { createMainBluebirdApiIntegration } from '@/lib/mainBluebirdApi';
import { ProductionAuthHttpError } from '@/lib/productionAuthApi';
import type { ProductionNotificationPrefs } from '@/lib/productionAuthApi';
import { readClerkNotificationProfile, saveClerkNotificationPreferences, notificationPreferenceRows } from '@/lib/clerkNotificationPreferences';
import { NotificationPreferenceEditor } from '@/components/NotificationPreferenceEditor';
import { SettingsGroup } from '@/components/SettingsGroup';
import { NETWORKING_INBOX_ROUTE, notificationRoute } from '@/lib/notificationRoute';
import { usePersistedState } from '@/hooks/usePersistedState';

// ── Toggle pill ───────────────────────────────────────────────────────────────
function Toggle({ value, onToggle, activeColor, trackOff, knobColor, disabled = false }: { value: boolean; onToggle: () => void; activeColor: string; trackOff: string; knobColor: string; disabled?: boolean }) {
  return (
    <TouchableOpacity
      style={[styles.toggle, { backgroundColor: value ? activeColor : trackOff }, disabled && styles.toggleDisabled]}
      onPress={onToggle}
      disabled={disabled}
      activeOpacity={0.8}
    >
      <View style={[styles.toggleKnob, { backgroundColor: knobColor, transform: [{ translateX: value ? 18 : 2 }] }]} />
    </TouchableOpacity>
  );
}

function timeAgo(d: string) {
  const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const TOGGLE_DEFAULTS = {
  flightFromHome: true,
  allFlights:     false,
  queueUpdates:   true,
  seatConfirmed:  true,
  memberUpdates:  false,
};

const DELIVERY_CHANNELS = [
  { value: 'app', label: 'App', hint: 'In-app history' },
  { value: 'email', label: 'Email', hint: 'Email only' },
  { value: 'both', label: 'Both', hint: 'App + email' },
] as const;
type DeliveryChannel = NonNullable<User['notificationChannel']>;

function notificationChannelLabel(channel: string | null): string {
  if (channel === 'email') return 'Email';
  if (channel === 'sms') return 'SMS';
  if (channel === 'both') return 'Email + SMS';
  return 'Not set';
}

function notificationModeLabel(mode: ProductionNotificationPrefs['mode']): string {
  if (mode === 'off') return 'Off';
  if (mode === 'all') return 'All flights';
  return 'Specific flights';
}

function notificationReadError(error: unknown): string {
  if (error instanceof ProductionAuthHttpError && error.status === 401) {
    return 'Your sign-in may have expired. Sign in again, then try once more.';
  }
  if (error instanceof ProductionAuthHttpError && error.status === 403) {
    return 'Notification preferences are unavailable for this account right now.';
  }
  if (error instanceof ProductionAuthHttpError) {
    return 'Could not load notification preferences. Please try again.';
  }
  return 'Could not load notification preferences. Check your connection and try again.';
}

function ClerkNotificationSettings() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const session = useClerkAuthSnapshot();
  const { clerkMemberResolution } = useAuth();
  const configuration = getMainBluebirdApiConfigurationOrNull();
  const sessionRef = React.useRef(session);
  sessionRef.current = session;
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const saveController = React.useRef<AbortController | null>(null);
  useEffect(() => () => saveController.current?.abort(), []);

  const currentUser =
    clerkMemberResolution.status === 'profile_complete' &&
    clerkMemberResolution.clerkUserId === session?.userId
      ? clerkMemberResolution.currentUser
      : null;
  const canLoadPreferences =
    !!configuration &&
    session?.isLoaded === true &&
    session.isSignedIn === true &&
    !!session.userId &&
    currentUser?.isAuthenticated === true;

  const queryKey = [
    'clerk-notification-preferences',
    configuration?.environment ?? 'unconfigured',
    configuration?.apiBaseUrl ?? 'unconfigured',
    session?.userId ?? 'signed-out',
  ];
  const createApi = () => {
    if (!configuration || !session?.userId || !canLoadPreferences) {
      throw new Error('A complete authenticated Clerk profile and matching Main API configuration are required.');
    }
    const requestedClerkUserId = session.userId;
    return createMainBluebirdApiIntegration({
      configuration,
      tokenProvider: {
        environment: configuration.environment,
        getVerifiedAccessToken: async () => {
          const active = sessionRef.current;
          if (!active?.isLoaded || !active.isSignedIn || active.userId !== requestedClerkUserId) return null;
          const token = await active.getToken();
          const latest = sessionRef.current;
          return latest?.isLoaded && latest.isSignedIn && latest.userId === requestedClerkUserId ? token : null;
        },
      },
    });
  };
  const preferencesQuery = useQuery({
    queryKey,
    enabled: false,
    retry: false,
    staleTime: 0,
    queryFn: async ({ signal }) => {
      if (!configuration || !session?.userId || !canLoadPreferences) {
        throw new Error('A complete authenticated Clerk profile and matching Main API configuration are required.');
      }
      const requestedClerkUserId = session.userId;
      const api = createApi();
      return readClerkNotificationProfile({
        getCurrentSession: () => sessionRef.current,
        requestedClerkUserId,
        readProfile: (requestOptions) => api.authenticated.getProfile(requestOptions),
        signal,
      });
    },
  });

  const profile = canLoadPreferences ? preferencesQuery.data : undefined;
  const prefs = profile?.notificationPrefs;
  const prefRows = prefs ? notificationPreferenceRows(prefs).map(({ key, label, value }) => ({
    label,
    hint: key === 'mode' ? notificationModeLabel(value as ProductionNotificationPrefs['mode']) : notificationChannelLabel(value),
  })) : [];
  const savePreferences = async (preferences: ProductionNotificationPrefs) => {
    if (!session?.userId || saveController.current || preferencesQuery.isFetching) throw new Error('Refresh or save already in progress.');
    setSaving(true);
    const controller = new AbortController();
    saveController.current = controller;
    try {
      const api = createApi();
      const refreshed = await saveClerkNotificationPreferences({
        getCurrentSession: () => sessionRef.current,
        requestedClerkUserId: session.userId,
        readProfile: (options) => api.authenticated.getProfile(options),
        updateProfile: (data, options) => api.authenticated.updateProfile(data, options),
        preferences,
        signal: controller.signal,
      });
      queryClient.setQueryData(queryKey, refreshed);
    } catch (error) {
      throw new Error(notificationReadError(error).replace('load notification preferences', 'verify the preference update'));
    } finally {
      setSaving(false);
      saveController.current = null;
    }
  };

  const topPad = Platform.OS === 'web' ? 60 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]} testID="clerk-notifications">
      <View style={[
        styles.header,
        { paddingTop: topPad + 12, borderBottomColor: colors.separator },
      ]}>
        <TouchableOpacity
          style={[styles.backBtn, { backgroundColor: colors.muted }]}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/profile'))}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Text style={[styles.backChevron, { color: colors.textOnSurface }]}>‹</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.textOnSurface }]}>Notification Settings</Text>
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.clerkScroll, { paddingBottom: botPad + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight }]}>SAVED PREFERENCES</Text>
        {!prefs ? (
          <View style={[styles.preferenceNotice, { backgroundColor: colors.surface }]}>
            <Text style={[styles.noticeBody, { color: colors.textOnSurface }]}>
              Loading saved preferences may also update the phone number on your profile if it has already been verified.
            </Text>
            {preferencesQuery.isError && (
              <Text style={[styles.noticeError, { color: colors.destructive }]} testID="clerk-notification-preferences-error">
                {notificationReadError(preferencesQuery.error)}
              </Text>
            )}
            {canLoadPreferences ? (
              <TouchableOpacity
                style={[styles.loadPreferencesButton, { backgroundColor: colors.primary }]}
                onPress={() => { void preferencesQuery.refetch(); }}
                disabled={preferencesQuery.isFetching}
                activeOpacity={0.8}
                accessibilityRole="button"
                testID="clerk-load-notification-preferences"
              >
                {preferencesQuery.isFetching ? (
                  <ActivityIndicator size="small" color={colors.primaryForeground} />
                ) : (
                  <Text style={[styles.loadPreferencesText, { color: colors.primaryForeground }]}>
                    {preferencesQuery.isError ? 'Try again' : 'Load saved preferences'}
                  </Text>
                )}
              </TouchableOpacity>
            ) : (
              <Text style={[styles.noticeError, { color: colors.mutedForegroundLight }]}>
                Notification preferences are unavailable right now. Please try again later.
              </Text>
            )}
          </View>
        ) : (
          <>
            <Text style={[styles.noticeBody, { color: colors.mutedForegroundLight }]}>
              These are the last loaded account preferences. Email and SMS are delivery channels, not push settings. Refreshing may also synchronize your verified phone number.
            </Text>
            <SettingsGroup title="Flight alerts" rows={prefRows.slice(0, prefs.mode === 'specific' ? 4 : prefs.mode === 'all' ? 2 : 1)} />
            <SettingsGroup title="Updates" rows={prefRows.slice(prefs.mode === 'specific' ? 4 : prefs.mode === 'all' ? 2 : 1)} />
            {profile && <NotificationPreferenceEditor
              key={preferencesQuery.dataUpdatedAt}
              profile={profile}
              disabled={saving || preferencesQuery.isFetching || preferencesQuery.isError}
              onSave={savePreferences}
            />}
            <TouchableOpacity
              style={[styles.refreshPreferencesButton, { borderColor: colors.border }]}
              onPress={() => { void preferencesQuery.refetch(); }}
              disabled={preferencesQuery.isFetching || saving}
              activeOpacity={0.75}
              accessibilityRole="button"
              testID="clerk-refresh-notification-preferences"
            >
              {preferencesQuery.isFetching ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={[styles.refreshPreferencesText, { color: colors.primary }]}>Refresh preferences</Text>
              )}
            </TouchableOpacity>
            {preferencesQuery.isError && (
              <Text style={[styles.noticeError, { color: colors.destructive }]} testID="clerk-notification-preferences-error">
                {notificationReadError(preferencesQuery.error)}
              </Text>
            )}
          </>
        )}

        <View style={styles.unavailableSections}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight }]}>NOTIFICATION HISTORY</Text>
          <SettingsGroup rows={[{
            label: 'Recent notifications',
            hint: 'Unavailable right now',
          }]} />
          <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight }]}>PUSH DELIVERY</Text>
          <SettingsGroup rows={[{
            label: 'Push notification settings',
            hint: 'Unavailable right now',
          }]} />
        </View>
      </ScrollView>
    </View>
  );
}

function LegacyNotificationsScreen() {
  const colors      = useColors();
  const insets      = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { user, updateUser } = useAuth();

  const topPad = Platform.OS === 'web' ? 60 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const preferenceKey = `bluebird.notificationPreferences.${user?.id ?? 'signed-out'}`;
  const [toggles, setToggles, togglesHydrated] = usePersistedState(preferenceKey, TOGGLE_DEFAULTS);
  const flip = (key: keyof typeof TOGGLE_DEFAULTS) =>
    setToggles((prev) => ({ ...prev, [key]: !prev[key] }));

  const [deliveryChannel, setDeliveryChannel] = useState<DeliveryChannel>('app');
  const [deliveryChannelUserId, setDeliveryChannelUserId] = useState<string | null>(null);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);
  const updateUserMutation = useUpdateMe();
  const currentUserIdRef = React.useRef<string | null>(user?.id ?? null);

  useEffect(() => {
    currentUserIdRef.current = user?.id ?? null;
    if (!user) {
      setDeliveryChannel('app');
      setDeliveryChannelUserId(null);
      setDeliveryError(null);
      return;
    }
    setDeliveryChannel(user?.notificationChannel ?? 'app');
    setDeliveryChannelUserId(user.id);
    setDeliveryError(null);
  }, [user?.id, user?.notificationChannel]);

  const changeDeliveryChannel = (next: DeliveryChannel) => {
    if (
      !user
      || deliveryChannelUserId !== user.id
      || next === deliveryChannel
      || updateUserMutation.isPending
    ) return;
    const previous = deliveryChannel;
    const memberId = user.id;
    setDeliveryChannel(next);
    setDeliveryError(null);
    updateUserMutation.mutate(
      { data: { notificationChannel: next } },
      {
        onSuccess: (updated) => {
          if (currentUserIdRef.current !== memberId) return;
          updateUser(updated);
          setDeliveryChannel(updated.notificationChannel ?? 'app');
        },
        onError: (error: any) => {
          if (currentUserIdRef.current !== memberId) return;
          setDeliveryChannel(previous);
          setDeliveryError(error?.error ?? error?.message ?? "Couldn't save your notification preference.");
        },
      },
    );
  };

  const notificationsKey = getListNotificationsQueryKey();
  const { data: notifData, isLoading, isError, refetch } = useListNotifications({
    query: {
      refetchInterval: 15000,
      refetchIntervalInBackground: false,
    },
  });

  // Refetch whenever the screen regains focus
  useFocusEffect(
    React.useCallback(() => {
      refetch();
    }, [refetch]),
  );

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    try { await refetch(); } finally { setRefreshing(false); }
  };

  const readMutation = useMarkNotificationRead({
    mutation: {
      // Optimistically flip the unread dot right away
      onMutate: async ({ id }) => {
        await queryClient.cancelQueries({ queryKey: notificationsKey });
        const previous = queryClient.getQueryData<Notification[]>(notificationsKey);
        queryClient.setQueryData<Notification[]>(notificationsKey, (old) =>
          (old ?? []).map((n) => (n.id === id ? { ...n, read: true } : n)),
        );
        return { previous };
      },
      onError: (_err, _vars, context: any) => {
        if (context?.previous) queryClient.setQueryData(notificationsKey, context.previous);
      },
      onSettled: () => queryClient.invalidateQueries({ queryKey: notificationsKey }),
    },
  });

  const handleNotificationPress = (item: Notification) => {
    if (!item.read) readMutation.mutate({ id: item.id });
    const route = notificationRoute(item) ?? NETWORKING_INBOX_ROUTE;
    router.push(route as any);
  };

  const notifications = ((notifData as Notification[]) ?? []);

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]}>
      {/* Custom header */}
      <View style={[
        styles.header,
        { paddingTop: topPad + 12, borderBottomColor: colors.separator },
      ]}>
        <TouchableOpacity style={[styles.backBtn, { backgroundColor: colors.muted }]} onPress={() => router.back()} activeOpacity={0.7}>
          <Text style={[styles.backChevron, { color: colors.textOnSurface }]}>‹</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.textOnSurface }]}>Notifications</Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { paddingBottom: botPad + 40 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {/* Travel Preferences */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight }]}>TRAVEL PREFERENCES</Text>
        <SettingsGroup
          rows={[
            {
              label: 'Home Airports',
              hint: user?.homeAirports?.length ? user.homeAirports.join(', ') : 'Not set',
              onPress: () => router.push('/airport-picker' as any),
            },
          ]}
        />

        {/* Delivery channel */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight, marginTop: 24 }]}>
          LEGACY ACCOUNT DELIVERY CHANNEL
        </Text>
        <View style={[styles.channelCard, { backgroundColor: colors.surface }]}>
          <Text style={[styles.channelDescription, { color: colors.mutedForegroundLight }]}>
            Saved to the legacy demo account only. This App/Email field is separate from Main API email/SMS notificationPrefs; it does not configure push.
          </Text>
          {user && deliveryChannelUserId === user.id ? (
            <View style={styles.channelOptions}>
              {DELIVERY_CHANNELS.map(({ value, label, hint }) => {
                const selected = deliveryChannel === value;
                return (
                  <TouchableOpacity
                    key={value}
                    style={[
                      styles.channelOption,
                      { borderColor: selected ? colors.primary : colors.separator },
                      selected && { backgroundColor: colors.primary },
                    ]}
                    onPress={() => changeDeliveryChannel(value)}
                    disabled={updateUserMutation.isPending}
                    activeOpacity={0.75}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected, disabled: updateUserMutation.isPending }}
                  >
                    <Text style={[styles.channelLabel, { color: selected ? colors.primaryForeground : colors.textOnSurface }]}>
                      {label}
                    </Text>
                    <Text style={[styles.channelHint, { color: selected ? colors.primaryForeground : colors.mutedForegroundLight }]}>
                      {hint}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <ActivityIndicator size="small" color={colors.primary} />
          )}
          {updateUserMutation.isPending && user && deliveryChannelUserId === user.id ? (
            <View style={styles.channelStatus}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.channelStatusText, { color: colors.mutedForegroundLight }]}>Saving…</Text>
            </View>
          ) : deliveryError ? (
            <Text style={[styles.channelError, { color: colors.destructive }]}>{deliveryError}</Text>
          ) : null}
        </View>

        {/* Flight notification toggles */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight, marginTop: 24 }]}>
          LOCAL DEMO FLIGHT CONTROLS
        </Text>
        <Text style={[styles.noticeBody, { color: colors.mutedForegroundLight, marginBottom: 12 }]}>
          These demo toggles are stored on this device only. They are not saved to your account and do not control notification delivery.
        </Text>
        <View style={[styles.toggleCard, { backgroundColor: colors.surface }]}>
          {([
            ['flightFromHome', 'Flights from Home Airports'],
            ['allFlights',     'All New Flights'],
          ] as const).map(([key, label], i, arr) => (
            <View key={key}>
              <View style={styles.toggleRow}>
                <Text style={[styles.toggleLabel, { color: colors.textOnSurface }]}>{label}</Text>
                 <Toggle disabled={!togglesHydrated} value={toggles[key]} onToggle={() => flip(key)} activeColor={colors.primary} trackOff={colors.muted} knobColor={colors.primaryForeground} />
              </View>
              {i < arr.length - 1 && <View style={[styles.sep, { backgroundColor: colors.separator }]} />}
            </View>
          ))}
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight, marginTop: 24 }]}>LOCAL DEMO UPDATES</Text>
        <View style={[styles.toggleCard, { backgroundColor: colors.surface }]}>
          {([
            ['queueUpdates',  'Queue Position Updates'],
            ['seatConfirmed', 'Seat Confirmed'],
            ['memberUpdates', 'Membership & Offers'],
          ] as const).map(([key, label], i, arr) => (
            <View key={key}>
              <View style={styles.toggleRow}>
                <Text style={[styles.toggleLabel, { color: colors.textOnSurface }]}>{label}</Text>
                 <Toggle disabled={!togglesHydrated} value={toggles[key]} onToggle={() => flip(key)} activeColor={colors.primary} trackOff={colors.muted} knobColor={colors.primaryForeground} />
              </View>
              {i < arr.length - 1 && <View style={[styles.sep, { backgroundColor: colors.separator }]} />}
            </View>
          ))}
        </View>

        {/* Recent Activity */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight, marginTop: 28 }]}>
          LEGACY DEMO RECENT ACTIVITY
        </Text>

        {!togglesHydrated || isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        ) : isError ? (
          <View style={styles.emptyWrap}>
            <Text style={[styles.emptyText, { color: colors.mutedForegroundLight }]}>Could not load notifications</Text>
            <TouchableOpacity style={[styles.retryBtn, { borderColor: colors.border }]} onPress={() => refetch()}>
              <Text style={[styles.retryText, { color: colors.textOnSurface }]}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : notifications.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={[styles.emptyText, { color: colors.mutedForegroundLight }]}>No notifications yet</Text>
          </View>
        ) : (
          <View style={[styles.activityList, { backgroundColor: colors.surface }]}>
            {notifications.map((item, i) => (
              <React.Fragment key={item.id}>
                <TouchableOpacity
                  style={styles.activityRow}
                  onPress={() => handleNotificationPress(item)}
                  activeOpacity={0.7}
                >
                  <View style={[
                    styles.activityDot,
                    { backgroundColor: item.read ? colors.mutedForegroundLight : colors.primary },
                  ]} />
                  <View style={styles.activityContent}>
                    <Text style={[
                      styles.activityTitle,
                      { color: colors.textOnSurface, fontFamily: item.read ? 'Inter_400Regular' : 'Inter_600SemiBold' },
                    ]}>
                      {item.title}
                    </Text>
                    <Text style={[styles.activityBody, { color: colors.mutedForegroundLight }]} numberOfLines={2}>
                      {item.body}
                    </Text>
                  </View>
                  <Text style={[styles.activityTime, { color: colors.mutedForegroundLight }]}>
                    {timeAgo(item.createdAt)}
                  </Text>
                </TouchableOpacity>
                {i < notifications.length - 1 && <View style={[styles.activitySep, { backgroundColor: colors.separator }]} />}
              </React.Fragment>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

export default function NotificationsScreen() {
  const { authMode } = useAuth();
  const session = useClerkAuthSnapshot();
  const configuration = getMainBluebirdApiConfigurationOrNull();
  return authMode === 'clerk'
    ? <ClerkNotificationSettings key={`${session?.userId}:${session?.isSignedIn}:${configuration?.environment}:${configuration?.apiBaseUrl}`} />
    : <LegacyNotificationsScreen />;
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    paddingHorizontal: 16, paddingBottom: 12,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderBottomWidth: 1,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  backChevron:  { fontFamily: 'Inter_500Medium', fontSize: 22, marginTop: -2 },
  headerTitle:  { fontFamily: 'Inter_700Bold', fontSize: 20 },

  clerkScroll: { paddingHorizontal: 16, paddingTop: 20, gap: 10 },
  scroll: { paddingHorizontal: 16, paddingTop: 20 },

  preferenceNotice: { borderRadius: 18, padding: 16, gap: 12 },
  noticeBody: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  noticeError: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
  loadPreferencesButton: {
    minHeight: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 18,
  },
  loadPreferencesText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  refreshPreferencesButton: {
    minHeight: 42, borderRadius: 14, borderWidth: 1, alignItems: 'center',
    justifyContent: 'center', paddingHorizontal: 16,
  },
  refreshPreferencesText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  unavailableSections: { gap: 10, marginTop: 14 },

  sectionLabel: {
    fontFamily: 'Inter_600SemiBold', fontSize: 11,
    letterSpacing: 0.6, marginBottom: 8,
  },

  toggleCard: {
    borderRadius: 18,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2,
  },
  channelCard: {
    borderRadius: 18,
    padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2,
  },
  channelDescription: {
    fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, marginBottom: 12,
  },
  channelOptions: {
    flexDirection: 'row', gap: 8,
  },
  channelOption: {
    flex: 1, minHeight: 58, borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 8, paddingVertical: 9, alignItems: 'center', justifyContent: 'center',
  },
  channelLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  channelHint: { fontFamily: 'Inter_400Regular', fontSize: 10, marginTop: 3, textAlign: 'center' },
  channelStatus: {
    flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 12,
  },
  channelStatusText: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  channelError: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17, marginTop: 12 },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  toggleLabel: { fontFamily: 'Inter_400Regular', fontSize: 15, flex: 1, marginRight: 12 },
  sep: { height: 1, marginHorizontal: 16 },

  toggle: {
    width: 44, height: 26, borderRadius: 13,
    justifyContent: 'center', overflow: 'hidden',
  },
  toggleDisabled: { opacity: 0.55 },
  toggleKnob: {
    width: 22, height: 22, borderRadius: 11,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowRadius: 3, shadowOpacity: 0.15, elevation: 2,
  },

  activityList: {
    borderRadius: 18,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2,
  },
  activityRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  activityDot:     { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  activityContent: { flex: 1, gap: 3 },
  activityTitle:   { fontSize: 14, lineHeight: 20 },
  activityBody:    { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 16 },
  activityTime:    { fontFamily: 'Inter_400Regular', fontSize: 11 },
  activitySep:     { height: 1, marginHorizontal: 16 },

  emptyWrap: { paddingVertical: 32, alignItems: 'center' },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 14 },
  retryBtn: { marginTop: 12, borderWidth: 1, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 9 },
  retryText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
});
