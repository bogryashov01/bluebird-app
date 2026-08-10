import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Platform, Alert,
} from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRegister } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

export default function CreateAccountScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { signIn } = useAuth();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string }>({});

  const registerMutation = useRegister({
    mutation: {
      onSuccess: async (data) => {
        // @ts-ignore
        await signIn(data.token, data.user);
        queryClient.clear();
        router.replace('/(auth)/verify-email');
      },
      onError: (err: any) => {
        const msg = err?.response?.data?.error || err?.message || 'Registration failed';
        Alert.alert('Registration failed', msg);
      },
    },
  });

  const validate = () => {
    const newErrors: typeof errors = {};
    if (!name.trim()) newErrors.name = 'Name is required';
    if (!email.trim()) newErrors.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(email)) newErrors.email = 'Enter a valid email';
    if (!password) newErrors.password = 'Password is required';
    else if (password.length < 6) newErrors.password = 'Password must be at least 6 characters';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleCreate = () => {
    if (!validate()) return;
    registerMutation.mutate({
      data: { name: name.trim(), email: email.toLowerCase().trim(), password },
    });
  };

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundMid, paddingTop: topPad }]}>
      <KeyboardAwareScrollViewCompat contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad + 24 }]} bottomOffset={24} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color="#8896B3" />
        </TouchableOpacity>

        <View style={styles.logoRow}>
          <Feather name="send" size={20} color={colors.primary} style={{ transform: [{ rotate: '-45deg' }] }} />
          <Text style={styles.logoText}>Bluebird</Text>
        </View>

        <Text style={styles.title}>Create your account.</Text>
        <Text style={styles.subtitle}>Join thousands of members flying on empty legs.</Text>

        <View style={styles.form}>
          {/* Name */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Full name</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground }, errors.name && [styles.inputError, { borderColor: colors.destructive }]]}
              placeholder="Alex Johnson"
              placeholderTextColor="#8896B3"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
            />
            {errors.name && <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.name}</Text>}
          </View>

          {/* Email */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground }, errors.email && [styles.inputError, { borderColor: colors.destructive }]]}
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

          {/* Password */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Password</Text>
            <View style={[styles.inputRow, { backgroundColor: colors.input, borderColor: colors.border }, errors.password && [styles.inputError, { borderColor: colors.destructive }]]}>
              <TextInput
                style={[styles.inputFlex, { color: colors.foreground }]}
                placeholder="Min. 6 characters"
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
            style={[styles.submitBtn, { backgroundColor: colors.primary }, registerMutation.isPending && styles.submitBtnDisabled]}
            onPress={handleCreate}
            disabled={registerMutation.isPending}
            activeOpacity={0.8}
          >
            {registerMutation.isPending ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={[styles.submitBtnText, { color: colors.primaryForeground }]}>Create Account</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.signInRow}>
          <Text style={styles.signInPrefix}>Already a member? </Text>
          <TouchableOpacity onPress={() => router.push('/(auth)/sign-in')}>
            <Text style={[styles.signInLink, { color: colors.primary }]}>Sign in</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: 24 },
  backBtn: { marginTop: 8, marginBottom: 24, width: 36, height: 36, justifyContent: 'center' },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 32 },
  logoText: { color: '#FFFFFF', fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  title: { color: '#FFFFFF', fontSize: 28, fontFamily: 'Inter_700Bold', marginBottom: 8 },
  subtitle: { color: '#8896B3', fontSize: 15, fontFamily: 'Inter_400Regular', marginBottom: 36, lineHeight: 22 },
  form: { gap: 20 },
  fieldGroup: { gap: 6 },
  label: { color: '#8896B3', fontSize: 13, fontFamily: 'Inter_500Medium', letterSpacing: 0.3 },
  input: {
    borderWidth: 1,
    borderRadius: 12, height: 52, paddingHorizontal: 16,
    fontSize: 15, fontFamily: 'Inter_400Regular',
  },
  inputRow: {
    borderWidth: 1,
    borderRadius: 12, height: 52, paddingHorizontal: 16,
    flexDirection: 'row', alignItems: 'center',
  },
  inputFlex: { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular' },
  inputError: {},
  errorText: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  submitBtn: { height: 56, borderRadius: 999, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  submitBtnDisabled: { opacity: 0.7 },
  submitBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  signInRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 28 },
  signInPrefix: { color: '#8896B3', fontSize: 14, fontFamily: 'Inter_400Regular' },
  signInLink: { fontSize: 14, fontFamily: 'Inter_500Medium' },
});
