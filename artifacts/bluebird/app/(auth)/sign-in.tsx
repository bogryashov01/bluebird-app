import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Platform, Alert,
} from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useLogin } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { signIn } = useAuth();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  const loginMutation = useLogin({
    mutation: {
      onSuccess: async (data) => {
        // @ts-ignore
        await signIn(data.token, data.user);
        queryClient.clear();
        router.replace('/(tabs)/discover');
      },
      onError: (err: any) => {
        const msg = err?.response?.data?.error || err?.message || 'Login failed';
        Alert.alert('Sign in failed', msg);
      },
    },
  });

  const validate = () => {
    const newErrors: typeof errors = {};
    if (!email.trim()) newErrors.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(email)) newErrors.email = 'Enter a valid email';
    if (!password) newErrors.password = 'Password is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSignIn = () => {
    if (!validate()) return;
    loginMutation.mutate({ data: { email: email.toLowerCase().trim(), password } });
  };

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundMid, paddingTop: topPad }]}>
      <KeyboardAwareScrollViewCompat contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad + 24 }]} bottomOffset={24} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color="#8896B3" />
        </TouchableOpacity>

        <View style={styles.logoRow}>
          <Feather name="send" size={20} color={colors.primary} style={{ transform: [{ rotate: '-45deg' }] }} />
          <Text style={styles.logoText}>Bluebird</Text>
        </View>

        <Text style={styles.title}>Welcome back.</Text>
        <Text style={styles.subtitle}>Sign in to access your flights and membership.</Text>

        {/* Form */}
        <View style={styles.form}>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground }, errors.email ? [styles.inputError, { borderColor: colors.destructive }] : null]}
              placeholder="you@example.com"
              placeholderTextColor="#8896B3"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {errors.email && <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.email}</Text>}
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Password</Text>
            <View style={[styles.inputRow, { backgroundColor: colors.input, borderColor: colors.border }, errors.password ? [styles.inputError, { borderColor: colors.destructive }] : null]}>
              <TextInput
                style={[styles.inputFlex, { color: colors.foreground }]}
                placeholder="••••••••"
                placeholderTextColor="#8896B3"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
              />
              <TouchableOpacity onPress={() => setShowPassword((v) => !v)}>
                <Feather name={showPassword ? 'eye-off' : 'eye'} size={18} color="#8896B3" />
              </TouchableOpacity>
            </View>
            {errors.password && <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.password}</Text>}
          </View>

          <TouchableOpacity
            style={[styles.submitBtn, { backgroundColor: colors.primary }, loginMutation.isPending && styles.submitBtnDisabled]}
            onPress={handleSignIn}
            disabled={loginMutation.isPending}
            activeOpacity={0.8}
          >
            {loginMutation.isPending ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={[styles.submitBtnText, { color: colors.primaryForeground }]}>Sign in</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.divider}>
          <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          <Text style={styles.dividerText}>or</Text>
          <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
        </View>

        <TouchableOpacity style={styles.altAction} onPress={() => router.push('/(auth)/create-account')}>
          <Text style={[styles.altActionText, { color: colors.primary }]}>Create a new account</Text>
          <Feather name="arrow-right" size={14} color={colors.primary} />
        </TouchableOpacity>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    gap: 0,
  },
  backBtn: {
    marginTop: 8,
    marginBottom: 24,
    width: 36,
    height: 36,
    justifyContent: 'center',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 32,
  },
  logoText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    marginBottom: 8,
  },
  subtitle: {
    color: '#8896B3',
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    marginBottom: 36,
    lineHeight: 22,
  },
  form: {
    gap: 20,
  },
  fieldGroup: {
    gap: 6,
  },
  label: {
    color: '#8896B3',
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    letterSpacing: 0.3,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    height: 52,
    paddingHorizontal: 16,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
  },
  inputRow: {
    borderWidth: 1,
    borderRadius: 12,
    height: 52,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  inputFlex: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
  },
  inputError: {
  },
  errorText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  submitBtn: {
    height: 56,
    borderRadius: 999,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  submitBtnDisabled: {
    opacity: 0.7,
  },
  submitBtnText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 28,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    color: '#8896B3',
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  altAction: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  altActionText: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
  },
});
