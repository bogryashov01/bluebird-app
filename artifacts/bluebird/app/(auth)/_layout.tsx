import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
      <Stack.Screen name="splash" />
      <Stack.Screen name="welcome" />
      <Stack.Screen name="onboarding" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="airport-summary" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="phone" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="register" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="verify-code" options={{ animation: 'slide_from_right' }} />
    </Stack>
  );
}
