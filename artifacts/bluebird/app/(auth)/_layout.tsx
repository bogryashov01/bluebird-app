import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
      <Stack.Screen name="splash" />
      <Stack.Screen name="onboarding" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="sign-in" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="create-account" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="verify-email" options={{ animation: 'slide_from_right' }} />
    </Stack>
  );
}
