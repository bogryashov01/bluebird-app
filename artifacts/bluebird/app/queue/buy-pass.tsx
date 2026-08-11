import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform, Alert,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useBuyLinePass } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import * as Haptics from 'expo-haptics';

const PLUS_BULLETS = [
  '5 Skip the Line Passes',
  'Priority notifications & earlier access',
  'Premium concierge & member events',
];

// "Skip the Line" purchase screen — buy 1 pass ($2,000 demo checkout) or
// upgrade to Plus membership.
export default function BuyPassScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, updateUser } = useAuth();
  const queryClient = useQueryClient();
  const [purchased, setPurchased] = useState(false);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const buyMutation = useBuyLinePass({
    mutation: {
      onSuccess: (data: any) => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        if (user && typeof data?.linePassCount === 'number') {
          updateUser({ ...user, linePassCount: data.linePassCount });
        }
        queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
        setPurchased(true);
        if (Platform.OS === 'web') {
          // RN-web Alert.alert with buttons is a no-op — navigate back directly.
          router.back();
        } else {
          Alert.alert(
            'Pass purchased',
            '1 Skip the Line pass has been added to your account.',
            [{ text: 'Done', onPress: () => router.back() }],
          );
        }
      },
      onError: (err: any) => {
        Alert.alert('Purchase failed', err?.data?.error || err?.response?.data?.error || err?.message || 'Failed to buy pass');
      },
    },
  });

  const handleBuy = () => {
    if (buyMutation.isPending || purchased) return;
    buyMutation.mutate();
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.offWhite }]}>
      <TouchableOpacity
        style={[styles.backBtn, { top: topPad + 14, backgroundColor: colors.muted }]}
        onPress={() => router.back()}
        activeOpacity={0.75}
      >
        <Text style={[styles.backChevron, { color: colors.textOnSurface }]}>‹</Text>
      </TouchableOpacity>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: topPad + 72, paddingBottom: 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.title, { color: colors.textOnSurface }]}>Skip the Line</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForegroundLight }]}>
          Skip the wait and confirm your seat instantly, any time.
        </Text>

        {/* Single pass */}
        <View style={[styles.passCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.passTitle, { color: colors.textOnSurface }]}>1 Skip the Line Pass</Text>
          <Text style={[styles.passSub, { color: colors.mutedForegroundLight }]}>
            Guarantees your seat on this flight, instantly.
          </Text>
          <Text style={[styles.passPrice, { color: colors.textOnSurface }]}>$2,000</Text>
          <TouchableOpacity
            style={[styles.buyBtn, { backgroundColor: colors.muted }, buyMutation.isPending && { opacity: 0.6 }]}
            onPress={handleBuy}
            disabled={buyMutation.isPending}
            activeOpacity={0.8}
          >
            <Text style={[styles.buyBtnText, { color: colors.textOnSurface }]}>Buy 1 Pass</Text>
          </TouchableOpacity>
        </View>

        {/* Recommended: Plus upgrade */}
        <View style={[styles.plusCard, { backgroundColor: colors.surface, borderColor: colors.primary }]}>
          <View style={[styles.recommendedPill, { backgroundColor: colors.primary + '1A' }]}>
            <Text style={[styles.recommendedText, { color: colors.primary }]}>RECOMMENDED</Text>
          </View>
          <Text style={[styles.passTitle, { color: colors.textOnSurface }]}>Upgrade to Plus Membership</Text>
          <Text style={[styles.passSub, { color: colors.mutedForegroundLight }]}>$995/month — includes:</Text>
          <View style={styles.bullets}>
            {PLUS_BULLETS.map((b) => (
              <View key={b} style={styles.bulletRow}>
                <Feather name="plus" size={13} color={colors.primary} />
                <Text style={[styles.bulletText, { color: colors.textOnSurface }]}>{b}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity
            style={[styles.upgradeBtn, { backgroundColor: colors.primary }]}
            onPress={() => router.push('/upgrade/plus')}
            activeOpacity={0.85}
          >
            <Text style={[styles.upgradeBtnText, { color: colors.primaryForeground }]}>Upgrade to Plus</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.demoNote, { color: colors.mutedForegroundLight }]}>
          Demo checkout — no real payment will be charged.
        </Text>
      </ScrollView>

      {/* Apple Pay-styled demo pay button (buys 1 pass) */}
      <View style={[styles.footer, { paddingBottom: bottomPad + 12 }]}>
        <TouchableOpacity
          style={[styles.applePayBtn, { backgroundColor: colors.scheme === 'dark' ? colors.foreground : '#000000' }, buyMutation.isPending && { opacity: 0.7 }]}
          onPress={handleBuy}
          disabled={buyMutation.isPending}
          activeOpacity={0.85}
        >
          {buyMutation.isPending
            ? <ActivityIndicator color={colors.scheme === 'dark' ? colors.background : '#FFFFFF'} size="small" />
            : (
              <Text style={[styles.applePayText, { color: colors.scheme === 'dark' ? colors.background : '#FFFFFF' }]}>
                Pay with  Pay
              </Text>
            )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  backBtn: {
    position: 'absolute', zIndex: 20, left: 16,
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
  },
  backChevron: { fontFamily: 'Inter_500Medium', fontSize: 22, marginTop: -2 },
  content: { paddingHorizontal: 22, gap: 14 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 26 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, marginTop: -8, marginBottom: 4 },
  passCard: {
    borderRadius: 18, borderWidth: 1, padding: 18, gap: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2,
  },
  passTitle: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  passSub: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  passPrice: { fontFamily: 'Inter_700Bold', fontSize: 24, marginTop: 4 },
  buyBtn: { borderRadius: 999, paddingVertical: 13, alignItems: 'center', marginTop: 8 },
  buyBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 14.5 },
  plusCard: {
    borderRadius: 18, borderWidth: 1.5, padding: 18, gap: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2,
  },
  recommendedPill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 4 },
  recommendedText: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.8 },
  bullets: { gap: 6, marginTop: 6 },
  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bulletText: { fontFamily: 'Inter_500Medium', fontSize: 13.5 },
  upgradeBtn: { borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  upgradeBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  demoNote: { fontFamily: 'Inter_400Regular', fontSize: 12, textAlign: 'center', marginTop: 2 },
  footer: { paddingHorizontal: 22, paddingTop: 12 },
  applePayBtn: { borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  applePayText: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
});
