import { useEffect, useRef } from 'react';
import { router } from 'expo-router';
import type { QueryClient } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import type { QueueEntry } from '@workspace/api-client-react';
import { useGetQueueStatus } from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';

// ─── Shared waiting→confirmed flip tracking ──────────────────────────────────
// Every observer of the queue-status query (the Queue Status screen and the
// app-wide watcher below) funnels its data through `observeQueueEntries`, so
// the guard semantics are identical everywhere:
//   - only entries we have *observed* in the waiting state can trigger the
//     celebration (already-confirmed entries on mount/revisit never do), and
//   - each entry celebrates at most once, no matter how many observers see
//     the flip (the sets are module-level, shared by all observers).
// The sets are cleared on sign-out/account switch so a new session starts
// from a clean slate.
const seenWaitingIds = new Set<string>();
const celebratedIds = new Set<string>();

export function resetQueueCelebrationTracking(): void {
  seenWaitingIds.clear();
  celebratedIds.clear();
}

// The pass flow confirms the seat via its own mutation and shows its own
// celebration; marking the entry celebrated keeps the watchers from pushing
// a second confirmed screen when the next poll reveals the flip.
export function markQueueEntryCelebrated(entryId: string): void {
  celebratedIds.add(entryId);
}

// Records waiting entries and, on an observed waiting→confirmed flip, routes
// to the full-screen celebration exactly once. Safe to call from multiple
// observers with the same data — the synchronous `celebratedIds` add makes
// whichever observer runs first win.
export function observeQueueEntries(entries: QueueEntry[], queryClient: QueryClient): void {
  const flipped = entries.find(
    (e) =>
      e.status === 'confirmed' &&
      seenWaitingIds.has(e.id) &&
      !celebratedIds.has(e.id),
  );
  for (const e of entries) {
    if (e.status === 'waiting') seenWaitingIds.add(e.id);
  }
  if (!flipped) return;
  celebratedIds.add(flipped.id);
  queryClient.invalidateQueries({ queryKey: ['/api/trips'] });
  queryClient.invalidateQueries({ queryKey: [`/api/flights/${flipped.flightId}/my-status`] });
  const flight = flipped.flight;
  router.push({
    pathname: '/flight/confirmed',
    params: {
      from: flight?.fromAirport ?? '',
      to: flight?.toAirport ?? '',
      fromCity: flight?.fromCity ?? '',
      toCity: flight?.toCity ?? '',
      departureDate: flight?.departureDate ?? '',
      departureTime: flight?.departureTime ?? '',
      duration: flight?.duration ?? '',
      aircraftType: flight?.aircraftType ?? '',
      flightId: flipped.flightId ?? '',
      petFeeUsd: flipped.bringingPet ? '500' : '0',
    },
  });
}

// ─── App-wide watcher ─────────────────────────────────────────────────────────
// Mounted once in the root layout. Polls the same queue-status query the
// Queue Status screen uses (React Query dedupes the network request), so a
// member browsing Discover, Trips, or Concierge still lands on the
// celebration when the queue engine auto-confirms their seat.
export function QueueConfirmationWatcher() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Clear flip tracking whenever the signed-in member changes (sign-out or
  // account switch) so one member's observed queues never leak into another
  // session on the same device.
  const prevUserId = useRef<string | null>(user?.id ?? null);
  useEffect(() => {
    const id = user?.id ?? null;
    if (id !== prevUserId.current) {
      prevUserId.current = id;
      resetQueueCelebrationTracking();
    }
  }, [user?.id]);

  const { data } = useGetQueueStatus({
    query: { enabled: !!user, refetchInterval: 10_000 },
  });

  useEffect(() => {
    if (!user || !data) return;
    observeQueueEntries((data as QueueEntry[]) ?? [], queryClient);
  }, [data, user, queryClient]);

  return null;
}
