import React from 'react';
import { Redirect, router } from 'expo-router';
import { ClerkAuthPanel } from '@/components/ClerkAuthPanel';
import { ClerkAuthConfigurationError } from '@/components/ClerkAuthConfigurationError';
import { canAccessClerkAuthRoutes, CLERK_AUTH_CONFIGURATION } from '@/lib/clerkAuthConfig';

export default function ClerkSignInScreen() {
  if (!CLERK_AUTH_CONFIGURATION.authExpected) {
    return <Redirect href="/(auth)/welcome" />;
  }
  if (!canAccessClerkAuthRoutes(CLERK_AUTH_CONFIGURATION)) {
    return <ClerkAuthConfigurationError />;
  }
  return <ClerkAuthPanel mode="sign-in" />;
}
