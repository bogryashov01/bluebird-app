import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform, Alert } from 'react-native';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, AntDesign } from '@expo/vector-icons';
import { useLogin } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

// Demo mode: the social buttons sign in with a server-seeded demo member
// instead of performing real OAuth.
const DEMO_EMAIL = 'demo@bluebird.app';
const DEMO_PASSWORD = 'bluebird-demo';

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { signIn } = useAuth();
  const queryClient = useQueryClient();
  const [pendingProvider, setPendingProvider] = React.useState<string | null>(null);

  const demoLogin = useLogin({
    mutation: {
      onSuccess: async (data) => {
        // @ts-ignore
        await signIn(data.token, data.user);
        queryClient.clear();
        router.replace('/(tabs)/discover');
      },
      onError: (err: any) => {
        setPendingProvider(null);
        const msg = err?.response?.data?.error || err?.message || 'Sign in failed';
        Alert.alert('Sign in failed', msg);
      },
    },
  });

  const handleSocial = (provider: 'apple' | 'google') => {
    if (demoLogin.isPending) return;
    setPendingProvider(provider);
    demoLogin.mutate({ data: { email: DEMO_EMAIL, password: DEMO_PASSWORD } });
  };

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const isDark = colors.scheme === 'dark';

  const outlinedBtn = {
    backgroundColor: colors.scheme === 'dark' ? colors.card : '#FFFFFF',
    borderColor: colors.border,
  };
  const appleBtn = {
    backgroundColor: isDark ? '#FFFFFF' : '#000000',
  };
  const appleText = { color: isDark ? '#000000' : '#FFFFFF' };

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundMid, paddingTop: topPad, paddingBottom: bottomPad + 16 }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <View style={styles.content}>
        <View style={[styles.logoCircle, { backgroundColor: colors.primary + '1A' }]}>
          <Feather name="send" size={30} color={colors.primary} style={{ transform: [{ rotate: '-45deg' }] }} />
        </View>

        <Text style={[styles.title, { color: colors.textOnBrand }]}>Welcome to Bluebird</Text>
        <Text style={[styles.subtitle, { color: colors.mutedOnBrand }]}>Sign in or create your account</Text>

        <View style={styles.buttons}>
          <TouchableOpacity
            style={[styles.pill, appleBtn]}
            onPress={() => handleSocial('apple')}
            disabled={demoLogin.isPending}
            activeOpacity={0.85}
          >
            {pendingProvider === 'apple' ? (
              <ActivityIndicator color={appleText.color} />
            ) : (
              <View style={styles.pillInner}>
                <AntDesign name="apple" size={17} color={appleText.color} />
                <Text style={[styles.pillText, appleText]}>Continue with Apple</Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.pill, styles.pillOutlined, outlinedBtn]}
            onPress={() => handleSocial('google')}
            disabled={demoLogin.isPending}
            activeOpacity={0.85}
          >
            {pendingProvider === 'google' ? (
              <ActivityIndicator color={colors.foreground} />
            ) : (
              <View style={styles.pillInner}>
                <AntDesign name="google" size={17} color={colors.foreground} />
                <Text style={[styles.pillText, { color: colors.foreground }]}>Continue with Google</Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.pill, styles.pillOutlined, outlinedBtn]}
            onPress={() => router.push('/(auth)/sign-in')}
            activeOpacity={0.85}
          >
            <View style={styles.pillInner}>
              <Feather name="mail" size={17} color={colors.foreground} />
              <Text style={[styles.pillText, { color: colors.foreground }]}>Continue with Email</Text>
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.divider}>
          <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          <Text style={[styles.dividerText, { color: colors.mutedOnBrand }]}>OR</Text>
          <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
        </View>

        <View style={styles.buttons}>
          <TouchableOpacity
            style={[styles.pill, { backgroundColor: colors.primary }]}
            onPress={() => router.push('/(auth)/sign-in')}
            activeOpacity={0.85}
          >
            <Text style={[styles.pillText, { color: colors.primaryForeground }]}>Sign In</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.pill, { backgroundColor: colors.secondary }]}
            onPress={() => router.push('/(auth)/create-account')}
            activeOpacity={0.85}
          >
            <Text style={[styles.pillText, { color: colors.secondaryForeground }]}>Create Account</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={() => router.push('/(auth)/forgot-password')} style={styles.forgotBtn}>
          <Text style={[styles.forgotText, { color: colors.primary }]}>Forgot Password?</Text>
        </TouchableOpacity>
      </View>

      <Text style={[styles.footerText, { color: colors.mutedOnBrand }]}>
        By continuing you agree to Bluebird's{' '}
        <Text style={[styles.footerLink, { color: colors.primary }]}>Terms of Service</Text> and{' '}
        <Text style={[styles.footerLink, { color: colors.primary }]}>Privacy Policy</Text>.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24 },
  content: { flex: 1, justifyContent: 'center', alignItems: 'stretch' },
  logoCircle: {
    width: 68, height: 68, borderRadius: 34,
    justifyContent: 'center', alignItems: 'center', alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 26, fontFamily: 'Inter_700Bold',
    textAlign: 'center', letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 15, fontFamily: 'Inter_400Regular',
    textAlign: 'center', marginTop: 6, marginBottom: 32,
  },
  buttons: { gap: 12 },
  pill: {
    height: 52, borderRadius: 999,
    justifyContent: 'center', alignItems: 'center',
  },
  pillOutlined: { borderWidth: 1 },
  pillInner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pillText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  divider: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginVertical: 22,
  },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { fontSize: 12, fontFamily: 'Inter_500Medium', letterSpacing: 1 },
  forgotBtn: { alignSelf: 'center', marginTop: 20, paddingVertical: 4 },
  forgotText: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  footerText: {
    fontSize: 12, fontFamily: 'Inter_400Regular',
    textAlign: 'center', lineHeight: 18, paddingHorizontal: 12,
  },
  footerLink: { fontFamily: 'Inter_500Medium' },
});
