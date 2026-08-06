import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Platform, Alert,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { useListNotifications } from '@workspace/api-client-react';
import type { Notification } from '@workspace/api-client-react';
import { SettingsGroup } from '@/components/SettingsGroup';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const { data: notifications } = useListNotifications({});
  const recentActivity = ((notifications as Notification[]) ?? []).slice(0, 5);

  const initials = user?.name?.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2) ?? '?';
  const tierLabel = {
    base: 'Base Member',
    plus: 'Plus Member',
    concierge: 'Concierge Member',
  }[user?.membershipTier ?? 'base'] ?? 'Base Member';
  const memberSince = user?.createdAt
    ? new Date(user.createdAt).getFullYear()
    : new Date().getFullYear();

  return (
    <View style={[styles.container]}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: topPad + 16, paddingBottom: bottomPad + 100 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Avatar + name ───────────────────────────────────── */}
        <View style={styles.avatarRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View>
            <Text style={styles.name}>{user?.name ?? 'Member'}</Text>
            <Text style={styles.memberSince}>{tierLabel} since {memberSince}</Text>
          </View>
        </View>

        {/* ── Account ─────────────────────────────────────────── */}
        <SettingsGroup
          title="Account"
          rows={[
            {
              label: 'Personal Information',
              onPress: () => Alert.alert('Personal Information', 'Edit your profile details.'),
            },
            {
              label: 'Connect Contacts',
              hint: 'find & invite members',
              onPress: () => Alert.alert('Connect Contacts', 'Find friends who are members.'),
            },
            {
              label: 'Payment Methods',
              onPress: () => Alert.alert('Payment Methods', 'Manage your saved payment methods.'),
            },
          ]}
        />

        {/* ── Preferences ─────────────────────────────────────── */}
        <SettingsGroup
          title="Preferences"
          rows={[
            {
              label: 'Notification Settings',
              hint: 'incl. travel preferences',
              onPress: () => router.push('/notifications'),
            },
            {
              label: 'Community',
              onPress: () => router.push('/community'),
            },
          ]}
        />

        {/* ── Support ─────────────────────────────────────────── */}
        <SettingsGroup
          title="Support"
          rows={[
            {
              label: 'AI Concierge',
              onPress: () => router.push('/concierge'),
            },
            {
              label: 'Help Center',
              onPress: () => Alert.alert('Help Center', 'Email us at support@bluebird.com'),
            },
            {
              label: 'Referral',
              onPress: () => router.push('/referral'),
            },
            {
              label: 'Legal',
              onPress: () => Alert.alert('Legal', 'Terms of service and privacy policy.'),
            },
          ]}
        />

        {/* ── Sign out ─────────────────────────────────────────── */}
        <SettingsGroup
          rows={[
            {
              label: 'Sign Out',
              onPress: () =>
                Alert.alert('Sign out?', 'Are you sure you want to sign out?', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Sign out', style: 'destructive', onPress: signOut },
                ]),
              right: <Text style={styles.signOutChevron}>›</Text>,
            },
          ]}
        />

        {/* ── Recent Activity ──────────────────────────────────── */}
        {recentActivity.length > 0 && (
          <View style={styles.activitySection}>
            <Text style={styles.activityTitle}>Recent Activity</Text>
            <View style={styles.activityList}>
              {recentActivity.map((item, i) => (
                <View
                  key={item.id}
                  style={[
                    styles.activityRow,
                    i < recentActivity.length - 1 && styles.activityRowBorder,
                  ]}
                >
                  <View style={[styles.activityDot, !item.read && styles.activityDotBlue]} />
                  <View style={styles.activityContent}>
                    <Text style={styles.activityLabel}>{item.title}</Text>
                    <Text style={styles.activityDate}>{fmtDate(item.createdAt)}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAF8' },
  scroll: { paddingHorizontal: 20, gap: 18 },

  // ── Avatar row
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingBottom: 4,
  },
  avatar: {
    width: 58, height: 58, borderRadius: 29,
    backgroundColor: '#0A1128',
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
    color: '#fff',
  },
  name: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
    color: '#0A1128',
    letterSpacing: -0.4,
  },
  memberSince: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: 'rgba(10,17,40,0.5)',
    marginTop: 2,
  },

  // ── Sign-out danger style
  signOutChevron: {
    fontSize: 20,
    color: 'rgba(10,17,40,0.3)',
    lineHeight: 22,
  },

  // ── Activity log
  activitySection: { gap: 10 },
  activityTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    color: 'rgba(10,17,40,0.4)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 4,
  },
  activityList: {
    backgroundColor: '#fff',
    borderRadius: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 20,
    shadowOpacity: 0.05,
    elevation: 3,
    overflow: 'hidden',
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 13,
  },
  activityRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(10,17,40,0.06)',
  },
  activityDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: 'rgba(10,17,40,0.25)',
    flexShrink: 0,
  },
  activityDotBlue: { backgroundColor: '#1259F2' },
  activityContent: { flex: 1 },
  activityLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    color: '#0A1128',
  },
  activityDate: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: 'rgba(10,17,40,0.45)',
    marginTop: 1,
  },
});
