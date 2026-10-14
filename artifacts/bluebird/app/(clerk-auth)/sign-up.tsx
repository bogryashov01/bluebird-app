import React from 'react';
import { Redirect } from 'expo-router';
import { ClerkAuthPanel } from '@/components/ClerkAuthPanel';
import {
  canAccessClerkAuthRoutes,
  CLERK_AUTH_CONFIGURATION,
} from '@/lib/clerkAuthConfig';

export default function ClerkSignUpScreen() {
  if (!canAccessClerkAuthRoutes(CLERK_AUTH_CONFIGURATION)) {
    return <Redirect href="/(auth)/welcome" />;
  }
  return <ClerkAuthPanel mode="sign-up" />;
}
