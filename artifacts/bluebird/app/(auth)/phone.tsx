import React, { useState } from 'react';
import { ThemedTextInput } from '@/components/ThemedTextInput';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Platform,
} from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRequestLoginCode } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { BluebirdLogo } from '@/components/BluebirdLogo';
import { CLERK_AUTH_CONFIGURATION } from '@/lib/clerkAuthConfig';
import { usePendingReferralCode } from '@/hooks/usePendingReferralCode';
import {
  applyPhonePlusPrefix,
  phonePlusPrefixFieldProps,
  phonePlusPrefixForLegacyNormalize,
} from '@/lib/phonePlusPrefix';

export default function PhoneScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const params = useLocalSearchParams<{ referralCode?: string }>();
  const { code: referralCode, ready: referralCodeReady, error: referralStorageError } =
    usePendingReferralCode(params.referralCode);
  const routeReferralCode = typeof params.referralCode === 'string' ? params.referralCode : '';
  const referralCodeForNavigation = referralCode || routeReferralCode;
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);

  const requestCode = useRequestLoginCode({
    mutation: {
      onSuccess: (data) => {
        router.push({
          pathname: '/(auth)/verify-code',
          params: {
            phone: data.phone,
            // Demo: the raw code stands in for a delivered SMS.
            demoCode: data.demoCode ?? '',
            cooldown: String(data.resendCooldownSeconds ?? 30),
            ...(referralCodeForNavigation ? { referralCode: referralCodeForNavigation } : {}),
          },
        });
      },
      onError: (err: any) => {
        setError(err?.response?.data?.error || err?.message || 'Could not send the code');
      },
    },
  });

  const digits = applyPhonePlusPrefix(phone).slice(1);
  // 10 digits → legacy US path; 11–15 → international E.164 with country code.
  const valid = digits.length === 10 || (digits.length >= 11 && digits.length <= 15);

  if (CLERK_AUTH_CONFIGURATION.authExpected) {
    return <Redirect href="/(clerk-auth)/sign-in" />;
  }

  const handleContinue = () => {
    if (!valid || requestCode.isPending || !referralCodeReady || referralStorageError) return;
    setError(null);
    requestCode.mutate({ data: { phone: phonePlusPrefixForLegacyNormalize(phone) } });
  };

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundMid, paddingTop: topPad }]}>
      <StatusBar style={colors.scheme === 'dark' ? 'light' : 'dark'} />
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad + 24 }]}
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(auth)/welcome'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Feather name="arrow-left" size={20} color={colors.mutedOnBrand} />
        </TouchableOpacity>

        <BluebirdLogo variant="full" size="small" style={styles.logo} />

        <Text style={[styles.title, { color: colors.textOnBrand }]}>Enter your phone number</Text>
        <Text style={[styles.subtitle, { color: colors.mutedOnBrand }]}>
          We'll text you a 6-digit code to sign in or create your account.
          Numbers start with +. Add your country code (for example +44), or enter 10 US digits after +.
        </Text>

        <View style={styles.fieldGroup}>
          <Text style={[styles.label, { color: colors.mutedOnBrand }]}>Phone number</Text>
          <ThemedTextInput
            style={[
              styles.input,
              { backgroundColor: colors.input, borderColor: error ? colors.destructive : colors.border, color: colors.foreground },
            ]}
            placeholder="+15555550100"
            placeholderTextColor={colors.mutedForeground}
            {...phonePlusPrefixFieldProps(phone, (t) => { setPhone(t); setError(null); })}
            autoComplete="tel"
            textContentType="telephoneNumber"
            autoFocus
            returnKeyType="go"
            onSubmitEditing={handleContinue}
            testID="phone-input"
          />
          {error && <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>}
        {referralStorageError ? <Text style={[styles.errorText, { color: colors.destructive }]}>{referralStorageError}</Text> : null}
        </View>

        <TouchableOpacity
          style={[
            styles.submitBtn,
            { backgroundColor: colors.primary },
            (!valid || requestCode.isPending || !referralCodeReady || !!referralStorageError) && styles.submitBtnDisabled,
          ]}
          onPress={handleContinue}
          disabled={!valid || requestCode.isPending || !referralCodeReady || !!referralStorageError}
          activeOpacity={0.8}
          testID="send-code-button"
        >
          {requestCode.isPending ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={[styles.submitBtnText, { color: colors.primaryForeground }]}>Send code</Text>
          )}
        </TouchableOpacity>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: 24 },
  backBtn: { marginTop: 8, marginBottom: 24, width: 36, height: 36, justifyContent: 'center' },
  logo: { width: 112, height: 25, marginBottom: 32 },
  title: { fontSize: 28, fontFamily: 'Inter_700Bold', marginBottom: 8 },
  subtitle: { fontSize: 15, fontFamily: 'Inter_400Regular', marginBottom: 36, lineHeight: 22 },
  fieldGroup: { gap: 6, marginBottom: 24 },
  label: { fontSize: 13, fontFamily: 'Inter_500Medium', letterSpacing: 0.3 },
  input: {
    borderWidth: 1, borderRadius: 12, height: 52, paddingHorizontal: 16,
    fontSize: 17, fontFamily: 'Inter_400Regular', letterSpacing: 0.5,
  },
  errorText: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  submitBtn: { height: 56, borderRadius: 999, justifyContent: 'center', alignItems: 'center' },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
});
