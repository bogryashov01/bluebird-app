import React from 'react';
import { router } from 'expo-router';

/**
 * Keep old networking-profile deep links valid without leaving a second
 * networking editor in the app.
 */
export default function LegacyNetworkingProfileRoute() {
  React.useEffect(() => {
    router.replace('/account/personal-info' as any);
  }, []);

  return null;
}