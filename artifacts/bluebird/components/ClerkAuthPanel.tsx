import React, { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth, useClerk } from '@clerk/expo';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import {
  getClerkAuthErrorMessage,
  getClerkAuthViewState,
  performClerkSignOut,
} from '@/lib/clerkAuthConfig';

export function ClerkAuthPanel({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { isLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const [error, setError] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const state = getClerkAuthViewState({ isLoaded, isSignedIn, error });
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const isSignIn = mode === 'sign-in';

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    setError(null);
    const result = await performClerkSignOut(() => signOut());
    setIsSigningOut(false);
    if (!result.ok) setError(getClerkAuthErrorMessage(result.message));
  };

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.backgroundMid, paddingTop: topPad, paddingBottom: bottomPad },
      ]}
    >
      <StatusBar style={colors.scheme === 'dark' ? 'light' : 'dark'} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to Bluebird demo sign-in"
        onPress={() => router.replace('/(auth)/welcome')}
        style={styles.backButton}
        testID="clerk-back-to-demo"
      >
        <Feather name="arrow-left" size={21} color={colors.mutedOnBrand} />
      </Pressable>

      <View style={styles.content}>
        <Text style={[styles.eyebrow, { color: colors.paleBlue }]}>BLUEBIRD ACCOUNT</Text>
        <Text style={[styles.title, { color: colors.textOnBrand }]}>
          {isSignIn ? 'Sign in with Clerk' : 'Create a Clerk account'}
        </Text>
        <Text style={[styles.subtitle, { color: colors.mutedOnBrand }]}>
          {isSignIn
            ? 'This sign-in is separate from Bluebird’s phone-based demo account.'
            : 'This sign-up is separate from Bluebird’s existing onboarding.'}
        </Text>

        {error && (
          <View style={[styles.messageBox, { borderColor: colors.destructive }]} testID="clerk-auth-error">
            <Text style={[styles.messageTitle, { color: colors.destructive }]}>
              Authentication issue
            </Text>
            <Text style={[styles.stateText, { color: colors.textOnBrand }]}>{error}</Text>
          </View>
        )}

        {state === 'loading' && (
          <View style={styles.stateBox} accessibilityLiveRegion="polite" testID="clerk-auth-loading">
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.stateText, { color: colors.mutedOnBrand }]}>
              Checking Clerk session…
            </Text>
          </View>
        )}

        {state === 'signed-out' && (
          <View style={[styles.messageBox, { borderColor: colors.border }]} testID="clerk-auth-signed-out">
            <Text style={[styles.messageTitle, { color: colors.textOnBrand }]}>
              {isSignIn ? 'No sign-in method is enabled yet' : 'Sign-up is not enabled yet'}
            </Text>
            <Text style={[styles.stateText, { color: colors.mutedOnBrand }]}>
              The Clerk instance and its approved authentication methods have not been
              confirmed. No sign-in request or account creation was attempted.
            </Text>
          </View>
        )}

        {(state === 'signed-in' || (state === 'error' && isSignedIn === true)) && (
          <View style={[styles.messageBox, { borderColor: colors.border }]} testID="clerk-auth-signed-in">
            <Text style={[styles.messageTitle, { color: colors.textOnBrand }]}>
              Clerk session active
            </Text>
            <Text style={[styles.stateText, { color: colors.mutedOnBrand }]}>
              This session is not connected to Bluebird member data or production APIs.
            </Text>
            <Pressable
              accessibilityRole="button"
              style={[styles.primaryButton, { backgroundColor: colors.primary }, isSigningOut && styles.disabled]}
              onPress={handleSignOut}
              disabled={isSigningOut}
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
        )}

        <View style={styles.links}>
          <Text style={[styles.footerText, { color: colors.mutedOnBrand }]}>
            {isSignIn ? 'Need an account?' : 'Already have a Clerk account?'}
          </Text>
          <Pressable
            accessibilityRole="link"
            onPress={() => router.replace(isSignIn ? '/(clerk-auth)/sign-up' : '/(clerk-auth)/sign-in')}
            testID={isSignIn ? 'clerk-go-to-sign-up' : 'clerk-go-to-sign-in'}
          >
            <Text style={[styles.linkText, { color: colors.paleBlue }]}>
              {isSignIn ? 'Create account' : 'Sign in'}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24 },
  backButton: { height: 44, width: 44, justifyContent: 'center' },
  content: { flex: 1, justifyContent: 'center' },
  eyebrow: { fontSize: 12, fontFamily: 'Inter_600SemiBold', letterSpacing: 1.4, marginBottom: 10 },
  title: { fontSize: 28, fontFamily: 'Inter_700Bold', letterSpacing: -0.4 },
  subtitle: { fontSize: 15, fontFamily: 'Inter_400Regular', lineHeight: 22, marginTop: 8, marginBottom: 30 },
  stateBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 20 },
  messageBox: { borderWidth: 1, borderRadius: 16, padding: 18, gap: 10 },
  messageTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold' },
  stateText: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 21 },
  primaryButton: { minHeight: 50, marginTop: 8, borderRadius: 999, justifyContent: 'center', alignItems: 'center' },
  primaryButtonText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  disabled: { opacity: 0.55 },
  links: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingVertical: 20 },
  footerText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  linkText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
});
