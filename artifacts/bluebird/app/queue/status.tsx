import React from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Platform, Alert,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useGetQueueStatus } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

export default function QueueStatusScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const { data: queueEntries, isLoading, refetch } = useGetQueueStatus({});

  const handleCancel = (entryId: string) => {
    Alert.alert('Cancel Queue Spot?', 'You will lose your position in the queue.', [
      { text: 'Keep Spot', style: 'cancel' },
      {
        text: 'Cancel Spot',
        style: 'destructive',
        onPress: async () => {
          try {
            await fetch(`/api/queue/${entryId}`, { method: 'DELETE' });
            queryClient.invalidateQueries({ queryKey: ['getQueueStatus'] });
          } catch {}
        },
      },
    ]);
  };

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const entries = (queueEntries as any[]) || [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {entries.length === 0 ? (
        <View style={styles.centered}>
          <Feather name="inbox" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
            No active queues
          </Text>
          <Text style={[styles.emptyBody, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Browse available flights and join a queue to see your status here.
          </Text>
          <TouchableOpacity
            style={[styles.browseBtn, { backgroundColor: colors.primary }]}
            onPress={() => router.replace('/(tabs)/discover')}
            activeOpacity={0.8}
          >
            <Text style={[styles.browseBtnText, { fontFamily: 'Inter_600SemiBold' }]}>Browse Flights</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.listContent, { paddingBottom: bottomPad + 24 }]}
          renderItem={({ item }) => {
            const flight = item.flight;
            return (
              <View style={[styles.queueCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                {/* Position badge */}
                <View style={styles.positionRow}>
                  <View style={[styles.positionBadge, { backgroundColor: colors.primary + '20', borderColor: colors.primary + '40' }]}>
                    <Text style={[styles.positionNum, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>
                      #{item.position}
                    </Text>
                    <Text style={[styles.positionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                      of {item.totalInQueue} in queue
                    </Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: '#10B98120' }]}>
                    <View style={[styles.statusDot, { backgroundColor: '#10B981' }]} />
                    <Text style={[styles.statusText, { color: '#10B981', fontFamily: 'Inter_500Medium' }]}>Active</Text>
                  </View>
                </View>

                {/* Flight info */}
                {flight && (
                  <View style={[styles.flightInfo, { borderTopColor: colors.border }]}>
                    <View style={styles.routeRow}>
                      <Text style={[styles.routeCode, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>{flight.fromAirport}</Text>
                      <Feather name="send" size={14} color={colors.primary} style={{ transform: [{ rotate: '-45deg' }] }} />
                      <Text style={[styles.routeCode, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>{flight.toAirport}</Text>
                    </View>
                    <Text style={[styles.flightMeta, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                      {flight.departureDate} · {flight.departureTime} · {flight.aircraftType}
                    </Text>
                  </View>
                )}

                {item.usedLinePass && (
                  <View style={[styles.passUsed, { backgroundColor: colors.primary + '15' }]}>
                    <Feather name="zap" size={12} color={colors.primary} />
                    <Text style={[styles.passUsedText, { color: colors.primary, fontFamily: 'Inter_400Regular' }]}>
                      Skip the Line pass used
                    </Text>
                  </View>
                )}

                <TouchableOpacity
                  style={[styles.cancelBtn, { borderColor: colors.border }]}
                  onPress={() => handleCancel(item.id)}
                >
                  <Text style={[styles.cancelBtnText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                    Leave queue
                  </Text>
                </TouchableOpacity>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 14 },
  emptyTitle: { fontSize: 20 },
  emptyBody: { fontSize: 14, lineHeight: 22, textAlign: 'center' },
  browseBtn: { paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12 },
  browseBtnText: { color: '#fff', fontSize: 15 },
  listContent: { padding: 16, gap: 14 },
  queueCard: { borderRadius: 16, borderWidth: 1, overflow: 'hidden', padding: 16, gap: 14 },
  positionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  positionBadge: { flexDirection: 'row', alignItems: 'baseline', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
  positionNum: { fontSize: 22 },
  positionLabel: { fontSize: 12 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 12 },
  flightInfo: { borderTopWidth: 1, paddingTop: 14, gap: 6 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  routeCode: { fontSize: 20 },
  flightMeta: { fontSize: 13 },
  passUsed: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  passUsedText: { fontSize: 12 },
  cancelBtn: { height: 40, borderWidth: 1, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  cancelBtnText: { fontSize: 14 },
});
