import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AppHeader } from '@/components/AppHeader';
import { ConciergeHeader } from '@/components/ConciergeHeader';
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
import { ThemeProvider } from '@/context/ThemeContext';
import { useColors } from '@/hooks/useColors';
import { StatusBar } from 'expo-status-bar';

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

function RootLayoutNav() {
  const colors = useColors();
  // Custom inset-aware header: the default native-stack header rendered
  // behind the iPhone notch/Dynamic Island on these routes.
  const headerOptions = {
    header: (props: React.ComponentProps<typeof AppHeader>) => <AppHeader {...props} />,
  } as const;
  return (
    <>
    <StatusBar style={colors.scheme === 'dark' ? 'light' : 'dark'} />
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="flight/[id]"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="flight/policy"
        options={{ headerShown: true, title: 'Flight Policy', ...headerOptions }}
      />
      <Stack.Screen
        name="flight/confirmed"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="queue/join"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="queue/intl-notice"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="queue/joined"
        options={{ headerShown: false, gestureEnabled: false }}
      />
      <Stack.Screen
        name="queue/pass"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="queue/buy-pass"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="queue/status"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="concierge"
        options={{
          headerShown: true,
          title: 'AI Concierge',
          header: (props: React.ComponentProps<typeof ConciergeHeader>) => <ConciergeHeader {...props} />,
        }}
      />
      <Stack.Screen
        name="referral"
        options={{ headerShown: true, title: 'Referral', ...headerOptions }}
      />
      <Stack.Screen
        name="notifications"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="community"
        options={{ headerShown: true, title: 'Community', ...headerOptions }}
      />
      <Stack.Screen
        name="upgrade/[tier]"
        options={{ headerShown: true, title: 'Upgrade Membership', ...headerOptions }}
      />
      <Stack.Screen
        name="membership/plans"
        options={{ headerShown: true, title: 'All Plans', ...headerOptions }}
      />
      <Stack.Screen
        name="membership/manage"
        options={{ headerShown: true, title: 'Manage Plan', ...headerOptions }}
      />
      <Stack.Screen
        name="account/personal-info"
        options={{ headerShown: true, title: 'Personal Information', ...headerOptions }}
      />
      <Stack.Screen
        name="account/payment-methods"
        options={{ headerShown: true, title: 'Payment Methods', ...headerOptions }}
      />
      <Stack.Screen
        name="account/contacts"
        options={{ headerShown: true, title: 'Connect Contacts', ...headerOptions }}
      />
      <Stack.Screen
        name="support/help-center"
        options={{ headerShown: true, title: 'Help Center', ...headerOptions }}
      />
      <Stack.Screen
        name="support/legal"
        options={{ headerShown: true, title: 'Legal', ...headerOptions }}
      />
    </Stack>
    </>
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
              <ThemeProvider>
                <AuthProvider>
                  <RootLayoutNav />
                </AuthProvider>
              </ThemeProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
