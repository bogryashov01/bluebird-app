import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Redirect, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { createMainBluebirdApiIntegration } from '@/lib/mainBluebirdApi';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import {
  checkClerkBluebirdRegistrationStatus,
  ClerkRegistrationCompletionError,
  diagnoseClerkBluebirdRegistrationProfile,
  getClerkRegistrationCompletionCheck,
  getClerkRegistrationWriteOutcome,
  saveClerkBluebirdRegistration,
  type ClerkRegistrationCompletionCheck,
  type ClerkRegistrationProfileDiagnostic,
  type ClerkRegistrationSaveDiagnostic,
  type ClerkRegistrationWriteOutcome,
} from '@/lib/clerkBluebirdProfile';
import {
  buildClerkProfileUpdateRequest,
  getClerkProfileRegistrationDraft,
  getClerkRegistrationProfileResult,
  setClerkProfileRegistrationDraft,
  setClerkVerifiedRegistrationCompletion,
  validateClerkAirportCitySelection,
  validateClerkProfileForm,
} from '@/lib/clerkProfileOnboarding';
import {
  describeProductionReadFailure,
  fetchProductionAirportCities,
  fetchProductionAirports,
  productionReadRetryDelay,
  shouldRetryProductionRead,
} from '@/lib/productionFlights';
import type { ClerkSessionSnapshot } from '@/lib/clerkProductionTokenProvider';
import type { UpdateProductionUserProfileRequest } from '@/lib/productionAuthApi';

export default function RegistrationReviewScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { authMode, clerkMemberResolution } = useAuth();
  const session = useClerkAuthSnapshot();
  const configuration = getMainBluebirdApiConfigurationOrNull();
  const clerkUserId = session?.isSignedIn === true ? session.userId : null;
  const isActiveIncompleteIdentity =
    authMode === 'clerk' &&
    !!clerkUserId &&
    clerkMemberResolution.status === 'profile_incomplete' &&
    clerkMemberResolution.clerkUserId === clerkUserId;
  const [draftState, setDraftState] = useState<{
    identity: string | null;
    draft: ReturnType<typeof getClerkProfileRegistrationDraft> | null;
  }>(() => ({
    identity: clerkUserId,
    draft: clerkUserId ? getClerkProfileRegistrationDraft(clerkUserId) : null,
  }));
  const draft = draftState.identity === clerkUserId
    ? draftState.draft
    : clerkUserId
      ? getClerkProfileRegistrationDraft(clerkUserId)
      : null;
  const selectedAirportCodes = draft
    ? [...new Set([draft.homeAirportCode]
      .map((code) => code?.trim().toUpperCase())
      .filter((code): code is string => !!code))]
    : [];
  const selectedAirportCodesKey = selectedAirportCodes.join(',');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveDiagnostic, setSaveDiagnostic] = useState<ClerkRegistrationSaveDiagnostic | null>(null);
  const [completionCheck, setCompletionCheck] = useState<ClerkRegistrationCompletionCheck | null>(null);
  const [profileDiagnostic, setProfileDiagnostic] = useState<ClerkRegistrationProfileDiagnostic | 'loading' | 'setup_unavailable' | null>(null);
  const [isDiagnosingProfile, setIsDiagnosingProfile] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [weightNotConfirmed, setWeightNotConfirmed] = useState(false);
  const savingRef = useRef(false);
  const profileDiagnosticRef = useRef(false);
  const currentIdentity = useRef<string | null>(clerkUserId);
  currentIdentity.current = session?.isSignedIn === true ? session.userId ?? null : null;
  const currentSession = useRef(session);
  currentSession.current = session;
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  useEffect(() => {
    setDraftState({
      identity: clerkUserId,
      draft: clerkUserId ? getClerkProfileRegistrationDraft(clerkUserId) : null,
    });
    setSaveError(null);
    setSaveDiagnostic(null);
    setCompletionCheck(null);
    setProfileDiagnostic(null);
    setIsDiagnosingProfile(false);
    setIsCheckingStatus(false);
    setWeightNotConfirmed(false);
    savingRef.current = false;
    profileDiagnosticRef.current = false;
  }, [clerkUserId]);

  const airportsQuery = useQuery({
    queryKey: ['clerk-registration-review-airport-details', configuration?.environment, selectedAirportCodesKey],
    queryFn: ({ signal }) => {
      if (!configuration) throw new Error('Main Bluebird API configuration is unavailable.');
      return fetchProductionAirports(selectedAirportCodes, {
        signal,
        environment: configuration.environment,
        baseUrl: configuration.apiBaseUrl,
      });
    },
    enabled: !!configuration && isActiveIncompleteIdentity && selectedAirportCodes.length > 0,
    retry: shouldRetryProductionRead,
    retryDelay: productionReadRetryDelay,
    staleTime: 24 * 60 * 60 * 1000,
  });
  const citiesQuery = useQuery({
    queryKey: ['clerk-registration-review-city-catalog', configuration?.environment],
    queryFn: ({ signal }) => {
      if (!configuration) throw new Error('Main Bluebird API configuration is unavailable.');
      return fetchProductionAirportCities({
        signal,
        environment: configuration.environment,
        baseUrl: configuration.apiBaseUrl,
      });
    },
    enabled: !!configuration && isActiveIncompleteIdentity,
    retry: shouldRetryProductionRead,
    retryDelay: productionReadRetryDelay,
    staleTime: 24 * 60 * 60 * 1000,
  });
  const airports = airportsQuery.data ?? [];
  const cities = citiesQuery.data ?? [];
  const airportReadFailure = airportsQuery.isError
    ? describeProductionReadFailure(airportsQuery.error, 'airport details')
    : null;
  const cityReadFailure = citiesQuery.isError
    ? describeProductionReadFailure(citiesQuery.error, 'the city list')
    : null;
  const cityKeys = cities.map((city) => city.key);
  const homeAirport = draft
    ? airports.find((airport) => airport.code === draft.homeAirportCode)
    : undefined;
  const selectedCities = draft
    ? draft.favoriteCityKeys
      .map((key) => cities.find((city) => city.key === key))
      .filter((city) => city !== undefined)
    : [];

  if (!session?.isLoaded) return <CenteredState title="Checking your registration" loading />;
  if (session.isSignedIn !== true || !clerkUserId || !isActiveIncompleteIdentity) {
    return <Redirect href="/(clerk-auth)/signed-in" />;
  }
  if (!draft) return <CenteredState title="Your registration draft is unavailable." />;

  const createAuthenticatedApi = () => {
    if (!configuration) throw new Error('Main Bluebird API configuration is unavailable.');
    return createMainBluebirdApiIntegration({
      configuration,
      tokenProvider: {
        environment: configuration.environment,
        getVerifiedAccessToken: async () => {
          const activeSession = currentSession.current as ClerkSessionSnapshot | null;
          if (
            !activeSession ||
            activeSession.isSignedIn !== true ||
            currentIdentity.current !== clerkUserId
          ) return null;
          return activeSession.getToken();
        },
      },
    });
  };

  const saveRegistration = async () => {
    if (savingRef.current) return;
    if (currentIdentity.current !== clerkUserId) {
      setSaveError('Your signed-in account changed. Reopen registration to continue.');
      return;
    }
    const profileError = validateClerkProfileForm(draft.values);
    if (profileError) {
      setSaveError(profileError);
      return;
    }
    if (airportsQuery.isError || citiesQuery.isError) {
      setSaveError('We couldn’t verify your locations. Use an available retry above or go back and search again.');
      return;
    }
    if (airportsQuery.isLoading || citiesQuery.isLoading) {
      setSaveError('Wait for your locations to finish loading before saving.');
      return;
    }
    if (!homeAirport) {
      setSaveError('Your home airport is no longer available. Go back and choose it again.');
      return;
    }
    const selectionError = validateClerkAirportCitySelection({
      homeAirportCode: draft.homeAirportCode,
      favoriteCityKeys: draft.favoriteCityKeys,
      catalogKeys: cityKeys,
    });
    if (selectionError) {
      setSaveError(selectionError);
      return;
    }
    const profileResult = getClerkRegistrationProfileResult(clerkUserId);
    if (
      !profileResult ||
      profileResult.completion !== 'completion_required' ||
      !configuration
    ) {
      setSaveError('Your registration could not be verified. Go back and reload your profile.');
      return;
    }

    let data: UpdateProductionUserProfileRequest;
    try {
      data = buildClerkProfileUpdateRequest({
        values: draft.values,
        homeAirportCode: draft.homeAirportCode,
        favoriteCityKeys: draft.favoriteCityKeys,
        catalogKeys: cityKeys,
        profile: profileResult.profile,
      });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Review your details and try again.');
      return;
    }

    setClerkProfileRegistrationDraft(clerkUserId, draft);
    savingRef.current = true;
    setIsSaving(true);
    setSaveError(null);
    setSaveDiagnostic(null);
    setCompletionCheck(null);
    try {
      const api = createAuthenticatedApi();
      const result = await saveClerkBluebirdRegistration(api.authenticated, profileResult, data);
      if (currentIdentity.current !== clerkUserId) return;
      if (!setClerkVerifiedRegistrationCompletion(clerkUserId, result.currentUser)) {
        throw new ClerkRegistrationCompletionError(result.diagnostic);
      }
      setSaveDiagnostic(result.diagnostic);
      setCompletionCheck(getClerkRegistrationCompletionCheck(result.diagnostic));
      setWeightNotConfirmed(!result.weightSaved);
    } catch (error) {
      if (currentIdentity.current !== clerkUserId) return;
      if (error instanceof ClerkRegistrationCompletionError) {
        setSaveDiagnostic(error.diagnostic);
        setCompletionCheck(getClerkRegistrationCompletionCheck(error.diagnostic));
        setSaveError(null);
      } else {
        setSaveError(getRegistrationSaveErrorMessage(error));
      }
    } finally {
      savingRef.current = false;
      if (currentIdentity.current === clerkUserId) setIsSaving(false);
    }
  };

  const checkRegistrationStatus = async () => {
    if (isCheckingStatus || isSaving || currentIdentity.current !== clerkUserId) return;
    setIsCheckingStatus(true);
    setSaveError(null);
    try {
      const api = createAuthenticatedApi();
      const result = await checkClerkBluebirdRegistrationStatus(api.authenticated);
      if (currentIdentity.current !== clerkUserId) return;
      setCompletionCheck(result);
      if (
        result.kind === 'confirmed_complete' &&
        result.currentUser &&
        !setClerkVerifiedRegistrationCompletion(clerkUserId, result.currentUser)
      ) {
        setCompletionCheck({ kind: 'unavailable', httpStatus: result.httpStatus });
      }
    } catch {
      if (currentIdentity.current === clerkUserId) {
        setCompletionCheck({ kind: 'unavailable', httpStatus: null });
      }
    } finally {
      if (currentIdentity.current === clerkUserId) setIsCheckingStatus(false);
    }
  };

  const canRunProfileDiagnostic =
    __DEV__ &&
    configuration?.environment === 'development' &&
    isActiveIncompleteIdentity;
  const diagnoseCurrentProfile = async () => {
    if (
      !canRunProfileDiagnostic ||
      profileDiagnosticRef.current ||
      currentIdentity.current !== clerkUserId
    ) return;
    profileDiagnosticRef.current = true;
    setIsDiagnosingProfile(true);
    setProfileDiagnostic('loading');
    try {
      const result = await diagnoseClerkBluebirdRegistrationProfile(createAuthenticatedApi().authenticated);
      if (currentIdentity.current === clerkUserId) setProfileDiagnostic(result);
    } catch {
      if (currentIdentity.current === clerkUserId) setProfileDiagnostic('setup_unavailable');
    } finally {
      profileDiagnosticRef.current = false;
      if (currentIdentity.current === clerkUserId) setIsDiagnosingProfile(false);
    }
  };

  const continueAfterConfirmation = () => {
    router.replace({ pathname: '/(auth)/welcome-tour', params: { clerkFlow: '1' } });
  };
  const completionConfirmed = completionCheck?.kind === 'confirmed_complete';

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite, paddingTop: topPad }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Locations"
          onPress={() => router.back()}
          style={[styles.backButton, { backgroundColor: colors.muted }]}
          testID="back-to-location-selection"
        >
          <Text style={[styles.backChevron, { color: colors.textOnSurface }]}>‹</Text>
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>STEP 3 OF 3</Text>
          <Text style={[styles.title, { color: colors.textOnSurface }]}>Review &amp; Save</Text>
        </View>
      </View>

      <KeyboardAwareScrollViewCompat
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 24 }]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
        showsVerticalScrollIndicator={false}
      >
        <ReviewCard title="Personal Information">
          <SummaryLine label="Name" value={`${draft.values.firstName.trim()} ${draft.values.lastName.trim()}`} />
          <SummaryLine label="Verified phone" value={draft.values.phoneE164 || 'Not available'} />
          <SummaryLine label="Date of birth" value={draft.values.dob} />
          <SummaryLine label="Gender" value={draft.values.gender === 'female' ? 'Female' : 'Male'} />
          {draft.values.weightLbs.trim() ? (
            <>
              <SummaryLine label="Weight" value={`${draft.values.weightLbs} lbs`} />
              <Text style={[styles.disclosure, { color: colors.mutedForegroundLight }]}>
                Weight is optional and will only be marked saved if Bluebird confirms it.
              </Text>
            </>
          ) : null}
        </ReviewCard>

        <ReviewCard title="Locations">
          <SummaryLine
            label="Home airport"
            value={homeAirport ? `${homeAirport.name} (${homeAirport.code})` : draft.homeAirportCode}
          />
          <View style={styles.summaryLine}>
            <Text style={[styles.summaryLabel, { color: colors.mutedForegroundLight }]}>Cities</Text>
            <Text style={[styles.summaryValue, { color: colors.textOnSurface }]}>
              {selectedCities.length
                ? selectedCities.map((city) => `${city.displayName}, ${city.country}`).join('\n')
                : 'Choose at least one city'}
            </Text>
          </View>
          {airportsQuery.isLoading || citiesQuery.isLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.bodyText, { color: colors.mutedForegroundLight }]}>Loading location details…</Text>
            </View>
          ) : null}
          {airportReadFailure ? (
            <View style={styles.loadingRow}>
              <ReviewReadFailure
                label={airportReadFailure.message}
                retryable={airportReadFailure.retryable}
                onRetry={() => void airportsQuery.refetch()}
                testID="registration-airport-details-error"
              />
            </View>
          ) : null}
          {cityReadFailure ? (
            <View style={styles.loadingRow}>
              <ReviewReadFailure
                label={cityReadFailure.message}
                retryable={cityReadFailure.retryable}
                onRetry={() => void citiesQuery.refetch()}
                testID="registration-city-details-error"
              />
            </View>
          ) : null}
        </ReviewCard>

        {saveError ? (
          <Text accessibilityLiveRegion="polite" style={[styles.inlineError, { color: colors.destructive }]} testID="registration-save-error">
            {saveError}
          </Text>
        ) : null}

        {canRunProfileDiagnostic ? (
          <View style={[styles.warningCard, { backgroundColor: colors.muted, borderColor: colors.border }]} testID="registration-profile-diagnostic">
            <Text style={[styles.optionTitle, { color: colors.textOnSurface }]}>
              Development profile diagnostic
            </Text>
            <Text style={[styles.bodyText, { color: colors.mutedForegroundLight }]}>
              This manually requests GET /api/me, then requests GET /api/me/profile only if the API confirms you are signed in. The profile request may synchronize verified Clerk phone information. It does not save, retry, clear your draft, or sign you out.
            </Text>
            <ActionButton
              label={isDiagnosingProfile ? 'Reading profile…' : 'Check saved profile details'}
              onPress={() => void diagnoseCurrentProfile()}
              disabled={isDiagnosingProfile || isSaving || isCheckingStatus}
              loading={isDiagnosingProfile}
              testID="diagnose-saved-profile"
            />
            {profileDiagnostic && profileDiagnostic !== 'loading' && profileDiagnostic !== 'setup_unavailable' ? (
              <RegistrationProfileDiagnosticResult result={profileDiagnostic} />
            ) : null}
            {profileDiagnostic === 'loading' ? (
              <Text accessibilityLiveRegion="polite" style={[styles.bodyText, { color: colors.mutedForegroundLight }]}>
                Reading Development API status and profile details…
              </Text>
            ) : null}
            {profileDiagnostic === 'setup_unavailable' ? (
              <Text accessibilityLiveRegion="polite" style={[styles.bodyText, { color: colors.destructive }]}>
                The Development diagnostic could not be started. No profile values were read.
              </Text>
            ) : null}
          </View>
        ) : null}

        {saveDiagnostic && completionCheck ? (
          <View style={[styles.warningCard, { backgroundColor: colors.muted, borderColor: colors.border }]} testID="registration-recovery-status">
            <Text style={[styles.optionTitle, { color: colors.textOnSurface }]}>
              {completionConfirmed ? 'Registration confirmed' : 'Registration needs confirmation'}
            </Text>
            <Text accessibilityLiveRegion="polite" style={[styles.bodyText, { color: colors.mutedForegroundLight }]} testID="registration-write-outcome">
              {describeRegistrationWriteOutcome(getClerkRegistrationWriteOutcome(saveDiagnostic))}
            </Text>
            <Text accessibilityLiveRegion="polite" style={[styles.bodyText, { color: colors.mutedForegroundLight }]} testID="registration-completion-outcome">
              {describeRegistrationCompletionCheck(completionCheck)}
            </Text>
            {completionConfirmed && weightNotConfirmed ? (
              <Text style={[styles.bodyText, { color: colors.mutedForegroundLight }]}>
                Your profile is complete. Bluebird did not confirm the optional weight, so it is not marked as saved.
              </Text>
            ) : null}
            {completionConfirmed ? (
              <ActionButton
                label="Continue"
                onPress={continueAfterConfirmation}
                testID="continue-after-registration-confirmed"
              />
            ) : (
              <ActionButton
                label={isCheckingStatus ? 'Checking status…' : 'Check registration status'}
                onPress={() => void checkRegistrationStatus()}
                disabled={isCheckingStatus || isSaving || !configuration}
                loading={isCheckingStatus}
                testID="check-registration-status"
              />
            )}
          </View>
        ) : null}
      </KeyboardAwareScrollViewCompat>

      {!completionConfirmed ? (
        <View style={[styles.footer, { borderTopColor: colors.border, paddingBottom: bottomPad + 12 }]}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            style={[styles.backAction, { borderColor: colors.border }]}
            testID="back-from-registration-review"
          >
            <Text style={[styles.backActionText, { color: colors.textOnSurface }]}>Back</Text>
          </Pressable>
          <ActionButton
            label={isSaving ? 'Saving…' : 'Confirm & Save'}
            onPress={() => void saveRegistration()}
            disabled={isSaving || isCheckingStatus || !configuration || airportsQuery.isLoading || citiesQuery.isLoading || airportsQuery.isError || citiesQuery.isError}
            loading={isSaving}
            testID="confirm-save-profile"
          />
        </View>
      ) : null}
    </View>
  );
}

function ReviewCard({ title, children }: { title: string; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.cardTitle, { color: colors.textOnSurface }]}>{title}</Text>
      {children}
    </View>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={styles.summaryLine}>
      <Text style={[styles.summaryLabel, { color: colors.mutedForegroundLight }]}>{label}</Text>
      <Text style={[styles.summaryValue, { color: colors.textOnSurface }]}>{value}</Text>
    </View>
  );
}

function RegistrationProfileDiagnosticResult({
  result,
}: {
  result: ClerkRegistrationProfileDiagnostic;
}) {
  const colors = useColors();
  if (result.kind === 'not_authenticated') {
    return (
      <View style={styles.diagnosticResults} testID="registration-profile-diagnostic-result">
        <SummaryLine label="GET /api/me" value={`HTTP ${result.meHttpStatus ?? 'unknown'} · not authenticated`} />
        <Text style={[styles.bodyText, { color: colors.mutedForegroundLight }]}>
          No profile details were requested because the API did not confirm authentication.
        </Text>
      </View>
    );
  }
  if (result.kind === 'unavailable') {
    const endpoint = result.failedEndpoint === 'me' ? 'GET /api/me' : 'GET /api/me/profile';
    const status = result.failedEndpoint === 'me' ? result.meHttpStatus : result.profileHttpStatus;
    return (
      <View style={styles.diagnosticResults} testID="registration-profile-diagnostic-result">
        <Text style={[styles.bodyText, { color: colors.destructive }]}>
          {endpoint} could not be read (HTTP {status ?? 'unknown'}). Profile field values are unavailable.
        </Text>
      </View>
    );
  }

  const profile = result.profile;
  const presence = (value: typeof profile.fields.firstName) =>
    value === 'present' ? 'Present' : value === 'absent' ? 'Absent' : 'Unknown';
  const condition = (value: boolean | null) =>
    value === null ? 'Unknown' : value ? 'Yes' : 'No';
  return (
    <View style={styles.diagnosticResults} testID="registration-profile-diagnostic-result">
      <SummaryLine label="GET /api/me" value={`HTTP ${result.meHttpStatus ?? 'unknown'} · authenticated`} />
      <SummaryLine label="/api/me.isProfileComplete" value={result.isProfileComplete ? 'Yes' : 'No'} />
      <SummaryLine label="GET /api/me/profile" value={`HTTP ${result.profileHttpStatus ?? 'unknown'}`} />
      <SummaryLine label="Profile isComplete" value={condition(profile.profileIsComplete)} />
      <SummaryLine label="First name" value={presence(profile.fields.firstName)} />
      <SummaryLine label="Last name" value={presence(profile.fields.lastName)} />
      <SummaryLine label="Date of birth" value={presence(profile.fields.dob)} />
      <SummaryLine label="Gender" value={presence(profile.fields.gender)} />
      <SummaryLine label="Home airport" value={presence(profile.fields.homeAirport)} />
      <SummaryLine label="Favorite cities" value={presence(profile.fields.favoriteCities)} />
      <SummaryLine label="Email" value={`${presence(profile.fields.email)} · required by the API`} />
      <SummaryLine
        label="Email account condition"
        value={`Editing ${profile.emailLocked === null ? 'unknown' : profile.emailLocked ? 'locked' : 'unlocked'} · signup type ${profile.signupChannel ?? 'unknown'}`}
      />
      <SummaryLine label="Verified phone" value={presence(profile.fields.verifiedPhone)} />
      <SummaryLine
        label="Verified phone required"
        value={profile.phoneVerificationRequired === null
          ? 'Unknown'
          : profile.phoneVerificationRequired ? 'Yes' : 'No'}
      />
      <SummaryLine
        label="Phone requirement satisfied"
        value={condition(profile.verifiedPhoneRequirementSatisfied)}
      />
      <SummaryLine
        label="upgradeCreditBalances contract"
        value={profile.upgradeCreditBalances === 'valid'
          ? 'Valid: both balances are nonnegative integers'
          : profile.upgradeCreditBalances === 'missing'
            ? 'Missing'
            : 'Present but invalid'}
      />
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.actionButton, { backgroundColor: colors.primary, opacity: disabled ? 0.55 : 1 }]}
      testID={testID}
    >
      {loading ? <ActivityIndicator color={colors.primaryForeground} /> : (
        <Text style={[styles.actionText, { color: colors.primaryForeground }]}>{label}</Text>
      )}
    </Pressable>
  );
}

function CenteredState({ title, loading = false }: { title: string; loading?: boolean }) {
  const colors = useColors();
  return (
    <View style={[styles.center, { backgroundColor: colors.background }]}>
      {loading ? <ActivityIndicator color={colors.primary} /> : null}
      <Text style={[styles.title, { color: colors.textOnSurface }]}>{title}</Text>
    </View>
  );
}

function ReviewReadFailure({
  label,
  retryable,
  onRetry,
  testID,
}: {
  label: string;
  retryable: boolean;
  onRetry: () => void;
  testID: string;
}) {
  const colors = useColors();
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <Text accessibilityLiveRegion="polite" style={[styles.inlineError, { color: colors.destructive }]} testID={testID}>
        {label}
      </Text>
      {retryable ? (
        <Pressable accessibilityRole="button" onPress={onRetry} style={{ alignSelf: 'flex-start' }}>
          <Text style={[styles.retryText, { color: colors.primary }]}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function getRegistrationSaveErrorMessage(error: unknown): string {
  const typed = error as { code?: string; status?: number };
  if (typed?.code === 'session_expired' || typed?.status === 401) {
    return 'Your sign-in has expired. Sign in again, then reopen registration.';
  }
  if (typed?.code === 'network' || typed?.code === 'timeout') {
    return 'Bluebird could not be reached. Your details are still here; check your connection before continuing.';
  }
  return 'Bluebird could not save your registration. Your details are still here; review them and try again.';
}

function describeRegistrationWriteOutcome(outcome: ClerkRegistrationWriteOutcome): string {
  switch (outcome.kind) {
    case 'rejected':
      return `Bluebird rejected the save request (HTTP ${outcome.httpStatus}).`;
    case 'unknown':
      return 'The save outcome is unknown. The request may have reached Bluebird, so this check will not resend it.';
    case 'malformed_response':
      return `Bluebird returned HTTP ${outcome.httpStatus}, but the response did not match the profile contract${outcome.issue ? ` (${outcome.issue})` : ''}.`;
    case 'valid_response':
      return 'Bluebird returned a valid profile response.';
  }
}

function describeRegistrationCompletionCheck(check: ClerkRegistrationCompletionCheck): string {
  const status = check.httpStatus === null ? '' : ` (HTTP ${check.httpStatus})`;
  switch (check.kind) {
    case 'confirmed_complete':
      return `Authenticated GET /api/me confirms that your profile is complete${status}.`;
    case 'incomplete':
      return `Authenticated GET /api/me responded${status}, but your profile is still incomplete.`;
    case 'unauthenticated':
      return `GET /api/me responded${status} without confirming an authenticated profile.`;
    case 'unavailable':
      return `Bluebird’s completion check is unavailable${status ? ` after${status}` : ''}. Your draft is still here; check again when connected.`;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  backButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  backChevron: { fontFamily: 'Inter_500Medium', fontSize: 24, marginTop: -2 },
  headerCopy: { flex: 1, gap: 2 },
  eyebrow: { fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 1 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 23, lineHeight: 29 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 8, gap: 12 },
  card: { borderWidth: 1, borderRadius: 18, padding: 15, gap: 11 },
  cardTitle: { fontFamily: 'Inter_700Bold', fontSize: 16, marginBottom: 1 },
  summaryLine: { gap: 3 },
  summaryLabel: { fontFamily: 'Inter_500Medium', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  summaryValue: { fontFamily: 'Inter_600SemiBold', fontSize: 14, lineHeight: 20 },
  bodyText: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  diagnosticResults: { gap: 3 },
  disclosure: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  inlineError: { fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 19 },
  retryText: { fontFamily: 'Inter_600SemiBold', paddingVertical: 6, paddingHorizontal: 4 },
  warningCard: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  optionTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14, lineHeight: 19 },
  footer: { borderTopWidth: 1, paddingHorizontal: 18, paddingTop: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  backAction: { minHeight: 52, minWidth: 84, borderRadius: 999, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  backActionText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  actionButton: { flex: 1, minHeight: 52, borderRadius: 999, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center' },
  actionText: { fontFamily: 'Inter_600SemiBold', fontSize: 15, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
});
