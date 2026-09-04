import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, Share, Platform, Linking, Alert, ImageBackground,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useGetReferral } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

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

  const { data: referral, isLoading, error } = useGetReferral({});
  const ref = referral as any;
  const [copied, setCopied] = useState(false);

  const referralCode = typeof ref?.code === 'string' ? ref.code.trim() : '';
  const link = typeof ref?.referralUrl === 'string'
    ? ref.referralUrl
    : referralCode
      ? `https://bluebird.co/join/${encodeURIComponent(referralCode)}`
      : '';
  const shareMessage = link
    ? `Join me on Bluebird. When you join successfully, we’ll each get 1 Skip the Line Pass: ${link}`
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
      `mailto:?subject=${encodeURIComponent('1 Skip the Line Pass for each of us')}&body=${encodeURIComponent(shareMessage)}`,
      'Email',
      'No email app is available. You can copy your referral link instead.',
    );
  };

  const handleShare = async () => {
    if (!requireLink()) return;
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({
          title: '1 Skip the Line Pass for each of us',
          text: shareMessage,
          url: link,
        });
        return;
      }

      await Share.share(
        Platform.OS === 'ios'
          ? { message: shareMessage, url: link }
          : { message: shareMessage, title: '1 Skip the Line Pass for each of us' },
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

  if (error) {
    const membershipRequired = (error as any)?.response?.data?.code === 'MEMBERSHIP_REQUIRED';
    return (
      <View style={[styles.centered, styles.errorState, { backgroundColor: colors.offWhite }]}>
        <Text style={[styles.errorTitle, { color: colors.textOnSurface }]}>
          {membershipRequired ? 'Membership unlocks referrals' : 'Referral details unavailable'}
        </Text>
        <Text style={[styles.errorBody, { color: colors.mutedForegroundLight }]}>
          {membershipRequired
            ? 'Join Bluebird to invite friends and receive one Skip the Line Pass each.'
            : 'We could not load your referral details. Please try again in a moment.'}
        </Text>
        {membershipRequired ? (
          <TouchableOpacity
            style={[styles.joinButton, { backgroundColor: colors.primary }]}
            onPress={() => router.push('/membership/join' as any)}
          >
            <Text style={[styles.joinButtonText, { color: colors.primaryForeground }]}>See membership plans</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  const invited: { name: string; status: string }[] = ref?.invited ?? [];
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.offWhite }}
      contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 24 }]}
    >
      <Text style={[styles.headline, { color: colors.textOnSurface }]}>A faster way to fly,{'\n'}for both of you.</Text>
      <Text style={[styles.subcopy, { color: colors.mutedForegroundLight }]}>
        When your friend joins Bluebird successfully, you’ll each receive one Skip the Line Pass.
      </Text>

      <ImageBackground
        source={require('../assets/images/hero-aircraft.jpg')}
        style={styles.previewCard}
        imageStyle={styles.previewImage}
        accessibilityLabel="Bluebird aircraft referral preview"
      >
        <View style={styles.previewOverlay}>
          <View style={[styles.previewShade, { backgroundColor: colors.backgroundMid }]} />
          <Text style={[styles.previewBrand, { color: colors.primaryForeground }]}>BLUEBIRD</Text>
          <View style={styles.previewCopy}>
            <Text style={[styles.previewTitle, { color: colors.primaryForeground }]}>Skip the line together.</Text>
            <Text style={[styles.previewBody, { color: colors.primaryForeground }]}>
              You get 1 pass. I get 1 pass.{'\n'}Our next flight gets closer.
            </Text>
          </View>
          <View style={[styles.passBadge, { backgroundColor: colors.primary }]}>
            <Text style={[styles.passBadgeText, { color: colors.primaryForeground }]}>1 PASS EACH</Text>
          </View>
        </View>
      </ImageBackground>

      {/* Code card */}
      <View style={[styles.codeCard, { backgroundColor: colors.surface, shadowColor: colors.backgroundMid }]}>
        <View style={styles.codeCopy}>
          <Text style={[styles.codeLabel, { color: colors.mutedForegroundLight }]}>YOUR REFERRAL CODE</Text>
          <Text style={[styles.code, { color: colors.textOnSurface }]} numberOfLines={1}>
            {referralCode || 'Unavailable'}
          </Text>
        </View>
        <TouchableOpacity
          testID="copy-referral-link"
          accessibilityLabel="Copy referral code and link"
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
             No one has joined with your code yet. Share it so you can both receive a pass.
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
  errorState: { paddingHorizontal: 28 },
  errorTitle: { fontFamily: 'Inter_700Bold', fontSize: 23, textAlign: 'center', marginBottom: 8 },
  errorBody: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  joinButton: { marginTop: 20, borderRadius: 999, paddingVertical: 14, paddingHorizontal: 22 },
  joinButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  content: { paddingTop: 40, paddingHorizontal: 22, alignItems: 'center', gap: 16 },
  headline: {
    fontFamily: 'Inter_700Bold', fontSize: 25, lineHeight: 31,
    textAlign: 'center', letterSpacing: -0.5,
  },
  subcopy: {
    fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21,
    textAlign: 'center',
  },
  previewCard: { width: '100%', height: 250 },
  previewImage: { borderRadius: 24 },
  previewOverlay: {
    flex: 1, borderRadius: 24, padding: 20,
    justifyContent: 'space-between', overflow: 'hidden',
  },
  previewShade: { ...StyleSheet.absoluteFillObject, opacity: 0.62 },
  previewBrand: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 2.4 },
  previewCopy: { marginTop: 'auto', marginBottom: 18 },
  previewTitle: { fontFamily: 'Inter_700Bold', fontSize: 25, lineHeight: 30, letterSpacing: -0.5 },
  previewBody: { fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 19, marginTop: 8 },
  passBadge: { alignSelf: 'flex-start', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
  passBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1.1 },
  codeCard: {
    width: '100%', borderRadius: 16, padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    shadowOpacity: 0.06, shadowRadius: 20, shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  code: {
    fontFamily: 'Inter_700Bold', fontSize: 20, letterSpacing: 1.2,
  },
  codeCopy: { flex: 1 },
  codeLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 1.1, marginBottom: 4 },
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
