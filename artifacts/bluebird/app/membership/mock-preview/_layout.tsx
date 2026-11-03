import React from 'react';
import { Stack } from 'expo-router';
import { AppHeader } from '@/components/AppHeader';
import { useBluebirdStackScreenOptions } from '@/lib/bluebirdNavigationTheme';

const headerOptions = {
  header: (props: React.ComponentProps<typeof AppHeader>) => <AppHeader {...props} />,
} as const;

export default function MembershipMockPreviewLayout() {
  const stackScreenOptions = useBluebirdStackScreenOptions();
  return (
    <Stack screenOptions={{ ...stackScreenOptions, headerShown: true }}>
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
