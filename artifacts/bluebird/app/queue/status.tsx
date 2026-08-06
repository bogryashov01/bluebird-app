import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform, Alert,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import type { QueueEntry } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import colors from '@/constants/colors';
import { useGetQueueStatus, useCancelQueueEntry, useConfirmQueueEntry } from '@workspace/api-client-react';

// Colours used in static StyleSheets (light surface — same as offWhite palette)
import { useAuth } from '@/context/AuthContext';
const BG      = colors.light.offWhite;       // '#FAFAF8'
const DARK    = colors.light.backgroundMid;  // '#0A1128'
const MUTED   = colors.light.mutedForegroundLight; // 'rgba(10,17,40,0.45)'
const BLUE    = colors.light.primary;        // '#1259F2'
const SUCCESS = colors.light.success;        // '#1E9E5C'

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
      if (diff <= 0) { setRemaining('Imminent'); return; }
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

// ─── SVG ring ─────────────────────────────────────────────────────────────────
const CIRC = 251;

function RingProgress({ position, total }: { position: number; total: number }) {
  const progress   = total > 1 ? (total - position) / (total - 1) : 1;
  const dashoffset = CIRC * (1 - progress);
  return (
    <View style={ring.wrap}>
      <Svg width={170} height={170} viewBox="0 0 90 90">
        <Circle cx="45" cy="45" r="40" fill="none" stroke="rgba(10,17,40,0.08)" strokeWidth="8" />
        <Circle
          cx="45" cy="45" r="40"
          fill="none"
          stroke={BLUE}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={dashoffset}
          transform="rotate(-90, 45, 45)"
        />
      </Svg>
      <View style={ring.inner}>
        <Text style={ring.num}>
          {position}<Text style={ring.total}>/{total}</Text>
        </Text>
        <Text style={ring.label}>POSITION</Text>
      </View>
    </View>
  );
}

const ring = StyleSheet.create({
  wrap:  { width: 170, height: 170, position: 'relative', alignItems: 'center', justifyContent: 'center' },
  inner: { position: 'absolute', alignItems: 'center' },
  num:   { fontFamily: 'Inter_700Bold', fontSize: 34, color: DARK, lineHeight: 40 },
  total: { fontFamily: 'Inter_400Regular', fontSize: 18, color: MUTED },
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: MUTED, letterSpacing: 0.5, textTransform: 'uppercase' },
});

// ─── Waiting queue entry card ─────────────────────────────────────────────────
function QueueCard({
  entry,
  onCancel,
  onConfirm,
  isConfirming,
}: {
  entry: QueueEntry;
  onCancel: () => void;
  onConfirm?: () => void;
  isConfirming?: boolean;
}) {
  const flight    = entry.flight;
  const countdown = useCountdown(flight?.departureDate, flight?.departureTime);
  const joinedAgo = formatAgo(entry.createdAt);
  const flightLabel = flight ? `${flight.fromAirport} → ${flight.toAirport}` : '— → —';
  const canConfirm = (entry as any).canConfirm === true;

  return (
    <View style={card.wrap}>
      <Text style={card.route}>{flightLabel}</Text>
      <RingProgress position={entry.position} total={entry.totalInQueue} />

      {flight && <Text style={card.countdown}>Decision in {countdown}</Text>}

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

      <View style={card.disclaimer}>
        <Text style={card.disclaimerText}>
          {canConfirm
            ? "You're first in line — confirm now to secure your seat before someone else takes your spot."
            : 'Flights may be modified or cancelled due to operational requirements.'}
        </Text>
      </View>

      {/* Primary action: confirm if eligible, otherwise offer Skip the Line */}
      {canConfirm && onConfirm ? (
        <TouchableOpacity
          style={[card.confirmBtn, isConfirming && { opacity: 0.6 }]}
          onPress={onConfirm}
          disabled={isConfirming}
          activeOpacity={0.85}
        >
          {isConfirming
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={card.confirmBtnText}>✓  Confirm your seat</Text>
          }
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={card.primaryBtn}
          onPress={() => router.push('/(tabs)/membership')}
          activeOpacity={0.85}
        >
          <Text style={card.primaryBtnText}>Use Skip the Line Pass</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={card.ghostBtn} onPress={() => router.push('/concierge')} activeOpacity={0.7}>
        <Text style={card.ghostBtnText}>Ask AI Concierge</Text>
      </TouchableOpacity>

      <TouchableOpacity style={card.leaveBtn} onPress={onCancel} activeOpacity={0.7}>
        <Text style={card.leaveBtnText}>Leave queue</Text>
      </TouchableOpacity>
    </View>
  );
}

function ConfirmedCard({ entry }: { entry: QueueEntry }) {
  const flight = entry.flight;
  const flightLabel = flight
    ? `${flight.fromAirport} → ${flight.toAirport}`
    : '— → —';

  return (
    <View style={[card.wrap, confirmed.wrap]}>
      {/* Confirmed badge */}
      <View style={confirmed.badge}>
        <Text style={confirmed.badgeText}>✓  CONFIRMED</Text>
      </View>

      <Text style={card.route}>{flightLabel}</Text>

      {flight && (
        <View style={card.section}>
          <View style={card.statusRow}>
            <Text style={card.sectionTitle}>Flight Status</Text>
            <View style={card.statusBadge}>
              <View style={card.statusDot} />
              <Text style={card.statusText}>
                {flight.status === 'available' ? 'Open' : flight.status ?? 'Active'}
              </Text>
            </View>
          </View>
          <View style={card.logRow}>
            <Text style={card.logText}>Departure</Text>
            <Text style={card.logTime}>{flight.departureDate} · {flight.departureTime}</Text>
          </View>
          <View style={card.logRow}>
            <Text style={card.logText}>Route</Text>
            <Text style={card.logTime}>{flight.fromCity} → {flight.toCity}</Text>
          </View>
        </View>
      )}

      <TouchableOpacity
        style={[card.primaryBtn, confirmed.tripsBtn]}
        onPress={() => router.push('/(tabs)/trips')}
        activeOpacity={0.85}
      >
        <Text style={card.primaryBtnText}>View in My Trips</Text>
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

const confirmed = StyleSheet.create({
  wrap: {
    borderWidth: 1.5,
    borderColor: 'rgba(30,158,92,0.30)',
  },
  badge: {
    backgroundColor: 'rgba(30,158,92,0.12)',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 6,
    alignSelf: 'center',
  },
  badgeText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    color: '#1E9E5C',
    letterSpacing: 0.5,
  },
  tripsBtn: {
    backgroundColor: '#0A1128',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    shadowOpacity: 0.20,
    elevation: 4,
  },
});
const card = StyleSheet.create({
  wrap: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 24,
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
    color: DARK,
    letterSpacing: -0.4,
    alignSelf: 'center',
  },
  countdown: { fontFamily: 'Inter_700Bold', fontSize: 15, color: BLUE },
  section: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 16,
    shadowOpacity: 0.05,
    elevation: 2,
  },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 13, color: DARK },
  logRow:  { flexDirection: 'row', justifyContent: 'space-between' },
  logText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: 'rgba(10,17,40,0.55)' },
  logTime: { fontFamily: 'Inter_400Regular', fontSize: 13, color: MUTED },
  statusRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot:   { width: 7, height: 7, borderRadius: 3.5, backgroundColor: SUCCESS },
  statusText:  { fontFamily: 'Inter_700Bold', fontSize: 13, color: SUCCESS },
  disclaimer: {
    width: '100%',
    backgroundColor: `${BLUE}0D`,
    borderRadius: 14,
    padding: 14,
  },
  disclaimerText: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, color: DARK },
  primaryBtn: {
    width: '100%',
    backgroundColor: BLUE,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: BLUE,
    shadowOffset: { width: 0, height: 14 },
    shadowRadius: 26,
    shadowOpacity: 0.32,
    elevation: 6,
  },
  primaryBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: '#fff' },
  confirmBtn: {
    width: '100%',
    backgroundColor: SUCCESS,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: SUCCESS,
    shadowOffset: { width: 0, height: 14 },
    shadowRadius: 26,
    shadowOpacity: 0.32,
    elevation: 6,
  },
  confirmBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: '#fff' },
  ghostBtn: { paddingVertical: 4 },
  ghostBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: MUTED, textAlign: 'center' },
  leaveBtn: {
    borderWidth: 1,
    borderColor: 'rgba(10,17,40,0.15)',
    borderRadius: 999,
    width: '100%',
    paddingVertical: 13,
    alignItems: 'center',
  },
  leaveBtnText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: MUTED },
});

// ─── Screen ──────────────────────────────────────────────────────────────────
export default function QueueStatusScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const topPad    = Platform.OS === 'web' ? 60 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const { user } = useAuth();

  // API now returns waiting + confirmed; we render each group separately
  const { data: queueEntries, isLoading } = useGetQueueStatus({
    query: { enabled: !!user },
  });
  const allEntries = (queueEntries as QueueEntry[]) ?? [];
  const waitingEntries = allEntries.filter((e) => e.status === 'waiting');
  const confirmedEntries = allEntries.filter((e) => e.status === 'confirmed');
  const hasAny = allEntries.length > 0;

  const cancelMutation = useCancelQueueEntry({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/queue/status'] }),
      onError: (err: any) => {
        Alert.alert('Error', err?.data?.error || err?.message || 'Failed to leave queue');
      },
    },
  });

  const confirmMutation = useConfirmQueueEntry({
    mutation: {
      onError: (err: any) => {
        Alert.alert('Could not confirm', err?.data?.error || err?.message || 'Failed to confirm seat');
      },
    },
  });

  const handleCancel = (entryId: string) => {
    Alert.alert('Leave Queue?', 'You will lose your position in the queue.', [
      { text: 'Keep Spot', style: 'cancel' },
      { text: 'Leave Queue', style: 'destructive', onPress: () => cancelMutation.mutate({ id: entryId }) },
    ]);
  };

  const handleConfirm = (entryId: string, flightId: string) => {
    Alert.alert('Confirm your seat?', 'This will reserve your spot on this flight.', [
      { text: 'Not yet', style: 'cancel' },
      {
        text: 'Confirm', style: 'default',
        onPress: () =>
          confirmMutation.mutate(
            { id: entryId },
            {
              onSuccess: () => {
                queryClient.invalidateQueries({ queryKey: ['/api/queue/status'] });
                queryClient.invalidateQueries({ queryKey: ['/api/trips'] });
                queryClient.invalidateQueries({ queryKey: [`/api/flights/${flightId}/my-status`] });
              },
            },
          ),
      },
    ]);
  };

  const backTop = topPad + 14;

  return (
    <View style={styles.container}>
      <TouchableOpacity style={[styles.backBtn, { top: backTop }]} onPress={() => router.back()} activeOpacity={0.7}>
        <Text style={styles.backChevron}>‹</Text>
      </TouchableOpacity>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={BLUE} size="large" />
        </View>
      ) : !hasAny ? (
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
          contentContainerStyle={[styles.scrollContent, { paddingTop: topPad + 80, paddingBottom: bottomPad + 24 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Confirmed entries appear first — most actionable */}
          {confirmedEntries.map((entry) => (
            <ConfirmedCard key={entry.id} entry={entry} />
          ))}
          {/* Waiting entries */}
          {waitingEntries.map((entry) => (
            <QueueCard
              key={entry.id}
              entry={entry}
              onCancel={() => handleCancel(entry.id)}
              onConfirm={() => handleConfirm(entry.id, entry.flightId)}
              isConfirming={confirmMutation.isPending}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  backBtn: {
    position: 'absolute', zIndex: 10, left: 18,
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(10,17,40,0.06)',
    alignItems: 'center', justifyContent: 'center',
  },
  backChevron: { fontSize: 24, color: DARK, lineHeight: 28, marginLeft: -2 },
  scrollContent: { paddingHorizontal: 22, alignItems: 'center' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  emptyTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 20, color: DARK },
  emptyBody:  { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 22, color: MUTED, textAlign: 'center' },
  browseBtn: {
    marginTop: 6,
    backgroundColor: BLUE,
    paddingHorizontal: 24, paddingVertical: 14, borderRadius: 999,
  },
  browseBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: '#fff' },
});
