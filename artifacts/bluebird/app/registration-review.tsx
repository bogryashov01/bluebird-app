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
  ClerkRegistrationCompletionError,
  saveClerkBluebirdRegistration,
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
  const [isSaving, setIsSaving] = useState(false);
  const [weightNotConfirmed, setWeightNotConfirmed] = useState(false);
  const savingRef = useRef(false);
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
    setWeightNotConfirmed(false);
    savingRef.current = false;
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
    try {
      const api = createMainBluebirdApiIntegration({
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
      const result = await saveClerkBluebirdRegistration(api.authenticated, profileResult, data);
      if (currentIdentity.current !== clerkUserId) return;
      if (!setClerkVerifiedRegistrationCompletion(clerkUserId, result.currentUser)) {
        throw new ClerkRegistrationCompletionError(result.diagnostic);
      }
      if (result.weightSaved) {
        router.replace({ pathname: '/(auth)/welcome-tour', params: { clerkFlow: '1' } });
      } else {
        setWeightNotConfirmed(true);
      }
    } catch (error) {
      if (currentIdentity.current !== clerkUserId) return;
      setSaveError(getRegistrationSaveErrorMessage(error));
    } finally {
      savingRef.current = false;
      if (currentIdentity.current === clerkUserId) setIsSaving(false);
    }
  };

  const continueAfterWeightNotice = () => {
    router.replace({ pathname: '/(auth)/welcome-tour', params: { clerkFlow: '1' } });
  };

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

        {weightNotConfirmed ? (
          <View style={[styles.warningCard, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Text style={[styles.optionTitle, { color: colors.textOnSurface }]}>Weight not confirmed</Text>
            <Text style={[styles.bodyText, { color: colors.mutedForegroundLight }]}>
              Your registration is complete. Bluebird did not confirm the weight, so it is not marked as saved.
            </Text>
            <ActionButton label="Continue" onPress={continueAfterWeightNotice} testID="continue-after-weight-not-confirmed" />
          </View>
        ) : null}
      </KeyboardAwareScrollViewCompat>

      {!weightNotConfirmed ? (
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
            disabled={isSaving || !configuration || airportsQuery.isLoading || citiesQuery.isLoading || airportsQuery.isError || citiesQuery.isError}
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
  if (error instanceof ClerkRegistrationCompletionError) {
    return 'Bluebird could not confirm your registration. Your details are still here; contact support before trying again.';
  }
  return 'Bluebird could not save your registration. Your details are still here; review them and try again.';
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
