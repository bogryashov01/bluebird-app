import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FlightView } from './productionFlights';
import {
  deserializeFullAppDemoQueueState,
  createFullAppDemoQueueEntry,
  FULL_APP_DEMO_QUEUE_STORAGE_KEY,
  joinFullAppDemoQueue,
  leaveFullAppDemoQueue,
  addFullAppDemoPass,
  useFullAppDemoPass,
  transitionFullAppDemoQueueEntry,
  type FullAppDemoQueueState,
  type FullAppDemoQueueStatus,
  type FullAppDemoQueueEntry,
} from './fullAppDemoQueueState';

interface FullAppDemoQueueContextValue {
  entries: FullAppDemoQueueEntry[];
  passCount: number;
  hydrated: boolean;
  storageError: string | null;
  joinFlight: (flight: FlightView) => Promise<void>;
  leaveFlight: (flightId: string | number) => Promise<void>;
  buyPass: () => Promise<void>;
  usePass: (flightId: string | number) => Promise<void>;
  transition: (
    flightId: string | number,
    status: Exclude<FullAppDemoQueueStatus, 'won'>,
    changedPosition?: number,
  ) => Promise<void>;
}

const FullAppDemoQueueContext = React.createContext<FullAppDemoQueueContextValue | null>(null);

export function FullAppDemoQueueProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<FullAppDemoQueueState>({ entries: [], passCount: 0 });
  const [hydrated, setHydrated] = React.useState(false);
  const [storageError, setStorageError] = React.useState<string | null>(null);
  const stateRef = React.useRef(state);
  stateRef.current = state;

  React.useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(FULL_APP_DEMO_QUEUE_STORAGE_KEY)
      .then(async (raw) => {
        const safeState = deserializeFullAppDemoQueueState(raw);
        let parsed: unknown = safeState;
        if (raw !== null) {
          try {
            parsed = JSON.parse(raw) as unknown;
          } catch {
            parsed = null;
          }
        }
        if (raw !== null && JSON.stringify(parsed) !== JSON.stringify(safeState)) {
          await AsyncStorage.setItem(FULL_APP_DEMO_QUEUE_STORAGE_KEY, JSON.stringify(safeState));
        }
        if (cancelled) return;
        stateRef.current = safeState;
        setState(safeState);
      })
      .catch(() => {
        if (cancelled) return;
        stateRef.current = { entries: [], passCount: 0 };
        setState(stateRef.current);
        setStorageError('Local demo queue storage could not be read. Queue actions are unavailable.');
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveState = React.useCallback(async (next: FullAppDemoQueueState) => {
    if (!hydrated) throw new Error('Local demo queue is still loading.');
    if (storageError) throw new Error('Local demo queue storage is unavailable.');
    try {
      await AsyncStorage.setItem(FULL_APP_DEMO_QUEUE_STORAGE_KEY, JSON.stringify(next));
      stateRef.current = next;
      setState(next);
      setStorageError(null);
    } catch {
      setStorageError('Local demo queue could not be saved. Check this browser’s local storage.');
      throw new Error('Local demo queue could not be saved.');
    }
  }, [hydrated, storageError]);

  const joinFlight = React.useCallback(async (flight: FlightView) => {
    // The queue can include either a live read or a typed fallback fixture;
    // neither source can issue a mutation or public queue read here.
    createFullAppDemoQueueEntry(flight, stateRef.current.entries.length + 1);
    await saveState({
      ...stateRef.current,
      entries: joinFullAppDemoQueue(stateRef.current.entries, flight),
    });
  }, [saveState]);

  const leaveFlight = React.useCallback(async (flightId: string | number) => {
    await saveState({
      ...stateRef.current,
      entries: leaveFullAppDemoQueue(stateRef.current.entries, flightId),
    });
  }, [saveState]);

  const buyPass = React.useCallback(async () => {
    await saveState(addFullAppDemoPass(stateRef.current));
  }, [saveState]);

  const usePass = React.useCallback(async (flightId: string | number) => {
    await saveState(useFullAppDemoPass(stateRef.current, flightId));
  }, [saveState]);

  const transition = React.useCallback(async (
    flightId: string | number,
    status: Exclude<FullAppDemoQueueStatus, 'won'>,
    changedPosition?: number,
  ) => {
    await saveState({
      ...stateRef.current,
      entries: transitionFullAppDemoQueueEntry(stateRef.current.entries, flightId, status, changedPosition),
    });
  }, [saveState]);

  const value = React.useMemo(() => ({
    entries: state.entries,
    passCount: state.passCount,
    hydrated,
    storageError,
    joinFlight,
    leaveFlight,
    buyPass,
    usePass,
    transition,
  }), [state, hydrated, storageError, joinFlight, leaveFlight, buyPass, usePass, transition]);

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

export function useFullAppDemoQueueOptional() {
  return React.useContext(FullAppDemoQueueContext);
}
