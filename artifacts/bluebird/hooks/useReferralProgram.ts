import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import referralDemoFixture from '@/fixtures/referral-demo.json';
import { useAuth } from '@/context/AuthContext';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import { createMainBluebirdApiIntegration } from '@/lib/mainBluebirdApi';
import { createMockReferralRepository, type MockReferralFixture } from '@/lib/mockReferralRepository';
import { createProductionReferralRepository, type ReferralRepository, type ReferralSnapshot } from '@/lib/referralProgram';

export type ReferralProgramState =
  | { status: 'loading'; snapshot: null; error: null }
  | { status: 'error'; snapshot: null; error: string }
  | { status: 'loaded'; snapshot: ReferralSnapshot; error: null };

const EMPTY_LOADING_STATE: ReferralProgramState = { status: 'loading', snapshot: null, error: null };
const EMPTY_ERROR_STATE = 'Referral details are unavailable because the selected Main API or Clerk session is not ready.';

function errorMessage(error: unknown): string {
  const typed = error as { code?: string; status?: number; message?: string };
  if (typed?.code === 'network' || typed?.code === 'timeout') {
    return 'Bluebird could not be reached. Check your connection and try again.';
  }
  if (typed?.code === 'session_expired' || typed?.status === 401) {
    return 'Your sign-in has expired. Sign in again, then reopen Referral Program.';
  }
  return 'Referral details are unavailable right now. Please try again.';
}

export function useReferralProgram() {
  const { authMode, demoMode } = useAuth();
  const clerkSession = useClerkAuthSnapshot();
  const configuration = getMainBluebirdApiConfigurationOrNull();
  const sessionRef = useRef(clerkSession);
  sessionRef.current = clerkSession;
  const accountId = clerkSession?.userId ?? null;
  const developmentBuild = typeof __DEV__ !== 'undefined' && __DEV__;
  const useMock = developmentBuild && demoMode;

  const mockRepository = useMemo(() => {
    if (!useMock) return null;
    return createMockReferralRepository({
      storage: AsyncStorage,
      accountId: 'full-app-demo-account',
      fixture: referralDemoFixture as MockReferralFixture,
    });
  }, [useMock]);

  const productionApi = useMemo(() => {
    if (!configuration) return null;
    try {
      return createMainBluebirdApiIntegration({
        configuration,
        tokenProvider: {
          environment: configuration.environment,
          getVerifiedAccessToken: async () => {
            const current = sessionRef.current;
            if (
              !current ||
              current.isLoaded !== true ||
              current.isSignedIn !== true ||
              current.userId !== accountId
            ) return null;
            return current.getToken();
          },
        },
      }).authenticated;
    } catch {
      return null;
    }
  }, [configuration?.environment, configuration?.apiBaseUrl, configuration?.clerkPublishableKey, accountId]);

  const productionRepository: ReferralRepository | null = useMemo(() => {
    if (authMode !== 'clerk' || !accountId || !productionApi) return null;
    return createProductionReferralRepository(productionApi);
  }, [authMode, accountId, productionApi]);

  const repository = useMock ? mockRepository : productionRepository;
  const identity = useMock ? 'mock:full-app-demo-account' : `clerk:${accountId ?? 'signed-out'}`;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ identity: string; value: ReferralProgramState }>({
    identity: '',
    value: EMPTY_LOADING_STATE,
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setState({ identity, value: EMPTY_LOADING_STATE });
    if (!repository) {
      setState({
        identity,
        value: {
          status: 'error',
          snapshot: null,
          error: authMode !== 'clerk' ? 'Referral Program requires a signed-in Bluebird account.' : EMPTY_ERROR_STATE,
        },
      });
      return () => controller.abort();
    }
    void repository.getReferralSnapshot(controller.signal)
      .then((snapshot) => {
        if (!cancelled) setState({ identity, value: { status: 'loaded', snapshot, error: null } });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ identity, value: { status: 'error', snapshot: null, error: errorMessage(error) } });
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [repository, identity, attempt, authMode]);

  const refresh = useCallback(() => setAttempt((value) => value + 1), []);
  const simulateQualifyingActivation = useCallback(async () => {
    if (!useMock || !mockRepository) {
      throw new Error('Local referral activation is available only in the development demo.');
    }
    setBusy(true);
    try {
      const snapshot = await mockRepository.simulateQualifyingActivation();
      setState({ identity, value: { status: 'loaded', snapshot, error: null } });
    } finally {
      setBusy(false);
    }
  }, [useMock, mockRepository]);

  const visibleState = state.identity === identity ? state.value : EMPTY_LOADING_STATE;
  const isReadyForIdentity = visibleState.status === 'loaded';

  return {
    state: visibleState,
    isLoading: visibleState.status === 'loading',
    isBusy: busy,
    canSimulateActivation: useMock && isReadyForIdentity,
    refresh,
    simulateQualifyingActivation,
  };
}
