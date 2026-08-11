import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform, Alert,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { FloatingBackButton } from '@/components/FloatingBackButton';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useJoinQueue, useGetFlightMyStatus } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import * as Haptics from 'expo-haptics';

const POLICY_ITEMS = [
  'Flights may be cancelled or changed due to operational requirements.',
  'Baggage restrictions apply based on aircraft type and available space.',
  'Pet policies apply — please confirm your pet meets carrier requirements.',
];

// "Before you join the queue" — policy acknowledgment step of the join flow.
export default function JoinQueueAcknowledgeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    flightId: string; fromCity: string; toCity: string;
    from: string; to: string; useLinePass?: string; passengers?: string;
    departureDate?: string; departureTime?: string; duration?: string;
    aircraftType?: string; international?: string; feeUsd?: string;
    flightStatus?: string;
  }>();
  const { flightId, fromCity, toCity, from, to } = params;
  const passengers = Math.max(1, parseInt(params.passengers ?? '1', 10) || 1);
  const useLinePass = params.useLinePass === '1';
  const isInternational = params.international === '1';
  const { user, updateUser } = useAuth();
  const queryClient = useQueryClient();
  const [checked, setChecked] = useState([false, false, false]);
  const [punctualityChecked, setPunctualityChecked] = useState(false);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  // Guard: a user already confirmed on this flight cannot join again.
  const { data: myStatus, isLoading: statusLoading } = useGetFlightMyStatus(flightId!, {
    query: { enabled: !!user && !!flightId },
  });
  const isConfirmed = myStatus?.status === 'confirmed';
  useEffect(() => {
    if (isConfirmed && flightId) router.replace(`/flight/${flightId}`);
  }, [isConfirmed, flightId]);

  const joinMutation = useJoinQueue({
    mutation: {
      onSuccess: async (entry: any) => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
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
        queryClient.invalidateQueries({ queryKey: ['/api/queue/status'] });
        queryClient.invalidateQueries({ queryKey: [`/api/flights/${flightId}/my-status`] });
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
        const msg = err?.response?.data?.error || err?.data?.error || 'Failed to join queue';
        Alert.alert('Error', msg);
      },
    },
  });

  const allChecked = checked.every(Boolean) && punctualityChecked;
  const needsIntlNotice = isInternational && user?.membershipTier === 'base';

  const handleContinue = () => {
    if (!allChecked || !flightId || isConfirmed) return;
    if (needsIntlNotice) {
      router.push({ pathname: '/queue/intl-notice', params });
      return;
    }
    joinMutation.mutate({ data: { flightId, useLinePass, passengers } });
  };

  const ctaDisabled = !allChecked || joinMutation.isPending || statusLoading || isConfirmed;

  return (
    <View style={[styles.container, { backgroundColor: colors.offWhite }]}>
      <FloatingBackButton />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: topPad + 72 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.title, { color: colors.textOnSurface }]}>Before you join{'\n'}the queue</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForegroundLight }]}>
          Please review and confirm the following for {fromCity ?? from} → {toCity ?? to}.
        </Text>

        {POLICY_ITEMS.map((item, i) => (
          <TouchableOpacity
            key={i}
            style={[styles.checkRow, { backgroundColor: colors.surface }]}
            onPress={() => setChecked((prev) => prev.map((c, j) => (j === i ? !c : c)))}
            activeOpacity={0.8}
          >
            <View style={[
              styles.checkbox,
              { borderColor: checked[i] ? colors.primary : colors.border, backgroundColor: checked[i] ? colors.primary : 'transparent' },
            ]}>
              {checked[i] && <Feather name="check" size={14} color={colors.primaryForeground} />}
            </View>
            <Text style={[styles.checkText, { color: colors.textOnSurface }]}>{item}</Text>
          </TouchableOpacity>
        ))}

        <TouchableOpacity
          style={[styles.punctualityCard, { backgroundColor: colors.surface, borderColor: punctualityChecked ? colors.primary : colors.border }]}
          onPress={() => setPunctualityChecked((v) => !v)}
          activeOpacity={0.8}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: punctualityChecked }}
        >
          <View style={styles.punctualityHeader}>
            <Feather name="clock" size={16} color={colors.primary} />
            <Text style={[styles.punctualityTitle, { color: colors.textOnSurface }]}>Punctuality</Text>
          </View>
          <View style={styles.punctualityRow}>
            <View style={[
              styles.checkbox,
              { borderColor: punctualityChecked ? colors.primary : colors.border, backgroundColor: punctualityChecked ? colors.primary : 'transparent' },
            ]}>
              {punctualityChecked && <Feather name="check" size={14} color={colors.primaryForeground} />}
            </View>
            <Text style={[styles.checkText, { color: colors.textOnSurface }]}>
              I understand the aircraft departs at the scheduled time. If I arrive late, the aircraft may leave without me and repeated late arrivals may affect my membership.
            </Text>
          </View>
        </TouchableOpacity>

        <Text style={[styles.legal, { color: colors.mutedForegroundLight }]}>
          By continuing, you acknowledge and accept these terms for this flight.
        </Text>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: bottomPad + 12 }]}>
        <PrimaryButton
          label="I Acknowledge — Continue"
          onPress={handleContinue}
          loading={joinMutation.isPending}
          disabled={ctaDisabled}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 22, paddingBottom: 24, gap: 12 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 26, lineHeight: 33, marginBottom: 2 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, marginBottom: 10 },
  checkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: 14, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2,
  },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  checkText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 13.5, lineHeight: 19 },
  punctualityCard: {
    borderRadius: 14, padding: 16, borderWidth: 1.5, gap: 12, marginTop: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2,
  },
  punctualityHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  punctualityTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  punctualityRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  legal: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17, marginTop: 6 },
  footer: { paddingHorizontal: 22, paddingTop: 12 },
});
