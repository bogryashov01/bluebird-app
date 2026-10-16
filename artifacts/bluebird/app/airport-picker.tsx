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
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import {
  getClerkProfileRegistrationDraft,
  setClerkHomeAirportDraft,
  setClerkProfileRegistrationDraft,
  toggleClerkAdditionalAirportDraft,
  toggleClerkFavoriteCityDraft,
  validateClerkAirportCitySelection,
  filterClerkRegistrationAirports,
  filterClerkRegistrationCities,
} from '@/lib/clerkProfileOnboarding';
import {
  describeProductionReadFailure,
  fetchProductionAirportCities,
  fetchProductionAirportSearch,
  getProductionAirportSearchViewState,
  productionReadRetryDelay,
  shouldRetryProductionRead,
  type AirportRecord,
  type ProductionAirportCityGroupResponse,
} from '@/lib/productionFlights';

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
    return <ClerkRegistrationAirportPicker key={clerkIdentity} clerkUserId={clerkIdentity} />;
  }

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
        onChange={(codes) => setSelection({ identity: user?.id ?? null, codes })}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        actionLabel="Save"
        onAction={save}
        isSaving={updateMutation.isPending}
        saveError={saveError}
        bottomInset={bottomPad}
      />
    </View>
  );
}

function ClerkRegistrationAirportPicker({ clerkUserId }: { clerkUserId: string }) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const [draft, setDraft] = useState(() => getClerkProfileRegistrationDraft(clerkUserId));
  const [activeTab, setActiveTab] = useState<'airports' | 'cities'>('airports');
  const [airportSearch, setAirportSearch] = useState('');
  const [debouncedAirportSearch, setDebouncedAirportSearch] = useState('');
  const [citySearch, setCitySearch] = useState('');
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const topPad = Platform.OS === 'web' ? 60 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const configuration = getMainBluebirdApiConfigurationOrNull();
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedAirportSearch(airportSearch.trim()), 250);
    return () => clearTimeout(timer);
  }, [airportSearch]);
  const airportsQuery = useQuery({
    queryKey: ['clerk-registration-airport-search', configuration?.environment, debouncedAirportSearch],
    queryFn: ({ signal }) => {
      if (!configuration) throw new Error('Main Bluebird API configuration is unavailable.');
      return fetchProductionAirportSearch(debouncedAirportSearch, {
        signal,
        environment: configuration.environment,
        baseUrl: configuration.apiBaseUrl,
      });
    },
    enabled: !!configuration && !!debouncedAirportSearch,
    retry: shouldRetryProductionRead,
    retryDelay: productionReadRetryDelay,
    staleTime: 5 * 60 * 1000,
  });
  const citiesQuery = useQuery({
    queryKey: ['clerk-registration-city-catalog', configuration?.environment],
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
  const normalizedAirportSearch = airportSearch.trim();
  const waitingForAirportSearch = normalizedAirportSearch !== debouncedAirportSearch;
  const airports = normalizedAirportSearch === debouncedAirportSearch
    ? filterClerkRegistrationAirports(airportsQuery.data ?? [], airportSearch)
    : [];
  const airportSearchState = getProductionAirportSearchViewState({
    configurationAvailable: !!configuration,
    query: airportSearch,
    isLoading: waitingForAirportSearch || airportsQuery.isLoading,
    error: waitingForAirportSearch ? undefined : airportsQuery.error,
    resultCount: airports.length,
  });
  const cityReadFailure = citiesQuery.isError
    ? describeProductionReadFailure(citiesQuery.error, 'the city list')
    : null;
  const cities = filterClerkRegistrationCities(citiesQuery.data ?? [], citySearch);
  const catalogKeys = (citiesQuery.data ?? []).map((city) => city.key);

  const chooseHomeAirport = (airport: AirportRecord) => {
    setClerkHomeAirportDraft(clerkUserId, airport.code);
    setDraft(getClerkProfileRegistrationDraft(clerkUserId));
    setSelectionError(null);
  };

  const toggleAdditionalAirport = (airport: AirportRecord) => {
    if (airport.code === draft.homeAirportCode) return;
    toggleClerkAdditionalAirportDraft(clerkUserId, airport.code);
    setDraft(getClerkProfileRegistrationDraft(clerkUserId));
    setSelectionError(null);
  };

  const toggleCity = (city: ProductionAirportCityGroupResponse) => {
    toggleClerkFavoriteCityDraft(clerkUserId, city.key, catalogKeys);
    setDraft(getClerkProfileRegistrationDraft(clerkUserId));
    setSelectionError(null);
  };

  const continueToReview = () => {
    const error = validateClerkAirportCitySelection({
      homeAirportCode: draft.homeAirportCode,
      favoriteCityKeys: draft.favoriteCityKeys,
      catalogKeys,
    });
    if (error) {
      setSelectionError(error);
      return;
    }
    setClerkProfileRegistrationDraft(clerkUserId, draft);
    router.push('/registration-review');
  };

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
          <Text style={[styles.registrationEyebrow, { color: colors.primary }]}>STEP 2 OF 3</Text>
          <Text style={[styles.title, { color: colors.textOnSurface }]}>Locations</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForegroundLight }]}>
            Choose your home airport, additional airports, and cities.
          </Text>
        </View>
      </View>

      <View style={[styles.locationTabs, { backgroundColor: colors.muted, borderColor: colors.border }]}>
        {([
          ['airports', 'Airports'],
          ['cities', 'Cities'],
        ] as const).map(([tab, label]) => {
          const selected = activeTab === tab;
          return (
            <Pressable
              key={tab}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => setActiveTab(tab)}
              style={[
                styles.locationTab,
                { backgroundColor: selected ? colors.card : 'transparent' },
              ]}
              testID={`registration-${tab}-tab`}
            >
              <Text style={[
                styles.locationTabText,
                { color: selected ? colors.textOnSurface : colors.mutedForegroundLight },
              ]}>{label}</Text>
              {tab === 'airports' && draft.homeAirportCode ? (
                <Text style={[styles.tabCount, { color: colors.primary }]}>
                  {1 + draft.additionalAirportCodes.length}
                </Text>
              ) : null}
              {tab === 'cities' && draft.favoriteCityKeys.length ? (
                <Text style={[styles.tabCount, { color: colors.primary }]}>
                  {draft.favoriteCityKeys.length}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <KeyboardAwareScrollViewCompat
        style={styles.registrationScroll}
        contentContainerStyle={[styles.locationListContent, { paddingBottom: bottomPad + 24 }]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.searchWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.searchGlyph, { color: colors.mutedForeground }]}>⌕</Text>
          <TextInput
            style={[styles.searchInput, { color: colors.foreground }]}
            placeholder={activeTab === 'airports' ? 'Search airports by name, city, or code' : 'Search cities or country'}
            placeholderTextColor={colors.mutedForeground}
            value={activeTab === 'airports' ? airportSearch : citySearch}
            onChangeText={activeTab === 'airports' ? setAirportSearch : setCitySearch}
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel={activeTab === 'airports' ? 'Search airports' : 'Search cities'}
            testID={activeTab === 'airports' ? 'registration-airport-search' : 'registration-city-search'}
          />
        </View>

        {activeTab === 'airports' ? (
          <>
            <Text style={[styles.selectionHint, { color: colors.mutedForegroundLight }]}>
              Choose one home airport and any additional airports you use.
            </Text>
            {airportSearchState.kind === 'configuration-unavailable' ? (
              <Text style={[styles.emptyText, { color: colors.destructive }]} testID="registration-airport-configuration-error">
                Airport search is unavailable because the Main Bluebird API is not configured.
              </Text>
            ) : null}
            {airportSearchState.kind === 'unsupported-empty-query' ? (
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]} testID="registration-airport-search-prompt">
                Search by airport name, city, or code to find airports. Browsing the full airport list isn’t available.
              </Text>
            ) : null}
            {airportSearchState.kind === 'loading' ? <CatalogLoading label="Searching airports…" /> : null}
            {airportSearchState.kind === 'error' ? (
              <CatalogError
                label={airportSearchState.failure.message}
                retryable={airportSearchState.failure.retryable}
                onRetry={() => void airportsQuery.refetch()}
                testID="registration-airport-search-error"
              />
            ) : null}
            {airportSearchState.kind === 'no-match' ? (
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]} testID="registration-airport-no-match">
                No airports matched “{airportSearch.trim()}”.
              </Text>
            ) : null}
            {airportSearchState.kind === 'results' ? airports.map((airport) => {
              const isHome = draft.homeAirportCode === airport.code;
              const isAdditional = draft.additionalAirportCodes.includes(airport.code);
              return (
                <View key={airport.code} style={[styles.catalogRow, { backgroundColor: colors.card, borderColor: isHome || isAdditional ? colors.primary : colors.border }]} testID={`registration-airport-${airport.code}`}>
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityLabel={`Set ${airport.name} as home airport`}
                    accessibilityState={{ selected: isHome }}
                    onPress={() => chooseHomeAirport(airport)}
                    style={styles.airportIdentity}
                    testID={`registration-home-airport-${airport.code}`}
                  >
                    <View style={[styles.radioMark, { borderColor: isHome ? colors.primary : colors.border }]}>
                      {isHome ? <View style={[styles.radioSelected, { backgroundColor: colors.primary }]} /> : null}
                    </View>
                    <View style={styles.catalogRowText}>
                      <Text style={[styles.catalogTitle, { color: colors.textOnSurface }]}>{airport.name}</Text>
                      <Text style={[styles.catalogMeta, { color: colors.mutedForegroundLight }]}>
                        {[airport.code, airport.city, airport.state, airport.country].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    {isHome ? <Text style={[styles.selectedLabel, { color: colors.primary }]}>Home</Text> : null}
                  </Pressable>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityLabel={`Add ${airport.name} as an additional airport`}
                    accessibilityState={{ checked: isAdditional }}
                    disabled={isHome}
                    onPress={() => toggleAdditionalAirport(airport)}
                    style={styles.additionalToggle}
                    testID={`registration-additional-airport-${airport.code}`}
                  >
                    <View style={[
                      styles.checkboxMark,
                      {
                        backgroundColor: isAdditional ? colors.primary : colors.card,
                        borderColor: isAdditional ? colors.primary : colors.border,
                        opacity: isHome ? 0.4 : 1,
                      },
                    ]}>
                      {isAdditional ? <Text style={{ color: colors.primaryForeground }}>✓</Text> : null}
                    </View>
                    <Text style={[styles.additionalLabel, { color: colors.mutedForegroundLight }]}>Additional</Text>
                  </Pressable>
                </View>
              );
            }) : null}
          </>
        ) : (
          <>
            <Text style={[styles.selectionHint, { color: colors.mutedForegroundLight }]}>
              Select one or more cities. At least one is required.
            </Text>
            {citiesQuery.isLoading ? <CatalogLoading label="Loading cities…" /> : null}
            {cityReadFailure ? (
              <CatalogError
                label={cityReadFailure.message}
                retryable={cityReadFailure.retryable}
                onRetry={() => void citiesQuery.refetch()}
                testID="registration-city-list-error"
              />
            ) : null}
            {!configuration ? (
              <Text style={[styles.emptyText, { color: colors.destructive }]}>The Main Bluebird API is not configured, so cities aren’t available.</Text>
            ) : null}
            {!citiesQuery.isLoading && !citiesQuery.isError && cities.length === 0 && configuration ? (
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No cities matched “{citySearch.trim()}”.</Text>
            ) : null}
            {!citiesQuery.isLoading && !citiesQuery.isError ? cities.map((city) => {
              const selected = draft.favoriteCityKeys.includes(city.key);
              return (
                <Pressable
                  key={city.key}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  onPress={() => toggleCity(city)}
                  style={[
                    styles.catalogRow,
                    { backgroundColor: colors.card, borderColor: selected ? colors.primary : colors.border },
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
                    <Text style={[styles.catalogMeta, { color: colors.mutedForegroundLight }]}>
                      {city.country} · {city.airportLabels.join(', ')}
                    </Text>
                  </View>
                  {selected ? <Text style={[styles.selectedLabel, { color: colors.primary }]}>Selected</Text> : null}
                </Pressable>
              );
            }) : null}
          </>
        )}
        {selectionError ? (
          <Text accessibilityLiveRegion="polite" style={[styles.error, { color: colors.destructive }]} testID="airport-selection-error">
            {selectionError}
          </Text>
        ) : null}
      </KeyboardAwareScrollViewCompat>

      <View style={[styles.registrationFooter, { borderTopColor: colors.border, paddingBottom: bottomPad + 12 }]}>
        <Pressable
          accessibilityRole="button"
          onPress={continueToReview}
          disabled={airportSearchState.kind === 'loading' || citiesQuery.isLoading || citiesQuery.isError}
          style={[styles.actionButton, { backgroundColor: colors.primary }]}
          testID="continue-to-registration-review"
        >
          <Text style={[styles.actionText, { color: colors.primaryForeground }]}>Continue to Review &amp; Save</Text>
        </Pressable>
      </View>
    </View>
  );
}

function CatalogLoading({ label }: { label: string }) {
  const colors = useColors();
  return (
    <View style={styles.loadingState}>
      <ActivityIndicator color={colors.primary} />
      <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

function CatalogError({
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
    <View style={styles.loadingState}>
      <Text accessibilityLiveRegion="polite" testID={testID} style={[styles.emptyText, { color: colors.destructive }]}>{label}</Text>
      {retryable ? (
        <Pressable accessibilityRole="button" onPress={onRetry}>
          <Text style={[styles.retryText, { color: colors.primary }]}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  backButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  backChevron: { fontFamily: 'Inter_500Medium', fontSize: 22, marginTop: -2 },
  headerText: { flex: 1 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 20 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, marginTop: 2 },
  registrationContainer: { flex: 1 },
  registrationHeader: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  registrationEyebrow: { fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 1 },
  registrationScroll: { flex: 1 },
  registrationScrollContent: { paddingHorizontal: 16, paddingTop: 12, gap: 20 },
  locationListContent: { paddingHorizontal: 16, paddingTop: 12, gap: 9 },
  locationTabs: { flexDirection: 'row', borderRadius: 14, borderWidth: 1, marginHorizontal: 16, padding: 4, gap: 4 },
  locationTab: { flex: 1, minHeight: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  locationTabText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  tabCount: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  registrationSection: { gap: 9 },
  sectionHeading: { gap: 3, paddingHorizontal: 2 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  searchWrap: { minHeight: 46, paddingHorizontal: 13, borderRadius: 14, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchGlyph: { fontSize: 21, lineHeight: 24 },
  searchInput: { flex: 1, minHeight: 44, fontSize: 15, fontFamily: 'Inter_400Regular' },
  selectionHint: { paddingHorizontal: 2, fontSize: 12, lineHeight: 18, fontFamily: 'Inter_400Regular' },
  emptyText: { padding: 12, fontSize: 13, lineHeight: 19, fontFamily: 'Inter_400Regular' },
  loadingState: { minHeight: 100, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 },
  catalogRow: { minHeight: 64, borderRadius: 14, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 12 },
  airportIdentity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  additionalToggle: { alignItems: 'center', justifyContent: 'center', gap: 4, minWidth: 62, minHeight: 48 },
  additionalLabel: { fontSize: 9, fontFamily: 'Inter_500Medium' },
  catalogRowText: { flex: 1, gap: 3 },
  catalogTitle: { fontSize: 14, lineHeight: 19, fontFamily: 'Inter_600SemiBold' },
  catalogMeta: { fontSize: 12, lineHeight: 17, fontFamily: 'Inter_400Regular' },
  radioMark: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { width: 10, height: 10, borderRadius: 5 },
  checkboxMark: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  selectedLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  error: { fontSize: 13, lineHeight: 19, fontFamily: 'Inter_500Medium' },
  retryText: { fontFamily: 'Inter_600SemiBold', padding: 8 },
  registrationFooter: { borderTopWidth: 1, paddingHorizontal: 18, paddingTop: 12 },
  actionButton: { minHeight: 52, borderRadius: 999, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center' },
  actionText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
});
