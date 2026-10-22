import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useReferralProgram } from '@/hooks/useReferralProgram';
import { formatReferralCredit } from '@/lib/referralProgram';

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
  const {
    state,
    isLoading,
    isBusy,
    canSimulateActivation,
    refresh,
    simulateQualifyingActivation,
  } = useReferralProgram();
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  const copyValue = async (value: string, kind: 'code' | 'link') => {
    try {
      await Clipboard.setStringAsync(value);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      showFeedback(
        'Could not copy',
        `Your referral ${kind} could not be copied. Please try again.`,
      );
    }
  };

  const shareInvite = async () => {
    if (state.status !== 'loaded') return;
    const message = `Give $500, earn $1,000 with Bluebird. Your friend receives a $500 membership discount, and you earn $1,000 in referral credit after their qualifying membership activation: ${state.snapshot.inviteUrl}`;
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({
          title: 'Give $500, earn $1,000 with Bluebird',
          text: message,
          url: state.snapshot.inviteUrl,
        });
        return;
      }
      await Share.share(
        Platform.OS === 'ios'
          ? { message, url: state.snapshot.inviteUrl }
          : { message, title: 'Give $500, earn $1,000 with Bluebird' },
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      showFeedback('Could not share invite', 'Sharing is not available right now. You can copy your invite link instead.');
    }
  };

  const activateDemoReferral = async () => {
    try {
      await simulateQualifyingActivation();
    } catch {
      showFeedback('Demo activation unavailable', 'The local referral activation could not be saved. Try again.');
    }
  };

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Referral Program' }} />
        <View style={[styles.centered, { backgroundColor: colors.offWhite }]} testID="referral-loading">
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.stateBody, { color: colors.mutedForegroundLight }]}>Loading Referral Program…</Text>
        </View>
      </>
    );
  }

  if (state.status === 'error') {
    return (
      <>
        <Stack.Screen options={{ title: 'Referral Program' }} />
        <View style={[styles.centered, styles.errorState, { backgroundColor: colors.offWhite }]} testID="referral-error">
          <Feather name="alert-circle" size={28} color={colors.destructive} />
          <Text style={[styles.stateTitle, { color: colors.textOnSurface }]}>Referral details unavailable</Text>
          <Text style={[styles.stateBody, { color: colors.mutedForegroundLight }]}>{state.error}</Text>
          <TouchableOpacity
            accessibilityRole="button"
            testID="referral-retry"
            style={[styles.primaryButton, { backgroundColor: colors.primary }]}
            onPress={refresh}
          >
            <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>Try again</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  if (state.status !== 'loaded') return null;
  const { snapshot } = state;
  const stats = [
    { label: 'Friends Activated', value: String(snapshot.statistics.friendsActivated) },
    { label: 'Credit Earned', value: formatReferralCredit(snapshot.statistics.creditEarnedCents) },
    { label: 'Credit Applied', value: formatReferralCredit(snapshot.statistics.creditAppliedCents) },
    { label: 'Balance', value: formatReferralCredit(snapshot.statistics.balanceCents), emphasis: true },
  ];

  return (
    <>
      <Stack.Screen options={{ title: 'Referral Program' }} />
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.offWhite }}
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 28 }]}
        showsVerticalScrollIndicator={false}
        testID="referral-screen"
      >
      <View style={[styles.hero, { backgroundColor: colors.backgroundMid }]}>
        <View style={[styles.heroIcon, { backgroundColor: colors.primary + '24' }]}>
          <Feather name="gift" size={21} color={colors.primaryForeground} />
        </View>
        <Text style={[styles.headline, { color: colors.textOnBrand }]}>Give $500,{'\n'}earn $1,000</Text>
        <Text style={[styles.subcopy, { color: colors.mutedOnBrand }]}>
          Your friend gets $500 off membership. You earn $1,000 in referral credit after their qualifying membership activation.
        </Text>
      </View>

      <View style={[styles.codeCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.codeCopy}>
          <Text style={[styles.eyebrow, { color: colors.mutedForegroundLight }]}>YOUR REFERRAL CODE</Text>
          <Text style={[styles.code, { color: colors.textOnSurface }]} numberOfLines={1} testID="referral-code">
            {snapshot.code}
          </Text>
        </View>
        <TouchableOpacity
          testID="copy-referral-code"
          accessibilityRole="button"
          accessibilityLabel="Copy Code"
          style={[styles.copyButton, { backgroundColor: colors.primary + '16' }]}
          onPress={() => copyValue(snapshot.code, 'code')}
          activeOpacity={0.75}
        >
          <Feather name={copied === 'code' ? 'check' : 'copy'} size={16} color={colors.primary} />
          <Text style={[styles.copyText, { color: colors.primary }]}>{copied === 'code' ? 'Copied' : 'Copy Code'}</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.linkCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.eyebrow, { color: colors.mutedForegroundLight }]}>YOUR INVITE LINK</Text>
        <Text style={[styles.link, { color: colors.textOnSurface }]} numberOfLines={2} testID="referral-link">
          {snapshot.inviteUrl}
        </Text>
        <View style={styles.linkActions}>
          <TouchableOpacity
            testID="copy-referral-link"
            accessibilityRole="button"
            accessibilityLabel="Copy Link"
            style={[styles.secondaryButton, { backgroundColor: colors.muted }]}
            onPress={() => copyValue(snapshot.inviteUrl, 'link')}
            activeOpacity={0.75}
          >
            <Feather name={copied === 'link' ? 'check' : 'link'} size={16} color={colors.textOnSurface} />
            <Text style={[styles.secondaryButtonText, { color: colors.textOnSurface }]}>
              {copied === 'link' ? 'Copied' : 'Copy Link'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="share-referral"
            accessibilityRole="button"
            accessibilityLabel="Share invite"
            style={[styles.primaryButton, { backgroundColor: colors.primary }]}
            onPress={shareInvite}
            activeOpacity={0.75}
          >
            <Feather name="share-2" size={16} color={colors.primaryForeground} />
            <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>Share</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.statsHeading}>
        <Text style={[styles.sectionTitle, { color: colors.textOnSurface }]}>Referral credits</Text>
        {canSimulateActivation ? (
          <View style={[styles.demoBadge, { backgroundColor: colors.secondary }]}>
            <Text style={[styles.demoBadgeText, { color: colors.primary }]}>LOCAL DEMO</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.statsGrid} testID="referral-statistics">
        {stats.map((stat) => (
          <View
            key={stat.label}
            style={[
              styles.statCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
              stat.emphasis && { borderColor: colors.primary },
            ]}
          >
            <Text style={[styles.statValue, { color: stat.emphasis ? colors.primary : colors.textOnSurface }]}>
              {stat.value}
            </Text>
            <Text style={[styles.statLabel, { color: colors.mutedForegroundLight }]}>{stat.label}</Text>
          </View>
        ))}
      </View>
      {snapshot.statistics.friendsActivated === 0 ? (
        <View style={[styles.emptyState, { backgroundColor: colors.surface, borderColor: colors.border }]} testID="referral-empty">
          <Feather name="users" size={18} color={colors.primary} />
          <Text style={[styles.emptyText, { color: colors.mutedForegroundLight }]}>
            No friends have activated a membership with your code yet. Share your invite to get started.
          </Text>
        </View>
      ) : null}

      {canSimulateActivation ? (
        <TouchableOpacity
          testID="simulate-referral-activation"
          accessibilityRole="button"
          disabled={isBusy}
          style={[styles.demoAction, { borderColor: colors.border, backgroundColor: colors.surface }]}
          onPress={activateDemoReferral}
        >
          {isBusy
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <Feather name="plus-circle" size={17} color={colors.primary} />}
          <Text style={[styles.demoActionText, { color: colors.textOnSurface }]}>
            {isBusy ? 'Updating local preview…' : 'Simulate qualifying activation'}
          </Text>
        </TouchableOpacity>
      ) : null}
      {canSimulateActivation ? (
        <Text style={[styles.disclaimer, { color: colors.mutedForegroundLight }]}>
          Development demo only. This updates local preview data; it does not activate a membership or process payment.
        </Text>
      ) : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28, gap: 12 },
  errorState: { alignItems: 'center' },
  stateTitle: { fontFamily: 'Inter_700Bold', fontSize: 21, textAlign: 'center', marginTop: 4 },
  stateBody: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  content: { paddingTop: 20, paddingHorizontal: 20, gap: 14 },
  hero: { width: '100%', borderRadius: 22, padding: 22, gap: 12 },
  heroIcon: { alignItems: 'center', justifyContent: 'center', width: 42, height: 42, borderRadius: 14 },
  headline: { fontFamily: 'Inter_700Bold', fontSize: 31, lineHeight: 35, letterSpacing: -0.7 },
  subcopy: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 },
  codeCard: {
    width: '100%', borderWidth: 1, borderRadius: 16, padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  },
  codeCopy: { flex: 1, minWidth: 0 },
  eyebrow: { fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 1.1, marginBottom: 5 },
  code: { fontFamily: 'Inter_700Bold', fontSize: 20, letterSpacing: 1.1 },
  copyButton: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 999 },
  copyText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  linkCard: { width: '100%', borderWidth: 1, borderRadius: 16, padding: 16, gap: 10 },
  link: { fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 },
  linkActions: { flexDirection: 'row', gap: 10, marginTop: 2 },
  primaryButton: {
    minHeight: 44, borderRadius: 999, paddingHorizontal: 17,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8,
  },
  primaryButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  secondaryButton: {
    flex: 1, minHeight: 44, borderRadius: 999, paddingHorizontal: 14,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8,
  },
  secondaryButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  statsHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  demoBadge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999 },
  demoBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 0.7 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: {
    width: '48%', flexGrow: 1, minHeight: 94, borderWidth: 1, borderRadius: 15,
    padding: 14, justifyContent: 'center', gap: 5,
  },
  statValue: { fontFamily: 'Inter_700Bold', fontSize: 21 },
  statLabel: { fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 17 },
  emptyState: { borderWidth: 1, borderRadius: 14, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 11 },
  emptyText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  demoAction: {
    minHeight: 48, borderWidth: 1, borderRadius: 15, paddingHorizontal: 15,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  demoActionText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  disclaimer: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: -7 },
});
