import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/expo';
import { useSignIn, useSignUp } from '@clerk/expo/legacy';
import { Feather } from '@expo/vector-icons';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';
import {
  beginClerkPhoneAuth,
  createClerkPhoneAuthActions,
  resendClerkPhoneCode,
  verifyClerkPhoneCode,
  type ClerkPhoneAuthMode,
  type ClerkPhoneAuthFailureStage,
  type ClerkSignInPhoneResource,
  type ClerkSignUpPhoneResource,
} from '@/lib/clerkPhoneAuth';

type FormStep = 'phone' | 'code';

export function ClerkAuthPanel({ mode }: { mode: ClerkPhoneAuthMode }) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { isLoaded, isSignedIn } = useAuth();
  const signInResource = useSignIn();
  const signUpResource = useSignUp();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<FormStep>('phone');
  const [busyAction, setBusyAction] = useState<'request' | 'verify' | 'resend' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorStage, setErrorStage] = useState<ClerkPhoneAuthFailureStage | null>(null);
  const isSignIn = mode === 'sign-in';
  const resourcesLoaded =
    signInResource.isLoaded &&
    signUpResource.isLoaded &&
    !!signInResource.signIn &&
    !!signUpResource.signUp &&
    !!signInResource.setActive;
  const actions = resourcesLoaded
    ? createClerkPhoneAuthActions({
        signIn: signInResource.signIn as unknown as ClerkSignInPhoneResource,
        signUp: signUpResource.signUp as unknown as ClerkSignUpPhoneResource,
        setActive: async ({ session }) => {
          const activate = signInResource.setActive ?? signUpResource.setActive;
          if (!activate) throw new Error('Clerk is not ready.');
          await activate({ session });
        },
      })
    : null;

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      navigateToClerkSignedIn(() => {
        setErrorStage('navigation');
        setError('Your Clerk session is active, but the signed-in screen could not be opened.');
      });
    }
  }, [isLoaded, isSignedIn]);

  const handleRequestCode = async () => {
    if (busyAction || !actions) return;
    setBusyAction('request');
    setError(null);
    setErrorStage(null);
    const result = await beginClerkPhoneAuth(mode, phone, actions);
    setBusyAction(null);
    if (!result.ok) {
      setError(result.message);
      setErrorStage(result.stage);
      return;
    }
    setCode('');
    setStep(result.nextStep);
  };

  const handleVerifyCode = async () => {
    if (busyAction || !actions) return;
    setBusyAction('verify');
    setError(null);
    setErrorStage(null);
    const result = await verifyClerkPhoneCode(mode, code, actions);
    setBusyAction(null);
    if (!result.ok) {
      setError(result.message);
      setErrorStage(result.stage);
      return;
    }
    navigateToClerkSignedIn(() => {
      setErrorStage('navigation');
      setError('Your Clerk session is active, but the signed-in screen could not be opened.');
    });
  };

  const handleResendCode = async () => {
    if (busyAction || !actions) return;
    setBusyAction('resend');
    setError(null);
    setErrorStage(null);
    const result = await resendClerkPhoneCode(mode, actions);
    setBusyAction(null);
    if (!result.ok) {
      setError(result.message);
      setErrorStage(result.stage);
    }
    else setCode('');
  };

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const pending = busyAction !== null;
  const title = isSignIn ? 'Sign in with Clerk' : 'Create a Clerk account';

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.backgroundMid, paddingTop: topPad },
      ]}
    >
      <StatusBar style={colors.scheme === 'dark' ? 'light' : 'dark'} />
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 20 }]}
        bottomOffset={72}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Bluebird demo sign-in"
          onPress={() => router.replace('/(auth)/welcome')}
          style={styles.backButton}
          testID="clerk-back-to-demo"
        >
          <Feather name="arrow-left" size={21} color={colors.mutedOnBrand} />
        </Pressable>

        <View style={styles.form}>
          <Text style={[styles.eyebrow, { color: colors.paleBlue }]}>BLUEBIRD ACCOUNT</Text>
          <Text style={[styles.title, { color: colors.textOnBrand }]}>{title}</Text>
          <Text style={[styles.subtitle, { color: colors.mutedOnBrand }]}>
            {isSignIn
              ? 'This Clerk session is separate from Bluebird’s phone-based demo account.'
              : 'This Clerk account is separate from Bluebird’s existing onboarding. Phone verification is required.'}
          </Text>

          {(!isLoaded || !resourcesLoaded) && (
            <View style={styles.stateBox} accessibilityLiveRegion="polite" testID="clerk-auth-loading">
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.stateText, { color: colors.mutedOnBrand }]}>
                Connecting to Clerk…
              </Text>
            </View>
          )}

          {isLoaded && resourcesLoaded && isSignedIn !== true && (
            <>
              {step === 'phone' ? (
                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: colors.mutedOnBrand }]}>Phone number</Text>
                  <TextInput
                    accessibilityLabel="Phone number"
                    autoComplete="tel"
                    autoCapitalize="none"
                    keyboardType="phone-pad"
                    onChangeText={(value) => {
                      setPhone(value);
                      setError(null);
                    }}
                    onSubmitEditing={handleRequestCode}
                    placeholder="+1 555 555 0100"
                    placeholderTextColor={colors.mutedForeground}
                    returnKeyType="go"
                    style={[
                      styles.input,
                      { backgroundColor: colors.input, borderColor: error ? colors.destructive : colors.border, color: colors.textOnBrand },
                    ]}
                    textContentType="telephoneNumber"
                    value={phone}
                    testID="clerk-phone-input"
                  />
                  <Text style={[styles.helperText, { color: colors.mutedOnBrand }]}>
                    Use 10 US digits or start an international number with + and its country code.
                  </Text>
                </View>
              ) : (
                <View style={styles.fieldGroup} testID="clerk-code-entry">
                  <Text style={[styles.label, { color: colors.mutedOnBrand }]}>SMS verification code</Text>
                  <Text style={[styles.helperText, { color: colors.mutedOnBrand }]}>
                    Enter the code Clerk sent to your phone. Your number is not shown here.
                  </Text>
                  <TextInput
                    accessibilityLabel="SMS verification code"
                    autoComplete="one-time-code"
                    autoCapitalize="none"
                    keyboardType="number-pad"
                    maxLength={8}
                    onChangeText={(value) => {
                      setCode(value.replace(/\D/g, '').slice(0, 8));
                      setError(null);
                    }}
                    onSubmitEditing={handleVerifyCode}
                    placeholder="Enter code"
                    placeholderTextColor={colors.mutedForeground}
                    returnKeyType="go"
                    style={[
                      styles.input,
                      { backgroundColor: colors.input, borderColor: error ? colors.destructive : colors.border, color: colors.textOnBrand },
                    ]}
                    textContentType="oneTimeCode"
                    value={code}
                    testID="clerk-code-input"
                  />
                </View>
              )}

              {error && (
                <View
                  accessibilityLiveRegion="polite"
                  style={[styles.messageBox, { borderColor: colors.destructive }]}
                  testID="clerk-auth-error"
                >
                  <Text style={[styles.messageTitle, { color: colors.destructive }]}>
                    {getErrorTitle(errorStage)}
                  </Text>
                  <Text style={[styles.stateText, { color: colors.textOnBrand }]}>{error}</Text>
                </View>
              )}

              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: pending || !isLoaded || !resourcesLoaded, busy: pending }}
                disabled={pending || !isLoaded || !resourcesLoaded}
                onPress={step === 'phone' ? handleRequestCode : handleVerifyCode}
                style={[
                  styles.primaryButton,
                  { backgroundColor: colors.primary },
                  (pending || !resourcesLoaded) && styles.disabled,
                ]}
                testID={step === 'phone' ? 'clerk-request-code' : 'clerk-verify-code'}
              >
                {pending ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
                    {step === 'phone' ? 'Send verification code' : 'Verify and continue'}
                  </Text>
                )}
              </Pressable>

              {step === 'code' && (
                <View style={styles.codeActions}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={pending}
                    onPress={handleResendCode}
                    style={styles.secondaryAction}
                    testID="clerk-resend-code"
                  >
                    {busyAction === 'resend' ? (
                      <ActivityIndicator color={colors.paleBlue} />
                    ) : (
                      <Text style={[styles.linkText, { color: colors.paleBlue }]}>Resend code</Text>
                    )}
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={pending}
                    onPress={() => {
                      setStep('phone');
                      setCode('');
                      setError(null);
                      setErrorStage(null);
                    }}
                    style={styles.secondaryAction}
                    testID="clerk-edit-phone"
                  >
                    <Text style={[styles.linkText, { color: colors.paleBlue }]}>Edit phone number</Text>
                  </Pressable>
                </View>
              )}
            </>
          )}
          {isSignedIn === true && errorStage === 'navigation' && error && (
            <View
              accessibilityLiveRegion="polite"
              style={[styles.messageBox, { borderColor: colors.destructive }]}
              testID="clerk-auth-error"
            >
              <Text style={[styles.messageTitle, { color: colors.destructive }]}>
                {getErrorTitle(errorStage)}
              </Text>
              <Text style={[styles.stateText, { color: colors.textOnBrand }]}>{error}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  navigateToClerkSignedIn(() => {
                    setErrorStage('navigation');
                    setError('Your Clerk session is active, but the signed-in screen could not be opened.');
                  })
                }
                style={styles.secondaryAction}
                testID="clerk-retry-navigation"
              >
                <Text style={[styles.linkText, { color: colors.paleBlue }]}>
                  Retry opening the signed-in screen
                </Text>
              </Pressable>
            </View>
          )}
        </View>

        <View style={styles.links}>
          <Text style={[styles.footerText, { color: colors.mutedOnBrand }]}>
            {isSignIn ? 'Need a Clerk account?' : 'Already have a Clerk account?'}
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
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24 },
  content: { flexGrow: 1, justifyContent: 'space-between' },
  backButton: { height: 44, width: 44, justifyContent: 'center' },
  form: { flexGrow: 1, justifyContent: 'center', paddingVertical: 18 },
  eyebrow: { fontSize: 12, fontFamily: 'Inter_600SemiBold', letterSpacing: 1.4, marginBottom: 10 },
  title: { fontSize: 28, fontFamily: 'Inter_700Bold', letterSpacing: -0.4 },
  subtitle: { fontSize: 15, fontFamily: 'Inter_400Regular', lineHeight: 22, marginTop: 8, marginBottom: 26 },
  stateBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 20 },
  fieldGroup: { gap: 8, marginBottom: 18 },
  label: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  helperText: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 19 },
  input: { minHeight: 52, borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, fontSize: 16 },
  messageBox: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 8, marginBottom: 16 },
  messageTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  stateText: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 21 },
  primaryButton: { minHeight: 50, marginTop: 4, borderRadius: 999, justifyContent: 'center', alignItems: 'center' },
  primaryButtonText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  disabled: { opacity: 0.55 },
  codeActions: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 20, marginTop: 20 },
  secondaryAction: { minHeight: 42, justifyContent: 'center' },
  links: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingVertical: 18 },
  footerText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  linkText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
});

function getErrorTitle(stage: ClerkPhoneAuthFailureStage | null): string {
  switch (stage) {
    case 'input':
      return 'Check your phone number';
    case 'create':
      return 'Could not start sign-in';
    case 'code-preparation':
      return 'Could not prepare the code';
    case 'response':
      return 'Could not confirm the verification step';
    case 'verification':
      return 'Could not verify the code';
    case 'session-activation':
      return 'Could not activate your session';
    case 'resend':
      return 'Could not resend the code';
    case 'navigation':
      return 'Could not open the signed-in screen';
    default:
      return 'Authentication issue';
  }
}

function navigateToClerkSignedIn(onFailure: () => void): void {
  try {
    router.replace('/(clerk-auth)/signed-in' as never);
  } catch {
    onFailure();
  }
}
