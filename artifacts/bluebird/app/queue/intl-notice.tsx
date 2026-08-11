import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { FloatingBackButton } from '@/components/FloatingBackButton';
import { PrimaryButton, SecondaryButton } from '@/components/PrimaryButton';
import { useJoinQueue } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import * as Haptics from 'expo-haptics';

// Dark "International Flight Notice" — shown only to Base members joining an
// international flight. Plus waives the fee.
export default function InternationalNoticeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    flightId: string; fromCity: string; toCity: string;
    from: string; to: string; useLinePass?: string; passengers?: string;
    feeUsd?: string; flightStatus?: string;
  }>();
  const { flightId } = params;
  const passengers = Math.max(1, parseInt(params.passengers ?? '1', 10) || 1);
  const useLinePass = params.useLinePass === '1';
  const fee = parseInt(params.feeUsd ?? '1000', 10) || 1000;
  const { user, updateUser } = useAuth();
  const queryClient = useQueryClient();
  const [joinError, setJoinError] = useState<string | null>(null);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const joinMutation = useJoinQueue({
    mutation: {
      onSuccess: async (entry: any) => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        queryClient.invalidateQueries({ queryKey: ['/api/queue/status'] });
        queryClient.invalidateQueries({ queryKey: [`/api/flights/${flightId}/my-status`] });
        queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
        if (useLinePass && user) {
          updateUser({ ...user, linePassCount: Math.max(0, (user.linePassCount ?? 0) - 1) });
        }
        // Skip the Line: the server confirms the seat atomically with the
        // pass — the join response comes back already confirmed.
        if (entry?.status === 'confirmed') {
          queryClient.invalidateQueries({ queryKey: ['/api/queue/status'] });
          queryClient.invalidateQueries({ queryKey: ['/api/trips'] });
          queryClient.invalidateQueries({ queryKey: [`/api/flights/${flightId}/my-status`] });
          router.replace({
            pathname: '/flight/confirmed',
            params: useLinePass ? { ...params, passUsed: '1' } : params,
          });
          return;
        }
        router.replace({
          pathname: '/queue/joined',
          params: {
            ...params,
            entryId: entry?.id ?? '',
            position: String(entry?.position ?? ''),
            totalInQueue: String(entry?.totalInQueue ?? ''),
            flightStatus: entry?.flight?.status ?? params.flightStatus ?? 'available',
          },
        });
      },
      onError: (err: any) => {
        const msg = err?.response?.data?.error || err?.data?.error || err?.message || 'Failed to join queue';
        setJoinError(msg);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      },
    },
  });

  const handleContinueBase = () => {
    if (!flightId || joinMutation.isPending) return;
    setJoinError(null);
    joinMutation.mutate({ data: { flightId, useLinePass, passengers, acceptIntlFee: true } });
  };

  // Brand-navy surface in both modes — textOnBrand/mutedOnBrand tokens apply.
  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundMid }]}>
      <FloatingBackButton variant="brand" />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: topPad + 76 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.globeBadge, { backgroundColor: colors.primary + '26' }]}>
          <Feather name="globe" size={20} color={colors.primary} />
        </View>

        <Text style={[styles.title, { color: colors.textOnBrand }]}>International Flight Notice</Text>
        <Text style={[styles.body, { color: colors.mutedOnBrand }]}>
          This flight crosses an international border. As a Base member, a one-time
          international fee applies — or upgrade to Plus to waive it and unlock more benefits.
        </Text>

        <View style={[styles.feeRow, { backgroundColor: colors.textOnBrand + '0A', borderColor: colors.textOnBrand + '14' }]}>
          <Text style={[styles.feeLabel, { color: colors.mutedOnBrand }]}>International Fee</Text>
          <Text style={[styles.feeValue, { color: colors.textOnBrand }]}>${fee.toLocaleString()}</Text>
        </View>

        <View style={[styles.plusCard, { backgroundColor: colors.primary + '1F', borderColor: colors.primary + '59' }]}>
          <Text style={[styles.plusTitle, { color: colors.textOnBrand }]}>Plus Membership waives this fee</Text>
          <Text style={[styles.plusBody, { color: colors.mutedOnBrand }]}>
            Plus unlocks priority notifications, earlier access and complimentary Skip the Line Passes.
          </Text>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: bottomPad + 12 }]}>
        {!!joinError && (
          <View style={[styles.errorBox, { backgroundColor: colors.coral + '26', borderColor: colors.coral + '66' }]}>
            <Feather name="alert-circle" size={15} color={colors.coral} />
            <Text style={[styles.errorText, { color: colors.coral }]}>{joinError}</Text>
          </View>
        )}
        <PrimaryButton label="Upgrade to Plus" onPress={() => router.push('/upgrade/plus')} />
        <SecondaryButton
          label={`Continue with Base ($${fee.toLocaleString()} fee)`}
          onPress={handleContinueBase}
          loading={joinMutation.isPending}
          backgroundColor={colors.textOnBrand + '14'}
          textColor={colors.textOnBrand}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 22, paddingBottom: 24, gap: 16 },
  globeBadge: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontFamily: 'Inter_700Bold', fontSize: 24 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, marginTop: -6 },
  feeRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderRadius: 14, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 16,
  },
  feeLabel: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  feeValue: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  plusCard: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 6 },
  plusTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14.5 },
  plusBody: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  footer: { paddingHorizontal: 22, paddingTop: 12, gap: 10 },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 11,
  },
  errorText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 },
});
