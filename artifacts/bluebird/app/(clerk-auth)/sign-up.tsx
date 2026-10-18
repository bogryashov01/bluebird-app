import React from 'react';
import { Redirect } from 'expo-router';
import { ClerkAuthConfigurationError } from '@/components/ClerkAuthConfigurationError';
import {
  canAccessClerkAuthRoutes,
  CLERK_AUTH_CONFIGURATION,
} from '@/lib/clerkAuthConfig';

export default function ClerkSignUpScreen() {
  if (!CLERK_AUTH_CONFIGURATION.authExpected) {
    return <Redirect href="/(auth)/welcome" />;
  }
  if (!canAccessClerkAuthRoutes(CLERK_AUTH_CONFIGURATION)) {
    return <ClerkAuthConfigurationError />;
  }
  return <Redirect href="/(clerk-auth)/sign-in" />;
}
