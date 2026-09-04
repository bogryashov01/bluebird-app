import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Platform, Pressable, Alert,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRequestLoginCode, useVerifyLoginCode } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

const CODE_LENGTH = 6;

export default function VerifyCodeScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { signIn, setPendingRegistrationGrant } = useAuth();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ phone?: string; demoCode?: string; cooldown?: string; referralCode?: string }>();
  const phone = typeof params.phone === 'string' ? params.phone : '';
  const initialCooldown = Number(params.cooldown) > 0 ? Number(params.cooldown) : 30;

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Demo: no real SMS is sent — surface the code so testers can complete the flow.
  const [demoCode, setDemoCode] = useState(typeof params.demoCode === 'string' ? params.demoCode : '');
  const [cooldown, setCooldown] = useState(initialCooldown);
  const inputRef = useRef<TextInput>(null);
  const submittedRef = useRef<string | null>(null);

  // Resend cooldown ticker
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [cooldown > 0]);

  const verifyMutation = useVerifyLoginCode({
    mutation: {
      onSuccess: async (data) => {
        if (data.outcome === 'registration_required' && data.registrationGrant) {
          setPendingRegistrationGrant(data.registrationGrant);
          router.replace({
            pathname: '/(auth)/complete-registration',
            params: typeof params.referralCode === 'string' ? { referralCode: params.referralCode } : {},
          });
          return;
        }
        if (data.outcome !== 'signed_in' || !data.token || !data.user) {
          submittedRef.current = null;
          setCode('');
          setError('The sign-in response was incomplete. Please request a new code.');
          inputRef.current?.focus();
          return;
        }
        await signIn(data.token, data.user as any);
        queryClient.clear();
        if (data.referralFeedback) {
          const messages = {
            invalid_code: 'That referral code is not valid, so no passes were added.',
            self_referral: 'You cannot use your own referral code, so no passes were added.',
            already_used: 'Referral passes are for friends creating a new account, so no additional passes were added.',
          } as const;
          const message = messages[data.referralFeedback];
          if (Platform.OS === 'web') window.alert(`Signed in\n\n${message}`);
          else Alert.alert('Signed in', message);
        }
        router.replace('/(tabs)/discover');
      },
      onError: (err: any) => {
        submittedRef.current = null;
        setCode('');
        setError(err?.response?.data?.error || err?.message || "That code didn't work. Try again.");
        inputRef.current?.focus();
      },
    },
  });

  const resendMutation = useRequestLoginCode({
    mutation: {
      onSuccess: (data) => {
        setDemoCode(data.demoCode ?? '');
        setCooldown(data.resendCooldownSeconds ?? 30);
        setError(null);
        setCode('');
        submittedRef.current = null;
        inputRef.current?.focus();
      },
      onError: (err: any) => {
        setError(err?.response?.data?.error || err?.message || 'Could not resend the code');
      },
    },
  });

  const handleChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    setError(null);
    // Auto-submit the moment the sixth digit lands (once per code value).
    if (digits.length === CODE_LENGTH && submittedRef.current !== digits && !verifyMutation.isPending) {
      submittedRef.current = digits;
      verifyMutation.mutate({
        data: {
          phone,
          code: digits,
          ...(typeof params.referralCode === 'string' ? { referralCode: params.referralCode } : {}),
        },
      });
    }
  };

  const handleResend = () => {
    if (cooldown > 0 || resendMutation.isPending) return;
    resendMutation.mutate({ data: { phone } });
  };

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const busy = verifyMutation.isPending;

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundMid, paddingTop: topPad, paddingBottom: bottomPad + 24 }]}>
      <StatusBar style={colors.scheme === 'dark' ? 'light' : 'dark'} />

      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
        <Feather name="arrow-left" size={20} color={colors.mutedOnBrand} />
      </TouchableOpacity>

      <Text style={[styles.title, { color: colors.textOnBrand }]}>Enter the code</Text>
      <Text style={[styles.subtitle, { color: colors.mutedOnBrand }]}>
        We texted a 6-digit code to{'\n'}
        <Text style={{ fontFamily: 'Inter_600SemiBold', color: colors.textOnBrand }}>{phone}</Text>
      </Text>

      {/* Hidden input drives the six visual boxes — enables the native numeric
          keypad and iOS one-time-code autofill. */}
      <Pressable style={styles.boxesWrap} onPress={() => inputRef.current?.focus()}>
        <TextInput
          ref={inputRef}
          style={styles.hiddenInput}
          value={code}
          onChangeText={handleChange}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          maxLength={CODE_LENGTH}
          autoFocus
          caretHidden
          editable={!busy}
          testID="verification-code-input"
        />
        <View style={styles.boxes} pointerEvents="none">
          {Array.from({ length: CODE_LENGTH }).map((_, i) => {
            const filled = i < code.length;
            const active = i === code.length && !busy;
            return (
              <View
                key={i}
                style={[
                  styles.box,
                  {
                    backgroundColor: colors.input,
                    borderColor: error ? colors.destructive : active ? colors.primary : colors.border,
                    borderWidth: active ? 2 : 1,
                  },
                ]}
              >
                <Text style={[styles.boxDigit, { color: colors.foreground }]}>{filled ? code[i] : ''}</Text>
              </View>
            );
          })}
        </View>
      </Pressable>

      {error ? (
        <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
      ) : busy ? (
        <View style={styles.verifyingRow}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[styles.verifyingText, { color: colors.mutedOnBrand }]}>Verifying…</Text>
        </View>
      ) : null}

      {demoCode ? (
        <View style={[styles.demoCard, { backgroundColor: colors.primary + '14', borderColor: colors.primary + '33' }]}>
          <Feather name="message-square" size={14} color={colors.primary} />
          <Text style={[styles.demoText, { color: colors.mutedOnBrand }]}>
            Demo — no SMS is sent. Your code is{' '}
            <Text style={{ fontFamily: 'Inter_700Bold', color: colors.textOnBrand }}>{demoCode}</Text>
          </Text>
        </View>
      ) : null}

      <TouchableOpacity
        onPress={handleResend}
        disabled={cooldown > 0 || resendMutation.isPending}
        style={styles.resendBtn}
        hitSlop={8}
        testID="resend-code-button"
      >
        {resendMutation.isPending ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Text
            style={[
              styles.resendText,
              { color: cooldown > 0 ? colors.mutedOnBrand : colors.primary },
            ]}
          >
            {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24 },
  backBtn: { marginTop: 8, marginBottom: 24, width: 36, height: 36, justifyContent: 'center' },
  title: { fontSize: 28, fontFamily: 'Inter_700Bold', marginBottom: 8 },
  subtitle: { fontSize: 15, fontFamily: 'Inter_400Regular', lineHeight: 22, marginBottom: 32 },
  boxesWrap: { marginBottom: 16 },
  hiddenInput: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    opacity: 0.02, fontSize: 1, color: 'transparent', zIndex: 2,
  },
  boxes: { flexDirection: 'row', gap: 10, justifyContent: 'space-between' },
  box: {
    flex: 1, height: 60, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
  },
  boxDigit: { fontSize: 24, fontFamily: 'Inter_700Bold' },
  errorText: { fontSize: 13, fontFamily: 'Inter_500Medium', marginBottom: 8 },
  verifyingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  verifyingText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  demoCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    marginTop: 8,
  },
  demoText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 19 },
  resendBtn: { alignSelf: 'center', marginTop: 24, minHeight: 22, justifyContent: 'center' },
  resendText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
});
