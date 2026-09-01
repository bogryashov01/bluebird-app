import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform, Alert, useWindowDimensions,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import type { QueueEntry, QueueMovementEvent } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { FloatingBackButton } from '@/components/FloatingBackButton';
import { PrimaryButton, SecondaryButton } from '@/components/PrimaryButton';
import { confirmDialog } from '@/lib/confirmDialog';
import { useGetQueueStatus, useCancelQueueEntry } from '@workspace/api-client-react';

import { useAuth } from '@/context/AuthContext';
import { observeQueueEntries } from '@/lib/queueCelebration';

// ─── Countdown hook ───────────────────────────────────────────────────────────
// Counts down to the decision moment: the queue engine holds a real member in
// the waiting state for a minimum period after joining (60s — mirrors
// REAL_MEMBER_MIN_WAIT_MS on the API server) before auto-confirming them at
// the front of the line. Once the window elapses, confirmation happens on an
// upcoming engine tick, so we show "Imminent".
const DECISION_MIN_WAIT_MS = 60_000;

function useDecisionCountdown(joinedAt?: string): string {
  const [remaining, setRemaining] = useState('--:--:--');

  useEffect(() => {
    if (!joinedAt) return;
    const target = new Date(joinedAt).getTime() + DECISION_MIN_WAIT_MS;
    const compute = () => {
      const diff = target - Date.now();
      if (diff <= 0) { setRemaining('Imminent'); return; }
      const hours = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setRemaining(`${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`);
    };
    compute();
    const id = setInterval(compute, 1000);
    return () => clearInterval(id);
  }, [joinedAt]);

  return remaining;
}

// ─── SVG ring ─────────────────────────────────────────────────────────────────
const CIRC = 251;

function RingProgress({ position, total }: { position: number; total: number }) {
  const colors = useColors();
  const { width: windowWidth } = useWindowDimensions();
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
function ConfirmedCard({ entry }: { entry: QueueEntry }) {
  const colors = useColors();
  const flight = entry.flight;
  const flightLabel = flight
    ? `${flight.fromAirport} → ${flight.toAirport}`
    : '— → —';

  return (
    <View style={[confirmed.wrap, { backgroundColor: colors.surface, borderColor: colors.success + '4D' }]}>
      <View style={[confirmed.badge, { backgroundColor: colors.success + '1F' }]}>
        <Text style={[confirmed.badgeText, { color: colors.success }]}>✓  CONFIRMED</Text>
      </View>

      <Text style={[confirmed.route, { color: colors.textOnSurface }]}>{flightLabel}</Text>

      {flight && (
        <View style={confirmed.details}>
          <View style={flat.statusRow}>
            <Text style={[flat.cardTitle, { color: colors.textOnSurface }]}>Flight Status</Text>
            <View style={flat.statusBadge}>
              <View style={[flat.statusDot, { backgroundColor: colors.success }]} />
              <Text style={[flat.statusText, { color: colors.success }]}>
                {flight.status === 'available' ? 'Open' : flight.status ?? 'Active'}
              </Text>
            </View>
          </View>
          <View style={flat.logRow}>
            <Text style={[flat.logText, { color: colors.mutedForegroundLight }]}>Departure</Text>
            <Text style={[flat.logTime, { color: colors.mutedForegroundLight }]}>{flight.departureDate} · {flight.departureTime}</Text>
          </View>
          <View style={flat.logRow}>
            <Text style={[flat.logText, { color: colors.mutedForegroundLight }]}>Route</Text>
            <Text style={[flat.logTime, { color: colors.mutedForegroundLight }]}>{flight.fromCity} → {flight.toCity}</Text>
          </View>
        </View>
      )}

      <PrimaryButton
        label="View in My Trips"
        onPress={() => router.push('/(tabs)/trips')}
        style={confirmed.fullWidth}
      />
    </View>
  );
}
function formatAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.floor(diff / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function movementRows(entry: QueueEntry): { text: string; time: string }[] {
  const history = (entry.movementHistory ?? []) as QueueMovementEvent[];
  const rows = history.map((ev) =>
    ev.type === 'moved'
      ? { text: `Moved #${ev.from} → #${ev.to}`, time: formatAgo(ev.at) }
      : { text: `Joined queue at #${ev.position}`, time: formatAgo(ev.at) },
  );
  if (rows.length === 0) {
    // Legacy entries created before movement logging existed.
    return [{ text: `Joined queue`, time: formatAgo(entry.createdAt) }];
  }
  return rows.reverse();
}
const confirmed = StyleSheet.create({
  wrap: {
    width: '100%',
    borderRadius: 24,
    borderWidth: 1.5,
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
  route: { fontFamily: 'Inter_700Bold', fontSize: 22, letterSpacing: -0.4 },
  details: { width: '100%', gap: 10 },
  fullWidth: { width: '100%' },
});
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
  const { data: queueEntries, isLoading, refetch } = useGetQueueStatus({
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

  // Celebration on the flip to confirmed: when polling reveals an entry we
  // previously saw as *waiting* is now *confirmed*, land on the full-screen
  // "You're confirmed!" screen. Flip tracking lives in the shared
  // queueCelebration module (also fed by the app-wide watcher in the root
  // layout), so the celebration fires exactly once no matter which observer
  // sees the transition first — and never on revisits, since entries already
  // confirmed on mount were never observed as waiting.
  useEffect(() => {
    observeQueueEntries(allEntries, queryClient);
  }, [allEntries, queryClient]);

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

  // Tracks the entry whose pass button is mid-refetch, to disable the button.
  const [checkingPassEntryId, setCheckingPassEntryId] = useState<string | null>(null);

  // Routes to the Skip the Line flow. With ≥1 pass it opens the pass
  // confirmation sheet; with 0 passes it goes to the buy-pass screen (which
  // carries the entry so the member lands back on the confirmation after
  // purchasing). Refetches the entry first — the queue engine may have
  // auto-confirmed it since the last 10s poll, in which case the screen
  // simply updates to the confirmed banner instead of navigating.
  const handleUsePass = async (entry: QueueEntry) => {
    if (checkingPassEntryId) return;
    setCheckingPassEntryId(entry.id);
    try {
      const { data: fresh } = await refetch();
      const latest = ((fresh as QueueEntry[]) ?? []).find((e) => e.id === entry.id);
      if (!latest || latest.status !== 'waiting') {
        // No longer waiting (confirmed/cancelled) — the refetched data is
        // already in the cache, so the screen re-renders to the right state.
        return;
      }
      if ((user?.linePassCount ?? 0) > 0) {
        openPassSheet(latest);
      } else {
        router.push({ pathname: '/queue/buy-pass', params: entryParams(latest) });
      }
    } finally {
      setCheckingPassEntryId(null);
    }
  };

  const openPassSheet = (entry: QueueEntry) => {
    router.push({ pathname: '/queue/pass', params: entryParams(entry) });
  };

  const entryParams = (entry: QueueEntry) => {
    const flight = entry.flight;
    return {
        entryId: entry.id,
        position: String(entry.position),
        bringingPet: entry.bringingPet ? '1' : '0',
        flightId: entry.flightId,
        from: flight?.fromAirport ?? '',
        to: flight?.toAirport ?? '',
        fromCity: flight?.fromCity ?? '',
        toCity: flight?.toCity ?? '',
        departureDate: flight?.departureDate ?? '',
        departureTime: flight?.departureTime ?? '',
        duration: flight?.duration ?? '',
        aircraftType: flight?.aircraftType ?? '',
    };
  };

  const handleCancel = async (entryId: string) => {
    const ok = await confirmDialog('Leave Queue?', 'You will lose your position in the queue.', 'Leave Queue', true);
    if (ok) cancelMutation.mutate({ id: entryId });
  };

  // Bottom-pinned actions apply to the first waiting entry in view (the
  // non-picker path shows exactly one waiting entry in practice).
  const footerEntry = !needsPicker ? waitingEntries[0] : undefined;
  // Skip the Line is surfaced for every waiting entry, including position 1,
  // because queue position alone does not guarantee the seat.
  const passCount = user?.linePassCount ?? 0;

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
            const isWaiting = entry.status === 'waiting';
            return (
              <View key={entry.id} style={[styles.pickerRow, { backgroundColor: colors.surface }]}>
                <TouchableOpacity
                  style={styles.pickerRowMain}
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
                {isWaiting && (
                  <TouchableOpacity
                    style={[styles.pickerPassBtn, { backgroundColor: colors.primary + '14' }]}
                    onPress={() => handleUsePass(entry)}
                    disabled={checkingPassEntryId === entry.id}
                    activeOpacity={0.8}
                    testID={`use-skip-line-${entry.id}`}
                  >
                    {checkingPassEntryId === entry.id ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <Text style={[styles.pickerPassText, { color: colors.primary }]}>
                        {passCount > 0 ? 'Skip the Line — Use Pass' : 'Skip the Line — Get a Pass'}
                      </Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </ScrollView>
      ) : (
        <>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={[
              styles.scrollContent,
              { paddingTop: topPad + 60, paddingBottom: bottomPad + (footerEntry ? 150 : 24) },
            ]}
            showsVerticalScrollIndicator={false}
          >
            {/* Confirmed entries appear first — most actionable */}
            {confirmedEntries.map((entry) => (
              <ConfirmedCard key={entry.id} entry={entry} />
            ))}
            {/* Waiting entries — flat mockup layout */}
            {waitingEntries.map((entry) => (
              <WaitingQueueView key={entry.id} entry={entry} onCancel={() => handleCancel(entry.id)} />
            ))}
          </ScrollView>

          {/* Bottom-pinned primary action */}
          {footerEntry && (
            <View style={[styles.footer, { paddingBottom: bottomPad + 12, backgroundColor: colors.offWhite }]}>
              <PrimaryButton
                label={passCount > 0
                  ? `Use Skip the Line Pass (${passCount} left)`
                  : 'Skip the Line — Get a Pass'}
                loading={checkingPassEntryId === footerEntry.id}
                onPress={() => handleUsePass(footerEntry)}
              />
            </View>
          )}
        </>
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
    width: '100%',
    borderRadius: 18, padding: 18, marginBottom: 12, gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowRadius: 16, shadowOpacity: 0.05, elevation: 2,
  },
  pickerRowMain: { flexDirection: 'row', alignItems: 'center' },
  pickerPassBtn: {
    borderRadius: 12, paddingVertical: 11, alignItems: 'center', justifyContent: 'center',
  },
  pickerPassText: { fontFamily: 'Inter_600SemiBold', fontSize: 13.5 },
  pickerRoute: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  pickerMeta: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 3 },
  pickerChevron: { fontFamily: 'Inter_700Bold', fontSize: 20, marginLeft: 10 },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 22, paddingTop: 12, gap: 12,
  },
});

function WaitingQueueView({ entry, onCancel }: { entry: QueueEntry; onCancel: () => void }) {
  const colors = useColors();
  const flight    = entry.flight;
  const countdown = useDecisionCountdown(entry.createdAt);
  const routeLabel = flight ? `${flight.fromAirport} → ${flight.toAirport}` : '— → —';

  return (
    <View style={flat.wrap}>
      <Text style={[flat.route, { color: colors.textOnSurface }]}>{routeLabel}</Text>
      <RingProgress position={entry.position} total={entry.totalInQueue} />

      <Text style={[flat.countdown, { color: colors.primary }]}>
        {countdown === 'Imminent' ? 'Decision imminent' : `Decision in ${countdown}`}
      </Text>

      {/* Queue Movement — flat full-width white card */}
      <View style={[flat.card, { backgroundColor: colors.surface }]}>
        <Text style={[flat.cardTitle, { color: colors.textOnSurface }]}>Queue Movement</Text>
        {movementRows(entry).map((row, i) => (
          <View key={i} style={flat.logRow}>
            <Text style={[flat.logText, { color: colors.mutedForegroundLight }]}>{row.text}</Text>
            <Text style={[flat.logTime, { color: colors.mutedForegroundLight }]}>{row.time}</Text>
          </View>
        ))}
      </View>

      {/* Flight Status card */}
      <View style={[flat.card, { backgroundColor: colors.surface }]}>
        <View style={flat.statusRow}>
          <Text style={[flat.cardTitle, { color: colors.textOnSurface }]}>Flight Status</Text>
          <View style={flat.statusBadge}>
            <View style={[flat.statusDot, { backgroundColor: colors.success }]} />
            <Text style={[flat.statusText, { color: colors.success }]}>
              {flight?.status === 'available' ? 'Open' : flight?.status ?? 'Active'}
            </Text>
          </View>
        </View>
      </View>

      {/* Light-blue disclaimer banner */}
      <View style={[flat.disclaimer, { backgroundColor: colors.primary + '14' }]}>
        <Text style={[flat.disclaimerText, { color: colors.textOnSurface }]}>
          Flights may be modified or cancelled due to operational requirements.
        </Text>
      </View>

      <View style={flat.linkRow}>
        <TouchableOpacity onPress={() => router.push(`/flight/${entry.flightId}`)} activeOpacity={0.7}>
          <Text style={[flat.linkText, { color: colors.mutedForegroundLight }]}>View flight details</Text>
        </TouchableOpacity>
        <Text style={[flat.linkText, { color: colors.mutedForegroundLight }]}>·</Text>
        <TouchableOpacity onPress={onCancel} activeOpacity={0.7}>
          <Text style={[flat.linkText, { color: colors.mutedForegroundLight }]}>Leave queue</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const flat = StyleSheet.create({
  wrap: { width: '100%', alignItems: 'center', gap: 18, marginBottom: 20 },
  route: { fontFamily: 'Inter_700Bold', fontSize: 24, letterSpacing: -0.4 },
  countdown: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  card: {
    width: '100%',
    borderRadius: 16,
    padding: 16,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 16,
    shadowOpacity: 0.05,
    elevation: 2,
  },
  cardTitle: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  logRow:  { flexDirection: 'row', justifyContent: 'space-between' },
  logText: { fontFamily: 'Inter_400Regular', fontSize: 13 },
  logTime: { fontFamily: 'Inter_400Regular', fontSize: 13 },
  statusRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot:   { width: 7, height: 7, borderRadius: 3.5 },
  statusText:  { fontFamily: 'Inter_700Bold', fontSize: 13 },
  disclaimer: { width: '100%', borderRadius: 14, padding: 14 },
  disclaimerText: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  linkRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 2 },
  linkText: { fontFamily: 'Inter_500Medium', fontSize: 13 },
});
