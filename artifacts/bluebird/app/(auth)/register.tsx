import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Platform,
} from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRequestLoginCode } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

/**
 * Formats the phone input while typing. US-style numbers get (XXX) XXX-XXXX;
 * numbers starting with "+" are kept as international E.164 (up to 15 digits)
 * with no reformatting so any country code works.
 */
function formatPhoneInput(raw: string): string {
  if (raw.trim().startsWith('+')) {
    return '+' + raw.replace(/\D/g, '').slice(0, 15);
  }
  const digits = raw.replace(/\D/g, '').slice(0, 11);
  const d = digits.startsWith('1') && digits.length > 10 ? digits.slice(1) : digits;
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 10)}`;
}

export default function RegisterScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  // The mutation's onSuccess closes over the initial render, so read the
  // latest name from a ref when navigating.
  const nameRef = React.useRef('');
  nameRef.current = name.trim();

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
            name: nameRef.current,
          },
        });
      },
      onError: (err: any) => {
        setError(err?.response?.data?.error || err?.message || 'Could not send the code');
      },
    },
  });

  const digits = phone.replace(/\D/g, '');
  // US-style entry needs 10 digits; international "+" entry needs 11–15.
  const phoneValid = phone.startsWith('+') ? digits.length >= 11 && digits.length <= 15 : digits.length >= 10;
  const valid = name.trim().length >= 2 && phoneValid;

  const handleContinue = () => {
    if (!valid || requestCode.isPending) return;
    setError(null);
    requestCode.mutate({ data: { phone } });
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
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={colors.mutedOnBrand} />
        </TouchableOpacity>

        <View style={styles.logoRow}>
          <Feather name="send" size={20} color={colors.primary} style={{ transform: [{ rotate: '-45deg' }] }} />
          <Text style={[styles.logoText, { color: colors.textOnBrand }]}>Bluebird</Text>
        </View>

        <Text style={[styles.title, { color: colors.textOnBrand }]}>Create your account</Text>
        <Text style={[styles.subtitle, { color: colors.mutedOnBrand }]}>
          Tell us who you are and we'll text you a 6-digit code to finish
          signing up. Outside the US? Start with your country code, e.g. +44.
        </Text>

        <View style={styles.fieldGroup}>
          <Text style={[styles.label, { color: colors.mutedOnBrand }]}>Full name</Text>
          <TextInput
            style={[
              styles.input,
              { backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground },
            ]}
            placeholder="Alex Morgan"
            placeholderTextColor={colors.mutedForeground}
            value={name}
            onChangeText={setName}
            autoComplete="name"
            textContentType="name"
            autoCapitalize="words"
            autoFocus
            returnKeyType="next"
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={[styles.label, { color: colors.mutedOnBrand }]}>Phone number</Text>
          <TextInput
            style={[
              styles.input,
              { backgroundColor: colors.input, borderColor: error ? colors.destructive : colors.border, color: colors.foreground },
            ]}
            placeholder="(555) 555-0100"
            placeholderTextColor={colors.mutedForeground}
            value={phone}
            onChangeText={(t) => { setPhone(formatPhoneInput(t)); setError(null); }}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            returnKeyType="go"
            onSubmitEditing={handleContinue}
          />
          {error && <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>}
        </View>

        <TouchableOpacity
          style={[
            styles.submitBtn,
            { backgroundColor: colors.primary },
            (!valid || requestCode.isPending) && styles.submitBtnDisabled,
          ]}
          onPress={handleContinue}
          disabled={!valid || requestCode.isPending}
          activeOpacity={0.8}
        >
          {requestCode.isPending ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={[styles.submitBtnText, { color: colors.primaryForeground }]}>Send code</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.signInLink} onPress={() => router.replace('/(auth)/phone')} hitSlop={8}>
          <Text style={[styles.signInText, { color: colors.mutedOnBrand }]}>
            Already a member?{' '}
            <Text style={{ fontFamily: 'Inter_600SemiBold', color: colors.primary }}>Sign in</Text>
          </Text>
        </TouchableOpacity>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: 24 },
  backBtn: { marginTop: 8, marginBottom: 24, width: 36, height: 36, justifyContent: 'center' },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 32 },
  logoText: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
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
  signInLink: { alignSelf: 'center', marginTop: 20 },
  signInText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
});
