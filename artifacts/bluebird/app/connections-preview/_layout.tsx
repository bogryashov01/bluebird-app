import { Stack } from 'expo-router';
import { useBluebirdStackScreenOptions } from '@/lib/bluebirdNavigationTheme';

export default function ConnectionsPreviewLayout() {
  const stackScreenOptions = useBluebirdStackScreenOptions();
  return <Stack screenOptions={{ ...stackScreenOptions, headerShown: false }} />;
}
