import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FlightView } from './productionFlights';
import {
  deserializeFullAppDemoQueueState,
  createFullAppDemoQueueEntry,
  FULL_APP_DEMO_QUEUE_STORAGE_KEY,
  joinFullAppDemoQueue,
  leaveFullAppDemoQueue,
  type FullAppDemoQueueEntry,
} from './fullAppDemoQueueState';

interface FullAppDemoQueueContextValue {
  entries: FullAppDemoQueueEntry[];
  hydrated: boolean;
  storageError: string | null;
  joinFlight: (flight: FlightView) => Promise<void>;
  leaveFlight: (flightId: string | number) => Promise<void>;
}

const FullAppDemoQueueContext = React.createContext<FullAppDemoQueueContextValue | null>(null);

export function FullAppDemoQueueProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = React.useState<FullAppDemoQueueEntry[]>([]);
  const [hydrated, setHydrated] = React.useState(false);
  const [storageError, setStorageError] = React.useState<string | null>(null);
  const entriesRef = React.useRef(entries);
  entriesRef.current = entries;

  React.useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(FULL_APP_DEMO_QUEUE_STORAGE_KEY)
      .then(async (raw) => {
        const safeEntries = deserializeFullAppDemoQueueState(raw);
        let parsed: unknown = safeEntries;
        if (raw !== null) {
          try {
            parsed = JSON.parse(raw) as unknown;
          } catch {
            parsed = null;
          }
        }
        if (raw !== null && JSON.stringify(parsed) !== JSON.stringify(safeEntries)) {
          await AsyncStorage.setItem(FULL_APP_DEMO_QUEUE_STORAGE_KEY, JSON.stringify(safeEntries));
        }
        if (cancelled) return;
        entriesRef.current = safeEntries;
        setEntries(safeEntries);
      })
      .catch(() => {
        if (cancelled) return;
        entriesRef.current = [];
        setEntries([]);
        setStorageError('Local demo queue storage could not be read. Queue actions are unavailable.');
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveEntries = React.useCallback(async (next: FullAppDemoQueueEntry[]) => {
    if (!hydrated) throw new Error('Local demo queue is still loading.');
    try {
      await AsyncStorage.setItem(FULL_APP_DEMO_QUEUE_STORAGE_KEY, JSON.stringify(next));
      entriesRef.current = next;
      setEntries(next);
      setStorageError(null);
    } catch {
      setStorageError('Local demo queue could not be saved. Check this browser’s local storage.');
      throw new Error('Local demo queue could not be saved.');
    }
  }, [hydrated]);

  const joinFlight = React.useCallback(async (flight: FlightView) => {
    // Validate before composing the next state so only actual live Production
    // flights can enter this local-only queue.
    createFullAppDemoQueueEntry(flight);
    await saveEntries(joinFullAppDemoQueue(entriesRef.current, flight));
  }, [saveEntries]);

  const leaveFlight = React.useCallback(async (flightId: string | number) => {
    await saveEntries(leaveFullAppDemoQueue(entriesRef.current, flightId));
  }, [saveEntries]);

  const value = React.useMemo(() => ({
    entries,
    hydrated,
    storageError,
    joinFlight,
    leaveFlight,
  }), [entries, hydrated, storageError, joinFlight, leaveFlight]);

  return (
    <FullAppDemoQueueContext.Provider value={value}>
      {children}
    </FullAppDemoQueueContext.Provider>
  );
}

export function useFullAppDemoQueue() {
  const context = React.useContext(FullAppDemoQueueContext);
  if (!context) {
    throw new Error('useFullAppDemoQueue must be used inside FullAppDemoQueueProvider.');
  }
  return context;
}
