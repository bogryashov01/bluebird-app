import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import {
  isMemberMessageRealtimeEnabled,
  resolveMemberMessageGatewayConfiguration,
  startMemberMessageRealtime,
  stopMemberMessageRealtime,
} from '@/lib/memberMessageRealtime';

type FreshTokenReader = (options?: { skipCache?: boolean }) => Promise<string | null>;

function useForeground(): boolean {
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active');
    });
    return () => subscription.remove();
  }, []);
  return foreground;
}

async function readFreshClerkToken(getToken: FreshTokenReader): Promise<string | null> {
  try {
    const token = await getToken({ skipCache: true });
    return typeof token === 'string' && token.trim() ? token : null;
  } catch {
    return null;
  }
}

export function MemberMessageRealtime() {
  const session = useClerkAuthSnapshot();
  const foreground = useForeground();
  const clerkUserId = session?.isLoaded === true && session.isSignedIn === true ? session.userId : null;
  const getToken = session?.getToken;

  useEffect(() => {
    const configuration = getMainBluebirdApiConfigurationOrNull();
    const gateway = resolveMemberMessageGatewayConfiguration();
    if (
      !foreground ||
      !clerkUserId ||
      !getToken ||
      !gateway ||
      configuration?.environment !== 'production' ||
      !isMemberMessageRealtimeEnabled()
    ) {
      stopMemberMessageRealtime();
      return;
    }
    const readToken = getToken as FreshTokenReader;
    startMemberMessageRealtime({
      clerkUserId,
      gatewayUrl: gateway.gatewayUrl,
      gatewayOrigin: gateway.gatewayOrigin,
      getAccessToken: () => readFreshClerkToken(readToken),
    });
    return () => stopMemberMessageRealtime();
  }, [clerkUserId, foreground, getToken]);

  return null;
}
