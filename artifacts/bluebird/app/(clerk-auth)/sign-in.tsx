import React from 'react';
import { Redirect, router } from 'expo-router';
import { Text, TouchableOpacity, View } from 'react-native';
import { ClerkAuthPanel } from '@/components/ClerkAuthPanel';
import { ClerkAuthConfigurationError } from '@/components/ClerkAuthConfigurationError';
import { canAccessClerkAuthRoutes, CLERK_AUTH_CONFIGURATION } from '@/lib/clerkAuthConfig';
import { useColors } from '@/hooks/useColors';

export default function ClerkSignInScreen() {
  const colors = useColors();
  if (!CLERK_AUTH_CONFIGURATION.authExpected) {
    return <Redirect href="/(auth)/welcome" />;
  }
  if (!canAccessClerkAuthRoutes(CLERK_AUTH_CONFIGURATION)) {
    return <ClerkAuthConfigurationError />;
  }
  return (
    <View style={{ flex: 1 }}>
      <ClerkAuthPanel mode="sign-in" />
      {typeof __DEV__ !== 'undefined' && __DEV__ ? (
        <TouchableOpacity
          testID="clerk-development-preview-entry"
          accessibilityRole="button"
          onPress={() => router.replace('/development-preview' as any)}
          style={{ position: 'absolute', bottom: 18, alignSelf: 'center', padding: 12 }}
        >
          <Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold', fontSize: 12 }}>
            Open development preview
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
