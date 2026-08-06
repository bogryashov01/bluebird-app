import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Switch, Platform, Alert,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useJoinQueue } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import * as Haptics from 'expo-haptics';

export default function JoinQueueScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { flightId, fromCity, toCity, from, to, useLinePass: useLinePassParam } = useLocalSearchParams<{
    flightId: string; fromCity: string; toCity: string;
    from: string; to: string; useLinePass?: string;
  }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [useLinePass, setUseLinePass] = useState(useLinePassParam === '1');

  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const { updateUser } = useAuth();

  const joinMutation = useJoinQueue({
    mutation: {
      onSuccess: async () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        queryClient.invalidateQueries({ queryKey: ['getQueueStatus'] });
        // Sync line pass count in the cached auth user immediately so UI stays accurate
        if (useLinePass && user) {
          updateUser({ ...user, linePassCount: Math.max(0, (user.linePassCount ?? 0) - 1) });
        }
        router.replace('/queue/status');
      },
      onError: (err: any) => {
        const msg = err?.response?.data?.error || 'Failed to join queue';
        Alert.alert('Error', msg);
      },
    },
  });

  const handleJoin = () => {
    if (!flightId) return;
    joinMutation.mutate({ data: { flightId, useLinePass } });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        {/* Flight summary */}
        <View style={[styles.flightCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.routeRow}>
            <View style={styles.airportBlock}>
              <Text style={[styles.airportCode, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>{from}</Text>
              <Text style={[styles.cityName, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{fromCity}</Text>
            </View>
            <Feather name="send" size={20} color={colors.primary} style={{ transform: [{ rotate: '-45deg' }] }} />
            <View style={[styles.airportBlock, { alignItems: 'flex-end' }]}>
              <Text style={[styles.airportCode, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>{to}</Text>
              <Text style={[styles.cityName, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{toCity}</Text>
            </View>
          </View>
        </View>

        {/* Queue info */}
        <View style={styles.infoBlock}>
          <Feather name="info" size={16} color={colors.primary} />
          <Text style={[styles.infoText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            You'll be notified when a seat becomes available. You have 30 minutes to accept.
          </Text>
        </View>

        {/* Skip the line toggle */}
        {user && user.linePassCount > 0 && (
          <View style={[styles.skipToggleCard, { backgroundColor: colors.card, borderColor: colors.primary + '60' }]}>
            <View style={styles.skipToggleLeft}>
              <Feather name="zap" size={20} color={colors.primary} />
              <View>
                <Text style={[styles.skipToggleTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                  Skip the Line
                </Text>
                <Text style={[styles.skipToggleSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                  Use 1 pass ({user.linePassCount} remaining)
                </Text>
              </View>
            </View>
            <Switch
              value={useLinePass}
              onValueChange={setUseLinePass}
              trackColor={{ true: colors.primary, false: colors.border }}
              thumbColor="#fff"
            />
          </View>
        )}

        {useLinePass && (
          <View style={[styles.passAlert, { backgroundColor: colors.success + '15', borderColor: colors.success + '40' }]}>
            <Feather name="zap" size={14} color={colors.success} />
            <Text style={[styles.passAlertText, { color: colors.success, fontFamily: 'Inter_500Medium' }]}>
              You'll be placed at the front of the queue
            </Text>
          </View>
        )}
      </View>

      {/* CTA */}
      <View style={[styles.footer, { borderTopColor: colors.border, paddingBottom: bottomPad + 12 }]}>
        <TouchableOpacity
          style={[styles.confirmBtn, { backgroundColor: colors.primary }, joinMutation.isPending && { opacity: 0.7 }]}
          onPress={handleJoin}
          disabled={joinMutation.isPending}
          activeOpacity={0.8}
        >
          {joinMutation.isPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Text style={[styles.confirmBtnText, { fontFamily: 'Inter_600SemiBold' }]}>
                {useLinePass ? 'Skip the Line & Join' : 'Join the Queue'}
              </Text>
              <Feather name="arrow-right" size={18} color="#fff" />
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancelBtn} onPress={() => router.back()}>
          <Text style={[styles.cancelBtnText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, padding: 20, gap: 16 },
  flightCard: { borderRadius: 16, borderWidth: 1, padding: 20 },
  routeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  airportBlock: { flex: 1 },
  airportCode: { fontSize: 28 },
  cityName: { fontSize: 13, marginTop: 2 },
  infoBlock: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  infoText: { flex: 1, fontSize: 14, lineHeight: 20 },
  skipToggleCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, borderRadius: 14, borderWidth: 1,
  },
  skipToggleLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  skipToggleTitle: { fontSize: 15 },
  skipToggleSub: { fontSize: 12, marginTop: 2 },
  passAlert: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 12, borderRadius: 10, borderWidth: 1,
  },
  passAlertText: { fontSize: 13 },
  footer: { padding: 16, gap: 10, borderTopWidth: 1 },
  confirmBtn: {
    height: 56, borderRadius: 14,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8,
  },
  confirmBtnText: { color: '#fff', fontSize: 16 },
  cancelBtn: { height: 44, justifyContent: 'center', alignItems: 'center' },
  cancelBtnText: { fontSize: 14 },
});
