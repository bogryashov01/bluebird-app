import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform, Alert } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useResendVerification, useVerifyEmail } from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

export default function VerifyEmailScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { user, updateUser } = useAuth();
  // Demo: the raw single-use token arrives via route params instead of an
  // emailed link; Resend rotates it server-side and hands back the new one.
  const { vt } = useLocalSearchParams<{ vt?: string }>();
  const [verificationToken, setVerificationToken] = React.useState<string>(typeof vt === 'string' ? vt : '');
  const [resent, setResent] = React.useState(false);

  const resendMutation = useResendVerification({
    mutation: {
      onSuccess: (data) => {
        if (data.demoVerificationToken) setVerificationToken(data.demoVerificationToken);
        setResent(true);
      },
      onError: (err: any) => {
        const msg = err?.response?.data?.error || err?.message || 'Could not resend the email';
        Alert.alert('Resend failed', msg);
      },
    },
  });

  const verifyMutation = useVerifyEmail({
    mutation: {
      onSuccess: (updated) => {
        updateUser(updated);
        router.replace('/(auth)/welcome-member');
      },
      onError: (err: any) => {
        const msg = err?.response?.data?.error || err?.message || 'Verification failed. Tap Resend Email and try again.';
        Alert.alert('Verification failed', msg);
      },
    },
  });

  const handleContinue = () => {
    if (!verificationToken) {
      Alert.alert('Verification needed', 'Tap "Resend Email" to get a fresh verification link, then continue.');
      return;
    }
    verifyMutation.mutate({ data: { token: verificationToken } });
  };

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const isDark = colors.scheme === 'dark';

  // Already verified (e.g. deep link back here) — nothing to verify.
  if (user?.emailVerified) {
    return <Redirect href="/(auth)/welcome-member" />;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <View style={styles.content}>
        <View style={[styles.envelopeCircle, { backgroundColor: colors.primary + '14' }]}>
          <Feather name="mail" size={30} color={colors.primary} />
        </View>

        <Text style={[styles.title, { color: colors.foreground }]}>Check your inbox</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>We sent a verification link to</Text>
        <Text style={[styles.email, { color: colors.foreground }]}>{user?.email ?? 'your email address'}</Text>

        <TouchableOpacity
          onPress={() => resendMutation.mutate()}
          disabled={resendMutation.isPending}
          style={styles.resendBtn}
          hitSlop={8}
        >
          {resendMutation.isPending ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={[styles.resendText, { color: colors.primary }]}>
              {resent ? 'Email Sent ✓' : 'Resend Email'}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={[styles.footer, { paddingBottom: bottomPad + 16 }]}>
        <TouchableOpacity
          style={[styles.continueBtn, { backgroundColor: colors.primary }, verifyMutation.isPending && { opacity: 0.7 }]}
          onPress={handleContinue}
          disabled={verifyMutation.isPending}
          activeOpacity={0.8}
        >
          {verifyMutation.isPending ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={[styles.continueText, { color: colors.primaryForeground }]}>Continue</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  envelopeCircle: {
    width: 76, height: 76, borderRadius: 38,
    justifyContent: 'center', alignItems: 'center', marginBottom: 24,
  },
  title: { fontSize: 24, fontFamily: 'Inter_700Bold', letterSpacing: -0.3, marginBottom: 14 },
  body: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 21 },
  email: { fontSize: 14, fontFamily: 'Inter_600SemiBold', marginTop: 2 },
  resendBtn: { marginTop: 28, minHeight: 22, justifyContent: 'center' },
  resendText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  footer: { paddingHorizontal: 20, paddingTop: 8 },
  continueBtn: { height: 54, borderRadius: 999, justifyContent: 'center', alignItems: 'center' },
  continueText: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
});
