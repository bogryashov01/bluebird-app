import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import {
  isMemberMessageRealtimeEnabled,
  MEMBER_MESSAGE_GATEWAY_ORIGIN,
  MEMBER_MESSAGE_GATEWAY_URL,
  startMemberMessageRealtime,
  stopMemberMessageRealtime,
} from '@/lib/memberMessageRealtime';

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

export function MemberMessageRealtime() {
  const session = useClerkAuthSnapshot();
  const foreground = useForeground();
  const clerkUserId = session?.isLoaded === true && session.isSignedIn === true ? session.userId : null;
  const getToken = session?.getToken;

  useEffect(() => {
    const configuration = getMainBluebirdApiConfigurationOrNull();
    if (
      !foreground ||
      !clerkUserId ||
      !getToken ||
      configuration?.environment !== 'production' ||
      !isMemberMessageRealtimeEnabled()
    ) {
      stopMemberMessageRealtime();
      return;
    }
    const readToken = getToken;
    startMemberMessageRealtime({
      clerkUserId,
      gatewayUrl: process.env[MEMBER_MESSAGE_GATEWAY_URL],
      gatewayOrigin: process.env[MEMBER_MESSAGE_GATEWAY_ORIGIN],
      getAccessToken: () => readToken(),
    });
    return () => stopMemberMessageRealtime();
  }, [clerkUserId, foreground, getToken]);

  return null;
}
