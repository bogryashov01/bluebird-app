import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform, Alert,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
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
          router.replace({ pathname: '/flight/confirmed', params });
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

  const allChecked = checked.every(Boolean);
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
      <TouchableOpacity
        style={[styles.backBtn, { top: topPad + 14, backgroundColor: colors.muted }]}
        onPress={() => router.back()}
        activeOpacity={0.75}
      >
        <Text style={[styles.backChevron, { color: colors.textOnSurface }]}>‹</Text>
      </TouchableOpacity>

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

        <Text style={[styles.legal, { color: colors.mutedForegroundLight }]}>
          By continuing, you acknowledge and accept these terms for this flight.
        </Text>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: bottomPad + 12 }]}>
        <TouchableOpacity
          style={[styles.cta, { backgroundColor: colors.primary }, ctaDisabled && { opacity: 0.45 }]}
          onPress={handleContinue}
          disabled={ctaDisabled}
          accessibilityState={{ disabled: ctaDisabled }}
          activeOpacity={0.85}
        >
          {joinMutation.isPending
            ? <ActivityIndicator color={colors.primaryForeground} />
            : <Text style={[styles.ctaText, { color: colors.primaryForeground }]}>I Acknowledge — Continue</Text>}
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
  legal: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17, marginTop: 6 },
  footer: { paddingHorizontal: 22, paddingTop: 12 },
  cta: { borderRadius: 999, paddingVertical: 17, alignItems: 'center' },
  ctaText: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
});
