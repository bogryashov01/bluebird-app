import React from 'react';
import { Redirect } from 'expo-router';
import { View } from 'react-native';
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
  return (
    <View style={{ flex: 1 }}>
      <ClerkAuthPanel />
    </View>
  );
}
