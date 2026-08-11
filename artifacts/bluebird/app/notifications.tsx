import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import {
  useListNotifications, useMarkNotificationRead, getListNotificationsQueryKey,
} from '@workspace/api-client-react';
import type { Notification } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { SettingsGroup } from '@/components/SettingsGroup';
import { notificationRoute } from '@/lib/notificationRoute';

// ── Toggle pill ───────────────────────────────────────────────────────────────
function Toggle({ value, onToggle, activeColor, trackOff, knobColor }: { value: boolean; onToggle: () => void; activeColor: string; trackOff: string; knobColor: string }) {
  return (
    <TouchableOpacity
      style={[styles.toggle, { backgroundColor: value ? activeColor : trackOff }]}
      onPress={onToggle}
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

export default function NotificationsScreen() {
  const colors      = useColors();
  const insets      = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const topPad = Platform.OS === 'web' ? 60 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const [toggles, setToggles] = useState(TOGGLE_DEFAULTS);
  const flip = (key: keyof typeof TOGGLE_DEFAULTS) =>
    setToggles((prev) => ({ ...prev, [key]: !prev[key] }));

  const notificationsKey = getListNotificationsQueryKey();
  const { data: notifData, isLoading, refetch } = useListNotifications({
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
    const route = notificationRoute(item);
    if (route) router.push(route as any);
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
            { label: 'Home Airport', hint: 'TEB', onPress: () => {} },
          ]}
        />

        {/* Flight notification toggles */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight, marginTop: 24 }]}>
          FLIGHT NOTIFICATIONS
        </Text>
        <View style={[styles.toggleCard, { backgroundColor: colors.surface }]}>
          {([
            ['flightFromHome', 'Flights from Home Airport'],
            ['allFlights',     'All New Flights'],
          ] as const).map(([key, label], i, arr) => (
            <View key={key}>
              <View style={styles.toggleRow}>
                <Text style={[styles.toggleLabel, { color: colors.textOnSurface }]}>{label}</Text>
                <Toggle value={toggles[key]} onToggle={() => flip(key)} activeColor={colors.primary} trackOff={colors.muted} knobColor={colors.primaryForeground} />
              </View>
              {i < arr.length - 1 && <View style={[styles.sep, { backgroundColor: colors.separator }]} />}
            </View>
          ))}
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight, marginTop: 24 }]}>UPDATES</Text>
        <View style={[styles.toggleCard, { backgroundColor: colors.surface }]}>
          {([
            ['queueUpdates',  'Queue Position Updates'],
            ['seatConfirmed', 'Seat Confirmed'],
            ['memberUpdates', 'Membership & Offers'],
          ] as const).map(([key, label], i, arr) => (
            <View key={key}>
              <View style={styles.toggleRow}>
                <Text style={[styles.toggleLabel, { color: colors.textOnSurface }]}>{label}</Text>
                <Toggle value={toggles[key]} onToggle={() => flip(key)} activeColor={colors.primary} trackOff={colors.muted} knobColor={colors.primaryForeground} />
              </View>
              {i < arr.length - 1 && <View style={[styles.sep, { backgroundColor: colors.separator }]} />}
            </View>
          ))}
        </View>

        {/* Recent Activity */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight, marginTop: 28 }]}>
          RECENT ACTIVITY
        </Text>

        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
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

  scroll: { paddingHorizontal: 16, paddingTop: 20 },

  sectionLabel: {
    fontFamily: 'Inter_600SemiBold', fontSize: 11,
    letterSpacing: 0.6, marginBottom: 8,
  },

  toggleCard: {
    borderRadius: 18,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2,
  },
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
});
