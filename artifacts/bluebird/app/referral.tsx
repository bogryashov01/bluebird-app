import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, Share, Platform, Linking, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useGetReferral } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

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

function showFeedback(title: string, message: string) {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

export default function ReferralScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const { data: referral, isLoading } = useGetReferral({});
  const ref = referral as any;
  const [copied, setCopied] = useState(false);

  const referralCode = typeof ref?.code === 'string' ? ref.code.trim() : '';
  const link = referralCode
    ? `https://bluebird.com/join?ref=${encodeURIComponent(referralCode)}`
    : '';
  const shareMessage = link
    ? `Join Bluebird — private aviation for everyone. Use my referral link to get started: ${link}`
    : '';

  const requireLink = () => {
    if (link) return true;
    showFeedback(
      'Referral link unavailable',
      'We could not load your personal referral link. Please try again in a moment.',
    );
    return false;
  };

  const handleCopy = async () => {
    if (!requireLink()) return;
    try {
      await Clipboard.setStringAsync(link);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      showFeedback(
        'Could not copy link',
        'Your referral link could not be copied. Please try again.',
      );
    }
  };

  const openReferralUrl = async (
    url: string,
    flowName: string,
    fallbackMessage: string,
  ) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) throw new Error(`${flowName} is not supported`);
      await Linking.openURL(url);
    } catch {
      showFeedback(`Could not open ${flowName}`, fallbackMessage);
    }
  };

  const handleSms = async () => {
    if (!requireLink()) return;
    const separator = Platform.OS === 'ios' ? '&' : '?';
    await openReferralUrl(
      `sms:${separator}body=${encodeURIComponent(shareMessage)}`,
      'SMS',
      'No text messaging app is available. You can copy your referral link instead.',
    );
  };

  const handleEmail = async () => {
    if (!requireLink()) return;
    await openReferralUrl(
      `mailto:?subject=${encodeURIComponent('Join me on Bluebird')}&body=${encodeURIComponent(shareMessage)}`,
      'Email',
      'No email app is available. You can copy your referral link instead.',
    );
  };

  const handleShare = async () => {
    if (!requireLink()) return;
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({
          title: 'Join Bluebird',
          text: shareMessage,
          url: link,
        });
        return;
      }

      await Share.share(
        Platform.OS === 'ios'
          ? { message: shareMessage, url: link }
          : { message: shareMessage, title: 'Join Bluebird' },
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      showFeedback(
        'Could not share link',
        'Sharing is not available right now. You can copy your referral link instead.',
      );
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.offWhite }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const invited: { name: string; status: string }[] = ref?.invited ?? [];
  const cells = qrCells(link || 'bluebird');

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.offWhite }}
      contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 24 }]}
    >
      <Text style={[styles.headline, { color: colors.textOnSurface }]}>Invite your friends.{'\n'}Help them save.</Text>
      <Text style={[styles.subcopy, { color: colors.mutedForegroundLight }]}>
        Share your personal link and help friends save on private aviation. Earn rewards together when they become members.
      </Text>

      {/* QR-style graphic */}
      <View style={[styles.qr, { backgroundColor: colors.backgroundMid }]}>
        {cells.map((on, i) => (
          <View key={i} style={[styles.qrCell, on && { backgroundColor: colors.primaryForeground }]} />
        ))}
      </View>

      {/* Code card */}
      <View style={[styles.codeCard, { backgroundColor: colors.surface, shadowColor: '#0A1128' }]}>
        <Text style={[styles.code, { color: colors.textOnSurface }]} numberOfLines={1}>
          {link || 'Referral link unavailable'}
        </Text>
        <TouchableOpacity
          testID="copy-referral-link"
          accessibilityLabel="Copy referral link"
          style={[styles.copyPill, { backgroundColor: colors.primary + '14' }]}
          onPress={handleCopy}
          activeOpacity={0.7}
        >
          <Text style={[styles.copyText, { color: colors.primary }]}>{copied ? 'Copied' : 'Copy'}</Text>
        </TouchableOpacity>
      </View>

      {/* Share actions */}
      <View style={styles.actionsRow}>
        {[
          { label: 'SMS', onPress: handleSms, testID: 'share-referral-sms' },
          { label: 'Email', onPress: handleEmail, testID: 'share-referral-email' },
          { label: 'Share', onPress: handleShare, testID: 'share-referral-share' },
        ].map((a) => (
          <TouchableOpacity
            key={a.label}
            testID={a.testID}
            accessibilityRole="button"
            accessibilityLabel={`Share referral link by ${a.label}`}
            style={[styles.actionBtn, { backgroundColor: colors.muted }]}
            onPress={a.onPress}
            activeOpacity={0.7}
          >
            <Text style={[styles.actionText, { color: colors.textOnSurface }]}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Invited list */}
      <View style={styles.invitedSection}>
        <Text style={[styles.invitedTitle, { color: colors.textOnSurface }]}>Invited ({invited.length})</Text>
        {invited.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.mutedForegroundLight }]}>
            No one has used your code yet. Share it to start earning rewards.
          </Text>
        ) : (
          invited.map((friend, i) => (
            <View
              key={`${friend.name}-${i}`}
              style={[styles.invitedRow, i < invited.length - 1 && [styles.invitedRowBorder, { borderBottomColor: colors.separator }]]}
            >
              <Text style={[styles.invitedName, { color: colors.mutedForegroundLight }]}>{shortName(friend.name)}</Text>
              <Text style={friend.status === 'joined' ? [styles.statusJoined, { color: colors.primary }] : [styles.statusPending, { color: colors.mutedForegroundLight }]}>
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
    textAlign: 'center', letterSpacing: -0.5,
  },
  subcopy: {
    fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21,
    textAlign: 'center',
  },
  qr: {
    width: 150, height: 150, borderRadius: 20,
    padding: 16, flexDirection: 'row', flexWrap: 'wrap',
  },
  qrCell: {
    width: (150 - 32 - 5 * 4) / 6, height: (150 - 32 - 5 * 4) / 6,
    marginRight: 4, marginBottom: 4,
  },
  codeCard: {
    width: '100%', borderRadius: 16, padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    shadowOpacity: 0.06, shadowRadius: 20, shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  code: {
    flex: 1, fontFamily: 'Inter_700Bold', fontSize: 17,
    letterSpacing: 0.5,
  },
  copyPill: {
    paddingVertical: 8,
    paddingHorizontal: 12, borderRadius: 999,
  },
  copyText: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  actionsRow: { flexDirection: 'row', gap: 10, width: '100%' },
  actionBtn: {
    flex: 1, borderRadius: 14,
    paddingVertical: 13, alignItems: 'center',
  },
  actionText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  invitedSection: { width: '100%', marginTop: 6 },
  invitedTitle: {
    fontFamily: 'Inter_700Bold', fontSize: 13, marginBottom: 10,
  },
  emptyText: {
    fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21,
  },
  invitedRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: 10,
  },
  invitedRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  invitedName: { fontFamily: 'Inter_400Regular', fontSize: 14 },
  statusJoined: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  statusPending: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
});
