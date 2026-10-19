import React from 'react';
import {
  ActivityIndicator, Alert, Image, Linking, Platform, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { File as ExpoFile } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import {
  useGetNetworkingProfile,
  useRequestUploadUrl,
  useUpdateMe,
  useUpdateNetworkingProfile,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Redirect, router, Stack } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { uploadProfilePhoto } from '@/lib/profile-photo-upload';
import { selectProfilePhoto } from '@/lib/profile-photo-selection';
import { isLocalFlightReadMode } from '@/lib/productionFlights';
import { ProductionAuthenticatedUnavailableNotice } from '@/components/ProductionAuthenticatedUnavailableNotice';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { createMainBluebirdApiIntegration } from '@/lib/mainBluebirdApi';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import {
  getClerkBluebirdProfileEffectDependencies,
  isClerkBluebirdProfileResultCurrent,
} from '@/lib/clerkBluebirdProfile';
import {
  buildClerkPersonalInfoUpdateRequest,
  getChangedClerkPersonalInfoFields,
  getClerkPersonalInfoValues,
  loadClerkPersonalInfo,
  updateClerkPersonalInfoExplicitly,
  formatClerkDateOfBirth,
} from '@/lib/clerkPersonalInfo';
import type { ClerkPersonalInfoValues } from '@/lib/clerkPersonalInfo';
import type { ProductionUserProfile } from '@/lib/productionAuthApi';

type ClerkPersonalInfoLoadState =
  | { kind: 'loading' }
  | { kind: 'refreshing'; clerkUserId: string; profile: ProductionUserProfile }
  | { kind: 'error'; message: string; clerkUserId?: string; staleProfile?: ProductionUserProfile }
  | { kind: 'not_authenticated' }
  | { kind: 'loaded'; clerkUserId: string; profile: ProductionUserProfile };

type MainApiClient = ReturnType<typeof createMainBluebirdApiIntegration>;

function ClerkPersonalInfoScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const session = useClerkAuthSnapshot();
  const configuration = getMainBluebirdApiConfigurationOrNull();
  const [loadState, setLoadState] = React.useState<ClerkPersonalInfoLoadState>({ kind: 'loading' });
  const [loadAttempt, setLoadAttempt] = React.useState(0);
  const cachedProfile = React.useRef<{ clerkUserId: string; profile: ProductionUserProfile } | null>(null);
  const currentIdentity = React.useRef<string | null>(session?.userId ?? null);
  currentIdentity.current = session?.userId ?? null;
  const currentSession = React.useRef(session);
  currentSession.current = session;
  const saveController = React.useRef<AbortController | null>(null);
  const requestDependencies = getClerkBluebirdProfileEffectDependencies({
    configuration,
    session,
    loadAttempt,
  });

  const createApi = React.useCallback((): MainApiClient => {
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
            activeSession.isLoaded !== true ||
            activeSession.isSignedIn !== true ||
            activeSession.userId !== requestedClerkUserId
          ) return null;
          return activeSession.getToken();
        },
      },
    });
  }, [...requestDependencies]);

  const loadProfile = React.useCallback(async (signal: AbortSignal) => {
    if (!session?.isLoaded || session.isSignedIn !== true || !session.userId) return;
    const requestedClerkUserId = session.userId;
    const cached = cachedProfile.current;
    setLoadState(cached?.clerkUserId === requestedClerkUserId
      ? { kind: 'refreshing', ...cached }
      : { kind: 'loading' });
    try {
      const result = await loadClerkPersonalInfo(createApi().authenticated, signal);
      if (!isClerkBluebirdProfileResultCurrent({
        requestedClerkUserId,
        currentClerkUserId: currentIdentity.current,
        aborted: signal.aborted,
      })) return;
      if (result.kind === 'api_not_authenticated') {
        setLoadState({ kind: 'not_authenticated' });
        return;
      }
      cachedProfile.current = { clerkUserId: requestedClerkUserId, profile: result.profile };
      setLoadState({ kind: 'loaded', clerkUserId: requestedClerkUserId, profile: result.profile });
    } catch (error) {
      if (signal.aborted || currentIdentity.current !== requestedClerkUserId) return;
      const retained = cachedProfile.current?.clerkUserId === requestedClerkUserId
        ? cachedProfile.current
        : null;
      setLoadState({
        kind: 'error',
        message: getClerkPersonalInfoErrorMessage(error),
        ...(retained ? { clerkUserId: retained.clerkUserId, staleProfile: retained.profile } : {}),
      });
    }
  }, [createApi, ...requestDependencies]);

  React.useEffect(() => {
    if (!session?.isLoaded || session.isSignedIn !== true || !session.userId) {
      setLoadState({ kind: 'loading' });
      return;
    }
    const controller = new AbortController();
    void loadProfile(controller.signal);
    return () => {
      controller.abort();
      saveController.current?.abort();
      saveController.current = null;
    };
  }, [loadProfile, ...requestDependencies]);

  if (!session) {
    return <ClerkPersonalInfoState title="Profile unavailable" message="Sign in to view your Bluebird profile." />;
  }
  if (!session.isLoaded) return <ClerkPersonalInfoState loading title="Loading your profile" />;
  if (session.isSignedIn !== true) return <Redirect href="/(clerk-auth)/sign-in" />;

  const visibleState = 'clerkUserId' in loadState && loadState.clerkUserId !== session.userId
    ? { kind: 'loading' as const }
    : loadState;
  const bottomPadding = (Platform.OS === 'web' ? 34 : insets.bottom) + 32;
  const topPadding = Platform.OS === 'web' ? 67 : insets.top;

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]} testID="clerk-personal-info">
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.clerkHeader, { paddingTop: topPadding + 12 }]}>
        <TouchableOpacity
          style={[styles.clerkBackBtn, { backgroundColor: colors.muted }]}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/profile'))}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Back"
          testID="clerk-personal-info-back"
        >
          <Ionicons name="arrow-back" size={20} color={colors.textOnSurface} />
        </TouchableOpacity>
        <Text style={[styles.clerkHeaderTitle, { color: colors.textOnSurface }]}>Personal Information</Text>
      </View>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[styles.clerkInfoContent, { paddingBottom: bottomPadding }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bottomOffset={20}
      >
        {visibleState.kind === 'loading' ? (
          <ClerkPersonalInfoState loading title="Loading your profile" />
        ) : visibleState.kind === 'not_authenticated' ? (
          <View style={styles.clerkInfoCard}>
            <Text style={[styles.title, { color: colors.textOnSurface }]}>Profile unavailable</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForegroundLight }]}>
              Bluebird did not confirm this signed-in session. No profile details were loaded.
            </Text>
            <TouchableOpacity
              style={[styles.button, { backgroundColor: colors.primary }]}
              onPress={() => setLoadAttempt((attempt) => attempt + 1)}
              accessibilityRole="button"
              testID="clerk-personal-info-retry"
            >
              <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : visibleState.kind === 'error' && !visibleState.staleProfile ? (
          <View style={[styles.clerkInfoCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.title, { color: colors.textOnSurface }]}>Profile unavailable</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForegroundLight }]}>{visibleState.message}</Text>
            <TouchableOpacity
              style={[styles.button, { backgroundColor: colors.primary }]}
              onPress={() => setLoadAttempt((attempt) => attempt + 1)}
              accessibilityRole="button"
              testID="clerk-personal-info-retry"
            >
              <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {visibleState.kind === 'refreshing' ? (
              <View style={styles.refreshingRow} accessibilityRole="progressbar" testID="clerk-personal-info-refreshing">
                <Image source={require('@/assets/images/bluebird-bird-mark.png')} style={styles.refreshingMark} resizeMode="contain" />
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : null}
            {visibleState.kind === 'error' ? (
              <View style={[styles.inlineLoadError, { backgroundColor: colors.surface }]} testID="clerk-personal-info-refresh-error">
                <Text style={[styles.helperText, { color: colors.destructive }]}>{visibleState.message}</Text>
                <TouchableOpacity
                  onPress={() => setLoadAttempt((attempt) => attempt + 1)}
                  accessibilityRole="button"
                  testID="clerk-personal-info-retry"
                >
                  <Text style={[styles.retryText, { color: colors.primary }]}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            <ClerkPersonalInfoForm
              key={visibleState.clerkUserId!}
              clerkUserId={visibleState.clerkUserId!}
              profile={visibleState.kind === 'error' ? visibleState.staleProfile! : visibleState.profile}
              createApi={createApi}
              currentIdentity={currentIdentity}
              saveController={saveController}
            />
          </>
        )}
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

function ClerkPersonalInfoForm({
  clerkUserId,
  profile,
  createApi,
  currentIdentity,
  saveController,
}: {
  clerkUserId: string;
  profile: ProductionUserProfile;
  createApi: () => MainApiClient;
  currentIdentity: React.MutableRefObject<string | null>;
  saveController: React.MutableRefObject<AbortController | null>;
}) {
  const colors = useColors();
  const [values, setValues] = React.useState<ClerkPersonalInfoValues>(
    () => getClerkPersonalInfoValues(profile),
  );
  const [baseline, setBaseline] = React.useState<ClerkPersonalInfoValues>(
    () => getClerkPersonalInfoValues(profile),
  );
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [saveNotice, setSaveNotice] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const [dobFocused, setDobFocused] = React.useState(false);
  const [focusedField, setFocusedField] = React.useState<keyof ClerkPersonalInfoValues | null>(null);
  const savingRef = React.useRef(false);
  const changedFields = getChangedClerkPersonalInfoFields(values, baseline);
  React.useEffect(() => {
    if (getChangedClerkPersonalInfoFields(values, baseline).length > 0) return;
    const refreshedValues = getClerkPersonalInfoValues(profile);
    setValues(refreshedValues);
    setBaseline(refreshedValues);
  }, [profile]);
  let requestData: ReturnType<typeof buildClerkPersonalInfoUpdateRequest> | null = null;
  let saveIssue: string | null = null;
  if (changedFields.length > 0) {
    try {
      requestData = buildClerkPersonalInfoUpdateRequest(profile, values, baseline);
    } catch (error) {
      saveIssue = error instanceof Error ? error.message : 'Review your details before saving.';
    }
  }

  const setField = <K extends keyof ClerkPersonalInfoValues>(
    field: K,
    value: ClerkPersonalInfoValues[K],
  ) => {
    setValues((current) => ({ ...current, [field]: value }));
    setSaveError(null);
    setSaveNotice(null);
  };

  const saveChanges = async () => {
    if (savingRef.current || !requestData || currentIdentity.current !== clerkUserId) return;
    const controller = new AbortController();
    saveController.current = controller;
    savingRef.current = true;
    setIsSaving(true);
    setSaveError(null);
    setSaveNotice(null);
    try {
      await updateClerkPersonalInfoExplicitly(
        createApi().authenticated,
        requestData,
        { signal: controller.signal },
      );
      if (controller.signal.aborted || currentIdentity.current !== clerkUserId) return;
      setBaseline(values);
      setSaveNotice('Bluebird accepted your changes.');
    } catch (error) {
      if (!controller.signal.aborted && currentIdentity.current === clerkUserId) {
        setSaveError(getClerkPersonalInfoErrorMessage(error));
      }
    } finally {
      if (saveController.current === controller) saveController.current = null;
      savingRef.current = false;
      if (!controller.signal.aborted && currentIdentity.current === clerkUserId) setIsSaving(false);
    }
  };

  const fieldStyle = (field: keyof ClerkPersonalInfoValues) => [
    styles.input,
    {
      backgroundColor: colors.surface,
      color: colors.textOnSurface,
      borderColor: focusedField === field ? colors.primary : colors.border,
    },
  ];

  return (
    <View style={styles.clerkInfoGroups} testID="clerk-personal-info-form">
      <View style={[styles.clerkInfoGroup, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.groupTitle, { color: colors.textOnSurface }]}>Personal details</Text>
        <ClerkInfoField label="First name">
          <TextInput
            style={fieldStyle('firstName')}
            onFocus={() => setFocusedField('firstName')}
            onBlur={() => setFocusedField(null)}
            value={values.firstName}
            onChangeText={(value) => setField('firstName', value)}
            placeholder="Not provided"
            placeholderTextColor={colors.mutedForegroundLight}
            autoCapitalize="words"
            autoComplete="given-name"
            maxLength={80}
            accessibilityLabel="First name"
            testID="clerk-personal-info-first-name"
          />
        </ClerkInfoField>
        <ClerkInfoField label="Last name">
          <TextInput
            style={fieldStyle('lastName')}
            onFocus={() => setFocusedField('lastName')}
            onBlur={() => setFocusedField(null)}
            value={values.lastName}
            onChangeText={(value) => setField('lastName', value)}
            placeholder="Not provided"
            placeholderTextColor={colors.mutedForegroundLight}
            autoCapitalize="words"
            autoComplete="family-name"
            maxLength={80}
            accessibilityLabel="Last name"
            testID="clerk-personal-info-last-name"
          />
        </ClerkInfoField>
        <ClerkInfoField label="Date of birth">
          <TextInput
            style={fieldStyle('dob')}
            value={dobFocused ? values.dob : formatClerkDateOfBirth(values.dob)}
            onFocus={() => {
              setDobFocused(true);
              setFocusedField('dob');
            }}
            onBlur={() => {
              setDobFocused(false);
              setFocusedField(null);
            }}
            onChangeText={(value) => setField('dob', value)}
            placeholder="Not provided"
            placeholderTextColor={colors.mutedForegroundLight}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            maxLength={10}
            accessibilityLabel="Date of birth"
            testID="clerk-personal-info-dob"
          />
          <Text style={[styles.helperText, { color: colors.mutedForegroundLight }]}>Edit as YYYY-MM-DD.</Text>
        </ClerkInfoField>
        <ClerkInfoField label="Gender">
          <View style={styles.choiceRow}>
            {(['female', 'male'] as const).map((gender) => {
              const selected = values.gender === gender;
              return (
                <TouchableOpacity
                  key={gender}
                  style={[
                    styles.choice,
                    { borderColor: selected ? colors.primary : colors.border },
                    selected && { backgroundColor: colors.primary + '12' },
                  ]}
                  onPress={() => setField('gender', gender)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  testID={`clerk-personal-info-gender-${gender}`}
                >
                  <Text style={[styles.choiceText, { color: selected ? colors.primary : colors.textOnSurface }]}>
                    {gender === 'female' ? 'Female' : 'Male'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ClerkInfoField>
        <ClerkInfoField label="Weight (lbs)">
          <TextInput
            style={fieldStyle('weightLbs')}
            onFocus={() => setFocusedField('weightLbs')}
            onBlur={() => setFocusedField(null)}
            value={values.weightLbs}
            onChangeText={(value) => setField('weightLbs', value)}
            placeholder="Not provided"
            placeholderTextColor={colors.mutedForegroundLight}
            keyboardType="number-pad"
            maxLength={4}
            accessibilityLabel="Weight in pounds, optional"
            testID="clerk-personal-info-weight"
          />
        </ClerkInfoField>
      </View>
      <View style={[styles.clerkInfoGroup, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.groupTitle, { color: colors.textOnSurface }]}>Contact</Text>
        <ClerkInfoField label="Email">
          <ReadOnlyProfileValue
            value={profile.email?.trim() || 'Not provided'}
            accessibilityLabel="Email, read only"
          />
          {profile.emailLocked ? (
            <Text style={[styles.helperText, { color: colors.mutedForegroundLight }]}>Verified email</Text>
          ) : null}
        </ClerkInfoField>
        <ClerkInfoField label="Phone">
          <ReadOnlyProfileValue
            value={profile.phoneE164?.trim() || 'Not provided'}
            accessibilityLabel="Phone, read only"
            cue={profile.phoneVerifiedAt ? 'checkmark-circle' : 'lock-closed'}
            cueColor={profile.phoneVerifiedAt ? colors.success : undefined}
          />
          {profile.phoneE164 ? (
            <Text style={[styles.helperText, { color: colors.mutedForegroundLight }]}>
              {profile.phoneVerifiedAt ? 'Verified phone number' : 'Phone verification not confirmed'}
            </Text>
          ) : null}
        </ClerkInfoField>
      </View>
      <View style={[styles.clerkInfoGroup, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.groupTitle, { color: colors.textOnSurface }]}>Travel preferences</Text>
        <ClerkInfoField label="Home airport">
          <ReadOnlyProfileValue
            value={profile.homeAirportLabel?.trim() || profile.homeAirportCode?.trim() || 'Not provided'}
            accessibilityLabel="Home airport, read only"
          />
        </ClerkInfoField>
        <ClerkInfoField label="Favorite airports">
          <ReadOnlyProfileValue
            value={profile.favoriteAirportLabels.length
              ? profile.favoriteAirportLabels.join(', ')
              : profile.favoriteAirportCodes.length
                ? profile.favoriteAirportCodes.join(', ')
                : 'Not provided'}
            accessibilityLabel="Favorite airports, read only"
          />
        </ClerkInfoField>
        <ClerkInfoField label="Favorite cities">
          <ReadOnlyProfileValue
            value={profile.favoriteCityLabels.length
              ? profile.favoriteCityLabels.join(', ')
              : profile.favoriteCityKeys.length
                ? profile.favoriteCityKeys.join(', ')
                : 'Not provided'}
            accessibilityLabel="Favorite cities, read only"
          />
        </ClerkInfoField>
      </View>

      {saveError ? <Text style={[styles.errorText, { color: colors.destructive }]} testID="clerk-personal-info-save-error">{saveError}</Text> : null}
      {saveNotice ? <Text style={[styles.savedText, { color: colors.success }]} testID="clerk-personal-info-save-success">{saveNotice}</Text> : null}
      {saveIssue && changedFields.length > 0 ? (
        <Text style={[styles.helperText, { color: colors.mutedForegroundLight }]} testID="clerk-personal-info-save-guidance">
          {saveIssue}
        </Text>
      ) : null}
      {requestData ? (
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.primary, opacity: isSaving ? 0.6 : 1 }]}
          activeOpacity={0.85}
          disabled={isSaving}
          onPress={() => { void saveChanges(); }}
          accessibilityRole="button"
          testID="clerk-personal-info-save"
        >
          {isSaving
            ? <ActivityIndicator color={colors.primaryForeground} />
            : <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Save changes</Text>}
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function ClerkInfoField({ label, children }: { label: string; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={styles.clerkInfoField}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForegroundLight }]}>{label}</Text>
      {children}
    </View>
  );
}

function ReadOnlyProfileValue({
  value,
  accessibilityLabel,
  cue = 'lock-closed',
  cueColor,
}: {
  value: string;
  accessibilityLabel: string;
  cue?: 'lock-closed' | 'checkmark-circle';
  cueColor?: string;
}) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.readOnlyValue,
        { backgroundColor: colors.muted, borderColor: colors.border },
      ]}
      accessibilityLabel={accessibilityLabel}
      accessible
    >
      <Text style={[styles.readOnlyText, { color: colors.textOnSurface }]}>{value}</Text>
      <Ionicons name={cue} size={16} color={cueColor ?? colors.mutedForegroundLight} />
    </View>
  );
}

function ClerkPersonalInfoState({
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
          <Image source={require('@/assets/images/bluebird-bird-mark.png')} style={styles.loadingMark} resizeMode="contain" />
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

function getClerkPersonalInfoErrorMessage(error: unknown): string {
  const typed = error as { code?: string; status?: number };
  if (typed?.code === 'session_expired' || typed?.status === 401) {
    return 'Your sign-in has expired. Sign in again, then reopen your profile.';
  }
  if (typed?.code === 'network' || typed?.code === 'timeout') {
    return 'Bluebird could not be reached. Check your connection and try again.';
  }
  return 'Bluebird could not load or save your profile. Please try again.';
}

function toPhotoUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const baseUrl = process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : '';
  return `${baseUrl}${path.startsWith('/api/') ? path : `/api/storage${path}`}`;
}

function resolveAccountPhotoUrl(path: string | null | undefined): string | null {
  return path ? toPhotoUrl(path) : null;
}

export default function PersonalInfoScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { user, updateUser, authMode } = useAuth();
  const queryClient = useQueryClient();
  const localDemoFlow = authMode === 'legacy' && isLocalFlightReadMode();
  const [cameraPermission, requestCameraPermission] = ImagePicker.useCameraPermissions();
  const [libraryPermission, requestLibraryPermission] = ImagePicker.useMediaLibraryPermissions();

  // Account and networking data intentionally remain separate. The account
  // form is available while the member-only networking query is loading or
  // unavailable.
  const updateMutation = useUpdateMe({
    mutation: {
      onSuccess: (data: any) => {
        updateUser(data);
        setAccountSaved(true);
        setTimeout(() => setAccountSaved(false), 2500);
      },
      onError: (err: any) => setAccountError(err?.response?.data?.error ?? 'Failed to save changes'),
    },
  });
  // Saving a photo is a standalone account update, not part of the editable
  // name/email/weight form or the networking profile.
  const updatePhotoMutation = useUpdateMe();
  const networkingEnabled = localDemoFlow && !!user && user.membershipTier !== 'none';
  const {
    data: networkingData,
    isLoading: networkingLoading,
    isError: networkingError,
    refetch: refetchNetworking,
  } = useGetNetworkingProfile({
    query: { enabled: localDemoFlow && networkingEnabled, refetchOnMount: 'always' },
  });
  const networkingSave = useUpdateNetworkingProfile();
  const uploadPhoto = useRequestUploadUrl();

  const [name, setName] = React.useState(user?.name ?? '');
  const [email, setEmail] = React.useState(user?.email ?? '');
  const [weightKg, setWeightKg] = React.useState(user?.weightKg == null ? '' : String(user.weightKg));
  const [accountError, setAccountError] = React.useState<string | null>(null);
  const [accountSaved, setAccountSaved] = React.useState(false);
  const [photoError, setPhotoError] = React.useState<string | null>(null);
  const [photoSaved, setPhotoSaved] = React.useState(false);
  const [accountPhotoUrl, setAccountPhotoUrl] = React.useState<string | null>(
    resolveAccountPhotoUrl(user?.photoUrl),
  );

  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [industry, setIndustry] = React.useState('');
  const [bio, setBio] = React.useState('');
  const [linkedinUrl, setLinkedinUrl] = React.useState('');
  const [facebookUrl, setFacebookUrl] = React.useState('');
  const [instagramUrl, setInstagramUrl] = React.useState('');
  const [isUploadingPhoto, setIsUploadingPhoto] = React.useState(false);
  const [networkingErrorMessage, setNetworkingErrorMessage] = React.useState('');
  const [networkingSaved, setNetworkingSaved] = React.useState(false);

  React.useEffect(() => {
    setAccountPhotoUrl(resolveAccountPhotoUrl(user?.photoUrl));
  }, [user?.id, user?.photoUrl]);

  React.useEffect(() => {
    if (!networkingData) return;
    setFirstName(networkingData.firstName);
    setLastName(networkingData.lastName);
    setIndustry(networkingData.industry);
    setBio(networkingData.bio);
    setLinkedinUrl(networkingData.linkedinUrl ?? '');
    setFacebookUrl(networkingData.facebookUrl ?? '');
    setInstagramUrl(networkingData.instagramUrl ?? '');
  }, [networkingData]);

  const accountPhotoReady = !!(
    user?.photoAssetPath ||
    accountPhotoUrl
  );
  const networkingMissing = networkingData
    ? networkingData.missing.filter((item) => item !== 'photo')
    : [];
  if (networkingData && !accountPhotoReady) networkingMissing.push('photo');
  const networkingCompleted = !!networkingData && networkingMissing.length === 0;

  const accountDirty =
    name !== (user?.name ?? '') ||
    email !== (user?.email ?? '') ||
    weightKg !== (user?.weightKg == null ? '' : String(user.weightKg));

  const handleAccountSave = () => {
    setAccountError(null);
    if (!name.trim()) { setAccountError('Name cannot be empty'); return; }
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) {
      setAccountError('Enter a valid email address');
      return;
    }
    const trimmedWeight = weightKg.trim();
    const normalizedWeight = trimmedWeight === '' ? null : Number(trimmedWeight);
    if (
      trimmedWeight !== '' &&
      (normalizedWeight === null ||
        !Number.isFinite(normalizedWeight) ||
        normalizedWeight < 1 ||
        normalizedWeight > 500)
    ) {
      setAccountError('Weight must be between 1 and 500 kg');
      return;
    }
    updateMutation.mutate({
      data: {
        name: name.trim(),
        email: email.trim(),
        weightKg: normalizedWeight,
      },
    });
  };

  const pickPhoto = async (source: 'camera' | 'library') => {
    setPhotoError(null);
    try {
      const options = {
        mediaTypes: ['images'] as any,
        allowsEditing: true,
        aspect: [1, 1] as [number, number],
        quality: 0.75,
      };
      const result = await selectProfilePhoto(source, {
        platform: Platform.OS,
        permission: source === 'camera' ? cameraPermission : libraryPermission,
        requestPermission: source === 'camera' ? requestCameraPermission : requestLibraryPermission,
        launch: () => source === 'camera'
          ? ImagePicker.launchCameraAsync(options)
          : ImagePicker.launchImageLibraryAsync(options),
      });
      if (result.kind === 'denied') {
          if (result.permission.status === 'denied' && !result.permission.canAskAgain) {
            Alert.alert(
              'Permission needed',
              source === 'camera'
                ? 'Allow camera access in Settings to take a profile photo.'
                : 'Allow photo library access in Settings to choose a profile photo.',
              [
                { text: 'Not now', style: 'cancel' },
                {
                  text: 'Open Settings',
                  onPress: () => {
                    void Linking.openSettings().catch(() => {
                      setPhotoError('Could not open Settings. You can enable photo access in your device settings.');
                    });
                  },
                },
              ],
            );
          } else {
            setPhotoError(source === 'camera'
              ? 'Camera access is needed to take a profile photo.'
              : 'Photo library access is needed to choose a profile photo.');
          }
        return;
      }
      if (result.kind === 'cancelled') return;
      const asset = result.asset;
      setIsUploadingPhoto(true);
      const upload = await uploadProfilePhoto(asset, {
        platform: Platform.OS,
        createNativeFile: (uri) => new ExpoFile(uri),
        readWebBlob: async (uri) => (await (await fetch(uri)).blob()),
        requestUpload: async (metadata) => uploadPhoto.mutateAsync({ data: metadata }),
        put: (url, options) => expoFetch(url, options as any),
      });
      const savedUser = await updatePhotoMutation.mutateAsync({
        data: { photoAssetPath: upload.objectPath },
      });
      updateUser(savedUser);
      setAccountPhotoUrl(resolveAccountPhotoUrl(savedUser.photoUrl));
      setPhotoSaved(true);
      setTimeout(() => setPhotoSaved(false), 2500);
      queryClient.invalidateQueries({ queryKey: ['/api/networking/profile'] });
    } catch (uploadError: any) {
      setPhotoError(
        uploadError?.response?.data?.error ??
        uploadError?.data?.error ??
        uploadError?.message ??
        'Could not update your profile photo.',
      );
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  async function removePhoto() {
    setPhotoError(null);
    setIsUploadingPhoto(true);
    try {
      const savedUser = await updatePhotoMutation.mutateAsync({
        data: { photoAssetPath: null },
      });
      updateUser(savedUser);
      setAccountPhotoUrl(resolveAccountPhotoUrl(savedUser.photoUrl));
      setPhotoSaved(true);
      setTimeout(() => setPhotoSaved(false), 2500);
      queryClient.invalidateQueries({ queryKey: ['/api/networking/profile'] });
    } catch (updateError: any) {
      setPhotoError(
        updateError?.response?.data?.error ??
        updateError?.data?.error ??
        updateError?.message ??
        'Could not remove your profile photo.',
      );
    } finally {
      setIsUploadingPhoto(false);
    }
  }

  const handleNetworkingSave = () => {
    setNetworkingErrorMessage('');
    for (const [label, input] of [
      ['LinkedIn', linkedinUrl], ['Facebook', facebookUrl], ['Instagram', instagramUrl],
    ]) {
      if (!input.trim()) continue;
      try {
        const url = new URL(input.trim());
        if (['http:', 'https:'].includes(url.protocol) && url.hostname &&
            !url.username && !url.password && input.trim().length <= 2048) continue;
      } catch { /* Preserve typed values on validation failure. */ }
      setNetworkingErrorMessage(`Enter a valid http(s) URL for ${label}, or leave it blank.`);
      return;
    }
    networkingSave.mutate({
      data: {
        ...(firstName.trim() ? { firstName: firstName.trim() } : {}),
        ...(lastName.trim() ? { lastName: lastName.trim() } : {}),
        ...(industry.trim() ? { industry: industry.trim() } : {}),
        ...(bio.trim() ? { bio: bio.trim() } : {}),
        linkedinUrl: linkedinUrl.trim() || null,
        facebookUrl: facebookUrl.trim() || null,
        instagramUrl: instagramUrl.trim() || null,
      },
    }, {
      onSuccess: () => {
        setNetworkingSaved(true);
        queryClient.invalidateQueries({ queryKey: ['/api/networking/profile'] });
        setTimeout(() => setNetworkingSaved(false), 2200);
      },
      onError: (err: any) => setNetworkingErrorMessage(err?.data?.error ?? err?.message ?? 'Could not save your profile.'),
    });
  };

  const fieldStyle = [
    styles.input,
    { backgroundColor: colors.surface, color: colors.textOnSurface, borderColor: colors.border },
  ];
  const networkingField = (
    label: string,
    value: string,
    onChangeText: (nextValue: string) => void,
    placeholder: string,
    multiline = false,
    url = false,
  ) => (
    <React.Fragment key={label}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForegroundLight }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForegroundLight}
        multiline={multiline}
        keyboardType={url ? 'url' : 'default'}
        autoCapitalize={url ? 'none' : 'sentences'}
        autoCorrect={!url}
        autoComplete={url ? 'url' : 'off'}
        style={[...fieldStyle, multiline && styles.bioInput]}
        textAlignVertical={multiline ? 'top' : 'center'}
        maxLength={multiline ? 280 : url ? 2048 : 80}
      />
    </React.Fragment>
  );
  const bottomPadding = (Platform.OS === 'web' ? 34 : insets.bottom) + 40;

  if (authMode === 'clerk') {
    return <ClerkPersonalInfoScreen />;
  }

  if (!localDemoFlow) {
    return (
      <ProductionAuthenticatedUnavailableNotice
        title="Profile unavailable"
        testID="production-personal-info-unavailable"
      />
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomPadding }]}
        showsVerticalScrollIndicator={false}
        bottomOffset={20}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.fieldLabel, { color: colors.mutedForegroundLight }]}>Profile photo (optional)</Text>
        <View style={styles.accountPhotoButton}>
          {accountPhotoUrl
            ? <Image source={{ uri: accountPhotoUrl }} style={styles.accountPhoto} accessibilityLabel="Your profile photo" />
            : <View style={[styles.accountPhoto, { backgroundColor: colors.backgroundMid }]}>
              <Text style={[styles.photoText, { color: colors.textOnBrand }]}>+</Text>
            </View>}
          <View style={styles.photoCopy}>
            <Text style={[styles.photoLink, { color: colors.primary }]}>
              {isUploadingPhoto ? 'Saving profile photo…' : accountPhotoUrl ? 'Replace profile photo' : 'Add profile photo'}
            </Text>
            <Text style={[styles.photoHint, { color: colors.mutedForegroundLight }]}>
              Choose a photo or take one with your camera. Optional.
            </Text>
          </View>
          {isUploadingPhoto && <ActivityIndicator color={colors.primary} />}
        </View>
        <View style={styles.photoActions}>
          <TouchableOpacity
            onPress={() => { void pickPhoto('camera'); }}
            disabled={isUploadingPhoto}
            accessibilityRole="button"
            accessibilityLabel="Take photo"
            testID="take-profile-photo"
          >
            <Text style={[styles.photoLink, { color: colors.primary }]}>Take photo</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { void pickPhoto('library'); }}
            disabled={isUploadingPhoto}
            accessibilityRole="button"
            accessibilityLabel="Choose from library"
            testID="choose-profile-photo"
          >
            <Text style={[styles.photoLink, { color: colors.primary }]}>Choose from library</Text>
          </TouchableOpacity>
        </View>
        {accountPhotoUrl && (
          <TouchableOpacity
            onPress={() => { void removePhoto(); }}
            disabled={isUploadingPhoto}
            accessibilityRole="button"
            accessibilityLabel="Remove profile photo"
            style={styles.removePhotoButton}
          >
            <Text style={[styles.removePhotoLink, { color: colors.mutedForegroundLight }]}>Remove photo</Text>
          </TouchableOpacity>
        )}
        {photoError && <Text style={[styles.errorText, { color: colors.destructive }]}>{photoError}</Text>}
        {photoSaved && <Text style={[styles.savedText, { color: colors.success }]}>Profile photo updated.</Text>}

        <Text style={[styles.fieldLabel, { color: colors.mutedForegroundLight }]}>Full name</Text>
        <TextInput
          style={fieldStyle}
          value={name}
          onChangeText={setName}
          placeholder="Your name"
          placeholderTextColor={colors.mutedForegroundLight}
          autoCapitalize="words"
        />

        <Text style={[styles.fieldLabel, { color: colors.mutedForegroundLight }]}>Email (optional)</Text>
        <TextInput
          style={fieldStyle}
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor={colors.mutedForegroundLight}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={[styles.fieldLabel, { color: colors.mutedForegroundLight }]}>Phone</Text>
        <TextInput
          style={[...fieldStyle, { opacity: 0.6 }]}
          value={user?.phone ?? ''}
          editable={false}
        />
        <Text style={[styles.helperText, { color: colors.mutedForegroundLight }]}>
          Your phone number is how you sign in and can't be changed here.
        </Text>

        <Text style={[styles.fieldLabel, { color: colors.mutedForegroundLight }]}>Weight (kg)</Text>
        <TextInput
          style={fieldStyle}
          value={weightKg}
          onChangeText={setWeightKg}
          placeholder="Optional"
          placeholderTextColor={colors.mutedForegroundLight}
          keyboardType="decimal-pad"
        />
        <Text style={[styles.helperText, { color: colors.mutedForegroundLight }]}>
          Enter a value between 1 and 500 kg.
        </Text>

        {accountError && <Text style={[styles.errorText, { color: colors.destructive }]}>{accountError}</Text>}
        {accountSaved && <Text style={[styles.savedText, { color: colors.primary }]}>✓ Changes saved</Text>}
        <TouchableOpacity
          style={[
            styles.button,
            { backgroundColor: colors.primary, opacity: accountDirty && !updateMutation.isPending ? 1 : 0.5 },
          ]}
          activeOpacity={0.85}
          disabled={!accountDirty || updateMutation.isPending}
          onPress={handleAccountSave}
        >
          {updateMutation.isPending
            ? <ActivityIndicator color={colors.primaryForeground} />
            : <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Save changes</Text>}
        </TouchableOpacity>

        <View style={[styles.section, { borderTopColor: colors.separator }]}>
          <View style={styles.intro}>
            <Text style={[styles.sectionTitle, { color: colors.textOnSurface }]}>Your flight network</Text>
            <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>
              Share enough to make relevant introductions before a shared flight. Your full profile is only shown after you connect.
            </Text>
          </View>

          {!networkingEnabled ? (
            <View style={styles.membershipGate}>
              <Text style={[styles.gateTitle, { color: colors.textOnSurface }]}>Networking is for members</Text>
              <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>
                Join a Bluebird membership to create your networking profile.
              </Text>
              <TouchableOpacity
                style={[styles.button, { backgroundColor: colors.primary }]}
                onPress={() => router.push('/membership/plans' as any)}
              >
                <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>View membership plans</Text>
              </TouchableOpacity>
            </View>
          ) : networkingLoading ? (
            <View style={styles.networkingLoading}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>Loading your flight network profile…</Text>
            </View>
          ) : networkingError || !networkingData ? (
            <View style={styles.networkingLoading}>
              <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>We couldn't load your networking profile.</Text>
              <TouchableOpacity onPress={() => refetchNetworking()}>
                <Text style={[styles.link, { color: colors.primary }]}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {networkingField('First name', firstName, setFirstName, 'First name')}
              {networkingField('Last name', lastName, setLastName, 'Last name')}
              {networkingField('Industry or category', industry, setIndustry, 'e.g. Venture capital')}
              {networkingField('Short bio', bio, setBio, 'What would you enjoy talking about?', true)}
              {networkingField('LinkedIn URL (optional)', linkedinUrl, setLinkedinUrl, 'https://www.linkedin.com/in/you', false, true)}
              {networkingField('Facebook URL (optional)', facebookUrl, setFacebookUrl, 'https://www.facebook.com/you', false, true)}
              {networkingField('Instagram URL (optional)', instagramUrl, setInstagramUrl, 'https://www.instagram.com/you', false, true)}
              <View style={[styles.status, { backgroundColor: networkingCompleted ? colors.success + '16' : colors.primary + '12' }]}>
                <Text style={[styles.statusText, { color: networkingCompleted ? colors.success : colors.primary }]}>
                  {networkingCompleted
                    ? '✓ Profile complete — you can send introductions.'
                    : `Still needed: ${networkingMissing.join(', ')}`}
                </Text>
              </View>
              {networkingErrorMessage ? <Text style={[styles.errorText, { color: colors.destructive }]}>{networkingErrorMessage}</Text> : null}
              {networkingSaved ? <Text style={[styles.savedText, { color: colors.success }]}>Saved across your devices.</Text> : null}
              <TouchableOpacity
                onPress={handleNetworkingSave}
                disabled={networkingSave.isPending}
                activeOpacity={0.8}
                style={[styles.button, { backgroundColor: colors.primary, opacity: networkingSave.isPending ? 0.6 : 1 }]}
              >
                {networkingSave.isPending
                  ? <ActivityIndicator color={colors.primaryForeground} />
                  : <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Save profile</Text>}
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 20 },
  clerkHeader: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  clerkBackBtn: {
    width: 42, height: 42, borderRadius: 21,
    alignItems: 'center', justifyContent: 'center',
  },
  clerkHeaderTitle: { fontSize: 26, lineHeight: 32, fontFamily: 'Inter_700Bold', letterSpacing: -0.4 },
  clerkInfoContent: { paddingHorizontal: 16, paddingTop: 2, flexGrow: 1, gap: 14 },
  clerkInfoGroups: { gap: 14 },
  clerkInfoGroup: { padding: 14, borderRadius: 16, borderWidth: 1, gap: 12 },
  groupTitle: { fontSize: 16, lineHeight: 22, fontFamily: 'Inter_700Bold', marginBottom: 2 },
  clerkInfoField: { gap: 6 },
  clerkInfoCard: { padding: 16, borderRadius: 16, gap: 12 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  loadingMark: { width: 44, height: 48 },
  refreshingRow: { height: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  refreshingMark: { width: 18, height: 18 },
  inlineLoadError: { padding: 12, borderRadius: 12, gap: 8 },
  retryText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  title: { fontSize: 24, lineHeight: 30, fontFamily: 'Inter_700Bold', letterSpacing: -0.4 },
  subtitle: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_400Regular' },
  readOnlyValue: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  readOnlyText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    flex: 1,
    flexWrap: 'wrap',
  },
  fieldLabel: {
    fontFamily: 'Inter_600SemiBold', fontSize: 13,
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
  input: {
    minHeight: 50,
    borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 10,
    fontFamily: 'Inter_500Medium', fontSize: 15,
    marginBottom: 0,
  },
  bioInput: { minHeight: 105, paddingTop: 13 },
  helperText: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
  errorText: { fontFamily: 'Inter_500Medium', fontSize: 13, marginBottom: 12, lineHeight: 18 },
  savedText: { fontFamily: 'Inter_500Medium', fontSize: 13, marginBottom: 12 },
  button: { borderRadius: 999, paddingVertical: 16, alignItems: 'center', marginTop: 6 },
  buttonText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  section: { borderTopWidth: 1, marginTop: 30, paddingTop: 28 },
  intro: { gap: 7, marginBottom: 12 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 23, letterSpacing: -0.4 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 },
  membershipGate: { gap: 8, marginTop: 8 },
  gateTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, letterSpacing: -0.2 },
  networkingLoading: { alignItems: 'center', gap: 10, paddingVertical: 24 },
  link: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  accountPhotoButton: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 8 },
  photoActions: { flexDirection: 'row', gap: 24, marginBottom: 18, paddingLeft: 82 },
  removePhotoButton: { alignSelf: 'flex-start', marginTop: -14, marginBottom: 18 },
  accountPhoto: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center' },
  photoCopy: { flex: 1, gap: 4 },
  photoHint: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
  removePhotoLink: { fontFamily: 'Inter_500Medium', fontSize: 12, paddingTop: 2 },
  photoText: { fontFamily: 'Inter_400Regular', fontSize: 34 },
  photoLink: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  status: { borderRadius: 12, padding: 12, marginTop: 18 },
  statusText: { fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 },
});
