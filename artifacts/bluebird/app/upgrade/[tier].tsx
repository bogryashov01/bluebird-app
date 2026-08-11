import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useUpgradeMembership } from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

const TIER_INFO: Record<string, {
  label: string; price: string; priceNum: string; tagline: string;
  color: string; features: string[]; passes: number;
}> = {
  plus: {
    label: 'Plus',
    price: '$299 / mo',
    priceNum: '$299.00',
    tagline: 'More access, more freedom',
    color: '#1259F2',
    passes: 2,
    features: ['Everything in Base', '2 Skip the Line passes / mo', 'Priority support', 'International flights', 'Guest pass'],
  },
  concierge: {
    label: 'Concierge',
    price: '$799 / mo',
    priceNum: '$799.00',
    tagline: 'The complete Bluebird experience',
    color: '#F59E0B',
    passes: 10,
    features: ['Everything in Plus', 'Unlimited Line passes', 'AI Concierge 24/7', 'Dedicated coordinator', 'Lounge access', 'Custom flights'],
  },
};

export default function UpgradeScreen() {
  const { tier } = useLocalSearchParams<{ tier: string }>();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { user, updateUser } = useAuth();
  const queryClient = useQueryClient();
  const [success, setSuccess] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const info = TIER_INFO[tier ?? ''];

  const upgradeMutation = useUpgradeMembership({
    mutation: {
      onSuccess: (data: any) => {
        queryClient.invalidateQueries({ queryKey: ['getMembership'] });
        queryClient.invalidateQueries();
        if (user) updateUser({ ...user, membershipTier: data.tier, linePassCount: data.linePassCount });
        setSuccess(true);
      },
      onError: (err: any) => setErrorMsg(err?.response?.data?.error ?? 'Upgrade failed. Please try again.'),
    },
  });

  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  if (!info) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.offWhite }]}>
        <Text style={{ color: colors.textOnSurface, fontFamily: 'Inter_500Medium' }}>Unknown plan.</Text>
      </View>
    );
  }

  if (success) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.offWhite, paddingHorizontal: 28 }]}>
        <View style={[styles.successBadge, { backgroundColor: info.color + '20' }]}>
          <Text style={{ fontSize: 44 }}>🎉</Text>
        </View>
        <Text style={[styles.successTitle, { color: colors.textOnSurface }]}>Welcome to {info.label}!</Text>
        <Text style={[styles.successBody, { color: colors.mutedForegroundLight }]}>
          Your membership has been upgraded. {info.passes} Skip the Line passes have been added to your account.
        </Text>
        <TouchableOpacity
          style={[styles.confirmBtn, { backgroundColor: info.color, alignSelf: 'stretch' }]}
          activeOpacity={0.85}
          onPress={() => router.dismissTo('/(tabs)/membership')}
        >
          <Text style={[styles.confirmBtnText, { color: colors.primaryForeground }]}>Explore your benefits</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: botPad + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Plan header */}
        <View style={[styles.planCard, { backgroundColor: info.color }]}>
          <Text style={[styles.planLabel, { color: colors.primaryForeground }]}>Bluebird {info.label}</Text>
          <Text style={[styles.planPrice, { color: colors.primaryForeground + 'E6' }]}>{info.price}</Text>
          <Text style={[styles.planTagline, { color: colors.primaryForeground + 'BF' }]}>{info.tagline}</Text>
        </View>

        {/* Benefits */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight }]}>What you get</Text>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          {info.features.map((feat, i) => (
            <View key={feat} style={[styles.featureRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.separator }]}>
              <Text style={[styles.featureCheck, { color: info.color }]}>✓</Text>
              <Text style={[styles.featureText, { color: colors.textOnSurface }]}>{feat}</Text>
            </View>
          ))}
        </View>

        {/* Payment summary (mock) */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForegroundLight }]}>Payment</Text>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <View style={styles.payRow}>
            <Text style={[styles.payLabel, { color: colors.mutedForegroundLight }]}>Payment method</Text>
            <Text style={[styles.payValue, { color: colors.textOnSurface }]}>Visa •••• 4242</Text>
          </View>
          <View style={[styles.payRow, { borderTopWidth: 1, borderTopColor: colors.separator }]}>
            <Text style={[styles.payLabel, { color: colors.mutedForegroundLight }]}>Billing cycle</Text>
            <Text style={[styles.payValue, { color: colors.textOnSurface }]}>Monthly</Text>
          </View>
          <View style={[styles.payRow, { borderTopWidth: 1, borderTopColor: colors.separator }]}>
            <Text style={[styles.payLabel, { color: colors.mutedForegroundLight }]}>Due today</Text>
            <Text style={[styles.payTotal, { color: colors.textOnSurface }]}>{info.priceNum}</Text>
          </View>
        </View>
        <Text style={[styles.demoNote, { color: colors.mutedForegroundLight }]}>
          Demo checkout — no real payment will be charged.
        </Text>

        {errorMsg && (
          <Text style={[styles.errorText, { color: colors.destructive }]}>{errorMsg}</Text>
        )}

        <TouchableOpacity
          style={[styles.confirmBtn, { backgroundColor: info.color, opacity: upgradeMutation.isPending ? 0.7 : 1 }]}
          activeOpacity={0.85}
          disabled={upgradeMutation.isPending}
          onPress={() => {
            setErrorMsg(null);
            upgradeMutation.mutate({ data: { tier: tier as 'plus' | 'concierge' } });
          }}
        >
          {upgradeMutation.isPending
            ? <ActivityIndicator color={colors.primaryForeground} />
            : <Text style={[styles.confirmBtnText, { color: colors.primaryForeground }]}>Confirm upgrade — {info.priceNum}/mo</Text>}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { paddingHorizontal: 16, paddingTop: 16 },

  planCard: { borderRadius: 24, padding: 22, marginBottom: 22 },
  planLabel: { fontFamily: 'Inter_700Bold', fontSize: 22 },
  planPrice: { fontFamily: 'Inter_600SemiBold', fontSize: 16, marginTop: 4 },
  planTagline: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 8 },

  sectionLabel: {
    fontFamily: 'Inter_600SemiBold', fontSize: 12,
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10,
  },
  card: {
    borderRadius: 18, overflow: 'hidden', marginBottom: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2,
  },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 11 },
  featureCheck: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  featureText: { fontFamily: 'Inter_400Regular', fontSize: 14, flex: 1 },

  payRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 13,
  },
  payLabel: { fontFamily: 'Inter_400Regular', fontSize: 13.5 },
  payValue: { fontFamily: 'Inter_500Medium', fontSize: 13.5 },
  payTotal: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  demoNote: { fontFamily: 'Inter_400Regular', fontSize: 12, textAlign: 'center', marginBottom: 18, marginTop: -10 },

  errorText: { fontFamily: 'Inter_500Medium', fontSize: 13, textAlign: 'center', marginBottom: 12 },

  confirmBtn: { borderRadius: 999, paddingVertical: 16, alignItems: 'center' },
  confirmBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },

  successBadge: {
    width: 96, height: 96, borderRadius: 48,
    alignItems: 'center', justifyContent: 'center', marginBottom: 22,
  },
  successTitle: { fontFamily: 'Inter_700Bold', fontSize: 24, marginBottom: 10, textAlign: 'center' },
  successBody: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: 28 },
});
