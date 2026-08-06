import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useListNotifications, useMarkNotificationRead } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { SettingsGroup } from '@/components/SettingsGroup';

// ── Toggle pill ───────────────────────────────────────────────────────────────
function Toggle({ value, onToggle, activeColor }: { value: boolean; onToggle: () => void; activeColor: string }) {
  return (
    <TouchableOpacity
      style={[styles.toggle, { backgroundColor: value ? activeColor : 'rgba(10,17,40,0.12)' }]}
      onPress={onToggle}
      activeOpacity={0.8}
    >
      <View style={[styles.toggleKnob, { transform: [{ translateX: value ? 18 : 2 }] }]} />
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

  const { data: notifData, isLoading } = useListNotifications({});
  const readMutation = useMarkNotificationRead({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['listNotifications'] }),
    },
  });

  const notifications = (notifData as any[]) ?? [];

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]}>
      {/* Custom header */}
      <View style={[
        styles.header,
        { paddingTop: topPad + 12, borderBottomColor: 'rgba(10,17,40,0.06)' },
      ]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Text style={[styles.backChevron, { color: colors.backgroundMid }]}>‹</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.backgroundMid }]}>Notifications</Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { paddingBottom: botPad + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Travel Preferences */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight }]}>TRAVEL PREFERENCES</Text>
        <SettingsGroup
          rows={[
            { label: 'Home Airport',       hint: 'TEB',       onPress: () => {} },
            { label: 'Preferred Aircraft', hint: 'All types', onPress: () => {} },
          ]}
        />

        {/* Flight notification toggles */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight, marginTop: 24 }]}>
          FLIGHT NOTIFICATIONS
        </Text>
        <View style={styles.toggleCard}>
          {([
            ['flightFromHome', 'Flights from Home Airport'],
            ['allFlights',     'All New Flights'],
          ] as const).map(([key, label], i, arr) => (
            <View key={key}>
              <View style={styles.toggleRow}>
                <Text style={[styles.toggleLabel, { color: colors.backgroundMid }]}>{label}</Text>
                <Toggle value={toggles[key]} onToggle={() => flip(key)} activeColor={colors.primary} />
              </View>
              {i < arr.length - 1 && <View style={styles.sep} />}
            </View>
          ))}
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight, marginTop: 24 }]}>UPDATES</Text>
        <View style={styles.toggleCard}>
          {([
            ['queueUpdates',  'Queue Position Updates'],
            ['seatConfirmed', 'Seat Confirmed'],
            ['memberUpdates', 'Membership & Offers'],
          ] as const).map(([key, label], i, arr) => (
            <View key={key}>
              <View style={styles.toggleRow}>
                <Text style={[styles.toggleLabel, { color: colors.backgroundMid }]}>{label}</Text>
                <Toggle value={toggles[key]} onToggle={() => flip(key)} activeColor={colors.primary} />
              </View>
              {i < arr.length - 1 && <View style={styles.sep} />}
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
          <View style={styles.activityList}>
            {notifications.map((item: any, i: number) => (
              <React.Fragment key={item.id}>
                <TouchableOpacity
                  style={styles.activityRow}
                  onPress={() => { if (!item.read) readMutation.mutate({ id: item.id }); }}
                  activeOpacity={0.7}
                >
                  <View style={[
                    styles.activityDot,
                    { backgroundColor: item.read ? colors.mutedForegroundLight : colors.primary },
                  ]} />
                  <View style={styles.activityContent}>
                    <Text style={[
                      styles.activityTitle,
                      { color: colors.backgroundMid, fontFamily: item.read ? 'Inter_400Regular' : 'Inter_600SemiBold' },
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
                {i < notifications.length - 1 && <View style={styles.activitySep} />}
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
    backgroundColor: 'rgba(10,17,40,0.05)',
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
    backgroundColor: '#fff', borderRadius: 18,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2,
  },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  toggleLabel: { fontFamily: 'Inter_400Regular', fontSize: 15, flex: 1, marginRight: 12 },
  sep: { height: 1, backgroundColor: 'rgba(10,17,40,0.06)', marginHorizontal: 16 },

  toggle: {
    width: 44, height: 26, borderRadius: 13,
    justifyContent: 'center', overflow: 'hidden',
  },
  toggleKnob: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#fff',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowRadius: 3, shadowOpacity: 0.15, elevation: 2,
  },

  activityList: {
    backgroundColor: '#fff', borderRadius: 18,
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
  activitySep:     { height: 1, backgroundColor: 'rgba(10,17,40,0.06)', marginHorizontal: 16 },

  emptyWrap: { paddingVertical: 32, alignItems: 'center' },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 14 },
});
