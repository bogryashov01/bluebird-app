import React, { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/expo';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useDormantClerkProductionTokenProvider } from '@/lib/dormantClerkIntegration';
import { getClerkAuthErrorMessage, performClerkSignOut } from '@/lib/clerkAuthConfig';
import { useQueryClient } from '@tanstack/react-query';

export function ClerkSignedInScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { isLoaded, isSignedIn } = useAuth();
  const queryClient = useQueryClient();
  const clerkTokenProvider = useDormantClerkProductionTokenProvider();
  const [error, setError] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    setError(null);
    queryClient.clear();
    const result = await performClerkSignOut(() => clerkTokenProvider.clearClerkSession());
    setIsSigningOut(false);
    if (!result.ok) {
      setError(getClerkAuthErrorMessage(result.message));
      return;
    }
    router.replace('/(auth)/welcome');
  };

  if (!isLoaded) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.backgroundMid }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!isSignedIn) return <Redirect href="/(clerk-auth)/sign-in" />;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.backgroundMid, paddingTop: topPad, paddingBottom: bottomPad },
      ]}
    >
      <StatusBar style={colors.scheme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.content}>
        <Text style={[styles.eyebrow, { color: colors.paleBlue }]}>BLUEBIRD ACCOUNT</Text>
        <Text style={[styles.title, { color: colors.textOnBrand }]}>Bluebird member not linked</Text>
        <Text style={[styles.body, { color: colors.mutedOnBrand }]}>
          Your Clerk session is active, but Bluebird has not confirmed a matching member account. Member screens and cached member data stay unavailable until the backend can verify this connection.
        </Text>
        <Text style={[styles.pending, { color: colors.mutedOnBrand }]} testID="clerk-member-pending">
          Account status: pending link confirmation. No authenticated Bluebird API request has been made.
        </Text>
        {error && (
          <Text accessibilityLiveRegion="polite" style={[styles.error, { color: colors.destructive }]} testID="clerk-sign-out-error">
            {error}
          </Text>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: isSigningOut, busy: isSigningOut }}
          disabled={isSigningOut}
          onPress={handleSignOut}
          style={[styles.primaryButton, { backgroundColor: colors.primary }, isSigningOut && styles.disabled]}
          testID="clerk-sign-out"
        >
          {isSigningOut ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
              Sign out of Clerk
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24 },
  centered: { justifyContent: 'center', alignItems: 'center' },
  content: { flex: 1, justifyContent: 'center' },
  eyebrow: { fontSize: 12, fontFamily: 'Inter_600SemiBold', letterSpacing: 1.4, marginBottom: 10 },
  title: { fontSize: 28, fontFamily: 'Inter_700Bold', letterSpacing: -0.4 },
  body: { fontSize: 15, fontFamily: 'Inter_400Regular', lineHeight: 22, marginTop: 10, marginBottom: 24 },
  pending: { fontSize: 13, fontFamily: 'Inter_500Medium', lineHeight: 20, marginBottom: 24 },
  error: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 21, marginBottom: 14 },
  primaryButton: { minHeight: 50, borderRadius: 999, justifyContent: 'center', alignItems: 'center' },
  primaryButtonText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  disabled: { opacity: 0.55 },
});
