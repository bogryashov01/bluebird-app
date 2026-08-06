import { Redirect } from 'expo-router';

/**
 * The tabs group default index redirects to Discover — the primary tab.
 * This prevents the scaffold placeholder from appearing as a routable screen.
 */
export default function TabsIndex() {
  return <Redirect href="/(tabs)/discover" />;
}
