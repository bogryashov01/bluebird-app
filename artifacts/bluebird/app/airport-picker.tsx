import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Redirect, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useListAirports, useUpdateMe } from '@workspace/api-client-react';
import { AirportMultiSelect } from '@/components/AirportMultiSelect';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
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
  setClerkHomeAirportDraft,
  setClerkProfileRegistrationDraft,
  setClerkVerifiedRegistrationCompletion,
  toggleClerkFavoriteCityDraft,
  validateClerkAirportCitySelection,
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

export default function AirportPickerScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { user, updateUser, authMode, clerkMemberResolution } = useAuth();
  const session = useClerkAuthSnapshot();
  const isClerkOnboarding =
    authMode === 'clerk' &&
    session?.isLoaded === true &&
    session.isSignedIn === true &&
    clerkMemberResolution.status === 'profile_incomplete' &&
    clerkMemberResolution.clerkUserId === session.userId;
  const clerkIdentity = isClerkOnboarding ? session?.userId ?? null : null;
  const [selection, setSelection] = useState<{ identity: string | null; codes: string[] }>(() => ({
    identity: user?.id ?? null,
    codes: user?.homeAirports ?? [],
  }));
  const selected = selection.identity === (user?.id ?? null)
    ? selection.codes
    : user?.homeAirports ?? [];
  const [saveError, setSaveError] = useState<string | null>(null);
  const { data: groups, isLoading, isError, refetch } = useListAirports();
  const updateMutation = useUpdateMe();
  const topPad = Platform.OS === 'web' ? 60 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  useEffect(() => {
    setSelection({ identity: user?.id ?? null, codes: user?.homeAirports ?? [] });
  }, [user?.id]);

  if (authMode === 'clerk' && !isClerkOnboarding) {
    return <Redirect href="/(clerk-auth)/signed-in" />;
  }
  if (isClerkOnboarding && clerkIdentity) {
    return <ClerkRegistrationAirportPicker clerkUserId={clerkIdentity} />;
  }

  const continueSelection = () => {
    save();
  };

  const save = () => {
    setSaveError(null);
    updateMutation.mutate(
      { data: { homeAirports: selected } },
      {
        onSuccess: (updated) => {
          updateUser(updated);
          router.back();
        },
        onError: (error: any) => {
          setSaveError(error?.error ?? error?.message ?? "Couldn't save your home airports. Please try again.");
        },
      },
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.offWhite, paddingTop: topPad }]}>
      <View style={styles.header}>
        <TouchableOpacity style={[styles.backButton, { backgroundColor: colors.muted }]} onPress={() => router.back()}>
          <Text style={[styles.backChevron, { color: colors.textOnSurface }]}>‹</Text>
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.textOnSurface }]}>Home Airports</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForegroundLight }]}>
            Choose the airports you usually fly from.
          </Text>
        </View>
      </View>

      <AirportMultiSelect
        groups={groups}
        selected={selected}
        onChange={(codes) => {
          setSelection({ identity: user?.id ?? null, codes });
        }}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        actionLabel="Save"
        onAction={continueSelection}
        isSaving={updateMutation.isPending}
        saveError={saveError}
        bottomInset={bottomPad}
      />
    </View>
  );
}

type RegistrationTab = 'airport' | 'cities';

function ClerkRegistrationAirportPicker({ clerkUserId }: { clerkUserId: string }) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const session = useClerkAuthSnapshot();
  const configuration = getMainBluebirdApiConfigurationOrNull();
  const [tab, setTab] = useState<RegistrationTab>('airport');
  const [draft, setDraft] = useState(() => getClerkProfileRegistrationDraft(clerkUserId));
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [weightNotSaved, setWeightNotSaved] = useState(false);
  const savingRef = React.useRef(false);
  const currentIdentity = React.useRef<string | null>(clerkUserId);
  currentIdentity.current = session?.isSignedIn === true ? session.userId ?? null : null;
  const currentSession = React.useRef(session);
  currentSession.current = session;
  const searchQuery = search.trim();
  const airportQuery = useQuery({
    queryKey: ['clerk-registration-airport-search', configuration?.environment, debouncedSearch],
    queryFn: ({ signal }) => {
      if (!configuration) throw new Error('Main Bluebird API configuration is unavailable.');
      return fetchProductionAirportSearch(debouncedSearch, {
        signal,
        environment: configuration.environment,
        baseUrl: configuration.apiBaseUrl,
      });
    },
    enabled: !!configuration && debouncedSearch.length >= 2,
    retry: shouldRetryProductionRead,
    retryDelay: productionReadRetryDelay,
    staleTime: 30_000,
  });
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
    enabled: !!configuration,
    retry: shouldRetryProductionRead,
    retryDelay: productionReadRetryDelay,
    staleTime: 24 * 60 * 60 * 1000,
  });
  const catalog = citiesQuery.data ?? [];
  const catalogKeys = catalog.map((city) => city.key);
  const filteredCities = catalog.filter((city) =>
    `${city.displayName} ${city.country}`.toLocaleLowerCase().includes(searchQuery.toLocaleLowerCase()),
  );

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const saveRegistration = async () => {
    if (savingRef.current) return;
    if (!session || session.isSignedIn !== true || session.userId !== clerkUserId) {
      setSaveError('Your signed-in account changed. Reopen registration to continue.');
      return;
    }
    const selectionError = validateClerkAirportCitySelection({
      homeAirportCode: draft.homeAirportCode,
      favoriteCityKeys: draft.favoriteCityKeys,
      catalogKeys,
    });
    if (selectionError) {
      setSaveError(selectionError);
      setReviewing(false);
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
        favoriteCityKeys: draft.favoriteCityKeys,
        catalogKeys,
        profile: profileResult.profile,
      });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Review your profile details and try again.');
      return;
    }

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
      const result = await saveClerkBluebirdRegistration(
        api.authenticated,
        profileResult,
        data,
      );
      if (currentIdentity.current !== clerkUserId) return;
      if (!setClerkVerifiedRegistrationCompletion(clerkUserId, result.currentUser)) {
        throw new ClerkRegistrationCompletionError();
      }
      if (result.weightSaved) {
        router.replace({ pathname: '/(auth)/welcome-tour', params: { clerkFlow: '1' } });
      } else {
        setWeightNotSaved(true);
        setReviewing(false);
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

  const continueAfterWeightWarning = () => {
    router.replace({ pathname: '/(auth)/welcome-tour', params: { clerkFlow: '1' } });
  };

  const toggleAirport = (airport: AirportRecord) => {
    const next = {
      ...draft,
      homeAirportCode: airport.code,
    };
    setDraft(next);
    setClerkHomeAirportDraft(clerkUserId, airport.code);
    setSaveError(null);
  };

  const toggleCity = (city: ProductionAirportCityGroupResponse) => {
    const keys = toggleClerkFavoriteCityDraft(clerkUserId, city.key, catalogKeys);
    const next = { ...draft, favoriteCityKeys: keys };
    setDraft(next);
    setClerkProfileRegistrationDraft(clerkUserId, next);
    setSaveError(null);
  };

  const selectedCityNames = draft.favoriteCityKeys
    .map((key) => catalog.find((city) => city.key === key)?.displayName ?? key);
  const selectedAirport = draft.homeAirportCode
    ? airportQuery.data?.find((airport) => airport.code === draft.homeAirportCode)
    : undefined;
  const topPad = Platform.OS === 'web' ? 60 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const canReview = !!draft.homeAirportCode &&
    draft.favoriteCityKeys.length > 0 &&
    !citiesQuery.isLoading &&
    !citiesQuery.isError;

  return (
    <View style={[styles.registrationContainer, { backgroundColor: colors.offWhite, paddingTop: topPad }]}>
      <View style={styles.registrationHeader}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Back to personal information"
          style={[styles.backButton, { backgroundColor: colors.muted }]}
          onPress={() => router.back()}
        >
          <Text style={[styles.backChevron, { color: colors.textOnSurface }]}>‹</Text>
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={[styles.registrationEyebrow, { color: colors.primary }]}>STEP 2 OF 2</Text>
          <Text style={[styles.title, { color: colors.textOnSurface }]}>Airports &amp; Cities</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForegroundLight }]}>
            Choose one home airport and at least one favorite city.
          </Text>
        </View>
      </View>

      <View style={[styles.registrationTabs, { borderBottomColor: colors.border }]}>
        {([
          ['airport', 'Home Airport'],
          ['cities', 'Favorite Cities'],
        ] as const).map(([key, label]) => (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === key }}
            onPress={() => {
              setTab(key);
              setSearch('');
              setSaveError(null);
            }}
            style={[
              styles.registrationTab,
              { borderBottomColor: tab === key ? colors.primary : 'transparent' },
            ]}
            testID={`registration-tab-${key}`}
          >
            <Text style={[
              styles.registrationTabText,
              { color: tab === key ? colors.primary : colors.mutedForegroundLight },
            ]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      <KeyboardAwareScrollViewCompat
        style={styles.registrationScroll}
        contentContainerStyle={[styles.registrationScrollContent, { paddingBottom: bottomPad + 20 }]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
      >
        {tab === 'airport' ? (
          <View style={styles.registrationSection}>
            <View style={[styles.searchWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.searchGlyph, { color: colors.mutedForeground }]}>⌕</Text>
              <TextInput
                style={[styles.searchInput, { color: colors.foreground }]}
                placeholder="Search airports by name or code"
                placeholderTextColor={colors.mutedForeground}
                value={search}
                onChangeText={setSearch}
                autoCorrect={false}
                autoCapitalize="characters"
                accessibilityLabel="Search home airports"
                testID="registration-airport-search"
              />
            </View>
            <Text style={[styles.selectionHint, { color: colors.mutedForegroundLight }]}>
              {draft.homeAirportCode
                ? `Selected: ${draft.homeAirportCode}${selectedAirport ? ` — ${selectedAirport.name}` : ''}`
                : 'No home airport selected'}
            </Text>
            {debouncedSearch.length < 2 ? (
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                Enter at least two characters to search Bluebird airports.
              </Text>
            ) : airportQuery.isLoading ? (
              <View style={styles.loadingState}>
                <ActivityIndicator color={colors.primary} />
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Searching airports…</Text>
              </View>
            ) : airportQuery.isError ? (
              <View style={styles.loadingState}>
                <Text style={[styles.emptyText, { color: colors.destructive }]}>
                  Couldn’t search airports. Check your connection and retry.
                </Text>
                <RegistrationActionButton label="Try again" onPress={() => void airportQuery.refetch()} />
              </View>
            ) : airportQuery.data?.length ? (
              airportQuery.data.map((airport) => {
                const selected = draft.homeAirportCode === airport.code;
                return (
                  <Pressable
                    key={airport.code}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    onPress={() => toggleAirport(airport)}
                    style={[
                      styles.catalogRow,
                      {
                        backgroundColor: colors.card,
                        borderColor: selected ? colors.primary : colors.border,
                      },
                    ]}
                    testID={`registration-airport-${airport.code}`}
                  >
                    <View style={[
                      styles.radioMark,
                      { borderColor: selected ? colors.primary : colors.border },
                    ]}>
                      {selected ? <View style={[styles.radioSelected, { backgroundColor: colors.primary }]} /> : null}
                    </View>
                    <View style={styles.catalogRowText}>
                      <Text style={[styles.catalogTitle, { color: colors.textOnSurface }]}>
                        {airport.name}
                      </Text>
                      <Text style={[styles.catalogMeta, { color: colors.mutedForegroundLight }]}>
                        {[airport.code, airport.city, airport.state, airport.country].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                  </Pressable>
                );
              })
            ) : (
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                No Bluebird airports matched “{debouncedSearch}”.
              </Text>
            )}
          </View>
        ) : (
          <View style={styles.registrationSection}>
            <View style={[styles.searchWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.searchGlyph, { color: colors.mutedForeground }]}>⌕</Text>
              <TextInput
                style={[styles.searchInput, { color: colors.foreground }]}
                placeholder="Search favorite cities"
                placeholderTextColor={colors.mutedForeground}
                value={search}
                onChangeText={setSearch}
                autoCorrect={false}
                accessibilityLabel="Search favorite cities"
                testID="registration-city-search"
              />
            </View>
            <Text style={[styles.selectionHint, { color: colors.mutedForegroundLight }]}>
              {draft.favoriteCityKeys.length
                ? `${draft.favoriteCityKeys.length} favorite ${draft.favoriteCityKeys.length === 1 ? 'city' : 'cities'} selected`
                : 'Choose at least one city from Bluebird’s catalog.'}
            </Text>
            {citiesQuery.isLoading ? (
              <View style={styles.loadingState}>
                <ActivityIndicator color={colors.primary} />
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Loading cities…</Text>
              </View>
            ) : citiesQuery.isError ? (
              <View style={styles.loadingState}>
                <Text style={[styles.emptyText, { color: colors.destructive }]}>
                  Couldn’t load Bluebird’s city catalog.
                </Text>
                <RegistrationActionButton label="Try again" onPress={() => void citiesQuery.refetch()} />
              </View>
            ) : filteredCities.length ? (
              filteredCities.map((city) => {
                const selected = draft.favoriteCityKeys.includes(city.key);
                return (
                  <Pressable
                    key={city.key}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                    onPress={() => toggleCity(city)}
                    style={[
                      styles.catalogRow,
                      {
                        backgroundColor: colors.card,
                        borderColor: selected ? colors.primary : colors.border,
                      },
                    ]}
                    testID={`registration-city-${city.key}`}
                  >
                    <View style={[
                      styles.checkboxMark,
                      {
                        backgroundColor: selected ? colors.primary : colors.card,
                        borderColor: selected ? colors.primary : colors.border,
                      },
                    ]}>
                      {selected ? <Text style={{ color: colors.primaryForeground }}>✓</Text> : null}
                    </View>
                    <View style={styles.catalogRowText}>
                      <Text style={[styles.catalogTitle, { color: colors.textOnSurface }]}>{city.displayName}</Text>
                      <Text style={[styles.catalogMeta, { color: colors.mutedForegroundLight }]}>{city.country}</Text>
                    </View>
                  </Pressable>
                );
              })
            ) : (
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                No catalog cities match “{searchQuery}”.
              </Text>
            )}
          </View>
        )}

        {saveError ? (
          <Text accessibilityLiveRegion="polite" style={[styles.registrationError, { color: colors.destructive }]} testID="registration-save-error">
            {saveError}
          </Text>
        ) : null}

        {weightNotSaved ? (
          <View style={[styles.warningCard, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Text style={[styles.catalogTitle, { color: colors.textOnSurface }]}>Profile saved, weight not confirmed</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForegroundLight }]}>
              Bluebird confirmed your required registration details, but did not return the weight you entered. We have not marked that weight as saved.
            </Text>
            <RegistrationActionButton label="Continue to onboarding" onPress={continueAfterWeightWarning} />
          </View>
        ) : null}

        {reviewing && !weightNotSaved ? (
          <View style={[styles.reviewCard, { backgroundColor: colors.cardHigh, borderColor: colors.border }]} accessibilityViewIsModal>
            <Text style={[styles.catalogTitle, { color: colors.textOnSurface }]}>Review before saving</Text>
            <Text style={[styles.reviewText, { color: colors.mutedForegroundLight }]}>
              Home airport: {draft.homeAirportCode || 'Not selected'}
            </Text>
            <Text style={[styles.reviewText, { color: colors.mutedForegroundLight }]}>
              Favorite cities: {selectedCityNames.length ? selectedCityNames.join(', ') : 'None selected'}
            </Text>
            <Text style={[styles.reviewText, { color: colors.mutedForegroundLight }]}>
              Your personal information and these preferences will be sent to Bluebird’s authenticated profile API.
            </Text>
            <RegistrationActionButton
              label={isSaving ? 'Saving profile…' : 'Confirm and save profile'}
              onPress={() => void saveRegistration()}
              disabled={isSaving}
              testID="confirm-save-profile"
            />
            <Pressable
              accessibilityRole="button"
              disabled={isSaving}
              onPress={() => setReviewing(false)}
              style={styles.cancelReview}
              testID="cancel-save-review"
            >
              <Text style={[styles.cancelReviewText, { color: colors.mutedForegroundLight }]}>Cancel</Text>
            </Pressable>
          </View>
        ) : null}
      </KeyboardAwareScrollViewCompat>

      {!reviewing && !weightNotSaved ? (
        <View style={[styles.registrationFooter, { borderTopColor: colors.border, paddingBottom: bottomPad + 12 }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canReview }}
            disabled={!canReview}
            onPress={() => {
              const error = validateClerkAirportCitySelection({
                homeAirportCode: draft.homeAirportCode,
                favoriteCityKeys: draft.favoriteCityKeys,
                catalogKeys,
              });
              if (error) {
                setSaveError(error);
                return;
              }
              setSaveError(null);
              setReviewing(true);
            }}
            style={[
              styles.actionButton,
              { backgroundColor: colors.primary, opacity: canReview ? 1 : 0.55 },
            ]}
            testID="review-profile-save"
          >
            <Text style={[styles.actionText, { color: colors.primaryForeground }]}>Review &amp; save</Text>
          </Pressable>
        </View>
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
    return 'Bluebird could not be reached. Check your connection and try again.';
  }
  if (typed?.code === 'invalid_schema' || typed?.code === 'http') {
    return error instanceof Error
      ? `Bluebird could not save this profile: ${error.message}`
      : 'Bluebird could not save this profile. Review your details and try again.';
  }
  return 'Bluebird could not save your profile. Your details are still here; please try again.';
}

function RegistrationActionButton({
  label,
  onPress,
  disabled = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, busy: disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.actionButton,
        { backgroundColor: colors.primary, opacity: disabled ? 0.55 : 1 },
      ]}
      testID={testID}
    >
      {disabled ? (
        <ActivityIndicator color={colors.primaryForeground} />
      ) : (
        <Text style={[styles.actionText, { color: colors.primaryForeground }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  backButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  backChevron: { fontFamily: 'Inter_500Medium', fontSize: 22, marginTop: -2 },
  headerText: { flex: 1 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 20 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, marginTop: 2 },
  registrationContainer: { flex: 1 },
  registrationHeader: {
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  registrationEyebrow: { fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 1 },
  registrationTabs: { flexDirection: 'row', borderBottomWidth: 1, paddingHorizontal: 18 },
  registrationTab: { flex: 1, minHeight: 48, justifyContent: 'center', alignItems: 'center', borderBottomWidth: 2 },
  registrationTabText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  registrationScroll: { flex: 1 },
  registrationScrollContent: { paddingHorizontal: 16, paddingTop: 12, gap: 12 },
  registrationSection: { gap: 9 },
  searchWrap: {
    minHeight: 46, paddingHorizontal: 13, borderRadius: 14, borderWidth: 1,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  searchGlyph: { fontSize: 21, lineHeight: 24 },
  searchInput: { flex: 1, minHeight: 44, fontSize: 15, fontFamily: 'Inter_400Regular' },
  selectionHint: { paddingHorizontal: 2, fontSize: 12, lineHeight: 18, fontFamily: 'Inter_400Regular' },
  emptyText: { padding: 14, fontSize: 13, lineHeight: 19, fontFamily: 'Inter_400Regular' },
  loadingState: { minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20 },
  catalogRow: {
    minHeight: 64, borderRadius: 14, borderWidth: 1, padding: 12,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  catalogRowText: { flex: 1, gap: 3 },
  catalogTitle: { fontSize: 14, lineHeight: 19, fontFamily: 'Inter_600SemiBold' },
  catalogMeta: { fontSize: 12, lineHeight: 17, fontFamily: 'Inter_400Regular' },
  radioMark: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { width: 10, height: 10, borderRadius: 5 },
  checkboxMark: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  registrationError: { paddingHorizontal: 4, fontSize: 13, lineHeight: 19, fontFamily: 'Inter_500Medium' },
  warningCard: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  reviewCard: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 11, marginTop: 6 },
  reviewText: { fontSize: 13, lineHeight: 19, fontFamily: 'Inter_400Regular' },
  cancelReview: { minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  cancelReviewText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  registrationFooter: { borderTopWidth: 1, paddingHorizontal: 18, paddingTop: 12 },
  actionButton: { minHeight: 52, borderRadius: 999, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center' },
  actionText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
});