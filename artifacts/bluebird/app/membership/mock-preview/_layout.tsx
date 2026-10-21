import React from 'react';
import { Stack } from 'expo-router';
import { AppHeader } from '@/components/AppHeader';

const headerOptions = {
  header: (props: React.ComponentProps<typeof AppHeader>) => <AppHeader {...props} />,
} as const;

export default function MembershipMockPreviewLayout() {
  return (
    <Stack screenOptions={{ headerShown: true }}>
      <Stack.Screen
        name="index"
        options={{ title: 'Membership', ...headerOptions }}
      />
      <Stack.Screen
        name="plans"
        options={{ title: 'Public Plans', ...headerOptions }}
      />
    </Stack>
  );
}
