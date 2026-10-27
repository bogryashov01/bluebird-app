import React, { useEffect, useRef, useState } from 'react';
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
import { useAuth as useClerkAuth } from '@clerk/expo';
import { useSignIn, useSignUp } from '@clerk/expo/legacy';
import { Feather } from '@expo/vector-icons';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import {
  ClerkStartupDiagnosticDetails,
  ClerkStartupStateView,
} from '@/components/ClerkStartupStateView';
import { useAuth as useAppAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { useClerkProviderMounted } from '@/lib/dormantClerkIntegration';
import {
  beginClerkPhoneAuth,
  createClerkAuthActionGuard,
  createClerkPhoneAuthActions,
  resendClerkPhoneCode,
  verifyClerkPhoneCode,
  type ClerkPhoneAuthMode,
  type ClerkPhoneAuthFailureStage,
  type ClerkPhoneAuthDiagnostic,
  type ClerkSignInPhoneResource,
  type ClerkSignUpPhoneResource,
} from '@/lib/clerkPhoneAuth';
import { CLERK_AUTH_CONFIGURATION } from '@/lib/clerkAuthConfig';
import type { ClerkStartupFailureReason } from '@/lib/clerkStartup';
import { logClerkStartupDiagnostic } from '@/lib/clerkStartup';

type FormStep = 'phone' | 'code';

export function ClerkAuthPanel() {
  const {
    clerkStartupState,
    clerkStartupFailureReason,
    clerkStartupSnapshotReceived,
    clerkStartupIsLoaded,
    retryClerkStartup,
  } = useAppAuth();
  const providerMounted = useClerkProviderMounted();

  if (!providerMounted) {
    return (
      <ClerkStartupStateView
        state="failed"
        failureReason="provider_missing"
        snapshotReceived={false}
        isLoaded={false}
        onRetry={retryClerkStartup}
      />
    );
  }

  return (
    <ClerkAuthForm
      startupFailed={clerkStartupState === 'failed'}
      startupFailureReason={clerkStartupFailureReason ?? 'initialization_timeout'}
      startupSnapshotReceived={clerkStartupSnapshotReceived}
      startupIsLoaded={clerkStartupIsLoaded}
      onRetryStartup={retryClerkStartup}
      providerMounted={providerMounted}
    />
  );
}

function ClerkAuthForm({
  startupFailed,
  startupFailureReason,
  startupSnapshotReceived,
  startupIsLoaded,
  onRetryStartup,
  providerMounted,
}: {
  startupFailed: boolean;
  startupFailureReason: ClerkStartupFailureReason;
  startupSnapshotReceived: boolean;
  startupIsLoaded: boolean;
  onRetryStartup: () => void;
  providerMounted: boolean;
}) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const signInResource = useSignIn();
  const signUpResource = useSignUp();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [flowMode, setFlowMode] = useState<ClerkPhoneAuthMode>('sign-in');
  const [step, setStep] = useState<FormStep>('phone');
  const [busyAction, setBusyAction] = useState<'request' | 'verify' | 'resend' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorStage, setErrorStage] = useState<ClerkPhoneAuthFailureStage | null>(null);
  const requestCount = useRef(0);
  const actionGuard = useRef<ReturnType<typeof createClerkAuthActionGuard> | null>(null);
  if (!actionGuard.current) actionGuard.current = createClerkAuthActionGuard(setBusyAction);
  const resourcesLoaded =
    signInResource.isLoaded &&
    signUpResource.isLoaded &&
    !!signInResource.signIn &&
    !!signUpResource.signUp &&
    !!signInResource.setActive;
  const authResourcesReady = isLoaded && resourcesLoaded && !startupFailed;
  const actions = authResourcesReady
    ? createClerkPhoneAuthActions({
        signIn: signInResource.signIn as unknown as ClerkSignInPhoneResource,
        signUp: signUpResource.signUp as unknown as ClerkSignUpPhoneResource,
        diagnostics: __DEV__
          ? {
              nextRequestCount: () => ++requestCount.current,
              log: (event: ClerkPhoneAuthDiagnostic) => {
                console.info('[clerk-phone-auth]', event);
              },
            }
          : undefined,
        setActive: async ({ session }) => {
          const activate = signInResource.setActive ?? signUpResource.setActive;
          if (!activate) throw new Error('Clerk is not ready.');
          await activate({ session });
        },
      })
    : null;

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      logClerkStartupDiagnostic({
        event: 'signed_in_session',
        production: CLERK_AUTH_CONFIGURATION.environment === 'production',
        providerMounted,
        isLoaded,
        isSignedIn: true,
      });
      navigateToClerkSignedIn(providerMounted, () => {
        setErrorStage('navigation');
        setError('Your Clerk session is active, but the signed-in screen could not be opened.');
      });
    }
  }, [isLoaded, isSignedIn, providerMounted]);

  const handleRequestCode = async () => {
    if (!actions) return;
    const guarded = await actionGuard.current!.run('request', async () => {
      requestCount.current = 0;
      setError(null);
      setErrorStage(null);
      return beginClerkPhoneAuth('sign-in', phone, actions);
    });
    if (!guarded.accepted) return;
    const result = guarded.value;
    if (!result.ok) {
      setError(result.message);
      setErrorStage(result.stage);
      return;
    }
    setCode('');
    setPhone(result.phoneNumber);
    setFlowMode(result.mode ?? 'sign-in');
    setStep(result.nextStep);
  };

  const handleVerifyCode = async () => {
    if (!actions) return;
    const guarded = await actionGuard.current!.run('verify', async () => {
      setError(null);
      setErrorStage(null);
      return verifyClerkPhoneCode(flowMode, code, actions);
    });
    if (!guarded.accepted) return;
    const result = guarded.value;
    if (!result.ok) {
      setError(result.message);
      setErrorStage(result.stage);
      return;
    }
    logClerkStartupDiagnostic({
      event: flowMode === 'sign-in' ? 'sign_in_completed' : 'sign_up_completed',
      production: CLERK_AUTH_CONFIGURATION.environment === 'production',
      providerMounted,
    });
    navigateToClerkSignedIn(providerMounted, () => {
      setErrorStage('navigation');
      setError('Your Clerk session is active, but the signed-in screen could not be opened.');
    });
  };

  const handleResendCode = async () => {
    if (!actions) return;
    const guarded = await actionGuard.current!.run('resend', async () => {
      setError(null);
      setErrorStage(null);
      return resendClerkPhoneCode(flowMode, actions);
    });
    if (!guarded.accepted) return;
    const result = guarded.value;
    if (!result.ok) {
      setError(result.message);
      setErrorStage(result.stage);
    }
    else setCode('');
  };

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const pending = busyAction !== null;
  const title = step === 'phone'
    ? 'Continue with your phone'
    : flowMode === 'sign-in'
      ? 'Sign in to Bluebird'
      : 'Verify your phone';

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
          accessibilityLabel="Back to Bluebird welcome"
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
            {step === 'phone'
              ? 'We’ll look for your account first, then send a code to sign in or create an account.'
              : flowMode === 'sign-in'
                ? `Enter the code sent to ${phone}.`
                : `This number isn’t linked to an account yet. Verify ${phone} to create one. Bluebird member access is confirmed separately after sign-in.`}
          </Text>

          {startupFailed ? (
            <View
              accessibilityLiveRegion="polite"
              style={[styles.messageBox, { borderColor: colors.destructive }]}
              testID="clerk-startup-error"
            >
              <Text style={[styles.messageTitle, { color: colors.destructive }]}>
                Sign-in couldn’t start
              </Text>
              <Text style={[styles.stateText, { color: colors.textOnBrand }]}>
                Bluebird couldn’t initialize secure sign-in. Your account is protected. Please try again.
              </Text>
              <ClerkStartupDiagnosticDetails
                failureReason={startupFailureReason}
                snapshotReceived={startupSnapshotReceived}
                isLoaded={startupIsLoaded}
              />
              <Pressable
                accessibilityRole="button"
                onPress={onRetryStartup}
                style={styles.secondaryAction}
                testID="clerk-startup-retry"
              >
                <Text style={[styles.linkText, { color: colors.paleBlue }]}>Retry</Text>
              </Pressable>
            </View>
          ) : (!isLoaded || !resourcesLoaded) && (
            <View style={styles.stateBox} accessibilityLiveRegion="polite" testID="clerk-auth-loading">
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.stateText, { color: colors.mutedOnBrand }]}>
                Preparing sign-in…
              </Text>
            </View>
          )}

          {isSignedIn !== true && (
            <>
              {step === 'phone' ? (
                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: colors.mutedOnBrand }]}>Phone number</Text>
                  <TextInput
                    accessibilityLabel="Phone number"
                    autoComplete="tel"
                    autoCapitalize="none"
                    editable={authResourcesReady}
                    keyboardType="phone-pad"
                    onChangeText={(value) => {
                      setPhone(value);
                      setFlowMode('sign-in');
                      setError(null);
                    }}
                    onSubmitEditing={authResourcesReady ? handleRequestCode : undefined}
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
                    editable={authResourcesReady}
                    keyboardType="number-pad"
                    maxLength={8}
                    onChangeText={(value) => {
                      setCode(value.replace(/\D/g, '').slice(0, 8));
                      setError(null);
                    }}
                    onSubmitEditing={authResourcesReady ? handleVerifyCode : undefined}
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

              {error && authResourcesReady && (
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
                accessibilityState={{ disabled: pending || !authResourcesReady, busy: pending }}
                disabled={pending || !authResourcesReady}
                onPress={step === 'phone' ? handleRequestCode : handleVerifyCode}
                style={[
                  styles.primaryButton,
                  { backgroundColor: colors.primary },
                  (pending || !authResourcesReady) && styles.disabled,
                ]}
                testID={step === 'phone' ? 'clerk-request-code' : 'clerk-verify-code'}
              >
                {pending ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
                    {!authResourcesReady
                      ? 'Preparing sign-in…'
                      : step === 'phone'
                        ? 'Send verification code'
                        : 'Verify and continue'}
                  </Text>
                )}
              </Pressable>

              {step === 'code' && (
                <View style={styles.codeActions}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={pending || !authResourcesReady}
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
                    disabled={pending || !authResourcesReady}
                    onPress={() => {
                      setStep('phone');
                      setCode('');
                      setFlowMode('sign-in');
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
                  navigateToClerkSignedIn(providerMounted, () => {
                    setErrorStage('navigation');
                    setError('Your sign-in is complete, but we couldn’t open your account. Try again.');
                  })
                }
                style={styles.secondaryAction}
                testID="clerk-retry-navigation"
              >
                <Text style={[styles.linkText, { color: colors.paleBlue }]}>
                  Try again
                </Text>
              </Pressable>
            </View>
          )}
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

function navigateToClerkSignedIn(providerMounted: boolean, onFailure: () => void): void {
  const production = CLERK_AUTH_CONFIGURATION.environment === 'production';
  logClerkStartupDiagnostic({
    event: 'signed_in_route_requested',
    production,
    providerMounted,
  });
  try {
    router.replace('/(clerk-auth)/signed-in' as never);
  } catch {
    logClerkStartupDiagnostic({
      event: 'signed_in_route_failed',
      production,
      providerMounted,
      errorCategory: 'unknown',
    });
    onFailure();
  }
}
