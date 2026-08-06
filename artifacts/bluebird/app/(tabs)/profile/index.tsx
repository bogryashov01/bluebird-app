import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Platform, Alert,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';

type MenuItem = { icon: string; label: string; route?: string; onPress?: () => void; badge?: string | number; danger?: boolean };

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const initials = user?.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) ?? '?';

  const tierColor = { base: '#8896B3', plus: '#1259F2', concierge: '#F59E0B' }[user?.membershipTier ?? 'base'] ?? '#8896B3';
  const tierLabel = (user?.membershipTier ?? 'base').charAt(0).toUpperCase() + (user?.membershipTier ?? 'base').slice(1);

  const MENU_ITEMS: MenuItem[][] = [
    [
      { icon: 'bell', label: 'Notifications', route: '/notifications' },
      { icon: 'users', label: 'Community', route: '/community' },
      { icon: 'gift', label: 'Referral', route: '/referral' },
      { icon: 'cpu', label: 'AI Concierge', route: '/concierge' },
    ],
    [
      { icon: 'star', label: 'Membership', route: '/(tabs)/membership' },
      { icon: 'help-circle', label: 'Help & Support', onPress: () => Alert.alert('Support', 'Email us at support@bluebird.com') },
      {
        icon: 'log-out',
        label: 'Sign out',
        danger: true,
        onPress: () => Alert.alert('Sign out?', 'Are you sure you want to sign out?', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign out', style: 'destructive', onPress: signOut },
        ]),
      },
    ],
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: topPad + 16, paddingBottom: bottomPad + 80 }]} showsVerticalScrollIndicator={false}>
        {/* Profile card */}
        <View style={[styles.profileCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.avatar, { backgroundColor: colors.primary + '30', borderColor: colors.primary + '50' }]}>
            <Text style={[styles.avatarText, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>{initials}</Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={[styles.userName, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>{user?.name ?? 'User'}</Text>
            <Text style={[styles.userEmail, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{user?.email ?? ''}</Text>
          </View>
          <View style={[styles.tierBadge, { backgroundColor: tierColor + '20', borderColor: tierColor + '40' }]}>
            <Feather name="star" size={12} color={tierColor} />
            <Text style={[styles.tierText, { color: tierColor, fontFamily: 'Inter_500Medium' }]}>{tierLabel}</Text>
          </View>
        </View>

        {/* Stats row */}
        <View style={[styles.statsRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>{user?.linePassCount ?? 0}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>Line Passes</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>{tierLabel}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>Membership</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <View style={styles.statItem}>
            <View style={[styles.verifiedDot, { backgroundColor: user?.emailVerified ? colors.success : colors.mutedForeground }]} />
            <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              {user?.emailVerified ? 'Verified' : 'Unverified'}
            </Text>
          </View>
        </View>

        {/* Menu groups */}
        {MENU_ITEMS.map((group, gi) => (
          <View key={gi} style={[styles.menuGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {group.map((item, ii) => (
              <React.Fragment key={item.label}>
                {ii > 0 && <View style={[styles.menuSep, { backgroundColor: colors.border }]} />}
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={item.onPress ?? (() => item.route && router.push(item.route as any))}
                  activeOpacity={0.7}
                >
                  <View style={[styles.menuIconWrap, { backgroundColor: item.danger ? '#EF444420' : colors.secondary }]}>
                    <Feather name={item.icon as any} size={16} color={item.danger ? '#EF4444' : colors.foreground} />
                  </View>
                  <Text style={[styles.menuLabel, { color: item.danger ? '#EF4444' : colors.foreground, fontFamily: 'Inter_400Regular' }]}>
                    {item.label}
                  </Text>
                  {!item.danger && <Feather name="chevron-right" size={16} color={colors.mutedForeground} style={styles.menuChevron} />}
                </TouchableOpacity>
              </React.Fragment>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, gap: 16 },
  profileCard: {
    borderRadius: 16, borderWidth: 1, padding: 20,
    flexDirection: 'row', alignItems: 'center', gap: 14,
  },
  avatar: {
    width: 60, height: 60, borderRadius: 30,
    borderWidth: 2, justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { fontSize: 22 },
  profileInfo: { flex: 1 },
  userName: { fontSize: 18 },
  userEmail: { fontSize: 13, marginTop: 2 },
  tierBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1,
  },
  tierText: { fontSize: 12 },
  statsRow: {
    borderRadius: 14, borderWidth: 1, flexDirection: 'row',
    paddingVertical: 16,
  },
  statItem: { flex: 1, alignItems: 'center', gap: 4 },
  statValue: { fontSize: 16 },
  statLabel: { fontSize: 11 },
  statDivider: { width: 1 },
  verifiedDot: { width: 10, height: 10, borderRadius: 5 },
  menuGroup: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  menuSep: { height: 1 },
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, gap: 14 },
  menuIconWrap: { width: 34, height: 34, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  menuLabel: { flex: 1, fontSize: 15 },
  menuChevron: { marginLeft: 'auto' as any },
});
