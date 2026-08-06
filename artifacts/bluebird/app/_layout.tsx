import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { setBaseUrl } from '@workspace/api-client-react';
import { AuthProvider } from '@/context/AuthContext';
import { Platform } from 'react-native';

SplashScreen.preventAutoHideAsync();

// Set API base URL for Expo (absolute URL needed outside web proxy)
if (process.env.EXPO_PUBLIC_DOMAIN) {
  setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);
}


const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      retry: 1,
    },
  },
});

const HEADER_STYLE = {
  backgroundColor: '#0A1128',
} as const;

function RootLayoutNav() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="flight/[id]"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="flight/policy"
        options={{ headerShown: true, title: 'Flight Policy', headerStyle: HEADER_STYLE, headerTintColor: '#fff', headerTitleStyle: { fontFamily: 'Inter_600SemiBold' } }}
      />
      <Stack.Screen
        name="flight/confirmed"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="queue/join"
        options={{ headerShown: true, title: 'Join Queue', headerStyle: HEADER_STYLE, headerTintColor: '#fff', headerTitleStyle: { fontFamily: 'Inter_600SemiBold' } }}
      />
      <Stack.Screen
        name="queue/status"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="concierge"
        options={{ headerShown: true, title: 'AI Concierge', headerStyle: HEADER_STYLE, headerTintColor: '#fff', headerTitleStyle: { fontFamily: 'Inter_600SemiBold' } }}
      />
      <Stack.Screen
        name="referral"
        options={{ headerShown: true, title: 'Referral', headerStyle: HEADER_STYLE, headerTintColor: '#fff', headerTitleStyle: { fontFamily: 'Inter_600SemiBold' } }}
      />
      <Stack.Screen
        name="notifications"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="community"
        options={{ headerShown: true, title: 'Community', headerStyle: HEADER_STYLE, headerTintColor: '#fff', headerTitleStyle: { fontFamily: 'Inter_600SemiBold' } }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <AuthProvider>
                <RootLayoutNav />
              </AuthProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
