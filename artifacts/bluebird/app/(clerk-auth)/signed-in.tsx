import React from 'react';
import { Redirect } from 'expo-router';
import { ClerkSignedInScreen } from '@/components/ClerkSignedInScreen';
import { canAccessClerkAuthRoutes, CLERK_AUTH_CONFIGURATION } from '@/lib/clerkAuthConfig';

export default function ClerkSignedInRoute() {
  if (!canAccessClerkAuthRoutes(CLERK_AUTH_CONFIGURATION)) {
    return <Redirect href="/(auth)/welcome" />;
  }
  return <ClerkSignedInScreen />;
}
