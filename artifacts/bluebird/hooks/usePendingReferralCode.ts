import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  readPendingReferralCode,
  savePendingReferralCode,
} from '@/lib/pendingReferralCode';
import { isReferralCode, normalizeReferralCode } from '@/lib/referralProgram';

export function usePendingReferralCode(routeCode?: string) {
  const candidate = typeof routeCode === 'string' ? normalizeReferralCode(routeCode) : '';
  const [state, setState] = useState<{ code: string; ready: boolean; error: string | null }>({
    code: isReferralCode(candidate) ? candidate : '',
    ready: false,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    if (isReferralCode(candidate)) {
      void savePendingReferralCode(candidate, AsyncStorage)
        .then((code) => {
          if (!cancelled) setState({ code, ready: true, error: null });
        })
        .catch(() => {
          if (!cancelled) setState({ code: '', ready: true, error: 'Your invite could not be saved on this device.' });
        });
    } else {
      void readPendingReferralCode(AsyncStorage)
        .then((code) => {
          if (!cancelled) setState({ code: code ?? '', ready: true, error: null });
        })
        .catch(() => {
          if (!cancelled) setState({ code: '', ready: true, error: 'Your saved invite could not be restored.' });
        });
    }
    return () => { cancelled = true; };
  }, [candidate]);

  return state;
}
