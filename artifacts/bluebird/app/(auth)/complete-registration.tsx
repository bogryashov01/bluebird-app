import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useCompletePhoneRegistration } from '@workspace/api-client-react';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

export default function CompleteRegistrationScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const queryClient = useQueryClient();
  const { signIn, pendingRegistrationGrant, setPendingRegistrationGrant } = useAuth();
  const registrationGrant = pendingRegistrationGrant ?? '';
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [grantExpired, setGrantExpired] = useState(!registrationGrant);
  const lastNameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);

  const registration = useCompletePhoneRegistration({
    mutation: {
      onSuccess: async (data) => {
        await signIn(data.token, data.user as any);
        queryClient.clear();
        router.replace('/(auth)/welcome-tour');
      },
      onError: (err: any) => {
        const status = err?.response?.status;
        const message = err?.response?.data?.error || err?.message || 'Could not create your account. Please try again.';
        setGrantExpired(status === 401);
        setError(message);
      },
    },
  });

  const trimmedFirst = firstName.trim();
  const trimmedLast = lastName.trim();
  const normalizedEmail = email.trim().toLowerCase();
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
  const valid = trimmedFirst.length > 0 && trimmedLast.length > 0 && emailValid && !!registrationGrant;

  const submit = () => {
    if (!valid || registration.isPending) return;
    setError(null);
    registration.mutate({
      data: {
        registrationGrant,
        firstName: trimmedFirst,
        lastName: trimmedLast,
        email: normalizedEmail,
      },
    });
  };

  const restartVerification = () => {
    setPendingRegistrationGrant(null);
    router.replace('/(auth)/phone');
  };
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundMid, paddingTop: topPad }]}>
      <StatusBar style={colors.scheme === 'dark' ? 'light' : 'dark'} />
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad + 24 }]}
        bottomOffset={72}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity
          style={styles.backBtn}
          onPress={restartVerification}
          accessibilityLabel="Restart phone verification"
        >
          <Feather name="arrow-left" size={20} color={colors.mutedOnBrand} />
        </TouchableOpacity>

        <View style={styles.logoRow}>
          <Feather name="send" size={20} color={colors.primary} style={styles.logoIcon} />
          <Text style={[styles.logoText, { color: colors.textOnBrand }]}>Bluebird</Text>
        </View>

        <Text style={[styles.title, { color: colors.textOnBrand }]}>Finish creating your account</Text>
        <Text style={[styles.subtitle, { color: colors.mutedOnBrand }]}>
          Your phone is verified. Add your details to continue.
        </Text>

        <View style={styles.nameRow}>
          <View style={styles.nameField}>
            <Text style={[styles.label, { color: colors.mutedOnBrand }]}>First Name</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground }]}
              placeholder="Alex"
              placeholderTextColor={colors.mutedForeground}
              value={firstName}
              onChangeText={(value) => { setFirstName(value); setError(null); }}
              autoCapitalize="words"
              autoComplete="given-name"
              textContentType="givenName"
              returnKeyType="next"
              onSubmitEditing={() => lastNameRef.current?.focus()}
              autoFocus
              testID="first-name-input"
            />
          </View>
          <View style={styles.nameField}>
            <Text style={[styles.label, { color: colors.mutedOnBrand }]}>Last Name</Text>
            <TextInput
              ref={lastNameRef}
              style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground }]}
              placeholder="Morgan"
              placeholderTextColor={colors.mutedForeground}
              value={lastName}
              onChangeText={(value) => { setLastName(value); setError(null); }}
              autoCapitalize="words"
              autoComplete="family-name"
              textContentType="familyName"
              returnKeyType="next"
              onSubmitEditing={() => emailRef.current?.focus()}
              testID="last-name-input"
            />
          </View>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={[styles.label, { color: colors.mutedOnBrand }]}>Email</Text>
          <TextInput
            ref={emailRef}
            style={[
              styles.input,
              { backgroundColor: colors.input, borderColor: error ? colors.destructive : colors.border, color: colors.foreground },
            ]}
            placeholder="alex@example.com"
            placeholderTextColor={colors.mutedForeground}
            value={email}
            onChangeText={(value) => { setEmail(value); setError(null); }}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="go"
            onSubmitEditing={submit}
            testID="registration-email-input"
          />
        </View>

        {error ? <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text> : null}
        {grantExpired ? (
          <TouchableOpacity
            style={[styles.submitBtn, { backgroundColor: colors.primary }]}
            onPress={restartVerification}
            testID="restart-verification-button"
          >
            <Text style={[styles.submitBtnText, { color: colors.primaryForeground }]}>Verify phone again</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[
              styles.submitBtn,
              { backgroundColor: colors.primary },
              (!valid || registration.isPending) && styles.submitBtnDisabled,
            ]}
            onPress={submit}
            disabled={!valid || registration.isPending}
            activeOpacity={0.8}
            testID="complete-registration-button"
          >
            {registration.isPending
              ? <ActivityIndicator color={colors.primaryForeground} />
              : <Text style={[styles.submitBtnText, { color: colors.primaryForeground }]}>Create account</Text>}
          </TouchableOpacity>
        )}

        <Text style={[styles.backHint, { color: colors.mutedOnBrand }]}>
          Going back starts phone verification again for your security.
        </Text>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: 24 },
  backBtn: { marginTop: 8, marginBottom: 24, width: 36, height: 36, justifyContent: 'center' },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 28 },
  logoIcon: { transform: [{ rotate: '-45deg' }] },
  logoText: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  title: { fontSize: 28, fontFamily: 'Inter_700Bold', marginBottom: 8 },
  subtitle: { fontSize: 15, fontFamily: 'Inter_400Regular', marginBottom: 30, lineHeight: 22 },
  nameRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  nameField: { flex: 1, gap: 6 },
  fieldGroup: { gap: 6, marginBottom: 16 },
  label: { fontSize: 13, fontFamily: 'Inter_500Medium', letterSpacing: 0.3 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    height: 52,
    paddingHorizontal: 14,
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
  },
  errorText: { fontSize: 13, lineHeight: 18, fontFamily: 'Inter_500Medium', marginBottom: 14 },
  submitBtn: { height: 56, borderRadius: 999, justifyContent: 'center', alignItems: 'center' },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  backHint: { marginTop: 14, textAlign: 'center', fontSize: 12, lineHeight: 18, fontFamily: 'Inter_400Regular' },
});