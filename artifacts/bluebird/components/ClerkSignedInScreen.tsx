import React, { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth as useClerkAuth } from '@clerk/expo';
import { useColors } from '@/hooks/useColors';
import { getClerkAuthErrorMessage, performClerkSignOut } from '@/lib/clerkAuthConfig';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth as useBluebirdAuth } from '@/context/AuthContext';
import {
  getClerkPostLoginJourney,
} from '@/lib/clerkMemberResolution';
import { CLERK_MEMBER_NAVIGATION_READINESS } from '@/lib/productionAuthState';

export function ClerkSignedInScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { isLoaded, isSignedIn, signOut } = useClerkAuth();
  const { clerkMemberResolution } = useBluebirdAuth();
  const postLoginJourney = getClerkPostLoginJourney(
    clerkMemberResolution,
    CLERK_MEMBER_NAVIGATION_READINESS,
  );
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const isDevelopment = typeof __DEV__ !== 'undefined' && __DEV__;
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    setError(null);
    queryClient.clear();
    const result = await performClerkSignOut(async () => { await signOut(); });
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
  if (postLoginJourney.kind === 'profile') {
    return <Redirect href={postLoginJourney.destination} />;
  }
  if (postLoginJourney.kind === 'home') {
    return <Redirect href={postLoginJourney.destination} />;
  }

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.backgroundMid, paddingTop: topPad, paddingBottom: bottomPad },
      ]}
    >
      <StatusBar style={colors.scheme === 'dark' ? 'light' : 'dark'} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 12 }]} showsVerticalScrollIndicator={false}>
        <Text style={[styles.eyebrow, { color: colors.paleBlue }]}>BLUEBIRD ACCOUNT</Text>
        <Text style={[styles.title, { color: colors.textOnBrand }]}>
          We couldn’t finish setting up your account
        </Text>
        <Text style={[styles.body, { color: colors.mutedOnBrand }]} testID="clerk-post-login-status">
          {clerkMemberResolution.status === 'error' && clerkMemberResolution.reason === 'unauthorized'
            ? 'Please sign in again to continue.'
            : clerkMemberResolution.status === 'error' && clerkMemberResolution.reason === 'network'
              ? 'Check your connection and try again.'
              : 'Your account needs a little more setup before you can continue. Please try again later.'}
        </Text>

        {isDevelopment && isLoaded && isSignedIn && (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/(clerk-auth)/development' as any)}
            style={[styles.developmentLink, { borderColor: colors.border }]}
            testID="open-development-tools"
          >
            <Text style={[styles.secondaryButtonText, { color: colors.textOnBrand }]}>Development tools</Text>
          </Pressable>
        )}
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
              Sign out
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24 },
  centered: { justifyContent: 'center', alignItems: 'center' },
  content: { flexGrow: 1, justifyContent: 'center' },
  eyebrow: { fontSize: 12, fontFamily: 'Inter_600SemiBold', letterSpacing: 1.4, marginBottom: 10 },
  title: { fontSize: 28, fontFamily: 'Inter_700Bold', letterSpacing: -0.4 },
  body: { fontSize: 15, fontFamily: 'Inter_400Regular', lineHeight: 22, marginTop: 10, marginBottom: 16 },
  secondaryButton: { minHeight: 48, borderWidth: 1, borderRadius: 999, justifyContent: 'center', alignItems: 'center', marginTop: 12 },
  secondaryButtonText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  developmentLink: { minHeight: 42, borderWidth: 1, borderRadius: 999, justifyContent: 'center', alignItems: 'center', marginTop: 18 },
  error: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 21, marginBottom: 14 },
  primaryButton: { minHeight: 50, borderRadius: 999, justifyContent: 'center', alignItems: 'center' },
  primaryButtonText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  disabled: { opacity: 0.55 },
});
