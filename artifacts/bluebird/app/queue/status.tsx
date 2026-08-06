import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform, Alert,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { useGetQueueStatus, useCancelQueueEntry } from '@workspace/api-client-react';
import type { QueueEntry } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

// ─── Countdown hook ───────────────────────────────────────────────────────────
function useCountdown(departureDate?: string, departureTime?: string): string {
  const [remaining, setRemaining] = useState('--:--:--');

  useEffect(() => {
    if (!departureDate || !departureTime) return;

    const compute = () => {
      const [h, m] = departureTime.split(':').map(Number);
      const [y, mo, d] = departureDate.split('-').map(Number);
      const target = new Date(y, mo - 1, d, h, m, 0).getTime();
      const diff = target - Date.now();
      if (diff <= 0) {
        setRemaining('Imminent');
        return;
      }
      const hours = Math.floor(diff / 3600000);
      const mins  = Math.floor((diff % 3600000) / 60000);
      const secs  = Math.floor((diff % 60000) / 1000);
      setRemaining(
        `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      );
    };

    compute();
    const id = setInterval(compute, 1000);
    return () => clearInterval(id);
  }, [departureDate, departureTime]);

  return remaining;
}

// ─── SVG ring constants ───────────────────────────────────────────────────────
const CIRC = 251; // 2π × 40, the circumference used in the prototype

function RingProgress({ position, total }: { position: number; total: number }) {
  // How far you are toward the front: position 1/N = almost full ring
  const progress = total > 1 ? (total - position) / (total - 1) : 1;
  const dashoffset = CIRC * (1 - progress);

  return (
    <View style={ring.wrap}>
      <Svg width={170} height={170} viewBox="0 0 90 90">
        {/* Track */}
        <Circle cx="45" cy="45" r="40" fill="none" stroke="rgba(10,17,40,0.08)" strokeWidth="8" />
        {/* Fill */}
        <Circle
          cx="45" cy="45" r="40"
          fill="none"
          stroke="#1259F2"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={dashoffset}
          transform="rotate(-90, 45, 45)"
        />
      </Svg>
      <View style={ring.inner}>
        <Text style={ring.num}>
          {position}
          <Text style={ring.total}>/{total}</Text>
        </Text>
        <Text style={ring.label}>POSITION</Text>
      </View>
    </View>
  );
}

const ring = StyleSheet.create({
  wrap: { width: 170, height: 170, position: 'relative', alignItems: 'center', justifyContent: 'center' },
  inner: { position: 'absolute', alignItems: 'center' },
  num: { fontFamily: 'Inter_700Bold', fontSize: 34, color: '#0A1128', lineHeight: 40 },
  total: { fontFamily: 'Inter_400Regular', fontSize: 18, color: 'rgba(10,17,40,0.4)' },
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: 'rgba(10,17,40,0.45)', letterSpacing: 0.4 },
});

// ─── Single queue entry card ──────────────────────────────────────────────────
function QueueCard({ entry, onCancel }: { entry: QueueEntry; onCancel: () => void }) {
  const flight = entry.flight;
  const countdown = useCountdown(flight?.departureDate, flight?.departureTime);
  const joinedAgo = formatAgo(entry.createdAt);

  const flightLabel = flight
    ? `${flight.fromAirport} → ${flight.toAirport}`
    : '— → —';

  return (
    <View style={card.wrap}>
      {/* Route */}
      <Text style={card.route}>{flightLabel}</Text>

      {/* Ring */}
      <RingProgress position={entry.position} total={entry.totalInQueue} />

      {/* Countdown */}
      {flight && (
        <Text style={card.countdown}>Decision in {countdown}</Text>
      )}

      {/* Queue movement log */}
      <View style={card.section}>
        <Text style={card.sectionTitle}>Queue Activity</Text>
        <View style={card.logRow}>
          <Text style={card.logText}>Currently #{entry.position} of {entry.totalInQueue}</Text>
          <Text style={card.logTime}>now</Text>
        </View>
        <View style={card.logRow}>
          <Text style={card.logText}>Joined queue</Text>
          <Text style={card.logTime}>{joinedAgo}</Text>
        </View>
      </View>

      {/* Flight status */}
      <View style={card.section}>
        <View style={card.statusRow}>
          <Text style={card.sectionTitle}>Flight Status</Text>
          <View style={card.statusBadge}>
            <View style={card.statusDot} />
            <Text style={card.statusText}>
              {flight?.status === 'available' ? 'Open' : flight?.status ?? 'Active'}
            </Text>
          </View>
        </View>
      </View>

      {/* Disclaimer */}
      <View style={card.disclaimer}>
        <Text style={card.disclaimerText}>
          Flights may be modified or cancelled due to operational requirements.
        </Text>
      </View>

      {/* CTAs */}
      <TouchableOpacity
        style={card.primaryBtn}
        onPress={() => router.push('/(tabs)/membership')}
        activeOpacity={0.85}
      >
        <Text style={card.primaryBtnText}>Use Skip the Line Pass</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={card.ghostBtn}
        onPress={() => router.push('/concierge')}
        activeOpacity={0.7}
      >
        <Text style={card.ghostBtnText}>Ask AI Concierge</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={card.leaveBtn}
        onPress={onCancel}
        activeOpacity={0.7}
      >
        <Text style={card.leaveBtnText}>Leave queue</Text>
      </TouchableOpacity>
    </View>
  );
}

function formatAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const card = StyleSheet.create({
  wrap: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 22,
    padding: 22,
    alignItems: 'center',
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 24,
    shadowOpacity: 0.06,
    elevation: 4,
    marginBottom: 20,
  },
  route: {
    fontFamily: 'Inter_700Bold',
    fontSize: 22,
    color: '#0A1128',
    letterSpacing: -0.4,
    alignSelf: 'center',
  },
  countdown: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    color: '#1259F2',
  },
  section: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 24,
    shadowOpacity: 0.06,
    elevation: 3,
  },
  sectionTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    color: '#0A1128',
  },
  logRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  logText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: 'rgba(10,17,40,0.55)',
  },
  logTime: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: 'rgba(10,17,40,0.4)',
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 7, height: 7, borderRadius: 3.5,
    backgroundColor: '#1E9E5C',
  },
  statusText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    color: '#1E9E5C',
  },
  disclaimer: {
    width: '100%',
    backgroundColor: 'rgba(18,89,242,0.06)',
    borderRadius: 16,
    padding: 14,
  },
  disclaimerText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
    color: '#0A1128',
  },
  primaryBtn: {
    width: '100%',
    backgroundColor: '#1259F2',
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: '#1259F2',
    shadowOffset: { width: 0, height: 14 },
    shadowRadius: 26,
    shadowOpacity: 0.32,
    elevation: 6,
  },
  primaryBtnText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    color: '#fff',
  },
  ghostBtn: {
    paddingVertical: 4,
  },
  ghostBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    color: 'rgba(10,17,40,0.55)',
    textAlign: 'center',
  },
  leaveBtn: {
    borderWidth: 1,
    borderColor: 'rgba(10,17,40,0.15)',
    borderRadius: 12,
    width: '100%',
    paddingVertical: 12,
    alignItems: 'center',
  },
  leaveBtnText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: 'rgba(10,17,40,0.5)',
  },
});

// ─── Screen ──────────────────────────────────────────────────────────────────
export default function QueueStatusScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const topPad = Platform.OS === 'web' ? 60 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const { data: queueEntries, isLoading } = useGetQueueStatus({});
  const entries = ((queueEntries as QueueEntry[]) ?? []).filter((e) => e.status === 'waiting');

  const cancelMutation = useCancelQueueEntry({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['/api/queue/status'] });
      },
      onError: (err: any) => {
        const msg = err?.data?.error || err?.message || 'Failed to leave queue';
        Alert.alert('Error', msg);
      },
    },
  });

  const handleCancel = (entryId: string) => {
    Alert.alert('Leave Queue?', 'You will lose your position in the queue.', [
      { text: 'Keep Spot', style: 'cancel' },
      {
        text: 'Leave Queue', style: 'destructive',
        onPress: () => cancelMutation.mutate({ id: entryId }),
      },
    ]);
  };

  // Back button sits below the status bar; absolute so it floats over content
  const backTop = topPad + 14;

  return (
    <View style={styles.container}>
      {/* Back button */}
      <TouchableOpacity
        style={[styles.backBtn, { top: backTop }]}
        onPress={() => router.back()}
        activeOpacity={0.7}
      >
        <Text style={styles.backChevron}>‹</Text>
      </TouchableOpacity>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#1259F2" size="large" />
        </View>
      ) : entries.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No active queues</Text>
          <Text style={styles.emptyBody}>
            Browse available flights and join a queue to see your status here.
          </Text>
          <TouchableOpacity
            style={styles.browseBtn}
            onPress={() => router.replace('/(tabs)/discover')}
            activeOpacity={0.8}
          >
            <Text style={styles.browseBtnText}>Browse Flights</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: topPad + 80, paddingBottom: bottomPad + 24 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {entries.map((entry) => (
            <QueueCard key={entry.id} entry={entry} onCancel={() => handleCancel(entry.id)} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAF8' },
  backBtn: {
    position: 'absolute',
    zIndex: 10,
    left: 18,
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(10,17,40,0.06)',
    alignItems: 'center', justifyContent: 'center',
  },
  backChevron: {
    fontSize: 24,
    color: '#0A1128',
    lineHeight: 28,
    marginLeft: -2,
  },
  scrollContent: {
    paddingTop: 100,
    paddingHorizontal: 22,
    alignItems: 'center',
  },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 32, gap: 12,
  },
  emptyTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 20,
    color: '#0A1128',
  },
  emptyBody: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 22,
    color: 'rgba(10,17,40,0.55)',
    textAlign: 'center',
  },
  browseBtn: {
    marginTop: 6,
    backgroundColor: '#1259F2',
    paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12,
  },
  browseBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: '#fff',
  },
});
