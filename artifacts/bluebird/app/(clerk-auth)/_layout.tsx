import { Stack } from 'expo-router';

export default function ClerkAuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'fade',
      }}
    >
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="sign-up" />
      <Stack.Screen name="signed-in" />
    </Stack>
  );
}
