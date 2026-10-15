import { Redirect, Stack, useSegments } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { canAccessClerkProfileOnboardingRoute } from '@/lib/clerkProfileOnboarding';
import { CLERK_AUTH_CONFIGURATION } from '@/lib/clerkAuthConfig';

export default function AuthLayout() {
  const segments = useSegments();
  const authScreen = segments[1];
  const { authMode, clerkMemberResolution } = useAuth();
  const clerkSession = useClerkAuthSnapshot();
  const canOpenWelcomeTour =
    authMode === 'clerk' &&
    clerkSession?.isLoaded === true &&
    clerkSession.isSignedIn === true &&
    canAccessClerkProfileOnboardingRoute(
      segments,
      clerkMemberResolution,
      clerkSession.userId,
    );
  if (
    CLERK_AUTH_CONFIGURATION.enabled &&
    authScreen !== 'splash' &&
    authScreen !== 'welcome' &&
    !(authScreen === 'welcome-tour' && canOpenWelcomeTour)
  ) {
    return <Redirect href="/(clerk-auth)/sign-in" />;
  }

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
      <Stack.Screen name="splash" />
      <Stack.Screen name="welcome" />
      <Stack.Screen name="onboarding" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="airport-summary" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="phone" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="verify-code" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="complete-registration" options={{ animation: 'slide_from_right', gestureEnabled: false }} />
      <Stack.Screen name="welcome-tour" options={{ animation: 'slide_from_right', gestureEnabled: false }} />
    </Stack>
  );
}
