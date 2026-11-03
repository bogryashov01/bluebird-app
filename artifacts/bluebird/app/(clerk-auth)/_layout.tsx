import { Stack } from 'expo-router';
import { useBluebirdStackScreenOptions } from '@/lib/bluebirdNavigationTheme';

export default function ClerkAuthLayout() {
  const stackScreenOptions = useBluebirdStackScreenOptions();
  return (
    <Stack
      screenOptions={{
        ...stackScreenOptions,
        headerShown: false,
        animation: 'fade',
      }}
    >
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="sign-up" />
      <Stack.Screen name="signed-in" />
      <Stack.Screen name="development" />
    </Stack>
  );
}
