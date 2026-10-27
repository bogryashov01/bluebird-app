import React, { useCallback, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEMO_JOIN_FLOW_SETTING_VALUE,
  DEMO_SIMULATED_PASS_BALANCE,
  applySimulatedSkipLine,
  confirmDemoFlight,
  createDemoJoin,
  demoTripFromEntry,
  isDemoJoinFlowAllowed,
  parseStoredDemoEntry,
  readDemoJoinSetting,
  simulateDemoWinner,
  type DemoJoinEntry,
  type DemoJoinFlightInput,
  type DemoJoinTrip,
} from '@/lib/demoJoinFlow';

const SETTING_KEY = 'bluebird.demo-join-flow.enabled';
const ENTRY_KEY = 'bluebird.demo-join-flow.entry';
const PASS_KEY = 'bluebird.demo-join-flow.passes';

interface DemoJoinFlowContextValue {
  available: boolean;
  enabled: boolean;
  entry: DemoJoinEntry | null;
  demoTrip: DemoJoinTrip | null;
  passBalance: number;
  setEnabled: (enabled: boolean) => void;
  join: (flight: DemoJoinFlightInput) => DemoJoinEntry | null;
  simulateWinner: () => DemoJoinEntry | null;
  confirmFlight: () => DemoJoinEntry | null;
  useSimulatedPass: () => DemoJoinEntry | null;
}

const unavailable: DemoJoinFlowContextValue = {
  available: false,
  enabled: false,
  entry: null,
  demoTrip: null,
  passBalance: 0,
  setEnabled: () => undefined,
  join: () => null,
  simulateWinner: () => null,
  confirmFlight: () => null,
  useSimulatedPass: () => null,
};

const DemoJoinFlowContext = React.createContext<DemoJoinFlowContextValue>(unavailable);

function isDevelopmentBuild(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__ === true;
}

export function DemoJoinFlowProvider({ children }: { children: React.ReactNode }) {
  const available = isDevelopmentBuild();
  const [setting, setSetting] = useState(false);
  const [entry, setEntry] = useState<DemoJoinEntry | null>(null);
  const [passBalance, setPassBalance] = useState(DEMO_SIMULATED_PASS_BALANCE);

  useEffect(() => {
    if (!available) return undefined;
    let cancelled = false;
    void Promise.all([
      AsyncStorage.getItem(SETTING_KEY),
      AsyncStorage.getItem(ENTRY_KEY),
      AsyncStorage.getItem(PASS_KEY),
    ]).then(([storedSetting, storedEntry, storedPasses]) => {
      if (cancelled) return;
      setSetting(readDemoJoinSetting(storedSetting));
      setEntry(parseStoredDemoEntry(storedEntry));
      const parsedPasses = Number(storedPasses);
      if (Number.isSafeInteger(parsedPasses) && parsedPasses >= 0) setPassBalance(parsedPasses);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [available]);

  const enabled = isDemoJoinFlowAllowed(available, setting);
  const visibleEntry = enabled ? entry : null;

  const persistEntry = useCallback((next: DemoJoinEntry | null) => {
    setEntry(next);
    if (!next) {
      void AsyncStorage.removeItem(ENTRY_KEY).catch(() => undefined);
      return;
    }
    void AsyncStorage.setItem(ENTRY_KEY, JSON.stringify(next)).catch(() => undefined);
  }, []);

  const value = useMemo<DemoJoinFlowContextValue>(() => ({
    available,
    enabled,
    entry: visibleEntry,
    demoTrip: demoTripFromEntry(visibleEntry),
    passBalance: enabled ? passBalance : 0,
    setEnabled: (next: boolean) => {
      if (!available) return;
      setSetting(next);
      void AsyncStorage.setItem(SETTING_KEY, next ? DEMO_JOIN_FLOW_SETTING_VALUE : 'disabled').catch(() => undefined);
    },
    join: (flight: DemoJoinFlightInput) => {
      if (!isDemoJoinFlowAllowed(available, setting)) return null;
      const created = createDemoJoin(flight);
      if (!created) return null;
      persistEntry(created);
      return created;
    },
    simulateWinner: () => {
      if (!visibleEntry) return null;
      const next = simulateDemoWinner(visibleEntry);
      if (!next) return null;
      persistEntry(next);
      return next;
    },
    confirmFlight: () => {
      if (!visibleEntry) return null;
      const next = confirmDemoFlight(visibleEntry);
      if (!next) return null;
      persistEntry(next);
      return next;
    },
    useSimulatedPass: () => {
      if (!visibleEntry) return null;
      const next = applySimulatedSkipLine(visibleEntry, passBalance);
      if (!next) return null;
      const remaining = passBalance - 1;
      setPassBalance(remaining);
      void AsyncStorage.setItem(PASS_KEY, String(remaining)).catch(() => undefined);
      persistEntry(next);
      return next;
    },
  }), [available, enabled, passBalance, persistEntry, setting, visibleEntry]);

  return <DemoJoinFlowContext.Provider value={value}>{children}</DemoJoinFlowContext.Provider>;
}

export function useDemoJoinFlow(): DemoJoinFlowContextValue {
  return React.useContext(DemoJoinFlowContext);
}
