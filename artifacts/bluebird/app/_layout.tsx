import React, { useEffect } from 'react';
import { Platform, Text, View } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { setBaseUrl, setRequestGuard } from '@workspace/api-client-react';
import { AuthProvider, DemoAuthProvider } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { useColors } from '@/hooks/useColors';
import { QueueConfirmationWatcher } from '@/lib/queueCelebration';
import { DormantClerkProvider } from '@/lib/dormantClerkIntegration';
import { CLERK_AUTH_CONFIGURATION, shouldShowClerkConfigurationError } from '@/lib/clerkAuthConfig';
import { ClerkAuthConfigurationError } from '@/components/ClerkAuthConfigurationError';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '@/context/AuthContext';
import { shouldRedirectClerkRoute } from '@/lib/clerkAuthSession';
import { CLERK_MEMBER_NAVIGATION_READINESS } from '@/lib/productionAuthState';
import { isClerkHomeAvailable } from '@/lib/clerkMemberResolution';
import { canAccessClerkProfileOnboardingRoute } from '@/lib/clerkProfileOnboarding';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import {
  getMembershipDataModeConfiguration,
  isMembershipMockPreviewLocation,
} from '@/lib/membershipDataMode';
import {
  getFullAppDemoConfiguration,
  isFullAppDemoAllowedRoute,
  isFullAppDemoRoute,
} from '@/lib/fullAppDemo';
import { FullAppDemoQueueProvider } from '@/lib/fullAppDemoQueue';
import {
  isNativeProductionAuthTestEnabled,
  isNativeProductionAuthTestRequestAllowed,
} from '@/lib/nativeAuthTestPolicy';

SplashScreen.preventAutoHideAsync();

// The restricted native test build pins the legacy client to Production and
// allows it to make only the authenticated /api/me read. It never trusts the
// injected EXPO_PUBLIC_DOMAIN, which may target a Preview or legacy service.
if (isNativeProductionAuthTestEnabled()) {
  setBaseUrl('https://bluebirdjets.com');
  setRequestGuard(isNativeProductionAuthTestRequestAllowed);
} else {
  setRequestGuard(null);
}

// Set API base URL for Expo (absolute URL needed outside web proxy).
if (!isNativeProductionAuthTestEnabled() && process.env.EXPO_PUBLIC_DOMAIN) {
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
      <Stack.Screen name="membership/mock-preview" options={{ headerShown: false }} />
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
        name="concierge"
        options={{
          headerShown: true,
          title: 'AI Concierge',
          header: (props: React.ComponentProps<typeof ConciergeHeader>) => <ConciergeHeader {...props} />,
        }}
      />
      <Stack.Screen
        name="referral"
        options={{ headerShown: true, title: 'Referral Program', ...headerOptions }}
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
  const pathname = Platform.OS === 'web' && typeof window !== 'undefined'
    ? window.location.pathname
    : '';
  const isMembershipMockPreview = isMembershipMockPreviewLocation(pathname, segments);
  const fullAppDemo = getFullAppDemoConfiguration();

  // This development-only branch is selected before AuthProvider, Clerk, or
  // authenticated-data observers can mount.
  if (fullAppDemo.enabled) {
    return isFullAppDemoAllowedRoute(pathname, segments)
      ? <FullAppDemoRoot />
      : <FullAppDemoUnavailable />;
  }

  // An explicit demo URL never falls through to ordinary member routes in a
  // release runtime; the development gate above is required to enter it.
  if (isFullAppDemoRoute(pathname, segments)) return <FullAppDemoUnavailable />;

  // Use the browser URL as well as Expo Router's segments so a direct Replit
  // Membership Preview load never mounts Clerk or authenticated-data observers first.
  if (isMembershipMockPreview) return <MembershipMockPreviewRoot />;

  // A disabled provider cannot finish loading a session. Show the setup
  // blocker before mounting auth observers or waiting for that session.
  if (shouldShowClerkConfigurationError(CLERK_AUTH_CONFIGURATION)) {
    return <ClerkAuthConfigurationError />;
  }

  const authenticatedApp = (
    <AuthProvider>
      <RootLayoutNav />
    </AuthProvider>
  );

  return CLERK_AUTH_CONFIGURATION.enabled
    ? <DormantClerkProvider>{authenticatedApp}</DormantClerkProvider>
    : authenticatedApp;
}

function FullAppDemoRoot() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const headerOptions = {
    header: (props: React.ComponentProps<typeof AppHeader>) => <AppHeader {...props} />,
  } as const;
  return (
    <DemoAuthProvider>
      <FullAppDemoQueueProvider>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <StatusBar style={colors.scheme === 'dark' ? 'light' : 'dark'} />
          <View
            testID="full-app-demo-banner"
            accessibilityLabel="DEMO MODE"
            style={{
              minHeight: 34 + insets.top,
              paddingTop: insets.top,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.backgroundMid,
            }}
          >
            <Text style={{ color: colors.textOnBrand, fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1 }}>
              DEMO MODE
            </Text>
          </View>
          <Stack screenOptions={{ contentStyle: { backgroundColor: colors.background } }}>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="membership/plans"
              options={{ headerShown: true, title: 'All Plans', ...headerOptions }}
            />
            <Stack.Screen
              name="membership/mock-preview"
              options={{ headerShown: true, title: 'Membership', ...headerOptions }}
            />
            <Stack.Screen
              name="demo/flight/[id]"
              options={{ headerShown: false }}
            />
            <Stack.Screen name="flight/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="flight/policy" options={{ headerShown: true, title: 'Flight Policy', ...headerOptions }} />
            <Stack.Screen name="flight/confirmed" options={{ headerShown: false }} />
            <Stack.Screen name="queue/join" options={{ headerShown: false }} />
            <Stack.Screen name="queue/intl-notice" options={{ headerShown: false }} />
            <Stack.Screen name="queue/payment-review" options={{ headerShown: false }} />
            <Stack.Screen name="queue/joined" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="queue/status" options={{ headerShown: false }} />
            <Stack.Screen name="queue/pass" options={{ headerShown: false }} />
            <Stack.Screen name="queue/buy-pass" options={{ headerShown: false }} />
            <Stack.Screen name="upgrade/[tier]" options={{ headerShown: true, title: 'Upgrade Membership', ...headerOptions }} />
          </Stack>
        </View>
      </FullAppDemoQueueProvider>
    </DemoAuthProvider>
  );
}

function FullAppDemoUnavailable() {
  const colors = useColors();
  return (
    <View
      testID="full-app-demo-denied"
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: colors.background }}
    >
      <Text style={{ color: colors.foreground, fontFamily: 'Inter_700Bold', fontSize: 20 }}>
        Demo unavailable
      </Text>
      <Text style={{ color: colors.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 14, marginTop: 8, textAlign: 'center' }}>
        The full-app demo is available only in the development Preview.
      </Text>
    </View>
  );
}

function MembershipMockPreviewRoot() {
  const colors = useColors();
  const configuration = getMembershipDataModeConfiguration();
  return (
    <>
      <StatusBar style={colors.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Screen
          name="membership/mock-preview"
          options={{ headerShown: configuration.mockPreviewAllowed }}
        />
      </Stack>
    </>
  );
}
