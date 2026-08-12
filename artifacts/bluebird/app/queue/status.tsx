import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform, Alert, useWindowDimensions,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import type { QueueEntry } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { FloatingBackButton } from '@/components/FloatingBackButton';
import { PrimaryButton, SecondaryButton } from '@/components/PrimaryButton';
import { confirmDialog } from '@/lib/confirmDialog';
import { useGetQueueStatus, useCancelQueueEntry } from '@workspace/api-client-react';

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
  onUsePass,
  isUsingPass,
  passCount,
}: {
  entry: QueueEntry;
  onCancel: () => void;
  onUsePass?: () => void;
  isUsingPass?: boolean;
  passCount?: number;
}) {
  const colors = useColors();
  const flight    = entry.flight;
  const countdown = useCountdown(flight?.departureDate, flight?.departureTime);
  const joinedAgo = formatAgo(entry.createdAt);
  const flightLabel = flight ? `${flight.fromAirport} → ${flight.toAirport}` : '— → —';

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
          {entry.position === 1
            ? "You're first in line — your seat will be confirmed automatically at the decision moment. No action needed."
            : 'Flights may be modified or cancelled due to operational requirements.'}
        </Text>
      </View>

      <PrimaryButton
        label="View Flight Details"
        onPress={() => router.push(`/flight/${entry.flightId}`)}
        style={card.fullWidth}
      />

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

      <PrimaryButton
        label="View in My Trips"
        onPress={() => router.push('/(tabs)/trips')}
        backgroundColor={colors.backgroundMid}
        textColor={colors.primaryForeground}
        style={card.fullWidth}
      />
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
  fullWidth: { width: '100%' },
  passBtn: {
    width: '100%',
    borderWidth: 1.5,
    borderRadius: 999,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  passBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  ghostBtn: { paddingVertical: 4 },
  ghostBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, textAlign: 'center' },
  leaveBtn: {
    borderWidth: 1,
    borderRadius: 999,
    width: '100%',
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  leaveBtnText: { fontFamily: 'Inter_500Medium', fontSize: 14 },
});

// ─── Screen ──────────────────────────────────────────────────────────────────
export default function QueueStatusScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const topPad    = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const { user } = useAuth();
  const { entryId, flightId } = useLocalSearchParams<{ entryId?: string; flightId?: string }>();

  // API returns waiting + confirmed entries for the member. Poll so the
  // screen flips to the confirmed state on its own when the queue engine
  // auto-confirms the seat — no tap required.
  const { data: queueEntries, isLoading } = useGetQueueStatus({
    query: { enabled: !!user, refetchInterval: 10_000 },
  });
  const allEntries = (queueEntries as QueueEntry[]) ?? [];

  // Select only the tapped entry when navigation carried an identifier.
  // Fallbacks: single entry → show it; multiple entries with no identifier →
  // show a picker so the member chooses which queue to view.
  const targetedEntry =
    (entryId ? allEntries.find((e) => e.id === entryId) : undefined) ??
    (flightId ? allEntries.find((e) => e.flightId === flightId) : undefined);
  // If the identifier no longer matches an entry (cancelled/expired), fall
  // back to the no-identifier behavior rather than a dead-end empty screen.
  const visibleEntries = targetedEntry ? [targetedEntry] : allEntries;
  const needsPicker = !targetedEntry && allEntries.length > 1;

  const waitingEntries = visibleEntries.filter((e) => e.status === 'waiting');
  const confirmedEntries = visibleEntries.filter((e) => e.status === 'confirmed');
  const hasAny = allEntries.length > 0;

  const cancelMutation = useCancelQueueEntry({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/queue/status'] }),
      onError: (err: any) => {
        Alert.alert('Error', err?.data?.error || err?.message || 'Failed to leave queue');
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

  return (
    <View style={[styles.container, { backgroundColor: colors.offWhite }]}>
      <FloatingBackButton />

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
          <SecondaryButton
            label="Browse Flights"
            onPress={() => router.replace('/(tabs)/discover')}
            backgroundColor={colors.primary}
            textColor={colors.primaryForeground}
            style={styles.browseBtn}
          />
        </View>
      ) : needsPicker ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.scrollContent, { paddingTop: topPad + 80, paddingBottom: bottomPad + 24 }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.pickerTitle, { color: colors.textOnSurface }]}>Your queues</Text>
          <Text style={[styles.pickerSubtitle, { color: colors.mutedForegroundLight }]}>
            Select a queue to see its details.
          </Text>
          {allEntries.map((entry) => {
            const flight = entry.flight;
            const label = flight ? `${flight.fromAirport} → ${flight.toAirport}` : '— → —';
            return (
              <TouchableOpacity
                key={entry.id}
                style={[styles.pickerRow, { backgroundColor: colors.surface }]}
                onPress={() => router.setParams({ entryId: entry.id })}
                activeOpacity={0.8}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.pickerRoute, { color: colors.textOnSurface }]}>{label}</Text>
                  <Text style={[styles.pickerMeta, { color: colors.mutedForegroundLight }]}>
                    {entry.status === 'confirmed'
                      ? 'Confirmed'
                      : `In queue · #${entry.position} of ${entry.totalInQueue}`}
                    {flight ? ` · ${flight.departureDate} ${flight.departureTime}` : ''}
                  </Text>
                </View>
                <Text style={[styles.pickerChevron, { color: colors.mutedForegroundLight }]}>›</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
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
  scrollContent: { paddingHorizontal: 22, alignItems: 'center' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  emptyTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 20 },
  emptyBody:  { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 22, textAlign: 'center' },
  browseBtn: { marginTop: 6, paddingHorizontal: 24 },
  pickerTitle: { fontFamily: 'Inter_700Bold', fontSize: 22, alignSelf: 'flex-start' },
  pickerSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, alignSelf: 'flex-start', marginBottom: 14, marginTop: 4 },
  pickerRow: {
    width: '100%', flexDirection: 'row', alignItems: 'center',
    borderRadius: 18, padding: 18, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowRadius: 16, shadowOpacity: 0.05, elevation: 2,
  },
  pickerRoute: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  pickerMeta: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 3 },
  pickerChevron: { fontFamily: 'Inter_700Bold', fontSize: 20, marginLeft: 10 },
});
