/**
 * Dev-only authentication injection screen.
 * Accepts ?t=TOKEN&u=USER_B64&next=ROUTE, stores credentials,
 * then does a hard redirect to `next` so the auth state loads fresh.
 */
import { useEffect } from 'react';
import { View, ActivityIndicator, Platform } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_KEY = 'bluebird_token';
const USER_KEY  = 'bluebird_user';

export default function DevAuthScreen() {
  const params = useLocalSearchParams<{ t?: string; u?: string; next?: string }>();

  useEffect(() => {
    // In production builds this route is a no-op; redirect immediately.
    if (!__DEV__) {
      router.replace('/(tabs)/discover' as any);
      return;
    }

    const token  = params.t   as string | undefined;
    const userB64= params.u   as string | undefined;
    const next   = (params.next ?? '/(tabs)/discover') as string;

    if (!token || !userB64) {
      router.replace('/(tabs)/discover' as any);
      return;
    }
    try {
      const userJson = atob(userB64);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        // Store directly in localStorage so AuthProvider finds it on the fresh load
        window.localStorage.setItem(TOKEN_KEY, token);
        window.localStorage.setItem(USER_KEY, userJson);
        // Hard redirect — new page load picks up stored credentials
        window.location.href = next;
      } else {
        Promise.all([
          AsyncStorage.setItem(TOKEN_KEY, token),
          AsyncStorage.setItem(USER_KEY, userJson),
        ]).then(() => router.replace(next as any));
      }
    } catch {
      router.replace('/(tabs)/discover' as any);
    }
  }, []);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#060B1F' }}>
      <ActivityIndicator color="#1259F2" size="large" />
    </View>
  );
}
