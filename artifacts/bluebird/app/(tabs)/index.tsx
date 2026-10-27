import { Redirect } from 'expo-router';
import { useJoinNavDecision } from '@/lib/joinNavDiagnostics';

/**
 * The tabs group default index redirects to Discover — the primary tab.
 * This prevents the scaffold placeholder from appearing as a routable screen.
 */
export default function TabsIndex() {
  useJoinNavDecision('tabs-index', 'discover', {
    reason: 'tabs-index',
    destination: '/(tabs)/discover',
  });
  return <Redirect href="/(tabs)/discover" />;
}
