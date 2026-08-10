import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * useState that persists to AsyncStorage under `key`.
 * Loads the stored value on mount; writes on every change after hydration.
 */
export function usePersistedState<T>(key: string, initialValue: T) {
  const [state, setState] = React.useState<T>(initialValue);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(key)
      .then((raw) => {
        if (!cancelled && raw != null) setState(JSON.parse(raw) as T);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  React.useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(key, JSON.stringify(state)).catch(() => {});
  }, [key, state, hydrated]);

  return [state, setState, hydrated] as const;
}
