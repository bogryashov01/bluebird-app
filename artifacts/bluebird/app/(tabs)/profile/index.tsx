import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Platform, Modal, Pressable,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { useListNotifications } from '@workspace/api-client-react';
import type { Notification } from '@workspace/api-client-react';
import { notificationRoute } from '@/lib/notificationRoute';
import { SettingsGroup } from '@/components/SettingsGroup';
import { confirmDialog } from '@/lib/confirmDialog';
import { useTheme, type ThemePreference } from '@/context/ThemeContext';

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
        <Pressable style={[styles.sheet, { backgroundColor: colors.surface }]} onPress={() => {}}>
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

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { user, signOut } = useAuth();
  const { preference } = useTheme();
  const [appearanceOpen, setAppearanceOpen] = React.useState(false);

  const topPad    = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const { data: notifications } = useListNotifications({
    query: {
      refetchInterval: 15000,
      refetchIntervalInBackground: false,
    },
  });
  const notifList = (notifications as Notification[]) ?? [];
  const recentActivity = notifList.slice(0, 5);
  const unreadCount = notifList.filter((n) => !n.read).length;

  const initials    = user?.name?.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2) ?? '?';
  const tierLabel   = {
    base:      'Base Member',
    plus:      'Plus Member',
    concierge: 'Concierge Member',
  }[user?.membershipTier ?? 'base'] ?? 'Base Member';
  const memberSince = user?.createdAt
    ? new Date(user.createdAt).getFullYear()
    : new Date().getFullYear();

  return (
    <View style={[styles.container, { backgroundColor: colors.offWhite }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: topPad + 16, paddingBottom: bottomPad + 100 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Avatar + name ── */}
        <View style={styles.avatarRow}>
          <View style={[styles.avatar, { backgroundColor: colors.backgroundMid }]}>
            <Text style={[styles.avatarText, { color: colors.textOnBrand }]}>{initials}</Text>
          </View>
          <View>
            <Text style={[styles.name, { color: colors.textOnSurface }]}>{user?.name ?? 'Member'}</Text>
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
              onPress: () => router.push('/account/personal-info' as any),
            },
            {
              label: 'Connect Contacts',
              hint: 'find & invite members',
              onPress: () => router.push('/account/contacts' as any),
            },
            {
              label: 'Payment Methods',
              onPress: () => router.push('/account/payment-methods' as any),
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
              hint: 'incl. travel preferences',
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
              onPress: () => router.push('/community'),
            },
          ]}
        />

        {/* ── Support ── */}
        <SettingsGroup
          title="Support"
          rows={[
            { label: 'AI Concierge', onPress: () => router.push('/concierge') },
            { label: 'Help Center',  onPress: () => router.push('/support/help-center' as any) },
            { label: 'Referral',     onPress: () => router.push('/referral') },
            { label: 'Legal',        onPress: () => router.push('/support/legal' as any) },
          ]}
        />

        {/* ── Sign out ── */}
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
});
