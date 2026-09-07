import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * useState that persists to AsyncStorage under `key`.
 * Loads the stored value on mount; writes on every change after hydration.
 */
export function usePersistedState<T>(key: string, initialValue: T) {
  const [state, setState] = React.useState<T>(initialValue);
  const [hydratedKey, setHydratedKey] = React.useState<string | null>(null);
  const initialValueRef = React.useRef(initialValue);
  initialValueRef.current = initialValue;

  React.useEffect(() => {
    let cancelled = false;
    setHydratedKey(null);
    AsyncStorage.getItem(key)
      .then((raw) => {
        if (cancelled) return;
        setState(raw != null ? JSON.parse(raw) as T : initialValueRef.current);
      })
      .catch(() => {
        if (!cancelled) setState(initialValueRef.current);
      })
      .finally(() => {
        if (!cancelled) setHydratedKey(key);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  React.useEffect(() => {
    if (hydratedKey !== key) return;
    AsyncStorage.setItem(key, JSON.stringify(state)).catch(() => {});
  }, [key, state, hydratedKey]);

  return [state, setState, hydratedKey === key] as const;
}
