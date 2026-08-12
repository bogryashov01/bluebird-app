import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform, Alert,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { FloatingBackButton } from '@/components/FloatingBackButton';
import { PrimaryButton, SecondaryButton } from '@/components/PrimaryButton';
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
  // Optional originating queue entry (and its flight details) forwarded from
  // Queue Status; when present, a successful purchase lands the member on the
  // pass confirmation for that entry instead of dead-ending here.
  const params = useLocalSearchParams<{
    entryId?: string; position?: string; flightId?: string;
    from?: string; to?: string; fromCity?: string; toCity?: string;
    departureDate?: string; departureTime?: string; duration?: string;
    aircraftType?: string;
  }>();

  const afterPurchase = () => {
    if (params.entryId) {
      // Guide the member straight into using the new pass on their queue.
      router.replace({ pathname: '/queue/pass', params });
    } else {
      router.back();
    }
  };

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
          // RN-web Alert.alert with buttons is a no-op — navigate directly.
          afterPurchase();
        } else {
          Alert.alert(
            'Pass purchased',
            params.entryId
              ? '1 Skip the Line pass has been added to your account. Use it now to confirm your seat.'
              : '1 Skip the Line pass has been added to your account.',
            [{ text: params.entryId ? 'Use Pass' : 'Done', onPress: afterPurchase }],
          );
        }
      },
      onError: (err: any) => {
        const code = err?.data?.code || err?.response?.data?.code;
        if (code === 'MEMBERSHIP_REQUIRED') {
          router.replace({
            pathname: '/membership/join' as any,
            params: params.flightId ? { flightId: params.flightId } : {},
          });
          return;
        }
        Alert.alert('Purchase failed', err?.data?.error || err?.response?.data?.error || err?.message || 'Failed to buy pass');
      },
    },
  });

  // Non-member guard: pass purchases are a member feature — route straight to
  // the membership-required screen instead of showing the demo checkout.
  React.useEffect(() => {
    if (user?.membershipTier === 'none') {
      router.replace({
        pathname: '/membership/join' as any,
        params: params.flightId ? { flightId: params.flightId } : {},
      });
    }
  }, [user?.membershipTier]);

  const handleBuy = () => {
    if (buyMutation.isPending || purchased) return;
    buyMutation.mutate();
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.offWhite }]}>
      <FloatingBackButton />

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
          <SecondaryButton
            label="Buy 1 Pass"
            onPress={handleBuy}
            disabled={buyMutation.isPending}
            style={{ marginTop: 8 }}
          />
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
          <PrimaryButton
            label="Upgrade to Plus"
            onPress={() => router.push('/upgrade/plus')}
            style={{ marginTop: 10 }}
          />
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
  plusCard: {
    borderRadius: 18, borderWidth: 1.5, padding: 18, gap: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2,
  },
  recommendedPill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 4 },
  recommendedText: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.8 },
  bullets: { gap: 6, marginTop: 6 },
  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bulletText: { fontFamily: 'Inter_500Medium', fontSize: 13.5 },
  demoNote: { fontFamily: 'Inter_400Regular', fontSize: 12, textAlign: 'center', marginTop: 2 },
  footer: { paddingHorizontal: 22, paddingTop: 12 },
  // Apple Pay branding intentionally keeps platform black/white + its own geometry.
  applePayBtn: { borderRadius: 14, height: 54, justifyContent: 'center', alignItems: 'center' },
  applePayText: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
});
