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
import { Redirect, Stack, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { setBaseUrl } from '@workspace/api-client-react';
import { AuthProvider } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { useColors } from '@/hooks/useColors';
import { QueueConfirmationWatcher } from '@/lib/queueCelebration';
import { DormantClerkProvider } from '@/lib/dormantClerkIntegration';
import { CLERK_AUTH_CONFIGURATION } from '@/lib/clerkAuthConfig';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '@/context/AuthContext';
import { shouldRedirectClerkRoute } from '@/lib/clerkAuthSession';
import { CLERK_MEMBER_NAVIGATION_READINESS } from '@/lib/productionAuthState';
import { isClerkHomeAvailable } from '@/lib/clerkMemberResolution';
import { canAccessClerkProfileOnboardingRoute } from '@/lib/clerkProfileOnboarding';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { isDevelopmentPreviewRoute } from '@/lib/developmentPreview';

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
  const segments = useSegments();
  const { authMode, clerkSignedIn, clerkMemberResolution, memberAccessResolved } = useAuth();
  const clerkSession = useClerkAuthSnapshot();
  const isDevelopmentPreview = isDevelopmentPreviewRoute(
    segments,
    typeof __DEV__ !== 'undefined' && __DEV__,
  );
  const isClerkProfileRoute = segments[0] === 'account' && segments[1] === 'bluebird-profile';
  if (isClerkProfileRoute && authMode !== 'clerk') {
    return <Redirect href="/(auth)/welcome" />;
  }
  const registeredHomeReady = isClerkHomeAvailable(
    clerkMemberResolution,
    CLERK_MEMBER_NAVIGATION_READINESS,
  );
  const incompleteProfileOnboardingRoute =
    authMode === 'clerk' &&
    clerkSession?.isLoaded === true &&
    clerkSession.isSignedIn === true &&
    canAccessClerkProfileOnboardingRoute(
      segments,
      clerkMemberResolution,
      clerkSession.userId,
    );
  const clerkRouteGuarded =
    authMode === 'clerk' &&
    !incompleteProfileOnboardingRoute &&
    !isDevelopmentPreview &&
    shouldRedirectClerkRoute(segments, memberAccessResolved, registeredHomeReady);
  if (clerkRouteGuarded) {
    return <Redirect href={clerkSignedIn ? '/(clerk-auth)/signed-in' : '/(clerk-auth)/sign-in'} />;
  }
  // Custom inset-aware header: the default native-stack header rendered
  // behind the iPhone notch/Dynamic Island on these routes.
  const headerOptions = {
    header: (props: React.ComponentProps<typeof AppHeader>) => <AppHeader {...props} />,
  } as const;
  return (
    <>
    <StatusBar style={colors.scheme === 'dark' ? 'light' : 'dark'} />
    {/* App-wide waiting→confirmed watcher: celebrates a confirmed seat even
        when the member isn't on the Queue Status screen. */}
    <QueueConfirmationWatcher />
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      {CLERK_AUTH_CONFIGURATION.authExpected && (
        <Stack.Screen name="(clerk-auth)" options={{ headerShown: false }} />
      )}
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="development-preview/index" options={{ headerShown: false }} />
      <Stack.Screen name="development-preview/[screen]" options={{ headerShown: false }} />
      <Stack.Screen name="development-preview/show" options={{ headerShown: false }} />
      <Stack.Screen name="join/[code]" options={{ headerShown: false }} />
      <Stack.Screen
        name="flight/[id]"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="flight/skip-line-pass"
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
        name="trip/[id]/passengers"
        options={{ headerShown: true, title: 'Passenger Information', ...headerOptions }}
      />
      <Stack.Screen
        name="trip/[id]/index"
        options={{ headerShown: true, title: 'Trip Details', ...headerOptions }}
      />
      <Stack.Screen
        name="trip/[id]/boarding-pass"
        options={{ headerShown: true, title: 'Boarding Pass', ...headerOptions }}
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
        name="queue/payment-review"
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
        name="queue/production-unavailable"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="queue/dev-preview"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="membership/dev-preview"
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
        name="airport-picker"
        options={{ headerShown: false, presentation: 'modal' }}
      />
      <Stack.Screen
        name="registration-review"
        options={{ headerShown: false, presentation: 'card', gestureEnabled: false }}
      />
      <Stack.Screen
        name="community"
        options={{ headerShown: true, title: 'Community', ...headerOptions }}
      />
      <Stack.Screen
        name="networking/profile"
        options={{ headerShown: true, title: 'Personal Information', ...headerOptions }}
      />
      <Stack.Screen
        name="networking/requests"
        options={{ headerShown: true, title: 'Connection Requests', ...headerOptions }}
      />
      <Stack.Screen
        name="networking/connections"
        options={{ headerShown: true, title: 'Connections', ...headerOptions }}
      />
      <Stack.Screen
        name="networking/connections/[id]"
        options={{ headerShown: true, title: 'Conversation', ...headerOptions }}
      />
      <Stack.Screen
        name="upgrade/[tier]"
        options={{ headerShown: true, title: 'Upgrade Membership', ...headerOptions }}
      />
      <Stack.Screen
        name="membership/join"
        options={{ headerShown: true, title: 'Join Bluebird', ...headerOptions }}
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
        name="membership/family"
        options={{ headerShown: true, title: 'Family/Corporate', ...headerOptions }}
      />
      <Stack.Screen
        name="account/personal-info"
        options={{ headerShown: true, title: 'Personal Information', ...headerOptions }}
      />
      <Stack.Screen
        name="account/bluebird-profile"
        options={{ headerShown: true, title: 'Bluebird Profile', ...headerOptions }}
      />
      <Stack.Screen
        name="account/payment-methods"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="account/contacts"
        options={{ headerShown: true, title: 'Family/Corporate', ...headerOptions }}
      />
      <Stack.Screen
        name="join/family/[token]"
        options={{ headerShown: true, title: 'Family Invitation', ...headerOptions }}
      />
      <Stack.Screen
        name="account/passengers"
        options={{ headerShown: true, title: 'Passengers', ...headerOptions }}
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

  const app = (
    <SafeAreaProvider>
      <ThemeProvider>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <KeyboardProvider>
                <RoutedRoot />
              </KeyboardProvider>
            </GestureHandlerRootView>
          </QueryClientProvider>
        </ErrorBoundary>
      </ThemeProvider>
    </SafeAreaProvider>
  );

  return app;
}

function RoutedRoot() {
  const segments = useSegments();
  const isDevelopmentPreview = isDevelopmentPreviewRoute(
    segments,
    typeof __DEV__ !== 'undefined' && __DEV__,
  );

  const authenticatedApp = (
    <AuthProvider>
      <RootLayoutNav />
    </AuthProvider>
  );

  return (
    // Keep an identity-free context mounted across the root navigation switch.
    // Expo Router may retain an auth route layout for a transition frame after
    // the active segments change to Preview; that layout calls useAuth() while
    // its real authenticated subtree is being removed.
    <AuthProvider previewOnly>
      {isDevelopmentPreview ? (
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="development-preview/index" options={{ headerShown: false }} />
          <Stack.Screen name="development-preview/[screen]" options={{ headerShown: false }} />
          <Stack.Screen name="development-preview/show" options={{ headerShown: false }} />
          <Stack.Screen name="queue/dev-preview" options={{ headerShown: false }} />
          <Stack.Screen name="membership/dev-preview" options={{ headerShown: false }} />
        </Stack>
      ) : CLERK_AUTH_CONFIGURATION.enabled ? (
        <DormantClerkProvider>{authenticatedApp}</DormantClerkProvider>
      ) : (
        authenticatedApp
      )}
    </AuthProvider>
  );
}
