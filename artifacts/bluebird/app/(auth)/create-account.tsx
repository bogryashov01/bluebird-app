import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Platform, Alert,
} from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
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
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ firstName?: string; lastName?: string; email?: string; password?: string }>({});
  const lastNameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const registerMutation = useRegister({
    mutation: {
      onSuccess: async (data) => {
        await signIn(data.token, data.user);
        queryClient.clear();
        router.replace({
          pathname: '/(auth)/verify-email',
          // Demo: the raw verification token stands in for the emailed link.
          params: { vt: data.demoVerificationToken ?? '' },
        });
      },
      onError: (err: any) => {
        const msg = err?.response?.data?.error || err?.message || 'Registration failed';
        Alert.alert('Registration failed', msg);
      },
    },
  });

  const validate = () => {
    const newErrors: typeof errors = {};
    if (!firstName.trim()) newErrors.firstName = 'First name is required';
    if (!lastName.trim()) newErrors.lastName = 'Last name is required';
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
      data: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.toLowerCase().trim(),
        password,
      },
    });
  };

  const openLegal = (which: 'Terms' | 'Privacy Policy') => {
    // Placeholder until real Terms/Privacy pages exist.
    Alert.alert(which, `Bluebird's ${which === 'Terms' ? 'Terms of Service' : 'Privacy Policy'} will be available here soon.`);
  };

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const isDark = colors.scheme === 'dark';

  const inputStyle = [
    styles.input,
    { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={styles.scrollContent}
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity
          style={[styles.backBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.back()}
        >
          <Feather name="chevron-left" size={22} color={colors.foreground} />
        </TouchableOpacity>

        <Text style={[styles.title, { color: colors.foreground }]}>Create your account</Text>

        <View style={styles.form}>
          {/* First / Last name row */}
          <View style={styles.nameRow}>
            <View style={styles.nameCol}>
              <TextInput
                style={[...inputStyle, errors.firstName && { borderColor: colors.destructive }]}
                placeholder="First Name"
                placeholderTextColor={colors.mutedForeground}
                value={firstName}
                onChangeText={setFirstName}
                autoCapitalize="words"
                autoComplete="given-name"
                textContentType="givenName"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => lastNameRef.current?.focus()}
              />
              {errors.firstName && <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.firstName}</Text>}
            </View>
            <View style={styles.nameCol}>
              <TextInput
                ref={lastNameRef}
                style={[...inputStyle, errors.lastName && { borderColor: colors.destructive }]}
                placeholder="Last Name"
                placeholderTextColor={colors.mutedForeground}
                value={lastName}
                onChangeText={setLastName}
                autoCapitalize="words"
                autoComplete="family-name"
                textContentType="familyName"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => emailRef.current?.focus()}
              />
              {errors.lastName && <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.lastName}</Text>}
            </View>
          </View>

          {/* Email */}
          <View>
            <TextInput
              ref={emailRef}
              style={[...inputStyle, errors.email && { borderColor: colors.destructive }]}
              placeholder="Email Address"
              placeholderTextColor={colors.mutedForeground}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => passwordRef.current?.focus()}
            />
            {errors.email && <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.email}</Text>}
          </View>

          {/* Password */}
          <View>
            <View style={[styles.inputRow, { backgroundColor: colors.card, borderColor: errors.password ? colors.destructive : colors.border }]}>
              <TextInput
                ref={passwordRef}
                style={[styles.inputFlex, { color: colors.foreground }]}
                placeholder="Password"
                placeholderTextColor={colors.mutedForeground}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="go"
                onSubmitEditing={handleCreate}
              />
              <TouchableOpacity onPress={() => setShowPassword((v) => !v)} hitSlop={8}>
                <Feather name={showPassword ? 'eye-off' : 'eye'} size={18} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
            {errors.password && <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.password}</Text>}
          </View>

          <Text style={[styles.termsText, { color: colors.mutedForeground }]}>
            By creating an account, you agree to Bluebird's{' '}
            <Text style={[styles.termsLink, { color: colors.primary }]} onPress={() => openLegal('Terms')}>Terms</Text>
            {' '}and{' '}
            <Text style={[styles.termsLink, { color: colors.primary }]} onPress={() => openLegal('Privacy Policy')}>Privacy Policy</Text>.
          </Text>
        </View>
      </KeyboardAwareScrollViewCompat>

      {/* Bottom pinned action */}
      <View style={[styles.footer, { paddingBottom: bottomPad + 16 }]}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 24 },
  backBtn: {
    marginTop: 8, marginBottom: 20,
    width: 38, height: 38, borderRadius: 19, borderWidth: 1,
    justifyContent: 'center', alignItems: 'center',
  },
  title: { fontSize: 26, fontFamily: 'Inter_700Bold', letterSpacing: -0.4, marginBottom: 22 },
  form: { gap: 14 },
  nameRow: { flexDirection: 'row', gap: 12 },
  nameCol: { flex: 1 },
  input: {
    borderWidth: 1,
    borderRadius: 14, height: 52, paddingHorizontal: 16,
    fontSize: 15, fontFamily: 'Inter_400Regular',
  },
  inputRow: {
    borderWidth: 1,
    borderRadius: 14, height: 52, paddingHorizontal: 16,
    flexDirection: 'row', alignItems: 'center',
  },
  inputFlex: { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular' },
  errorText: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 4 },
  termsText: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 18, marginTop: 2 },
  termsLink: { fontFamily: 'Inter_600SemiBold' },
  footer: { paddingHorizontal: 20, paddingTop: 8 },
  submitBtn: { height: 54, borderRadius: 999, justifyContent: 'center', alignItems: 'center' },
  submitBtnDisabled: { opacity: 0.7 },
  submitBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
});
