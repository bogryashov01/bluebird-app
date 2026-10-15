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
} from '@/lib/clerkProfileOnboarding';
import {
  fetchProductionAirportSearch,
  productionReadRetryDelay,
  shouldRetryProductionRead,
  type AirportRecord,
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
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const topPad = Platform.OS === 'web' ? 60 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

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

  const continueToReview = () => {
    if (!draft.homeAirportCode) {
      setSelectionError('Choose one home airport to continue.');
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
          <Text style={[styles.title, { color: colors.textOnSurface }]}>Select Airports</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForegroundLight }]}>
            Choose a home airport and any additional airports you use.
          </Text>
        </View>
      </View>

      <KeyboardAwareScrollViewCompat
        style={styles.registrationScroll}
        contentContainerStyle={[styles.registrationScrollContent, { paddingBottom: bottomPad + 24 }]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
        showsVerticalScrollIndicator={false}
      >
        <AirportSearchSection
          title="Home Airport"
          description="Required · choose one airport"
          accessibilityLabel="Search home airports"
          placeholder="Search by airport name or code"
          selectedCodes={draft.homeAirportCode ? [draft.homeAirportCode] : []}
          mode="single"
          onSelect={chooseHomeAirport}
        />
        <AirportSearchSection
          title="Additional Airports"
          description="Optional · these selections are for this registration only"
          accessibilityLabel="Search additional airports"
          placeholder="Search additional airports"
          selectedCodes={draft.additionalAirportCodes}
          mode="multiple"
          onSelect={toggleAdditionalAirport}
        />
        {draft.additionalAirportCodes.length ? (
          <Text style={[styles.note, { color: colors.mutedForegroundLight }]} testID="additional-airports-unsaved">
            Additional airports are not saved to your profile by the current Bluebird API.
          </Text>
        ) : null}
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
          style={[styles.actionButton, { backgroundColor: colors.primary }]}
          testID="continue-to-registration-review"
        >
          <Text style={[styles.actionText, { color: colors.primaryForeground }]}>Continue to Review &amp; Save</Text>
        </Pressable>
      </View>
    </View>
  );
}

function AirportSearchSection({
  title,
  description,
  accessibilityLabel,
  placeholder,
  selectedCodes,
  mode,
  onSelect,
}: {
  title: string;
  description: string;
  accessibilityLabel: string;
  placeholder: string;
  selectedCodes: string[];
  mode: 'single' | 'multiple';
  onSelect: (airport: AirportRecord) => void;
}) {
  const colors = useColors();
  const configuration = getMainBluebirdApiConfigurationOrNull();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const query = useQuery({
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

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  return (
    <View style={styles.registrationSection}>
      <View style={styles.sectionHeading}>
        <Text style={[styles.sectionTitle, { color: colors.textOnSurface }]}>{title}</Text>
        <Text style={[styles.selectionHint, { color: colors.mutedForegroundLight }]}>{description}</Text>
      </View>
      <View style={[styles.searchWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.searchGlyph, { color: colors.mutedForeground }]}>⌕</Text>
        <TextInput
          style={[styles.searchInput, { color: colors.foreground }]}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          autoCapitalize="characters"
          accessibilityLabel={accessibilityLabel}
          testID={mode === 'single' ? 'registration-home-airport-search' : 'registration-additional-airport-search'}
        />
      </View>
      {selectedCodes.length ? (
        <Text style={[styles.selectionHint, { color: colors.mutedForegroundLight }]}>
          Selected: {selectedCodes.join(', ')}
        </Text>
      ) : null}
      {debouncedSearch.length < 2 ? (
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
          Enter at least two characters to search Bluebird airports.
        </Text>
      ) : !configuration ? (
        <Text style={[styles.emptyText, { color: colors.destructive }]}>
          Bluebird airport search is unavailable because the profile connection is not configured.
        </Text>
      ) : query.isLoading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Searching airports…</Text>
        </View>
      ) : query.isError ? (
        <View style={styles.loadingState}>
          <Text style={[styles.emptyText, { color: colors.destructive }]}>
            Couldn’t search airports. Check your connection and retry.
          </Text>
          <Pressable accessibilityRole="button" onPress={() => void query.refetch()}>
            <Text style={[styles.retryText, { color: colors.primary }]}>Try again</Text>
          </Pressable>
        </View>
      ) : query.data?.length ? (
        query.data.map((airport) => {
          const selected = selectedCodes.includes(airport.code);
          return (
            <Pressable
              key={airport.code}
              accessibilityRole={mode === 'single' ? 'radio' : 'checkbox'}
              accessibilityState={mode === 'single' ? { selected } : { checked: selected }}
              onPress={() => onSelect(airport)}
              style={[
                styles.catalogRow,
                {
                  backgroundColor: colors.card,
                  borderColor: selected ? colors.primary : colors.border,
                },
              ]}
              testID={`${mode === 'single' ? 'registration-home-airport' : 'registration-additional-airport'}-${airport.code}`}
            >
              <View style={[
                mode === 'single' ? styles.radioMark : styles.checkboxMark,
                {
                  backgroundColor: selected && mode === 'multiple' ? colors.primary : colors.card,
                  borderColor: selected ? colors.primary : colors.border,
                },
              ]}>
                {mode === 'single'
                  ? selected ? <View style={[styles.radioSelected, { backgroundColor: colors.primary }]} /> : null
                  : selected ? <Text style={{ color: colors.primaryForeground }}>✓</Text> : null}
              </View>
              <View style={styles.catalogRowText}>
                <Text style={[styles.catalogTitle, { color: colors.textOnSurface }]}>{airport.name}</Text>
                <Text style={[styles.catalogMeta, { color: colors.mutedForegroundLight }]}>
                  {[airport.code, airport.city, airport.state, airport.country].filter(Boolean).join(' · ')}
                </Text>
              </View>
              {selected ? <Text style={[styles.selectedLabel, { color: colors.primary }]}>Selected</Text> : null}
            </Pressable>
          );
        })
      ) : (
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
          No Bluebird airports matched “{debouncedSearch}”.
        </Text>
      )}
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
  registrationSection: { gap: 9 },
  sectionHeading: { gap: 3, paddingHorizontal: 2 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  searchWrap: { minHeight: 46, paddingHorizontal: 13, borderRadius: 14, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchGlyph: { fontSize: 21, lineHeight: 24 },
  searchInput: { flex: 1, minHeight: 44, fontSize: 15, fontFamily: 'Inter_400Regular' },
  selectionHint: { paddingHorizontal: 2, fontSize: 12, lineHeight: 18, fontFamily: 'Inter_400Regular' },
  emptyText: { padding: 12, fontSize: 13, lineHeight: 19, fontFamily: 'Inter_400Regular' },
  loadingState: { minHeight: 100, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 },
  catalogRow: { minHeight: 64, borderRadius: 14, borderWidth: 1, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  catalogRowText: { flex: 1, gap: 3 },
  catalogTitle: { fontSize: 14, lineHeight: 19, fontFamily: 'Inter_600SemiBold' },
  catalogMeta: { fontSize: 12, lineHeight: 17, fontFamily: 'Inter_400Regular' },
  radioMark: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { width: 10, height: 10, borderRadius: 5 },
  checkboxMark: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  selectedLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  note: { fontSize: 12, lineHeight: 18, paddingHorizontal: 2 },
  error: { fontSize: 13, lineHeight: 19, fontFamily: 'Inter_500Medium' },
  retryText: { fontFamily: 'Inter_600SemiBold', padding: 8 },
  registrationFooter: { borderTopWidth: 1, paddingHorizontal: 18, paddingTop: 12 },
  actionButton: { minHeight: 52, borderRadius: 999, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center' },
  actionText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
});
