import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, Share, Platform, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useGetReferral } from '@workspace/api-client-react';

const BG = '#FAFAF8';
const NAVY = '#0A1128';
const BLUE = '#1259F2';

// Deterministic 6x6 pattern derived from the referral link so the
// QR-style graphic "encodes" the user's link.
function qrCells(seed: string): boolean[] {
  let h = 2166136261;
  const cells: boolean[] = [];
  for (let i = 0; i < 36; i++) {
    h ^= seed.charCodeAt(i % Math.max(seed.length, 1)) + i;
    h = Math.imul(h, 16777619) >>> 0;
    cells.push((h & 3) < 2);
  }
  return cells;
}

function shortName(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return full;
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

export default function ReferralScreen() {
  const insets = useSafeAreaInsets();
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const { data: referral, isLoading } = useGetReferral({});
  const ref = referral as any;
  const [copied, setCopied] = useState(false);

  const link = ref?.code ? `https://bluebird.com/join?ref=${ref.code}` : '';
  const shareMessage = `Join Bluebird — private aviation for everyone. Use my referral code ${ref?.code} to get started. ${link}`;

  const handleCopy = async () => {
    if (!ref?.code) return;
    await Clipboard.setStringAsync(ref.code);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleMessage = () => {
    if (!link) return;
    const sep = Platform.OS === 'ios' ? '&' : '?';
    Linking.openURL(`sms:${sep}body=${encodeURIComponent(shareMessage)}`).catch(() => {});
  };

  const handleMail = () => {
    if (!link) return;
    Linking.openURL(
      `mailto:?subject=${encodeURIComponent('Join me on Bluebird')}&body=${encodeURIComponent(shareMessage)}`
    ).catch(() => {});
  };

  const handleMore = () => {
    if (!link) return;
    Share.share({ message: shareMessage, title: 'Join Bluebird' });
  };

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: BG }]}>
        <ActivityIndicator color={BLUE} size="large" />
      </View>
    );
  }

  const invited: { name: string; status: string }[] = ref?.invited ?? [];
  const cells = qrCells(link || 'bluebird');

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: BG }}
      contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 24 }]}
    >
      <Text style={styles.headline}>Invite your friends.{'\n'}Help them save.</Text>
      <Text style={styles.subcopy}>
        Share your code and help friends save on private aviation. Earn rewards together when they become members.
      </Text>

      {/* QR-style graphic */}
      <View style={styles.qr}>
        {cells.map((on, i) => (
          <View key={i} style={[styles.qrCell, on && { backgroundColor: '#fff' }]} />
        ))}
      </View>

      {/* Code card */}
      <View style={styles.codeCard}>
        <Text style={styles.code} numberOfLines={1}>{ref?.code ?? '—'}</Text>
        <TouchableOpacity style={styles.copyPill} onPress={handleCopy} activeOpacity={0.7}>
          <Text style={styles.copyText}>{copied ? 'Copied' : 'Copy'}</Text>
        </TouchableOpacity>
      </View>

      {/* Share actions */}
      <View style={styles.actionsRow}>
        {[
          { label: 'Message', onPress: handleMessage },
          { label: 'Mail', onPress: handleMail },
          { label: 'More', onPress: handleMore },
        ].map((a) => (
          <TouchableOpacity key={a.label} style={styles.actionBtn} onPress={a.onPress} activeOpacity={0.7}>
            <Text style={styles.actionText}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Invited list */}
      <View style={styles.invitedSection}>
        <Text style={styles.invitedTitle}>Invited ({invited.length})</Text>
        {invited.length === 0 ? (
          <Text style={styles.emptyText}>
            No one has used your code yet. Share it to start earning rewards.
          </Text>
        ) : (
          invited.map((friend, i) => (
            <View
              key={`${friend.name}-${i}`}
              style={[styles.invitedRow, i < invited.length - 1 && styles.invitedRowBorder]}
            >
              <Text style={styles.invitedName}>{shortName(friend.name)}</Text>
              <Text style={friend.status === 'joined' ? styles.statusJoined : styles.statusPending}>
                {friend.status === 'joined' ? 'Joined' : 'Pending'}
              </Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { paddingTop: 40, paddingHorizontal: 22, alignItems: 'center', gap: 16 },
  headline: {
    fontFamily: 'Inter_700Bold', fontSize: 25, lineHeight: 31,
    color: NAVY, textAlign: 'center', letterSpacing: -0.5,
  },
  subcopy: {
    fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21,
    color: 'rgba(10,17,40,0.55)', textAlign: 'center',
  },
  qr: {
    width: 150, height: 150, backgroundColor: NAVY, borderRadius: 20,
    padding: 16, flexDirection: 'row', flexWrap: 'wrap',
  },
  qrCell: {
    width: (150 - 32 - 5 * 4) / 6, height: (150 - 32 - 5 * 4) / 6,
    marginRight: 4, marginBottom: 4,
  },
  codeCard: {
    width: '100%', backgroundColor: '#fff', borderRadius: 16, padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    shadowColor: NAVY, shadowOpacity: 0.06, shadowRadius: 20, shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  code: {
    flex: 1, fontFamily: 'Inter_700Bold', fontSize: 17,
    color: NAVY, letterSpacing: 0.5,
  },
  copyPill: {
    backgroundColor: 'rgba(18,89,242,0.08)', paddingVertical: 8,
    paddingHorizontal: 12, borderRadius: 999,
  },
  copyText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: BLUE },
  actionsRow: { flexDirection: 'row', gap: 10, width: '100%' },
  actionBtn: {
    flex: 1, backgroundColor: 'rgba(10,17,40,0.06)', borderRadius: 14,
    paddingVertical: 13, alignItems: 'center',
  },
  actionText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: NAVY },
  invitedSection: { width: '100%', marginTop: 6 },
  invitedTitle: {
    fontFamily: 'Inter_700Bold', fontSize: 13, color: NAVY, marginBottom: 10,
  },
  emptyText: {
    fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21,
    color: 'rgba(10,17,40,0.45)',
  },
  invitedRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: 10,
  },
  invitedRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(10,17,40,0.08)',
  },
  invitedName: { fontFamily: 'Inter_400Regular', fontSize: 14, color: 'rgba(10,17,40,0.6)' },
  statusJoined: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: BLUE },
  statusPending: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: 'rgba(10,17,40,0.4)' },
});
