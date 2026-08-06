import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Share, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useColors } from '@/hooks/useColors';
import { useGetReferral } from '@workspace/api-client-react';
import * as Haptics from 'expo-haptics';

export default function ReferralScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const { data: referral, isLoading } = useGetReferral({});
  const ref = referral as any;

  const handleCopy = async () => {
    if (!ref?.code) return;
    await Clipboard.setStringAsync(ref.code);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  const handleShare = async () => {
    if (!ref?.code) return;
    Share.share({
      message: `Join Bluebird — private aviation for everyone. Use my referral code ${ref.code} to get started. https://bluebird.com/join?ref=${ref.code}`,
      title: 'Join Bluebird',
    });
  };

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.content, { paddingBottom: bottomPad + 24 }]}>
        {/* Hero */}
        <View style={[styles.heroCard, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '40' }]}>
          <View style={[styles.heroIcon, { backgroundColor: colors.primary }]}>
            <Feather name="gift" size={28} color="#fff" />
          </View>
          <Text style={[styles.heroTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
            Refer friends,{'\n'}earn passes.
          </Text>
          <Text style={[styles.heroBody, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Earn 1 Skip the Line pass for every friend who joins Bluebird using your referral code.
          </Text>
        </View>

        {/* Referral code */}
        <View style={[styles.codeCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.codeLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>Your referral code</Text>
          <View style={styles.codeRow}>
            <Text style={[styles.code, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>{ref?.code ?? '—'}</Text>
            <TouchableOpacity style={[styles.copyBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]} onPress={handleCopy}>
              <Feather name="copy" size={16} color={colors.foreground} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Stats */}
        <View style={[styles.statsRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {[
            { label: 'Total referrals', value: ref?.totalReferrals ?? 0 },
            { label: 'Passes earned', value: ref?.earnedPasses ?? 0 },
          ].map((stat, i) => (
            <React.Fragment key={stat.label}>
              {i > 0 && <View style={[styles.statDivider, { backgroundColor: colors.border }]} />}
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>{stat.value}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{stat.label}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>

        {/* Share button */}
        <TouchableOpacity style={[styles.shareBtn, { backgroundColor: colors.primary }]} onPress={handleShare} activeOpacity={0.8}>
          <Feather name="share-2" size={18} color="#fff" />
          <Text style={[styles.shareBtnText, { fontFamily: 'Inter_600SemiBold' }]}>Share your referral link</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { flex: 1, padding: 20, gap: 16 },
  heroCard: { padding: 20, borderRadius: 16, borderWidth: 1, gap: 14 },
  heroIcon: { width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center' },
  heroTitle: { fontSize: 24, lineHeight: 32 },
  heroBody: { fontSize: 14, lineHeight: 22 },
  codeCard: { padding: 20, borderRadius: 16, borderWidth: 1, gap: 8 },
  codeLabel: { fontSize: 12, letterSpacing: 0.5 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  code: { flex: 1, fontSize: 28, letterSpacing: 4 },
  copyBtn: { width: 40, height: 40, borderRadius: 10, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  statsRow: { flexDirection: 'row', borderRadius: 14, borderWidth: 1, paddingVertical: 16 },
  statItem: { flex: 1, alignItems: 'center', gap: 4 },
  statValue: { fontSize: 24 },
  statLabel: { fontSize: 12 },
  statDivider: { width: 1 },
  shareBtn: { height: 56, borderRadius: 14, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 },
  shareBtnText: { color: '#fff', fontSize: 16 },
});
