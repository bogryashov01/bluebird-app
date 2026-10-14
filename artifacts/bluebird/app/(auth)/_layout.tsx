import { Redirect, Stack, useSegments } from 'expo-router';
import { CLERK_AUTH_CONFIGURATION } from '@/lib/clerkAuthConfig';

export default function AuthLayout() {
  const segments = useSegments();
  const authScreen = segments[1];
  if (
    CLERK_AUTH_CONFIGURATION.enabled &&
    authScreen !== 'splash' &&
    authScreen !== 'welcome'
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
