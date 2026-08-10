import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

interface MockContact {
  id: string;
  name: string;
  detail: string;
  status: 'member' | 'invitable' | 'invited';
}

const INITIAL_CONTACTS: MockContact[] = [
  { id: '1', name: 'Ava Thompson',    detail: 'ava.t@example.com',      status: 'member' },
  { id: '2', name: 'Marcus Lee',      detail: '+1 (415) 555-0182',      status: 'member' },
  { id: '3', name: 'Sofia Ramirez',   detail: 'sofia.r@example.com',    status: 'invitable' },
  { id: '4', name: 'James Okafor',    detail: '+1 (212) 555-0147',      status: 'invitable' },
  { id: '5', name: 'Emily Chen',      detail: 'emily.chen@example.com', status: 'invitable' },
  { id: '6', name: 'Noah Patel',      detail: '+1 (310) 555-0126',      status: 'invitable' },
  { id: '7', name: 'Isabella Rossi',  detail: 'bella.r@example.com',    status: 'invitable' },
];

export default function ConnectContactsScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const [contacts, setContacts] = React.useState<MockContact[]>(INITIAL_CONTACTS);

  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const invite = (id: string) =>
    setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, status: 'invited' } : c)));

  const members = contacts.filter((c) => c.status === 'member');
  const others  = contacts.filter((c) => c.status !== 'member');

  const renderRow = (c: MockContact, i: number, list: MockContact[]) => {
    const initials = c.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
    return (
      <View
        key={c.id}
        style={[styles.row, i < list.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.separator }]}
      >
        <View style={[styles.avatar, { backgroundColor: colors.backgroundMid }]}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.name, { color: colors.textOnSurface }]} numberOfLines={1}>{c.name}</Text>
          <Text style={[styles.detail, { color: colors.mutedForegroundLight }]} numberOfLines={1}>{c.detail}</Text>
        </View>
        {c.status === 'member' && (
          <View style={[styles.memberBadge, { backgroundColor: colors.primary + '18' }]}>
            <Text style={[styles.memberBadgeText, { color: colors.primary }]}>Member</Text>
          </View>
        )}
        {c.status === 'invitable' && (
          <TouchableOpacity
            style={[styles.inviteBtn, { backgroundColor: colors.primary }]}
            onPress={() => invite(c.id)}
            activeOpacity={0.8}
          >
            <Text style={styles.inviteBtnText}>Invite</Text>
          </TouchableOpacity>
        )}
        {c.status === 'invited' && (
          <Text style={[styles.invitedText, { color: colors.mutedForegroundLight }]}>✓ Invited</Text>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: botPad + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.intro, { color: colors.mutedForegroundLight }]}>
          Friends already on Bluebird and contacts you can invite. Invited friends earn you referral rewards.
        </Text>

        {members.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight }]}>Already members</Text>
            <View style={[styles.card, { backgroundColor: colors.surface }]}>
              {members.map((c, i) => renderRow(c, i, members))}
            </View>
          </>
        )}

        <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight }]}>Invite to Bluebird</Text>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          {others.map((c, i) => renderRow(c, i, others))}
        </View>

        <Text style={[styles.demoNote, { color: colors.mutedForegroundLight }]}>
          Demo contacts — your real address book is never accessed.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 20 },
  intro: { fontFamily: 'Inter_400Regular', fontSize: 13.5, lineHeight: 19, marginBottom: 20 },
  sectionLabel: {
    fontFamily: 'Inter_600SemiBold', fontSize: 12,
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10,
  },
  card: {
    borderRadius: 18, overflow: 'hidden', marginBottom: 22,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  avatarText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: '#fff' },
  name: { fontFamily: 'Inter_600SemiBold', fontSize: 14.5 },
  detail: { fontFamily: 'Inter_400Regular', fontSize: 12.5, marginTop: 1 },
  memberBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  memberBadgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 11.5 },
  inviteBtn: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  inviteBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 12.5, color: '#fff' },
  invitedText: { fontFamily: 'Inter_500Medium', fontSize: 12.5 },
  demoNote: { fontFamily: 'Inter_400Regular', fontSize: 12, textAlign: 'center' },
});
