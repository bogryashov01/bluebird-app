import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
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
  setClerkPreferredCityConfirmed,
  setClerkPreferredCityDraft,
  setClerkProfileRegistrationDraft,
  setClerkVerifiedRegistrationCompletion,
  suggestClerkPreferredCity,
  validateClerkAirportCitySelection,
  validateClerkProfileForm,
} from '@/lib/clerkProfileOnboarding';
import {
  fetchProductionAirportCities,
  fetchProductionAirportSearch,
  productionReadRetryDelay,
  shouldRetryProductionRead,
  type AirportRecord,
  type ProductionAirportCityGroupResponse,
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
  const [search, setSearch] = useState('');
  const [showCitySearch, setShowCitySearch] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [weightNotSaved, setWeightNotSaved] = useState(false);
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
    setSearch('');
    setShowCitySearch(false);
    setSaveError(null);
    setWeightNotSaved(false);
    savingRef.current = false;
  }, [clerkUserId]);

  const citiesQuery = useQuery({
    queryKey: ['clerk-registration-airport-cities', configuration?.environment],
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
  const cities = citiesQuery.data ?? [];
  const catalogKeys = useMemo(() => cities.map((city) => city.key), [cities]);
  const airportCodes = draft
    ? [...new Set([draft.homeAirportCode, ...draft.additionalAirportCodes].filter(Boolean))]
    : [];
  const airportsQuery = useQuery({
    queryKey: ['clerk-registration-review-airports', configuration?.environment, airportCodes],
    queryFn: async ({ signal }) => {
      if (!configuration) throw new Error('Main Bluebird API configuration is unavailable.');
      const results = await Promise.all(airportCodes.map((code) =>
        fetchProductionAirportSearch(code, {
          signal,
          environment: configuration.environment,
          baseUrl: configuration.apiBaseUrl,
        }),
      ));
      return [...new Map(results.flat().map((airport) => [airport.code, airport])).values()];
    },
    enabled: !!configuration && isActiveIncompleteIdentity && airportCodes.length > 0,
    retry: shouldRetryProductionRead,
    retryDelay: productionReadRetryDelay,
    staleTime: 30_000,
  });
  const airports = airportsQuery.data ?? [];
  const homeAirport = draft
    ? airports.find((airport) => airport.code === draft.homeAirportCode)
    : undefined;
  const suggestedCityKey = draft
    ? suggestClerkPreferredCity(draft.homeAirportCode, cities)
    : null;
  const suggestedCity = cities.find((city) => city.key === suggestedCityKey);
  const preferredCityKey = draft?.favoriteCityKeys[0] || suggestedCityKey || '';
  const preferredCity = cities.find((city) => city.key === preferredCityKey);
  const filteredCities = cities.filter((city) =>
    `${city.displayName} ${city.country}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );

  if (!session?.isLoaded) {
    return <CenteredState title="Checking your registration" loading />;
  }
  if (session.isSignedIn !== true || !clerkUserId || !isActiveIncompleteIdentity) {
    return <Redirect href="/(clerk-auth)/signed-in" />;
  }
  if (!draft) return <CenteredState title="Your registration draft is unavailable." />;

  const setSelectedCity = (city: ProductionAirportCityGroupResponse) => {
    if (!setClerkPreferredCityDraft(clerkUserId, city.key, catalogKeys)) return;
    setDraftState({ identity: clerkUserId, draft: getClerkProfileRegistrationDraft(clerkUserId) });
    setSaveError(null);
  };

  const toggleCityConfirmation = () => {
    const next = !draft.preferredCityConfirmed;
    if (next && !preferredCityKey) {
      setSaveError('Choose a Preferred City before confirming it.');
      return;
    }
    if (preferredCityKey && !draft.favoriteCityKeys.includes(preferredCityKey)) {
      if (!setClerkPreferredCityDraft(clerkUserId, preferredCityKey, catalogKeys)) {
        setSaveError('Choose a Preferred City from Bluebird’s city catalog.');
        return;
      }
    }
    setClerkPreferredCityConfirmed(clerkUserId, next);
    setDraftState({ identity: clerkUserId, draft: getClerkProfileRegistrationDraft(clerkUserId) });
    setSaveError(null);
  };

  const continueAfterWeightWarning = () => {
    router.replace({ pathname: '/(auth)/welcome-tour', params: { clerkFlow: '1' } });
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
    if (!homeAirport) {
      setSaveError(airportsQuery.isError
        ? 'Bluebird could not verify the selected home airport. Retry the airport lookup.'
        : 'Wait for Bluebird to verify your home airport before saving.');
      return;
    }
    const selectedCityKeys = preferredCityKey ? [preferredCityKey] : [];
    const selectionError = validateClerkAirportCitySelection({
      homeAirportCode: draft.homeAirportCode,
      favoriteCityKeys: selectedCityKeys,
      catalogKeys,
      preferredCityConfirmed: draft.preferredCityConfirmed,
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
      setSaveError('Your profile could not be verified. Go back and reload your profile before saving.');
      return;
    }

    let data: UpdateProductionUserProfileRequest;
    try {
      data = buildClerkProfileUpdateRequest({
        values: draft.values,
        homeAirportCode: draft.homeAirportCode,
        favoriteCityKeys: selectedCityKeys,
        catalogKeys,
        preferredCityConfirmed: draft.preferredCityConfirmed,
        profile: profileResult.profile,
      });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Review your profile details and try again.');
      return;
    }

    setClerkProfileRegistrationDraft(clerkUserId, {
      ...draft,
      favoriteCityKeys: selectedCityKeys,
      preferredCityConfirmed: true,
    });
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
        throw new ClerkRegistrationCompletionError();
      }
      if (result.weightSaved) {
        router.replace({ pathname: '/(auth)/welcome-tour', params: { clerkFlow: '1' } });
      } else {
        setWeightNotSaved(true);
      }
    } catch (error) {
      if (currentIdentity.current !== clerkUserId) return;
      setSaveError(error instanceof ClerkRegistrationCompletionError
        ? 'Bluebird saved the request but did not confirm that your profile is complete. Your details are still here; try again or contact support.'
        : getRegistrationSaveErrorMessage(error));
    } finally {
      savingRef.current = false;
      if (currentIdentity.current === clerkUserId) setIsSaving(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite, paddingTop: topPad }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to airport selection"
          onPress={() => router.back()}
          style={[styles.backButton, { backgroundColor: colors.muted }]}
          testID="back-to-airport-selection"
        >
          <Text style={[styles.backChevron, { color: colors.textOnSurface }]}>‹</Text>
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>STEP 3 OF 3</Text>
          <Text style={[styles.title, { color: colors.textOnSurface }]}>Review &amp; Save</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForegroundLight }]}>
            Check your details before sending them to Bluebird.
          </Text>
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
          <SummaryLine label="Weight" value={draft.values.weightLbs ? `${draft.values.weightLbs} lbs` : 'Not provided'} />
          {draft.values.weightLbs ? (
            <Text style={[styles.disclosure, { color: colors.mutedForegroundLight }]} testID="weight-save-disclosure">
              Weight is optional. It will be described as saved only if Bluebird returns the entered value.
            </Text>
          ) : null}
        </ReviewCard>

        <ReviewCard title="Airports">
          <SummaryLine label="Home airport" value={homeAirport ? `${homeAirport.name} (${homeAirport.code})` : draft.homeAirportCode} />
          {draft.additionalAirportCodes.length ? (
            <>
              <SummaryLine
                label="Additional airports"
                value={draft.additionalAirportCodes.map((code) => {
                  const airport = airports.find((item) => item.code === code);
                  return airport ? `${airport.name} (${code})` : code;
                }).join(', ')}
              />
              <Text style={[styles.disclosure, { color: colors.mutedForegroundLight }]} testID="additional-airports-not-saved">
                Additional airports are shown for your review only. The current profile API does not save these selections.
              </Text>
            </>
          ) : (
            <SummaryLine label="Additional airports" value="None selected" />
          )}
          {airportsQuery.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
          {airportsQuery.isError ? (
            <View style={styles.loadingRow}>
              <Text style={[styles.inlineError, { color: colors.destructive }]}>
                Couldn’t verify airport names. Retry the lookup or return to Select Airports.
              </Text>
              <Pressable accessibilityRole="button" onPress={() => void airportsQuery.refetch()}>
                <Text style={[styles.link, { color: colors.primary }]}>Try again</Text>
              </Pressable>
            </View>
          ) : null}
        </ReviewCard>

        <ReviewCard title="Preferred City">
          {!configuration ? (
            <Text style={[styles.inlineError, { color: colors.destructive }]}>
              Bluebird’s profile connection is not configured, so the city catalog is unavailable.
            </Text>
          ) : citiesQuery.isLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.bodyText, { color: colors.mutedForegroundLight }]}>Loading Bluebird’s city catalog…</Text>
            </View>
          ) : citiesQuery.isError ? (
            <View style={styles.loadingRow}>
              <Text style={[styles.inlineError, { color: colors.destructive }]}>
                Couldn’t load the city catalog. Retry before choosing a Preferred City.
              </Text>
              <Pressable accessibilityRole="button" onPress={() => void citiesQuery.refetch()}>
                <Text style={[styles.link, { color: colors.primary }]}>Try again</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {suggestedCity ? (
                <View style={[styles.suggestionCard, { backgroundColor: colors.muted }]}>
                  <Text style={[styles.suggestion, { color: colors.mutedForegroundLight }]} testID="preferred-city-suggestion">
                    Suggested from {draft.homeAirportCode}: {suggestedCity.displayName} ({suggestedCity.country}).
                    {preferredCityKey === suggestedCity.key
                      ? ' Confirm it below or choose another city.'
                      : ` Your current selection is ${preferredCity?.displayName ?? 'not selected'}.`}
                  </Text>
                  {preferredCityKey !== suggestedCity.key ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setSelectedCity(suggestedCity)}
                      style={styles.textButton}
                      testID="use-suggested-preferred-city"
                    >
                      <Text style={[styles.link, { color: colors.primary }]}>Use suggested city</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
              <SummaryLine label="Selected city" value={preferredCity?.displayName ?? 'Choose a city from the catalog'} />
              {preferredCity ? (
                <Text style={[styles.bodyText, { color: colors.mutedForegroundLight }]}>{preferredCity.country}</Text>
              ) : null}
              {suggestedCityKey ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setShowCitySearch((visible) => !visible)}
                  style={styles.textButton}
                  testID="change-preferred-city"
                >
                  <Text style={[styles.link, { color: colors.primary }]}>
                    {showCitySearch ? 'Hide city search' : 'Choose a different city'}
                  </Text>
                </Pressable>
              ) : null}
              {(!suggestedCityKey || showCitySearch) ? (
                <View style={styles.cityPicker}>
                  <View style={[styles.searchWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <TextInput
                      style={[styles.searchInput, { color: colors.foreground }]}
                      value={search}
                      onChangeText={setSearch}
                      placeholder="Search Bluebird cities"
                      placeholderTextColor={colors.mutedForeground}
                      autoCorrect={false}
                      accessibilityLabel="Search preferred city"
                      testID="preferred-city-search"
                    />
                  </View>
                  {filteredCities.length ? filteredCities.slice(0, 30).map((city) => {
                    const selected = city.key === preferredCityKey;
                    return (
                      <Pressable
                        key={city.key}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        onPress={() => setSelectedCity(city)}
                        style={[
                          styles.cityOption,
                          {
                            backgroundColor: colors.card,
                            borderColor: selected ? colors.primary : colors.border,
                          },
                        ]}
                        testID={`preferred-city-option-${city.key}`}
                      >
                        <View style={[
                          styles.radioMark,
                          { borderColor: selected ? colors.primary : colors.border },
                        ]}>
                          {selected ? <View style={[styles.radioSelected, { backgroundColor: colors.primary }]} /> : null}
                        </View>
                        <View style={styles.cityOptionCopy}>
                          <Text style={[styles.optionTitle, { color: colors.textOnSurface }]}>{city.displayName}</Text>
                          <Text style={[styles.optionMeta, { color: colors.mutedForegroundLight }]}>{city.country}</Text>
                        </View>
                      </Pressable>
                    );
                  }) : (
                    <Text style={[styles.bodyText, { color: colors.mutedForegroundLight }]}>
                      No Bluebird cities match “{search.trim()}”.
                    </Text>
                  )}
                </View>
              ) : null}
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: draft.preferredCityConfirmed }}
                onPress={toggleCityConfirmation}
                style={styles.confirmCity}
                testID="confirm-preferred-city"
              >
                <View style={[
                  styles.checkboxMark,
                  {
                    backgroundColor: draft.preferredCityConfirmed ? colors.primary : colors.card,
                    borderColor: draft.preferredCityConfirmed ? colors.primary : colors.border,
                  },
                ]}>
                  {draft.preferredCityConfirmed ? <Text style={{ color: colors.primaryForeground }}>✓</Text> : null}
                </View>
                <Text style={[styles.bodyText, { color: colors.textOnSurface }]}>
                  I confirm {preferredCity?.displayName ?? 'this Preferred City'} as my preference.
                </Text>
              </Pressable>
              {!draft.preferredCityConfirmed ? (
                <Text style={[styles.disclosure, { color: colors.mutedForegroundLight }]}>
                  Your city selection won’t be sent until you confirm it and choose Confirm &amp; Save.
                </Text>
              ) : null}
            </>
          )}
        </ReviewCard>

        {saveError ? (
          <Text accessibilityLiveRegion="polite" style={[styles.inlineError, { color: colors.destructive }]} testID="registration-save-error">
            {saveError}
          </Text>
        ) : null}

        {weightNotSaved ? (
          <View style={[styles.warningCard, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Text style={[styles.optionTitle, { color: colors.textOnSurface }]}>Profile saved, weight not confirmed</Text>
            <Text style={[styles.bodyText, { color: colors.mutedForegroundLight }]}>
              Bluebird confirmed your required registration details, but didn’t return the weight you entered. That weight is not marked as saved.
            </Text>
            <ActionButton label="Continue to onboarding" onPress={continueAfterWeightWarning} />
          </View>
        ) : null}
      </KeyboardAwareScrollViewCompat>

      {!weightNotSaved ? (
        <View style={[styles.footer, { borderTopColor: colors.border, paddingBottom: bottomPad + 12 }]}>
          <ActionButton
            label={isSaving ? 'Saving profile…' : 'Confirm & Save'}
            onPress={() => void saveRegistration()}
            disabled={isSaving || !configuration || !draft.preferredCityConfirmed || citiesQuery.isLoading || citiesQuery.isError || airportsQuery.isLoading}
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

function getRegistrationSaveErrorMessage(error: unknown): string {
  const typed = error as { code?: string; status?: number };
  if (typed?.code === 'session_expired' || typed?.status === 401) {
    return 'Your sign-in has expired. Sign in again, then reopen registration.';
  }
  if (typed?.code === 'network' || typed?.code === 'timeout') {
    return 'Bluebird could not be reached. Check your connection and try again.';
  }
  if (typed?.code === 'invalid_schema' || typed?.code === 'http') {
    return error instanceof Error
      ? `Bluebird could not save this profile: ${error.message}`
      : 'Bluebird could not save this profile. Review your details and try again.';
  }
  return 'Bluebird could not save your profile. Your details are still here; please try again.';
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  backButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  backChevron: { fontFamily: 'Inter_500Medium', fontSize: 24, marginTop: -2 },
  headerCopy: { flex: 1, gap: 2 },
  eyebrow: { fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 1 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 23, lineHeight: 29 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 8, gap: 12 },
  card: { borderWidth: 1, borderRadius: 18, padding: 15, gap: 11 },
  cardTitle: { fontFamily: 'Inter_700Bold', fontSize: 16, marginBottom: 1 },
  summaryLine: { gap: 3 },
  summaryLabel: { fontFamily: 'Inter_500Medium', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  summaryValue: { fontFamily: 'Inter_600SemiBold', fontSize: 14, lineHeight: 20 },
  bodyText: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  disclosure: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18 },
  suggestion: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  suggestionCard: { borderRadius: 12, padding: 11, gap: 3 },
  cityPicker: { gap: 8 },
  searchWrap: { minHeight: 44, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, justifyContent: 'center' },
  searchInput: { minHeight: 42, fontSize: 14, fontFamily: 'Inter_400Regular' },
  cityOption: { minHeight: 60, borderWidth: 1, borderRadius: 13, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 11 },
  cityOptionCopy: { flex: 1, gap: 2 },
  optionTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14, lineHeight: 19 },
  optionMeta: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  radioMark: { width: 21, height: 21, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { width: 9, height: 9, borderRadius: 5 },
  checkboxMark: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  confirmCity: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
  textButton: { alignSelf: 'flex-start', paddingVertical: 4 },
  link: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  inlineError: { fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 19 },
  warningCard: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  footer: { borderTopWidth: 1, paddingHorizontal: 18, paddingTop: 12 },
  actionButton: { minHeight: 52, borderRadius: 999, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center' },
  actionText: { fontFamily: 'Inter_600SemiBold', fontSize: 15, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
});
