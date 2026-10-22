import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { BluebirdLogo } from '@/components/BluebirdLogo';
import { useColors } from '@/hooks/useColors';
import { useAuth as useBluebirdAuth } from '@/context/AuthContext';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { createMainBluebirdApiIntegration } from '@/lib/mainBluebirdApi';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import {
  canEditClerkBluebirdProfile,
  getClerkBluebirdProfileEffectDependencies,
  isClerkBluebirdProfileResultCurrent,
  loadClerkBluebirdProfile,
} from '@/lib/clerkBluebirdProfile';
import {
  CLERK_PROFILE_SAVE_LIMITATION,
  getVerifiedClerkPhoneNumber,
  canEditClerkRegistrationEmail,
  getClerkRegistrationEmailValue,
  getClerkProfileRegistrationDraft,
  setClerkProfileFormDraft,
  setClerkRegistrationProfileResult,
  validateClerkProfileForm,
} from '@/lib/clerkProfileOnboarding';
import type { ProductionUserProfile } from '@/lib/productionAuthApi';
import type { BluebirdProfileLoadResult } from '@/lib/clerkBluebirdProfile';

type ApiClient = ReturnType<typeof createMainBluebirdApiIntegration>;
type LoadState =
  | { kind: 'loading' }
  | { kind: 'refreshing'; clerkUserId: string; result: BluebirdProfileLoadResult }
  | { kind: 'error'; message: string; clerkUserId?: string; staleResult?: BluebirdProfileLoadResult }
  | { kind: 'loaded'; clerkUserId: string; result: BluebirdProfileLoadResult };

export default function BluebirdProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const session = useClerkAuthSnapshot();
  const { clerkMemberResolution } = useBluebirdAuth();
  const configuration = getMainBluebirdApiConfigurationOrNull();
  const verifiedCurrentUser =
    (clerkMemberResolution.status === 'profile_complete' ||
      clerkMemberResolution.status === 'profile_incomplete') &&
    clerkMemberResolution.clerkUserId === session?.userId
      ? clerkMemberResolution.currentUser
      : undefined;
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const cachedProfile = useRef<{ clerkUserId: string; result: BluebirdProfileLoadResult } | null>(null);
  const currentIdentity = useRef<string | null>(session?.userId ?? null);
  currentIdentity.current = session?.userId ?? null;
  const currentSession = useRef(session);
  currentSession.current = session;
  const profileLoadDependencies = getClerkBluebirdProfileEffectDependencies({
    configuration,
    session,
    loadAttempt,
  });

  const createApi = useCallback((): ApiClient => {
    if (!configuration || !session || session.isSignedIn !== true || !session.userId) {
      throw new Error('Your signed-in Bluebird account is unavailable.');
    }
    const requestedClerkUserId = session.userId;
    return createMainBluebirdApiIntegration({
      configuration,
      tokenProvider: {
        environment: configuration.environment,
        getVerifiedAccessToken: async () => {
          const activeSession = currentSession.current;
          if (
            !activeSession ||
            activeSession.isSignedIn !== true ||
            activeSession.userId !== requestedClerkUserId
          ) return null;
          return activeSession.getToken();
        },
      },
    });
  }, profileLoadDependencies);

  const loadProfile = useCallback(async (signal: AbortSignal) => {
    if (!session?.isLoaded || session.isSignedIn !== true || !session.userId) return;
    const requestedClerkUserId = session.userId;
    const cached = cachedProfile.current;
    setLoadState(cached?.clerkUserId === requestedClerkUserId
      ? { kind: 'refreshing', ...cached }
      : { kind: 'loading' });
    try {
      const result = await loadClerkBluebirdProfile(
        createApi().authenticated,
        signal,
        verifiedCurrentUser,
      );
      if (!isClerkBluebirdProfileResultCurrent({
        requestedClerkUserId,
        currentClerkUserId: currentIdentity.current,
        aborted: signal.aborted,
      })) return;
      cachedProfile.current = { clerkUserId: requestedClerkUserId, result };
      setLoadState({ kind: 'loaded', clerkUserId: requestedClerkUserId, result });
    } catch (error) {
      if (signal.aborted || currentIdentity.current !== requestedClerkUserId) return;
      const retained = cachedProfile.current?.clerkUserId === requestedClerkUserId
        ? cachedProfile.current
        : null;
      setLoadState({
        kind: 'error',
        message: getProfileErrorMessage(error),
        ...(retained ? { clerkUserId: retained.clerkUserId, staleResult: retained.result } : {}),
      });
    }
  }, [createApi, verifiedCurrentUser, ...profileLoadDependencies]);

  useEffect(() => {
    if (!session?.isLoaded || session.isSignedIn !== true || !session.userId) {
      setLoadState({ kind: 'loading' });
      return;
    }
    const controller = new AbortController();
    void loadProfile(controller.signal);
    return () => controller.abort();
  }, [loadProfile, ...profileLoadDependencies]);

  if (!session) {
    return <CenteredState title="Profile unavailable" message="Sign in to view your Bluebird profile." />;
  }
  if (!session.isLoaded) return <CenteredState loading title="Loading your profile" />;
  if (session.isSignedIn !== true) return <Redirect href="/(clerk-auth)/sign-in" />;
  if (!session.userId) {
    return <CenteredState title="Profile unavailable" message="Your Bluebird profile could not be loaded." />;
  }
  if (!configuration) {
    return <CenteredState title="Profile unavailable" message="Your Bluebird profile could not be loaded." />;
  }

  const visibleLoadState: LoadState = 'clerkUserId' in loadState &&
    loadState.clerkUserId !== session.userId
    ? { kind: 'loading' }
    : loadState;
  const result = visibleLoadState.kind === 'loaded' || visibleLoadState.kind === 'refreshing'
    ? visibleLoadState.result
    : visibleLoadState.kind === 'error' ? visibleLoadState.staleResult ?? null : null;
  const authenticatedResult = result?.kind === 'authenticated' ? result : null;
  const profileEditable = result ? canEditClerkBluebirdProfile(result) : false;
  const profile = authenticatedResult?.profile ?? null;
  const completionRequired = authenticatedResult?.completion === 'completion_required';
  const verifiedPhoneNumber = getVerifiedClerkPhoneNumber({
    sessionUserId: session.userId,
    clerkUserId: session.userId,
    phoneNumber: session.verifiedPhoneNumber,
    verificationStatus: session.verifiedPhoneNumber ? 'verified' : null,
  });

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: (Platform.OS === 'web' ? 67 : insets.top) + 20,
            paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 32,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          accessibilityRole="button"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/profile'))}
          style={styles.backLink}
        >
          <Text style={[styles.linkText, { color: colors.primary }]}>‹ Account</Text>
        </Pressable>

        {visibleLoadState.kind === 'refreshing' ? (
          <View style={styles.refreshingRow} accessibilityRole="progressbar" testID="clerk-bluebird-profile-refreshing">
            <BluebirdLogo variant="symbol" size="small" style={styles.refreshingMark} />
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : null}
        {visibleLoadState.kind === 'error' && visibleLoadState.staleResult ? (
          <View style={[styles.stateCard, { backgroundColor: colors.surface }]} testID="clerk-bluebird-profile-refresh-error">
            <Text style={[styles.subtitle, { color: colors.mutedForegroundLight }]}>{visibleLoadState.message}</Text>
            <ActionButton
              label="Try again"
              onPress={() => setLoadAttempt((attempt) => attempt + 1)}
            />
          </View>
        ) : null}

        {visibleLoadState.kind === 'loading' ? (
          <CenteredState loading title="Loading your profile" />
        ) : visibleLoadState.kind === 'error' && !visibleLoadState.staleResult ? (
          <View style={styles.stateCard}>
            <Text style={[styles.title, { color: colors.textOnSurface }]}>Profile unavailable</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForegroundLight }]}>
              {visibleLoadState.message}
            </Text>
            <ActionButton
              label="Try again"
              onPress={() => setLoadAttempt((attempt) => attempt + 1)}
            />
          </View>
        ) : !authenticatedResult ||
          authenticatedResult.completion === 'unverified' ||
          !profile ||
          !profileEditable ? (
          <View style={styles.stateCard}>
            <Text style={[styles.title, { color: colors.textOnSurface }]}>Profile unavailable</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForegroundLight }]}>
              We couldn’t verify your profile details. Try again in a moment.
            </Text>
            <ActionButton
              label="Try again"
              onPress={() => setLoadAttempt((attempt) => attempt + 1)}
            />
          </View>
        ) : (
          <ClerkProfileForm
            key={session.userId}
            clerkUserId={session.userId}
            profile={profile}
            verifiedPhoneNumber={verifiedPhoneNumber}
            completionRequired={completionRequired}
            profileResult={authenticatedResult}
          />
        )}
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

function ClerkProfileForm({
  clerkUserId,
  profile,
  verifiedPhoneNumber,
  completionRequired,
  profileResult,
}: {
  clerkUserId: string;
  profile: ProductionUserProfile;
  verifiedPhoneNumber: string | null;
  completionRequired: boolean;
  profileResult: Extract<BluebirdProfileLoadResult, { kind: 'authenticated' }>;
}) {
  const colors = useColors();
  const [values, setValues] = useState(() => getClerkProfileRegistrationDraft(
    clerkUserId,
    profile,
    verifiedPhoneNumber,
  ).values);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setClerkRegistrationProfileResult(clerkUserId, profileResult);
  }, [clerkUserId, profileResult]);

  useEffect(() => {
    setValues((current) => {
      const next = { ...current, phoneE164: verifiedPhoneNumber ?? '' };
      setClerkProfileFormDraft(clerkUserId, next);
      return next;
    });
  }, [clerkUserId, verifiedPhoneNumber]);

  const continueToAirports = () => {
    const email = getClerkRegistrationEmailValue(profile, values.email);
    const error = validateClerkProfileForm({ ...values, email });
    if (error) {
      setFormError(error);
      return;
    }
    setClerkProfileFormDraft(clerkUserId, values);
    router.push({ pathname: '/airport-picker', params: { clerkFlow: '1' } });
  };

  const update = (field: 'firstName' | 'lastName' | 'email' | 'dob' | 'weightLbs', value: string) => {
    if (field === 'email' && !canEditClerkRegistrationEmail(profile)) return;
    setValues((current) => {
      const next = { ...current, [field]: value };
      setClerkProfileFormDraft(clerkUserId, next);
      return next;
    });
    setFormError(null);
  };

  return (
    <View style={styles.formCard} testID="clerk-profile-form">
      <Text style={[styles.title, { color: colors.textOnSurface }]}>
        {completionRequired ? 'Step 1 of 3 · Personal Information' : 'Personal profile'}
      </Text>
      <Text style={[styles.subtitle, { color: colors.mutedForegroundLight }]}>
        Add a few details to get your Bluebird account ready.
      </Text>

      <FormField label="First Name">
        <ProfileInput
          value={values.firstName}
          onChangeText={(value) => update('firstName', value)}
          autoCapitalize="words"
          autoComplete="given-name"
          textContentType="givenName"
          returnKeyType="next"
          testID="profile-first-name"
        />
      </FormField>

      <FormField label="Last Name">
        <ProfileInput
          value={values.lastName}
          onChangeText={(value) => update('lastName', value)}
          autoCapitalize="words"
          autoComplete="family-name"
          textContentType="familyName"
          returnKeyType="next"
          testID="profile-last-name"
        />
      </FormField>

      <FormField label="Email">
        <ProfileInput
          value={getClerkRegistrationEmailValue(profile, values.email)}
          onChangeText={(value) => update('email', value)}
          editable={canEditClerkRegistrationEmail(profile)}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          autoCorrect={false}
          returnKeyType="next"
          testID="profile-email"
        />
        {profile.emailLocked ? (
          <Text style={[styles.helper, { color: colors.mutedForegroundLight }]}>
            This email is verified by your sign-in provider and can’t be changed here.
          </Text>
        ) : null}
      </FormField>

      <FormField label="Phone">
        <ProfileInput
          value={values.phoneE164}
          editable={false}
          placeholder="Verified phone unavailable"
          keyboardType="phone-pad"
          testID="profile-phone"
        />
        {!values.phoneE164 ? (
          <Text style={[styles.helper, { color: colors.destructive }]}>
            Sign in with a verified phone number to continue.
          </Text>
        ) : null}
      </FormField>

      <FormField label="Date of Birth">
        <ProfileInput
          value={values.dob}
          onChangeText={(value) => update('dob', value)}
          placeholder="YYYY-MM-DD"
          keyboardType="numbers-and-punctuation"
          autoCapitalize="none"
          maxLength={10}
          returnKeyType="next"
          testID="profile-date-of-birth"
        />
        <Text style={[styles.helper, { color: colors.mutedForegroundLight }]}>
          Use year-month-day, for example 1985-04-03.
        </Text>
      </FormField>

      <FormField label="Gender">
        <View style={styles.choiceRow}>
          {(['female', 'male'] as const).map((gender) => (
            <Pressable
              key={gender}
              accessibilityRole="button"
              accessibilityState={{ selected: values.gender === gender }}
              onPress={() => {
                setValues((current) => {
                  const next = { ...current, gender };
                  setClerkProfileFormDraft(clerkUserId, next);
                  return next;
                });
                setFormError(null);
              }}
              style={[
                styles.choice,
                {
                  borderColor: values.gender === gender ? colors.primary : colors.border,
                  backgroundColor: values.gender === gender ? colors.muted : colors.surface,
                },
              ]}
              testID={`profile-gender-${gender}`}
            >
              <Text style={[
                styles.choiceText,
                { color: values.gender === gender ? colors.primary : colors.textOnSurface },
              ]}>
                {gender === 'female' ? 'Female' : 'Male'}
              </Text>
            </Pressable>
          ))}
        </View>
      </FormField>

      <FormField label="Weight (lbs)">
        <ProfileInput
          value={values.weightLbs}
          onChangeText={(value) => update('weightLbs', value.replace(/\D/g, '').slice(0, 4))}
          keyboardType="number-pad"
          maxLength={4}
          placeholder="Optional"
          testID="profile-weight-lbs"
        />
      </FormField>

      <View style={[styles.limitationCard, { backgroundColor: colors.muted, borderColor: colors.border }]}>
        <Text style={[styles.helper, { color: colors.textOnSurface }]} testID="profile-save-limitation">
          {CLERK_PROFILE_SAVE_LIMITATION}
        </Text>
      </View>

      {formError ? (
        <Text accessibilityLiveRegion="polite" style={[styles.error, { color: colors.destructive }]} testID="profile-form-error">
          {formError}
        </Text>
      ) : null}

      <ActionButton
        label="Continue to Select Airports"
        onPress={continueToAirports}
        testID="continue-to-airport-selection"
      />
    </View>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForegroundLight }]}>{label}</Text>
      {children}
    </View>
  );
}

function ProfileInput({
  value,
  onChangeText,
  testID,
  ...props
}: {
  value: string;
  onChangeText?: (value: string) => void;
  testID?: string;
} & Omit<React.ComponentProps<typeof TextInput>, 'value' | 'onChangeText' | 'style'>) {
  const colors = useColors();
  return (
    <TextInput
      {...props}
      value={value}
      onChangeText={onChangeText}
      testID={testID}
      style={[
        styles.input,
        {
          backgroundColor: colors.input,
          color: colors.foreground,
          borderColor: colors.border,
          opacity: props.editable === false ? 0.8 : 1,
        },
      ]}
      placeholderTextColor={colors.mutedForeground}
    />
  );
}

function ActionButton({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.actionButton, { backgroundColor: colors.primary }]}
      testID={testID}
    >
      <Text style={[styles.actionText, { color: colors.primaryForeground }]}>{label}</Text>
    </Pressable>
  );
}

function CenteredState({
  title,
  message,
  loading = false,
}: {
  title: string;
  message?: string;
  loading?: boolean;
}) {
  const colors = useColors();
  return (
    <View style={styles.center} accessibilityLabel={loading ? title : undefined}>
      {loading ? (
        <>
          <BluebirdLogo variant="symbol" size="medium" style={styles.loadingMark} />
          <ActivityIndicator size="small" color={colors.primary} />
        </>
      ) : (
        <>
          <Text style={[styles.title, { color: colors.textOnSurface }]}>{title}</Text>
          {message ? <Text style={[styles.subtitle, { color: colors.mutedForegroundLight }]}>{message}</Text> : null}
        </>
      )}
    </View>
  );
}

function getProfileErrorMessage(error: unknown): string {
  const typed = error as { code?: string; status?: number };
  if (typed?.code === 'session_expired' || typed?.status === 401) {
    return 'Your sign-in has expired. Sign in again, then reopen your profile.';
  }
  if (typed?.code === 'network' || typed?.code === 'timeout') {
    return 'Bluebird could not be reached. Check your connection and try again.';
  }
  return 'Bluebird could not load your profile. Please try again.';
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 22, gap: 12, flexGrow: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  refreshingRow: { minHeight: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  refreshingMark: { width: 18, height: 18 },
  loadingMark: { width: 44, height: 48 },
  backLink: { alignSelf: 'flex-start', paddingVertical: 8, paddingRight: 16 },
  linkText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  title: { fontSize: 26, lineHeight: 32, fontFamily: 'Inter_700Bold', letterSpacing: -0.4 },
  subtitle: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_400Regular' },
  stateCard: { padding: 18, borderRadius: 18, gap: 12 },
  formCard: { padding: 18, borderRadius: 18, gap: 16 },
  field: { gap: 7 },
  fieldLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
  },
  choiceRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  choice: {
    minHeight: 44,
    minWidth: 116,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  limitationCard: { borderWidth: 1, borderRadius: 14, padding: 13 },
  helper: { fontSize: 12, lineHeight: 18, fontFamily: 'Inter_400Regular' },
  error: { fontSize: 13, lineHeight: 19, fontFamily: 'Inter_500Medium' },
  actionButton: { minHeight: 52, borderRadius: 999, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center' },
  actionText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
});
