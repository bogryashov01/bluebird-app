import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform, Alert, useWindowDimensions,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import type { QueueEntry, QueueMovementEvent } from '@workspace/api-client-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { FloatingBackButton } from '@/components/FloatingBackButton';
import { PrimaryButton, SecondaryButton } from '@/components/PrimaryButton';
import { confirmDialog } from '@/lib/confirmDialog';
import { useGetQueueStatus, useCancelQueueEntry, useGetMembership } from '@workspace/api-client-react';

import { useAuth } from '@/context/AuthContext';
import { observeQueueEntries } from '@/lib/queueCelebration';
import { ProductionReadOnlyNotice } from '@/components/ProductionReadOnlyNotice';
import { isLocalFlightReadMode } from '@/lib/productionFlights';
import { useFullAppDemoQueueOptional } from '@/lib/fullAppDemoQueue';
import type { FullAppDemoQueueEntry } from '@/lib/fullAppDemoQueueState';
import { fetchFullAppDemoFlight } from '@/lib/fullAppDemoLiveReads';
import { parseProductionFlightId } from '@/lib/productionFlights';

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

function RingProgress({ position, total, size }: { position: number; total: number; size?: number }) {
  const colors = useColors();
  const { width: windowWidth } = useWindowDimensions();
  const ringSize = size ?? Math.round(Math.min(170, Math.max(120, windowWidth - 200)));
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
                {formatFlightStatus(flight.status)}
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

function formatFlightStatus(status: string | null | undefined): string {
  return status === 'available' || status === 'published' ? 'Open' : status ?? 'Active';
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

function QueueMembersCard({ entry }: { entry: QueueEntry }) {
  const colors = useColors();
  const members = [...(entry.queueMembers ?? [])].sort((a, b) => a.position - b.position);

  return (
    <View style={[flat.card, { backgroundColor: colors.surface }]}>
      <View style={flat.membersHeader}>
        <Text style={[flat.cardTitle, { color: colors.textOnSurface }]}>People waiting</Text>
        <Text style={[flat.membersCount, { color: colors.mutedForegroundLight }]}>
          {members.length} {members.length === 1 ? 'member' : 'members'}
        </Text>
      </View>
      <View style={flat.memberBadgeRow}>
        {members.map((member, index) => {
          const isCurrentMember = member.position === entry.position;
          return (
            <View
              key={`${member.position}-${member.initials}-${index}`}
              style={[
                flat.memberBadge,
                {
                  backgroundColor: isCurrentMember ? colors.primary : colors.primary + '14',
                  borderColor: isCurrentMember ? colors.primary : colors.primary + '38',
                },
              ]}
              accessibilityLabel={`${isCurrentMember ? 'Your' : 'Queue member'} position ${member.position}`}
            >
              <Text style={[flat.memberInitials, { color: isCurrentMember ? colors.primaryForeground : colors.primary }]}>
                {member.initials}
              </Text>
              <Text style={[flat.memberPosition, { color: isCurrentMember ? colors.primaryForeground : colors.mutedForegroundLight }]}>
                #{member.position}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function DemoQueueStatusDetails({
  entry,
  decisionCountdown,
}: {
  entry: FullAppDemoQueueEntry;
  decisionCountdown: string;
}) {
  const colors = useColors();
  const routeLabel = `${entry.flight.fromAirport ?? '—'} → ${entry.flight.toAirport ?? '—'}`;
  const flightStatus = entry.flight.status === 'available' || entry.flight.status === 'published'
    ? 'Open'
    : entry.flight.status?.trim() || 'Unavailable';
  const activity = entry.status === 'changed-position'
    ? `Queue position changed locally to #${entry.position}`
    : `Joined queue at #${entry.position}`;

  return (
    <View style={demoStatus.wrap}>
      <Text style={[demoStatus.route, { color: colors.textOnSurface }]}>{routeLabel}</Text>
      <Text style={[demoStatus.state, { color: colors.mutedForegroundLight }]}>
        {entry.status === 'changed-position' ? 'Queue position changed' : 'Waiting'}
      </Text>
      <RingProgress position={entry.position} total={entry.totalInQueue} />
      <Text style={[demoStatus.countdown, { color: colors.primary }]}>
        {decisionCountdown === 'Imminent' ? 'Decision imminent' : `Decision in ${decisionCountdown}`}
      </Text>

      <View style={[flat.card, { backgroundColor: colors.surface }]}>
        <Text style={[flat.cardTitle, { color: colors.textOnSurface }]}>Queue Movement</Text>
        <View style={flat.logRow}>
          <Text style={[flat.logText, { color: colors.mutedForegroundLight }]}>{activity}</Text>
          {entry.status !== 'changed-position' && (
            <Text style={[flat.logTime, { color: colors.mutedForegroundLight }]}>{formatAgo(entry.createdAt)}</Text>
          )}
        </View>
      </View>

      <View style={[flat.card, { backgroundColor: colors.surface }]}>
        <View style={flat.statusRow}>
          <Text style={[flat.cardTitle, { color: colors.textOnSurface }]}>Flight Status</Text>
          <View style={flat.statusBadge}>
            <View style={[flat.statusDot, { backgroundColor: flightStatus === 'Open' ? colors.success : colors.mutedForegroundLight }]} />
            <Text style={[flat.statusText, { color: flightStatus === 'Open' ? colors.success : colors.mutedForegroundLight }]}>
              {flightStatus}
            </Text>
          </View>
        </View>
      </View>

      <View style={[flat.disclaimer, { backgroundColor: colors.primary + '14' }]}>
        <Text style={[flat.disclaimerText, { color: colors.textOnSurface }]}>
          Local demo only — this queue does not send a backend request or create a booking.
        </Text>
      </View>
    </View>
  );
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
  const { user, demoMode } = useAuth();
  const localDemoFlow = demoMode || isLocalFlightReadMode();
  const demoQueue = useFullAppDemoQueueOptional();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const topPad    = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const { data: membership } = useGetMembership({ query: { enabled: localDemoFlow && !demoMode } });
  const { entryId, flightId } = useLocalSearchParams<{ entryId?: string; flightId?: string }>();
  const demoEntries = demoQueue?.entries ?? [];
  const demoSelectedForRead = (entryId ? demoEntries.find((entry) => entry.id === entryId) : undefined) ??
    (flightId ? demoEntries.find((entry) => entry.flightId === flightId) : undefined) ??
    (demoEntries.length === 1 ? demoEntries[0] : undefined);
  const demoDecisionCountdown = useDecisionCountdown(demoSelectedForRead?.createdAt);
  const demoReadFlightId = parseProductionFlightId(demoSelectedForRead?.flightId);
  const demoFlightReadQuery = useQuery({
    queryKey: ['full-app-demo-flight-status', demoReadFlightId],
    queryFn: ({ signal }) => fetchFullAppDemoFlight(demoReadFlightId!, { signal }),
    enabled: demoMode && demoReadFlightId !== null,
  });
  useEffect(() => {
    const entry = demoSelectedForRead;
    const status = demoFlightReadQuery.data?.status;
    if (!demoMode || !demoQueue || !entry || !status) return;
    if (entry.status !== 'waiting' && entry.status !== 'changed-position') return;
    if (status === 'available' || status === 'published') return;
    void demoQueue.transition(entry.flightId, 'closed').catch(() => {});
  }, [demoMode, demoQueue, demoSelectedForRead?.id, demoSelectedForRead?.status, demoFlightReadQuery.data?.status]);

  // API returns waiting + confirmed entries for the member. Poll so the
  // screen flips to the confirmed state on its own when the queue engine
  // auto-confirms the seat — no tap required.
  const { data: queueEntries, isLoading, isError, refetch } = useGetQueueStatus({
    query: { enabled: localDemoFlow && !demoMode && !!user, refetchInterval: 10_000 },
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
    if (!localDemoFlow) return;
    observeQueueEntries(allEntries, queryClient);
  }, [allEntries, localDemoFlow, queryClient]);

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

  // Routes to the Skip the Line sheet regardless of balance. The sheet
  // distinguishes an empty balance from pass confirmation; neither dismissal
  // path performs a queue action. Refetch first because the queue engine may
  // have auto-confirmed this entry since the last 10s poll.
  const handleUsePass = async (entry: QueueEntry) => {
    if (!localDemoFlow || checkingPassEntryId) return;
    setCheckingPassEntryId(entry.id);
    try {
      const { data: fresh } = await refetch();
      const latest = ((fresh as QueueEntry[]) ?? []).find((e) => e.id === entry.id);
      if (!latest || latest.status !== 'waiting') {
        // No longer waiting (confirmed/cancelled) — the refetched data is
        // already in the cache, so the screen re-renders to the right state.
        return;
      }
      openPassSheet(latest);
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
    if (!localDemoFlow) return;
    const ok = await confirmDialog('Leave Queue?', 'You will lose your position in the queue.', 'Leave Queue', true);
    if (ok) cancelMutation.mutate({ id: entryId });
  };

  // Bottom-pinned actions apply to the first waiting entry in view (the
  // non-picker path shows exactly one waiting entry in practice).
  const footerEntry = !needsPicker ? waitingEntries[0] : undefined;
  // Skip the Line is surfaced for every waiting entry, including position 1,
  // because queue position alone does not guarantee the seat.
  const assignedFamilyPasses = membership?.family?.members.find((member) => member.userId === user?.id)?.availablePasses ?? 0;
  const passCount = (user?.linePassCount ?? 0) + assignedFamilyPasses;

  if (demoMode) {
    const localEntries = demoEntries;
    const selected = (entryId && localEntries.find((entry) => entry.id === entryId)) ??
      (flightId && localEntries.find((entry) => entry.flightId === flightId)) ??
      (localEntries.length === 1 ? localEntries[0] : undefined);
    const localFlightParams = selected ? {
      entryId: selected.id,
      position: String(selected.position),
      flightId: selected.flightId,
      from: selected.flight.fromAirport ?? '',
      to: selected.flight.toAirport ?? '',
      fromCity: selected.flight.fromCity ?? '',
      toCity: selected.flight.toCity ?? '',
      departureDate: selected.flight.departureDate ?? '',
      departureTime: selected.flight.departureTime ?? '',
      duration: selected.flight.duration ?? '',
      aircraftType: selected.flight.aircraftTypeName ?? selected.flight.aircraftType ?? '',
      bringingPet: '0',
    } : {};
    const openPass = () => router.push({
      pathname: '/queue/pass',
      params: localFlightParams,
    } as any);
    const leaveLocalEntry = async () => {
      if (!selected || !demoQueue || demoQueue.storageError) return;
      const ok = await confirmDialog(
        'Leave simulated queue?',
        'This removes the local demo entry only. It does not change a real flight queue.',
        'Leave Queue',
        true,
      );
      if (ok) await demoQueue.leaveFlight(selected.flightId);
    };
    if (!demoQueue?.hydrated) {
      return (
        <View style={[styles.centered, { backgroundColor: colors.offWhite }]} testID="full-app-demo-queue-loading">
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      );
    }
    if (!selected) {
      return (
        <View style={[styles.empty, { backgroundColor: colors.offWhite }]} testID="full-app-demo-queue-empty">
          <FloatingBackButton />
          <Text style={[styles.emptyTitle, { color: colors.textOnSurface }]}>
            {localEntries.length ? 'Select a queue from My Flights' : 'No active demo queues'}
          </Text>
          <Text style={[styles.emptyBody, { color: colors.mutedForegroundLight }]}>
            Join a flight from Discover to start a local queue simulation.
          </Text>
          <SecondaryButton
            label="Browse Flights"
            onPress={() => router.replace('/(tabs)/discover')}
            backgroundColor={colors.primary}
            textColor={colors.primaryForeground}
            style={styles.browseBtn}
          />
        </View>
      );
    }
    const routeLabel = `${selected.flight.fromAirport ?? '—'} → ${selected.flight.toAirport ?? '—'}`;
    const won = selected.status === 'won';
    const waiting = selected.status === 'waiting' || selected.status === 'changed-position';
    const localStatusLabel = won ? 'Flight won' : selected.status === 'closed' ? 'Queue closed'
      : selected.status === 'lost' ? 'No seat awarded'
      : selected.status === 'changed-position' ? 'Queue position changed' : 'Waiting';
    return (
      <View style={[styles.container, { backgroundColor: colors.offWhite }]} testID="full-app-demo-queue-status">
        <FloatingBackButton />
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: topPad + (waiting ? 30 : 76), paddingBottom: bottomPad + (waiting ? 220 : 28), gap: 16 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {waiting ? (
            <DemoQueueStatusDetails entry={selected} decisionCountdown={demoDecisionCountdown} />
          ) : (
            <>
              <Text style={[styles.pickerTitle, { color: colors.textOnSurface }]}>{localStatusLabel}</Text>
              <View style={[styles.pickerRow, { backgroundColor: colors.surface, width: '100%' }]}>
                <Text style={[styles.pickerRoute, { color: colors.textOnSurface }]}>{routeLabel}</Text>
                <Text style={[styles.pickerMeta, { color: colors.mutedForegroundLight }]}>
                  {selected.flight.fromCity ?? selected.flight.fromAirport ?? 'Origin'} → {selected.flight.toCity ?? selected.flight.toAirport ?? 'Destination'}
                </Text>
                <Text style={[styles.pickerMeta, { color: colors.mutedForegroundLight }]}>
                  {selected.flight.departureDate ?? 'Date unavailable'}{selected.flight.departureTime ? ` · ${selected.flight.departureTime}` : ''}
                </Text>
                <Text style={[styles.pickerMeta, { color: colors.mutedForegroundLight }]}>
                  Demo state only — no backend queue request or booking was made.
                </Text>
              </View>
            </>
          )}
          {demoQueue.storageError ? (
            <Text testID="full-app-demo-queue-storage-error" style={[styles.emptyBody, { color: colors.destructive }]}>
              {demoQueue.storageError}
            </Text>
          ) : null}
          {!waiting && (won ? (
            <PrimaryButton
              label="View Flight Won"
              testID="full-app-demo-view-won"
              onPress={() => router.replace(`/flight/${selected.flightId}` as any)}
              style={styles.fullWidth}
            />
          ) : (
            <SecondaryButton
              label="Back to Flight Details"
              onPress={() => router.replace(`/flight/${selected.flightId}` as any)}
              style={styles.fullWidth}
            />
          ))}
          {!waiting && (
            <SecondaryButton
              label="View My Flights"
              testID="full-app-demo-open-trips"
              onPress={() => router.push('/(tabs)/trips')}
              style={styles.fullWidth}
            />
          )}
        </ScrollView>
        {waiting && (
          <View style={[styles.demoStatusFooter, { backgroundColor: colors.offWhite, paddingBottom: bottomPad + 10 }]}>
            <Text style={[styles.demoPassBalance, { color: colors.mutedForegroundLight }]} testID="full-app-demo-pass-balance">
              Skip the Line Pass balance · {demoQueue.passCount} pass{demoQueue.passCount === 1 ? '' : 'es'}
            </Text>
            <PrimaryButton
              label={demoQueue.passCount > 0 ? 'Use Skip the Line Pass' : 'Get a Skip the Line Pass'}
              testID="full-app-demo-use-pass"
              disabled={!!demoQueue.storageError}
              onPress={openPass}
              style={styles.fullWidth}
            />
            <SecondaryButton
              label="Leave Simulated Queue"
              testID="full-app-demo-leave-queue"
              disabled={!!demoQueue.storageError}
              onPress={() => void leaveLocalEntry()}
              style={styles.fullWidth}
            />
            <TouchableOpacity
              testID="full-app-demo-open-trips"
              onPress={() => router.push('/(tabs)/trips')}
              activeOpacity={0.75}
              style={styles.demoTripsLink}
            >
              <Text style={[styles.demoTripsLinkText, { color: colors.mutedForegroundLight }]}>View My Flights</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }

  if (!localDemoFlow) {
    return <ProductionReadOnlyNotice flightId={flightId} />;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.offWhite }]}>
      <FloatingBackButton />

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
       ) : isError ? (
         <View style={styles.empty}>
           <Text style={[styles.emptyTitle, { color: colors.textOnSurface }]}>Could not load your queues</Text>
           <Text style={[styles.emptyBody, { color: colors.mutedForegroundLight }]}>Check your connection and try again.</Text>
           <SecondaryButton label="Try Again" onPress={() => refetch()} backgroundColor={colors.primary} textColor={colors.primaryForeground} style={styles.browseBtn} />
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
  fullWidth: { width: '100%' },
  demoStatusFooter: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 22, paddingTop: 10, gap: 8,
  },
  demoPassBalance: { fontFamily: 'Inter_500Medium', fontSize: 12, textAlign: 'center' },
  demoTripsLink: { minHeight: 28, alignItems: 'center', justifyContent: 'center' },
  demoTripsLinkText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  pickerTitle: { fontFamily: 'Inter_700Bold', fontSize: 22, alignSelf: 'flex-start' },
  pickerSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, alignSelf: 'flex-start', marginBottom: 14, marginTop: 4 },
  pickerRow: {
    width: '100%',
    borderRadius: 18, padding: 17, marginBottom: 12, gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 5 }, shadowRadius: 14, shadowOpacity: 0.06, elevation: 2,
  },
  pickerRowMain: { flexDirection: 'row', alignItems: 'center' },
  pickerPassBtn: {
    borderRadius: 12, paddingVertical: 11, alignItems: 'center', justifyContent: 'center',
  },
  pickerPassText: { fontFamily: 'Inter_600SemiBold', fontSize: 13.5 },
  pickerRoute: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  pickerMeta: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 3 },
  pickerChevron: { fontFamily: 'Inter_700Bold', fontSize: 20, marginLeft: 10 },
  queuePositionNumber: { fontFamily: 'Inter_700Bold', fontSize: 36, letterSpacing: -1 },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 22, paddingTop: 12, gap: 12,
  },
});

const demoStatus = StyleSheet.create({
  wrap: { width: '100%', alignItems: 'center', gap: 10 },
  route: { width: '100%', fontFamily: 'Inter_700Bold', fontSize: 23, letterSpacing: -0.4, textAlign: 'center' },
  state: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  countdown: { fontFamily: 'Inter_700Bold', fontSize: 15 },
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

      <QueueMembersCard entry={entry} />

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
              {formatFlightStatus(flight?.status)}
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
  wrap: { width: '100%', alignItems: 'center', gap: 16, marginBottom: 20 },
  route: { fontFamily: 'Inter_700Bold', fontSize: 23, letterSpacing: -0.4 },
  countdown: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  card: {
    width: '100%',
    borderRadius: 17,
    padding: 16,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 16,
    shadowOpacity: 0.05,
    elevation: 2,
  },
  cardTitle: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  membersHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  membersCount: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  memberBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  memberBadge: {
    minWidth: 54,
    minHeight: 58,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  memberInitials: { fontFamily: 'Inter_700Bold', fontSize: 15, letterSpacing: 0.3 },
  memberPosition: { fontFamily: 'Inter_500Medium', fontSize: 10 },
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
