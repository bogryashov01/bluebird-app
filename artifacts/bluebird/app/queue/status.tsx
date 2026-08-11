import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform, Alert, useWindowDimensions,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import type { QueueEntry } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { confirmDialog } from '@/lib/confirmDialog';
import { useGetQueueStatus, useCancelQueueEntry, useConfirmQueueEntry } from '@workspace/api-client-react';

import { useAuth } from '@/context/AuthContext';

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
  const colors = useColors();
  const { width: windowWidth } = useWindowDimensions();
  // Card padding (22*2) + screen padding (22*2) leaves ~windowWidth-88; cap at 170
  const ringSize = Math.round(Math.min(170, Math.max(120, windowWidth - 200)));
  const progress   = total > 1 ? (total - position) / (total - 1) : 1;
  const dashoffset = CIRC * (1 - progress);
  return (
    <View style={[ring.wrap, { width: ringSize, height: ringSize }]}>
      <Svg width={ringSize} height={ringSize} viewBox="0 0 90 90">
        <Circle cx="45" cy="45" r="40" fill="none" stroke={colors.separator} strokeWidth="8" />
        <Circle
          cx="45" cy="45" r="40"
          fill="none"
          stroke={colors.primary}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={dashoffset}
          transform="rotate(-90, 45, 45)"
        />
      </Svg>
      <View style={ring.inner}>
        <Text style={[ring.num, { color: colors.textOnSurface }]}>
          {position}<Text style={[ring.total, { color: colors.mutedForegroundLight }]}>/{total}</Text>
        </Text>
        <Text style={[ring.label, { color: colors.mutedForegroundLight }]}>POSITION</Text>
      </View>
    </View>
  );
}

const ring = StyleSheet.create({
  wrap:  { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  inner: { position: 'absolute', alignItems: 'center' },
  num:   { fontFamily: 'Inter_700Bold', fontSize: 34, lineHeight: 40 },
  total: { fontFamily: 'Inter_400Regular', fontSize: 18 },
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase' },
});

// ─── Waiting queue entry card ─────────────────────────────────────────────────
function QueueCard({
  entry,
  onCancel,
  onConfirm,
  isConfirming,
  onUsePass,
  isUsingPass,
  passCount,
}: {
  entry: QueueEntry;
  onCancel: () => void;
  onConfirm?: () => void;
  isConfirming?: boolean;
  onUsePass?: () => void;
  isUsingPass?: boolean;
  passCount?: number;
}) {
  const colors = useColors();
  const flight    = entry.flight;
  const countdown = useCountdown(flight?.departureDate, flight?.departureTime);
  const joinedAgo = formatAgo(entry.createdAt);
  const flightLabel = flight ? `${flight.fromAirport} → ${flight.toAirport}` : '— → —';
  const canConfirm = (entry as any).canConfirm === true;

  return (
    <View style={[card.wrap, { backgroundColor: colors.surface }]}>
      <Text style={[card.route, { color: colors.textOnSurface }]}>{flightLabel}</Text>
      <RingProgress position={entry.position} total={entry.totalInQueue} />

      {flight && <Text style={[card.countdown, { color: colors.primary }]}>Decision in {countdown}</Text>}

      <View style={[card.section, { backgroundColor: colors.surface }]}>
        <Text style={[card.sectionTitle, { color: colors.textOnSurface }]}>Queue Movement</Text>
        <View style={card.logRow}>
          <Text style={[card.logText, { color: colors.mutedForegroundLight }]}>Currently #{entry.position} of {entry.totalInQueue}</Text>
          <Text style={[card.logTime, { color: colors.mutedForegroundLight }]}>now</Text>
        </View>
        <View style={card.logRow}>
          <Text style={[card.logText, { color: colors.mutedForegroundLight }]}>Joined queue</Text>
          <Text style={[card.logTime, { color: colors.mutedForegroundLight }]}>{joinedAgo}</Text>
        </View>
      </View>

      <View style={[card.section, { backgroundColor: colors.surface }]}>
        <View style={card.statusRow}>
          <Text style={[card.sectionTitle, { color: colors.textOnSurface }]}>Flight Status</Text>
          <View style={card.statusBadge}>
            <View style={[card.statusDot, { backgroundColor: colors.success }]} />
            <Text style={[card.statusText, { color: colors.success }]}>
              {flight?.status === 'available' ? 'Open' : flight?.status ?? 'Active'}
            </Text>
          </View>
        </View>
      </View>

      <View style={[card.disclaimer, { backgroundColor: colors.primary + '0D' }]}>
        <Text style={[card.disclaimerText, { color: colors.textOnSurface }]}>
          {canConfirm
            ? "You're first in line — confirm now to secure your seat before someone else takes your spot."
            : 'Flights may be modified or cancelled due to operational requirements.'}
        </Text>
      </View>

      {/* Primary action: confirm if eligible, otherwise link to the flight */}
      {canConfirm && onConfirm ? (
        <TouchableOpacity
          style={[card.confirmBtn, { backgroundColor: colors.success, shadowColor: colors.success }, isConfirming && { opacity: 0.6 }]}
          onPress={onConfirm}
          disabled={isConfirming}
          activeOpacity={0.85}
        >
          {isConfirming
            ? <ActivityIndicator color={colors.successForeground} size="small" />
            : <Text style={[card.confirmBtnText, { color: colors.successForeground }]}>✓  Confirm your seat</Text>
          }
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[card.primaryBtn, { backgroundColor: colors.primary, shadowColor: colors.primary }]}
          onPress={() => router.push(`/flight/${entry.flightId}`)}
          activeOpacity={0.85}
        >
          <Text style={[card.primaryBtnText, { color: colors.primaryForeground }]}>View Flight Details</Text>
        </TouchableOpacity>
      )}

      {/* Skip the Line pass — offered when the member holds passes and is not already #1 */}
      {onUsePass && (
        <TouchableOpacity
          style={[card.passBtn, { borderColor: colors.primary }, isUsingPass && { opacity: 0.6 }]}
          onPress={onUsePass}
          disabled={isUsingPass}
          activeOpacity={0.85}
        >
          <Text style={[card.passBtnText, { color: colors.primary }]}>
            ⚡ Use Skip the Line Pass{typeof passCount === 'number' ? ` (${passCount} left)` : ''}
          </Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={card.ghostBtn} onPress={() => router.push('/concierge')} activeOpacity={0.7}>
        <Text style={[card.ghostBtnText, { color: colors.mutedForegroundLight }]}>Ask AI Concierge</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[card.leaveBtn, { borderColor: colors.border }]} onPress={onCancel} activeOpacity={0.7}>
        <Text style={[card.leaveBtnText, { color: colors.mutedForegroundLight }]}>Leave queue</Text>
      </TouchableOpacity>
    </View>
  );
}

function ConfirmedCard({ entry }: { entry: QueueEntry }) {
  const colors = useColors();
  const flight = entry.flight;
  const flightLabel = flight
    ? `${flight.fromAirport} → ${flight.toAirport}`
    : '— → —';

  return (
    <View style={[card.wrap, confirmed.wrap, { backgroundColor: colors.surface, borderColor: colors.success + '4D' }]}>
      {/* Confirmed badge */}
      <View style={[confirmed.badge, { backgroundColor: colors.success + '1F' }]}>
        <Text style={[confirmed.badgeText, { color: colors.success }]}>✓  CONFIRMED</Text>
      </View>

      <Text style={[card.route, { color: colors.textOnSurface }]}>{flightLabel}</Text>

      {flight && (
        <View style={[card.section, { backgroundColor: colors.surface }]}>
          <View style={card.statusRow}>
            <Text style={[card.sectionTitle, { color: colors.textOnSurface }]}>Flight Status</Text>
            <View style={card.statusBadge}>
              <View style={[card.statusDot, { backgroundColor: colors.success }]} />
              <Text style={[card.statusText, { color: colors.success }]}>
                {flight.status === 'available' ? 'Open' : flight.status ?? 'Active'}
              </Text>
            </View>
          </View>
          <View style={card.logRow}>
            <Text style={[card.logText, { color: colors.mutedForegroundLight }]}>Departure</Text>
            <Text style={[card.logTime, { color: colors.mutedForegroundLight }]}>{flight.departureDate} · {flight.departureTime}</Text>
          </View>
          <View style={card.logRow}>
            <Text style={[card.logText, { color: colors.mutedForegroundLight }]}>Route</Text>
            <Text style={[card.logTime, { color: colors.mutedForegroundLight }]}>{flight.fromCity} → {flight.toCity}</Text>
          </View>
        </View>
      )}

      <TouchableOpacity
        style={[card.primaryBtn, confirmed.tripsBtn, { backgroundColor: colors.backgroundMid }]}
        onPress={() => router.push('/(tabs)/trips')}
        activeOpacity={0.85}
      >
        <Text style={[card.primaryBtnText, { color: colors.primaryForeground }]}>View in My Trips</Text>
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
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 6,
    alignSelf: 'center',
  },
  badgeText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    letterSpacing: 0.5,
  },
  tripsBtn: {
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
    letterSpacing: -0.4,
    alignSelf: 'center',
  },
  countdown: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  section: {
    width: '100%',
    borderRadius: 18,
    padding: 16,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 16,
    shadowOpacity: 0.05,
    elevation: 2,
  },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  logRow:  { flexDirection: 'row', justifyContent: 'space-between' },
  logText: { fontFamily: 'Inter_400Regular', fontSize: 13 },
  logTime: { fontFamily: 'Inter_400Regular', fontSize: 13 },
  statusRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot:   { width: 7, height: 7, borderRadius: 3.5 },
  statusText:  { fontFamily: 'Inter_700Bold', fontSize: 13 },
  disclaimer: {
    width: '100%',
    borderRadius: 14,
    padding: 14,
  },
  disclaimerText: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  primaryBtn: {
    width: '100%',
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
    shadowOffset: { width: 0, height: 14 },
    shadowRadius: 26,
    shadowOpacity: 0.32,
    elevation: 6,
  },
  primaryBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  confirmBtn: {
    width: '100%',
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
    shadowOffset: { width: 0, height: 14 },
    shadowRadius: 26,
    shadowOpacity: 0.32,
    elevation: 6,
  },
  confirmBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  passBtn: {
    width: '100%',
    borderWidth: 1.5,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
  },
  passBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  ghostBtn: { paddingVertical: 4 },
  ghostBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, textAlign: 'center' },
  leaveBtn: {
    borderWidth: 1,
    borderRadius: 999,
    width: '100%',
    paddingVertical: 13,
    alignItems: 'center',
  },
  leaveBtnText: { fontFamily: 'Inter_400Regular', fontSize: 14 },
});

// ─── Screen ──────────────────────────────────────────────────────────────────
export default function QueueStatusScreen() {
  const colors = useColors();
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

  // Routes to the Skip the Line Pass sheet, which confirms the seat immediately.
  const handleUsePass = (entry: QueueEntry) => {
    const flight = entry.flight;
    router.push({
      pathname: '/queue/pass',
      params: {
        entryId: entry.id,
        position: String(entry.position),
        flightId: entry.flightId,
        from: flight?.fromAirport ?? '',
        to: flight?.toAirport ?? '',
        fromCity: flight?.fromCity ?? '',
        toCity: flight?.toCity ?? '',
        departureDate: flight?.departureDate ?? '',
        departureTime: flight?.departureTime ?? '',
        duration: flight?.duration ?? '',
        aircraftType: flight?.aircraftType ?? '',
      },
    });
  };

  const handleCancel = async (entryId: string) => {
    const ok = await confirmDialog('Leave Queue?', 'You will lose your position in the queue.', 'Leave Queue', true);
    if (ok) cancelMutation.mutate({ id: entryId });
  };

  const handleConfirm = async (entry: QueueEntry) => {
    const flight = entry.flight;
    const ok = await confirmDialog('Confirm your seat?', 'This will reserve your spot on this flight.');
    if (!ok) return;
    confirmMutation.mutate(
      { id: entry.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['/api/queue/status'] });
          queryClient.invalidateQueries({ queryKey: ['/api/trips'] });
          queryClient.invalidateQueries({ queryKey: [`/api/flights/${entry.flightId}/my-status`] });
          router.push({
            pathname: '/flight/confirmed',
            params: {
              from: flight?.fromAirport ?? '', to: flight?.toAirport ?? '',
              fromCity: flight?.fromCity ?? '', toCity: flight?.toCity ?? '',
              departureDate: flight?.departureDate ?? '', departureTime: flight?.departureTime ?? '',
              duration: flight?.duration ?? '', aircraftType: flight?.aircraftType ?? '',
            },
          });
        },
      },
    );
  };

  const backTop = topPad + 14;

  return (
    <View style={[styles.container, { backgroundColor: colors.offWhite }]}>
      <TouchableOpacity style={[styles.backBtn, { top: backTop, backgroundColor: colors.muted }]} onPress={() => router.back()} activeOpacity={0.7}>
        <Text style={[styles.backChevron, { color: colors.textOnSurface }]}>‹</Text>
      </TouchableOpacity>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : !hasAny ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: colors.textOnSurface }]}>No active queues</Text>
          <Text style={[styles.emptyBody, { color: colors.mutedForegroundLight }]}>
            Browse available flights and join a queue to see your status here.
          </Text>
          <TouchableOpacity
            style={[styles.browseBtn, { backgroundColor: colors.primary }]}
            onPress={() => router.replace('/(tabs)/discover')}
            activeOpacity={0.8}
          >
            <Text style={[styles.browseBtnText, { color: colors.primaryForeground }]}>Browse Flights</Text>
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
              onConfirm={() => handleConfirm(entry)}
              isConfirming={confirmMutation.isPending}
              onUsePass={
                user && user.linePassCount > 0 && entry.position !== 1
                  ? () => handleUsePass(entry)
                  : undefined
              }
              isUsingPass={false}
              passCount={user?.linePassCount ?? 0}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  backBtn: {
    position: 'absolute', zIndex: 10, left: 18,
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
  },
  backChevron: { fontSize: 24, lineHeight: 28, marginLeft: -2 },
  scrollContent: { paddingHorizontal: 22, alignItems: 'center' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  emptyTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 20 },
  emptyBody:  { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 22, textAlign: 'center' },
  browseBtn: {
    marginTop: 6,
    paddingHorizontal: 24, paddingVertical: 14, borderRadius: 999,
  },
  browseBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
});
