import React, { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth as useClerkAuth } from '@clerk/expo';
import { useColors } from '@/hooks/useColors';
import { getClerkAuthErrorMessage, performClerkSignOut } from '@/lib/clerkAuthConfig';
import { useQueryClient } from '@tanstack/react-query';

export function ClerkSignedInScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { isLoaded, isSignedIn, signOut } = useClerkAuth();
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

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.backgroundMid, paddingTop: topPad, paddingBottom: bottomPad },
      ]}
    >
      <StatusBar style={colors.scheme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.content}>
        <Text style={[styles.eyebrow, { color: colors.paleBlue }]}>WELCOME BACK</Text>
        <Text style={[styles.title, { color: colors.textOnBrand }]}>Your Bluebird journey</Text>
        <Text style={[styles.body, { color: colors.mutedOnBrand }]}>
          Your phone sign-in is ready. Open your Bluebird profile to check what the Development API confirms and continue any required profile setup.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/account/bluebird-profile' as any)}
          style={[styles.primaryButton, { backgroundColor: colors.primary }]}
          testID="open-bluebird-profile"
        >
          <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
            Continue to my Bluebird profile
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/membership/plans' as any)}
          style={[styles.secondaryButton, { borderColor: colors.border }]}
          testID="open-membership-plans"
        >
          <Text style={[styles.secondaryButtonText, { color: colors.textOnBrand }]}>Review membership plans</Text>
        </Pressable>
        <Text style={[styles.memberGateNote, { color: colors.mutedOnBrand }]} testID="clerk-member-eligibility-gate">
          Flights, queues, and trips stay protected until the API provides a stable Bluebird member identity and confirms feature eligibility. No membership or registration status is inferred from isMember.
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
  secondaryButton: { minHeight: 48, borderWidth: 1, borderRadius: 999, justifyContent: 'center', alignItems: 'center', marginTop: 12 },
  secondaryButtonText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  memberGateNote: { fontSize: 12, lineHeight: 18, marginTop: 20, textAlign: 'center', fontFamily: 'Inter_400Regular' },
  developmentLink: { minHeight: 42, borderWidth: 1, borderRadius: 999, justifyContent: 'center', alignItems: 'center', marginTop: 18 },
  error: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 21, marginBottom: 14 },
  primaryButton: { minHeight: 50, borderRadius: 999, justifyContent: 'center', alignItems: 'center' },
  primaryButtonText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  disabled: { opacity: 0.55 },
});
