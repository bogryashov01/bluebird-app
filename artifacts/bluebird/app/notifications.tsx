import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useListNotifications, useMarkNotificationRead } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { SettingsGroup } from '@/components/SettingsGroup';

// ── Custom toggle (matches prototype pill style) ──────────────────────────────
function Toggle({ value, onToggle }: { value: boolean; onToggle: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.toggle, { backgroundColor: value ? BLUE : 'rgba(10,17,40,0.12)' }]}
      onPress={onToggle}
      activeOpacity={0.8}
    >
      <View style={[styles.toggleKnob, { transform: [{ translateX: value ? 18 : 2 }] }]} />
    </TouchableOpacity>
  );
}

// ── Notification row (activity feed) ─────────────────────────────────────────
function timeAgo(d: string) {
  const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── Screen ────────────────────────────────────────────────────────────────────
const TOGGLE_DEFAULTS = {
  flightFromHome:   true,
  allFlights:       false,
  queueUpdates:     true,
  seatConfirmed:    true,
  memberUpdates:    false,
};

export default function NotificationsScreen() {
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
    <View style={styles.root}>
      {/* Custom header (native header is hidden in _layout) */}
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Text style={styles.backChevron}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { paddingBottom: botPad + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Travel Preferences ── */}
        <Text style={styles.sectionLabel}>TRAVEL PREFERENCES</Text>
        <SettingsGroup
          rows={[
            {
              label: 'Home Airport',
              hint: 'TEB',
              onPress: () => {},
            },
            {
              label: 'Preferred Aircraft',
              hint: 'All types',
              onPress: () => {},
            },
          ]}
        />

        {/* ── Notification toggles ── */}
        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>FLIGHT NOTIFICATIONS</Text>
        <View style={styles.toggleCard}>
          {(
            [
              ['flightFromHome', 'Flights from Home Airport'],
              ['allFlights',     'All New Flights'],
            ] as const
          ).map(([key, label], i, arr) => (
            <View key={key}>
              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>{label}</Text>
                <Toggle value={toggles[key]} onToggle={() => flip(key)} />
              </View>
              {i < arr.length - 1 && <View style={styles.sep} />}
            </View>
          ))}
        </View>

        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>UPDATES</Text>
        <View style={styles.toggleCard}>
          {(
            [
              ['queueUpdates',  'Queue Position Updates'],
              ['seatConfirmed', 'Seat Confirmed'],
              ['memberUpdates', 'Membership & Offers'],
            ] as const
          ).map(([key, label], i, arr) => (
            <View key={key}>
              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>{label}</Text>
                <Toggle value={toggles[key]} onToggle={() => flip(key)} />
              </View>
              {i < arr.length - 1 && <View style={styles.sep} />}
            </View>
          ))}
        </View>

        {/* ── Recent Activity ── */}
        <Text style={[styles.sectionLabel, { marginTop: 28 }]}>RECENT ACTIVITY</Text>

        {isLoading ? (
          <ActivityIndicator color={BLUE} style={{ marginTop: 24 }} />
        ) : notifications.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>No notifications yet</Text>
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
                  <View style={[styles.activityDot, { backgroundColor: item.read ? MUTED : BLUE }]} />
                  <View style={styles.activityContent}>
                    <Text
                      style={[
                        styles.activityTitle,
                        { fontFamily: item.read ? 'Inter_400Regular' : 'Inter_600SemiBold' },
                      ]}
                    >
                      {item.title}
                    </Text>
                    <Text style={styles.activityBody} numberOfLines={2}>{item.body}</Text>
                  </View>
                  <Text style={styles.activityTime}>{timeAgo(item.createdAt)}</Text>
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

// ── Palette ───────────────────────────────────────────────────────────────────
const BG   = '#FAFAF8';
const DARK  = '#0A1128';
const MUTED = 'rgba(10,17,40,0.45)';
const BLUE  = '#1259F2';
const CARD  = '#fff';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  // Header
  header: {
    paddingHorizontal: 16, paddingBottom: 12,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderBottomWidth: 1, borderBottomColor: 'rgba(10,17,40,0.06)',
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(10,17,40,0.05)',
    alignItems: 'center', justifyContent: 'center',
  },
  backChevron:  { fontFamily: 'Inter_500Medium', fontSize: 22, color: DARK, marginTop: -2 },
  headerTitle:  { fontFamily: 'Inter_700Bold', fontSize: 20, color: DARK },

  scroll: { paddingHorizontal: 16, paddingTop: 20 },

  // Section label
  sectionLabel: {
    fontFamily: 'Inter_600SemiBold', fontSize: 11, color: MUTED,
    letterSpacing: 0.6, marginBottom: 8,
  },

  // Toggle card
  toggleCard: {
    backgroundColor: CARD, borderRadius: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2,
  },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  toggleLabel: { fontFamily: 'Inter_400Regular', fontSize: 15, color: DARK, flex: 1, marginRight: 12 },
  sep: { height: 1, backgroundColor: 'rgba(10,17,40,0.06)', marginHorizontal: 16 },

  // Toggle pill
  toggle: {
    width: 44, height: 26, borderRadius: 13,
    justifyContent: 'center', overflow: 'hidden',
  },
  toggleKnob: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#fff',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowRadius: 3, shadowOpacity: 0.15, elevation: 2,
  },

  // Activity feed
  activityList: {
    backgroundColor: CARD, borderRadius: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2,
  },
  activityRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  activityDot:     { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  activityContent: { flex: 1, gap: 3 },
  activityTitle:   { fontSize: 14, color: DARK, lineHeight: 20 },
  activityBody:    { fontFamily: 'Inter_400Regular', fontSize: 12, color: MUTED, lineHeight: 16 },
  activityTime:    { fontFamily: 'Inter_400Regular', fontSize: 11, color: MUTED },
  activitySep:     { height: 1, backgroundColor: 'rgba(10,17,40,0.06)', marginHorizontal: 16 },

  emptyWrap: { paddingVertical: 32, alignItems: 'center' },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: MUTED },
});
