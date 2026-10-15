import React from 'react';
import { Redirect } from 'expo-router';
import { ClerkDevelopmentToolsScreen } from '@/components/ClerkDevelopmentToolsScreen';
import { CLERK_AUTH_CONFIGURATION } from '@/lib/clerkAuthConfig';

export default function ClerkDevelopmentRoute() {
  if (!CLERK_AUTH_CONFIGURATION.enabled) {
    return <Redirect href="/(auth)/welcome" />;
  }
  return <ClerkDevelopmentToolsScreen />;
}
