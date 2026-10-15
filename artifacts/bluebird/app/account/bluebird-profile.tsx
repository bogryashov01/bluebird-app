import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Redirect, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { createMainBluebirdApiIntegration } from '@/lib/mainBluebirdApi';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import {
  canEditClerkBluebirdProfile,
  getClerkBluebirdProfileEffectDependencies,
  isClerkBluebirdProfileResultCurrent,
  loadClerkBluebirdProfile,
  updateClerkBluebirdProfileExplicitly,
  type BluebirdProfileLoadResult,
} from '@/lib/clerkBluebirdProfile';
import type {
  UserGender,
} from '@/lib/productionAuthApi';
import type { ProductionAirportCityGroupResponse } from '@/lib/productionFlights';

type AirportCityGroup = ProductionAirportCityGroupResponse;
type Gender = UserGender;
type ApiClient = ReturnType<typeof createMainBluebirdApiIntegration>;
type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | {
      kind: 'loaded';
      clerkUserId: string;
      result: BluebirdProfileLoadResult;
      cities: AirportCityGroup[];
    };

export default function BluebirdProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const session = useClerkAuthSnapshot();
  const configuration = getMainBluebirdApiConfigurationOrNull();
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isStartingPhoneVerification, setIsStartingPhoneVerification] = useState(false);
  const [isCheckingPhoneVerification, setIsCheckingPhoneVerification] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  const [email, setEmail] = useState('');
  const [homeAirportCode, setHomeAirportCode] = useState('');
  const [favoriteCityKeys, setFavoriteCityKeys] = useState<string[]>([]);
  const [phoneE164, setPhoneE164] = useState('');
  const [phoneCountry, setPhoneCountry] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [phoneVerifiedFor, setPhoneVerifiedFor] = useState('');
  const [phoneCodeSent, setPhoneCodeSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSaved, setFormSaved] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
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
      throw new Error('Your signed-in Main Bluebird API session is unavailable.');
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
    setLoadState({ kind: 'loading' });
    setIsEditing(false);
    setFormError(null);
    try {
      const api = createApi();
      const result = await loadClerkBluebirdProfile(api.authenticated, signal);
      const cities = result.kind === 'authenticated'
        ? await api.public.getAirportCities({ signal })
        : [];
      if (!isClerkBluebirdProfileResultCurrent({
        requestedClerkUserId,
        currentClerkUserId: currentIdentity.current,
        aborted: signal.aborted,
      })) return;
      setLoadState({ kind: 'loaded', clerkUserId: requestedClerkUserId, result, cities });
      if (result.kind === 'authenticated') {
        setFirstName(result.profile.firstName ?? '');
        setLastName(result.profile.lastName ?? '');
        setDateOfBirth(result.profile.dob ?? '');
        setGender(result.profile.gender);
        setEmail(result.profile.email ?? result.currentUser.email ?? '');
        setHomeAirportCode(result.profile.homeAirportCode ?? '');
        setFavoriteCityKeys(result.profile.favoriteCityKeys);
        setPhoneE164(result.profile.phoneE164 ?? '');
        setPhoneCountry(result.profile.phoneCountry ?? '');
        setPhoneVerifiedFor(result.profile.phoneVerifiedAt ? result.profile.phoneE164 ?? '' : '');
      }
    } catch (error) {
      if (signal.aborted || currentIdentity.current !== requestedClerkUserId) return;
      setLoadState({ kind: 'error', message: getProfileErrorMessage(error) });
    }
  }, [createApi, ...profileLoadDependencies]);

  useEffect(() => {
    if (!session?.isLoaded || session.isSignedIn !== true || !session.userId) {
      setLoadState({ kind: 'loading' });
      return;
    }
    const controller = new AbortController();
    void loadProfile(controller.signal);
    return () => controller.abort();
  }, [loadProfile, ...profileLoadDependencies]);

  const visibleLoadState: LoadState = loadState.kind === 'loaded' &&
    loadState.clerkUserId !== (session?.userId ?? null)
    ? { kind: 'loading' }
    : loadState;
  const cityByKey = useMemo(
    () => new Map((visibleLoadState.kind === 'loaded' ? visibleLoadState.cities : []).map((city) => [city.key, city])),
    [visibleLoadState],
  );

  if (!session) {
    return (
      <CenteredState
        colors={colors}
        title="Profile unavailable"
        message="Sign in with your Bluebird account to view your profile."
      />
    );
  }
  if (!session.isLoaded) {
    return <CenteredState colors={colors} loading title="Loading account" />;
  }
  if (session.isSignedIn !== true) return <Redirect href="/(clerk-auth)/sign-in" />;
  if (!configuration) {
    return (
      <CenteredState
        colors={colors}
        title="Profile unavailable"
        message="The selected Main Bluebird API environment is not configured."
      />
    );
  }

  const loadedResult = visibleLoadState.kind === 'loaded' ? visibleLoadState.result : null;
  const authenticatedResult = loadedResult?.kind === 'authenticated' ? loadedResult : null;
  const editable = loadedResult ? canEditClerkBluebirdProfile(loadedResult) : false;
  const profile = authenticatedResult?.profile ?? null;
  const currentUser = authenticatedResult?.currentUser ?? null;
  const completionRequired = authenticatedResult?.completion === 'completion_required';
  const phoneRequired = !!(profile?.phoneVerificationRequired || currentUser?.needsSignupPhone);
  const profileCanBeSaved = !!editable && (
    !phoneRequired ||
    (!!normalizePhone(phoneE164) && phoneVerifiedFor === normalizePhone(phoneE164))
  );

  const handlePhoneNumberChange = (value: string) => {
    setPhoneE164(value);
    setPhoneCodeSent(false);
    setVerificationCode('');
    setPhoneVerifiedFor('');
    setFormError(null);
  };

  const handleStartPhoneVerification = async () => {
    if (!configuration || configuration.environment !== 'development') {
      setFormError('Phone verification is not enabled for the selected API environment.');
      return;
    }
    const normalizedPhone = normalizePhone(phoneE164);
    const normalizedCountry = phoneCountry.trim().toUpperCase();
    if (!/^\+[1-9]\d{7,14}$/.test(normalizedPhone) || !/^[A-Z]{2}$/.test(normalizedCountry)) {
      setFormError('Enter a valid international phone number and 2-letter country code first.');
      return;
    }
    setFormError(null);
    setIsStartingPhoneVerification(true);
    const requestedClerkUserId = session.userId;
    try {
      const result = await createApi().authenticated.startPhoneVerification({
        countryIso2: normalizedCountry,
        phoneE164: normalizedPhone,
      });
      if (currentIdentity.current !== requestedClerkUserId) return;
      setPhoneCodeSent(result.ok);
      if (!result.ok) setFormError('Bluebird could not request a verification code. Try again later.');
    } catch (error) {
      if (currentIdentity.current !== requestedClerkUserId) return;
      setFormError(getProfileErrorMessage(error));
    } finally {
      setIsStartingPhoneVerification(false);
    }
  };

  const handleCheckPhoneVerification = async () => {
    const normalizedPhone = normalizePhone(phoneE164);
    if (!/^\d{6}$/.test(verificationCode)) {
      setFormError('Enter the 6-digit code sent to your phone.');
      return;
    }
    setFormError(null);
    setIsCheckingPhoneVerification(true);
    const requestedClerkUserId = session.userId;
    try {
      const result = await createApi().authenticated.checkPhoneVerification({
        phoneE164: normalizedPhone,
        code: verificationCode,
      });
      if (currentIdentity.current !== requestedClerkUserId) return;
      if (result.status === 'verified') {
        setPhoneVerifiedFor(normalizedPhone);
        setPhoneCodeSent(false);
        setVerificationCode('');
      } else {
        setFormError(result.status === 'expired'
          ? 'That code has expired. Request a new code to continue.'
          : 'Bluebird has not verified this phone number yet.');
      }
    } catch (error) {
      if (currentIdentity.current !== requestedClerkUserId) return;
      setFormError(getProfileErrorMessage(error));
    } finally {
      setIsCheckingPhoneVerification(false);
    }
  };

  const handleSave = async () => {
    if (!loadedResult || !canEditClerkBluebirdProfile(loadedResult) || isSaving) return;
    const requestedClerkUserId = session?.userId;
    if (!requestedClerkUserId) return;
    const normalizedFirstName = firstName.trim();
    const normalizedLastName = lastName.trim();
    const normalizedDob = dateOfBirth.trim();
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPhone = normalizePhone(phoneE164);
    const normalizedCountry = phoneCountry.trim().toUpperCase();
    const phoneOnlySignup = profile?.signupChannel === 'phone';

    if (!normalizedFirstName || normalizedFirstName.length > 80 ||
        !normalizedLastName || normalizedLastName.length > 80) {
      setFormError('Enter a first and last name (up to 80 characters each).');
      return;
    }
    if (!isAdultDate(normalizedDob)) {
      setFormError('Enter a valid date of birth. You must be at least 18.');
      return;
    }
    if (!gender) {
      setFormError('Choose a gender to continue.');
      return;
    }
    if (!/^[A-Z0-9]{3,4}$/.test(homeAirportCode.trim().toUpperCase())) {
      setFormError('Enter a 3-letter IATA or 4-letter ICAO home airport code.');
      return;
    }
    if (favoriteCityKeys.length === 0) {
      setFormError('Choose at least one favorite city.');
      return;
    }
    if (phoneOnlySignup && !normalizedEmail) {
      setFormError('An email address is required to complete this phone-based profile.');
      return;
    }
    if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setFormError('Enter a valid email address.');
      return;
    }
    if (phoneRequired && !normalizedPhone) {
      setFormError('A phone number is required to complete this profile.');
      return;
    }
    if (normalizedPhone && !/^\+[1-9]\d{7,14}$/.test(normalizedPhone)) {
      setFormError('Enter the phone number in international format, such as +14155550123.');
      return;
    }
    if (normalizedPhone && !/^[A-Z]{2}$/.test(normalizedCountry)) {
      setFormError('Enter the 2-letter country code for this phone number.');
      return;
    }
    if (phoneRequired && normalizedPhone && phoneVerifiedFor !== normalizedPhone) {
      setFormError('Verify this phone number before saving your profile.');
      return;
    }

    setFormError(null);
    setFormSaved(false);
    setIsSaving(true);
    try {
      const savedProfile = await updateClerkBluebirdProfileExplicitly(
        createApi().authenticated,
        loadedResult,
        {
          firstName: normalizedFirstName,
          lastName: normalizedLastName,
          dob: normalizedDob,
          gender,
          homeAirportCode: homeAirportCode.trim().toUpperCase(),
          favoriteCityKeys,
          ...(normalizedPhone ? { phoneE164: normalizedPhone, phoneCountry: normalizedCountry } : {}),
          ...(!profile?.emailLocked && normalizedEmail ? { email: normalizedEmail } : {}),
        },
      );
      if (currentIdentity.current !== requestedClerkUserId) return;
      const nextCurrentUser = {
        ...loadedResult.currentUser,
        firstName: savedProfile.firstName,
        lastName: savedProfile.lastName,
        email: savedProfile.email,
        isProfileComplete: savedProfile.isComplete,
      };
      setLoadState({
        kind: 'loaded',
        clerkUserId: requestedClerkUserId,
        result: {
          kind: 'authenticated',
          currentUser: nextCurrentUser,
          profile: savedProfile,
          completion: savedProfile.isComplete === nextCurrentUser.isProfileComplete
            ? savedProfile.isComplete ? 'complete' : 'completion_required'
            : 'unverified',
        },
                        cities: visibleLoadState.kind === 'loaded' ? visibleLoadState.cities : [],
      });
      setFirstName(savedProfile.firstName ?? '');
      setLastName(savedProfile.lastName ?? '');
      setDateOfBirth(savedProfile.dob ?? '');
      setGender(savedProfile.gender);
      setEmail(savedProfile.email ?? '');
      setHomeAirportCode(savedProfile.homeAirportCode ?? '');
      setFavoriteCityKeys(savedProfile.favoriteCityKeys);
      setPhoneE164(savedProfile.phoneE164 ?? '');
      setPhoneCountry(savedProfile.phoneCountry ?? '');
      setPhoneVerifiedFor(savedProfile.phoneVerifiedAt ? normalizePhone(savedProfile.phoneE164 ?? '') : '');
      setIsEditing(false);
      setFormSaved(true);
    } catch (error) {
      setFormError(getProfileErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: (Platform.OS === 'web' ? 67 : insets.top) + 20,
            paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 32,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backLink}>
          <Text style={[styles.linkText, { color: colors.primary }]}>‹ Account</Text>
        </Pressable>
        <Text style={[styles.eyebrow, { color: colors.primary }]}>BLUEBIRD ACCOUNT</Text>
        <Text style={[styles.title, { color: colors.textOnSurface }]}>Personal profile</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForegroundLight }]}>
          Your profile is read from the signed-in account. Opening this page can synchronize phone details that Clerk has already verified.
        </Text>

        {visibleLoadState.kind === 'loading' ? (
          <StateCard colors={colors} loading message="Verifying your API session and loading your profile…" />
        ) : visibleLoadState.kind === 'error' ? (
          <StateCard
            colors={colors}
            message={visibleLoadState.message}
            action="Try again"
            onAction={() => setLoadAttempt((attempt) => attempt + 1)}
          />
        ) : visibleLoadState.result.kind === 'api_not_authenticated' ? (
          <StateCard
            colors={colors}
            message="The API did not confirm this session. Profile data and registration status are unavailable; no new account is inferred."
          />
        ) : (
          <>
            <StatusRow
              colors={colors}
              label="API authentication"
              value="Confirmed for this session"
              testID="profile-api-auth-state"
            />
            <StatusRow
              colors={colors}
              label="Profile completion"
              value={completionLabel(visibleLoadState.result.completion)}
              testID="profile-completion-state"
            />
            <StatusRow
              colors={colors}
              label="Membership"
              value={visibleLoadState.result.currentUser.isMember
                ? `Active${visibleLoadState.result.currentUser.memberTier ? ` · ${visibleLoadState.result.currentUser.memberTier}` : ''}`
                : 'No active membership'}
              testID="profile-membership-state"
            />
            <Text style={[styles.helper, { color: colors.mutedForegroundLight }]}>
              Membership is reported separately. Having no active membership does not mean you are unregistered.
            </Text>

            {visibleLoadState.result.completion === 'unverified' ? (
              <StateCard
                colors={colors}
                message="The API profile and account summary disagree about completion. Registration and editing are unavailable until the API can verify the state."
                action="Reload profile"
                onAction={() => setLoadAttempt((attempt) => attempt + 1)}
              />
            ) : (
              <>
                {visibleLoadState.result.completion === 'completion_required' && (
                  <View style={[styles.infoCard, { backgroundColor: colors.primary + '12', borderColor: colors.border }]}>
                    <Text style={[styles.cardTitle, { color: colors.textOnSurface }]}>Complete your Bluebird profile</Text>
                    <Text style={[styles.helper, { color: colors.mutedForegroundLight }]}>
                      The API confirms that this profile is incomplete. Saving the full profile is separate from membership and will not enroll you in a plan.
                    </Text>
                    {visibleLoadState.result.currentUser.needsSignupPhone && (
                      <Text style={[styles.helper, { color: colors.textOnSurface }]}>
                        The API also reports that a signup phone is needed.
                      </Text>
                    )}
                  </View>
                )}

                {!isEditing ? (
                  <ProfileSummary
                    colors={colors}
                      result={visibleLoadState.result}
                    cityByKey={cityByKey}
                    onEdit={() => {
                      setFormError(null);
                      setFormSaved(false);
                      setIsEditing(true);
                    }}
                  />
                ) : (
                  <View style={[styles.formCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <Text style={[styles.cardTitle, { color: colors.textOnSurface }]}>
                      {completionRequired ? 'Complete profile' : 'Edit profile'}
                    </Text>
                    <Text style={[styles.fieldLabel, { color: colors.mutedForegroundLight }]}>First name</Text>
                    <ProfileInput colors={colors} value={firstName} onChangeText={setFirstName} testID="profile-first-name" />
                    <Text style={[styles.fieldLabel, { color: colors.mutedForegroundLight }]}>Last name</Text>
                    <ProfileInput colors={colors} value={lastName} onChangeText={setLastName} testID="profile-last-name" />
                    <Text style={[styles.fieldLabel, { color: colors.mutedForegroundLight }]}>Date of birth (YYYY-MM-DD)</Text>
                    <ProfileInput
                      colors={colors}
                      value={dateOfBirth}
                      onChangeText={setDateOfBirth}
                      placeholder="1990-01-31"
                      testID="profile-dob"
                    />
                    <Text style={[styles.fieldLabel, { color: colors.mutedForegroundLight }]}>Gender</Text>
                    <View style={styles.choiceRow}>
                      {(['female', 'male'] as const).map((choice) => (
                        <ChoiceButton
                          key={choice}
                          colors={colors}
                          label={choice === 'female' ? 'Female' : 'Male'}
                          selected={gender === choice}
                          onPress={() => setGender(choice)}
                          testID={`profile-gender-${choice}`}
                        />
                      ))}
                    </View>
                    <Text style={[styles.fieldLabel, { color: colors.mutedForegroundLight }]}>
                      Email{profile?.emailLocked ? ' · managed by your sign-in provider' : ''}
                    </Text>
                    <ProfileInput
                      colors={colors}
                      value={email}
                      editable={!profile?.emailLocked}
                      onChangeText={setEmail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      testID="profile-email"
                    />
                    <Text style={[styles.fieldLabel, { color: colors.mutedForegroundLight }]}>Home airport code</Text>
                    <ProfileInput
                      colors={colors}
                      value={homeAirportCode}
                      onChangeText={(value) => setHomeAirportCode(value.toUpperCase())}
                      autoCapitalize="characters"
                      maxLength={4}
                      placeholder="SFO"
                      testID="profile-home-airport"
                    />
                    <Text style={[styles.fieldLabel, { color: colors.mutedForegroundLight }]}>Favorite cities</Text>
                    <View style={styles.cityGrid}>
                      {visibleLoadState.cities.map((city) => (
                        <ChoiceButton
                          key={city.key}
                          colors={colors}
                          label={city.displayName}
                          selected={favoriteCityKeys.includes(city.key)}
                          onPress={() => setFavoriteCityKeys((current) =>
                            current.includes(city.key)
                              ? current.filter((key) => key !== city.key)
                              : [...current, city.key],
                          )}
                          testID={`profile-city-${city.key}`}
                        />
                      ))}
                    </View>
                    <Text style={[styles.fieldLabel, { color: colors.mutedForegroundLight }]}>
                      Phone{phoneRequired ? ' · required' : ' · optional'}
                    </Text>
                    <ProfileInput
                      colors={colors}
                      value={phoneE164}
                      onChangeText={handlePhoneNumberChange}
                      keyboardType="phone-pad"
                      placeholder="+14155550123"
                      testID="profile-phone"
                    />
                    <Text style={[styles.fieldLabel, { color: colors.mutedForegroundLight }]}>Phone country (2-letter code)</Text>
                    <ProfileInput
                      colors={colors}
                      value={phoneCountry}
                      onChangeText={(value) => setPhoneCountry(value.toUpperCase())}
                      autoCapitalize="characters"
                      maxLength={2}
                      placeholder="US"
                      testID="profile-phone-country"
                    />

                    {phoneRequired && (
                      <View style={[styles.phoneCard, { borderColor: colors.border }]}>
                        <Text style={[styles.helper, { color: colors.mutedForegroundLight }]}>
                          Phone verification is required by the API. A text message is sent only after you request a code.
                        </Text>
                        {phoneVerifiedFor === normalizePhone(phoneE164) && !!phoneVerifiedFor ? (
                          <Text style={[styles.verifiedText, { color: colors.success }]}>Phone number verified</Text>
                        ) : (
                          <>
                            {configuration.environment !== 'development' ? (
                              <Text style={[styles.helper, { color: colors.mutedForegroundLight }]}>
                                SMS verification is unavailable for this API environment.
                              </Text>
                            ) : phoneCodeSent ? (
                              <>
                                <Text style={[styles.helper, { color: colors.mutedForegroundLight }]}>
                                  Code requested. Enter the 6-digit code sent to your phone.
                                </Text>
                                <ProfileInput
                                  colors={colors}
                                  value={verificationCode}
                                  onChangeText={(value) => setVerificationCode(value.replace(/\D/g, '').slice(0, 6))}
                                  keyboardType="number-pad"
                                  maxLength={6}
                                  placeholder="123456"
                                  testID="profile-phone-code"
                                />
                                <ActionButton
                                  colors={colors}
                                  label={isCheckingPhoneVerification ? 'Checking code…' : 'Verify phone'}
                                  disabled={isCheckingPhoneVerification}
                                  onPress={() => { void handleCheckPhoneVerification(); }}
                                  testID="verify-profile-phone"
                                />
                              </>
                            ) : (
                              <ActionButton
                                colors={colors}
                                label={isStartingPhoneVerification ? 'Requesting code…' : 'Send verification code'}
                                disabled={isStartingPhoneVerification}
                                onPress={() => { void handleStartPhoneVerification(); }}
                                testID="send-profile-phone-code"
                              />
                            )}
                          </>
                        )}
                      </View>
                    )}

                    {formError && <Text accessibilityLiveRegion="polite" style={[styles.error, { color: colors.destructive }]} testID="profile-form-error">{formError}</Text>}
                    {formSaved && <Text accessibilityLiveRegion="polite" style={[styles.success, { color: colors.success }]} testID="profile-saved">Profile saved.</Text>}
                    <View style={styles.buttonRow}>
                      <ActionButton
                        colors={colors}
                        secondary
                        label="Cancel"
                        disabled={isSaving}
                        onPress={() => setIsEditing(false)}
                      />
                      <ActionButton
                        colors={colors}
                        label={isSaving ? 'Saving…' : completionRequired ? 'Save profile' : 'Save changes'}
                        disabled={isSaving || !profileCanBeSaved}
                        onPress={() => { void handleSave(); }}
                        testID="save-bluebird-profile"
                      />
                    </View>
                  </View>
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function ProfileSummary({
  colors,
  result,
  cityByKey,
  onEdit,
}: {
  colors: ReturnType<typeof useColors>;
  result: Extract<BluebirdProfileLoadResult, { kind: 'authenticated' }>;
  cityByKey: Map<string, AirportCityGroup>;
  onEdit: () => void;
}) {
  const profile = result.profile;
  return (
    <View style={[styles.formCard, { backgroundColor: colors.surface, borderColor: colors.border }]} testID="bluebird-profile-values">
      <ProfileValue colors={colors} label="Name" value={[profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'Not provided'} />
      <ProfileValue colors={colors} label="Email" value={profile.email ?? result.currentUser.email ?? 'Not provided'} />
      <ProfileValue colors={colors} label="Date of birth" value={profile.dob ?? 'Not provided'} />
      <ProfileValue colors={colors} label="Gender" value={profile.gender ?? 'Not provided'} />
      <ProfileValue colors={colors} label="Home airport" value={[profile.homeAirportCode, profile.homeAirportLabel].filter(Boolean).join(' · ') || 'Not provided'} />
      <ProfileValue
        colors={colors}
        label="Favorite cities"
        value={profile.favoriteCityKeys.map((key) => cityByKey.get(key)?.displayName ?? key).join(', ') || 'Not provided'}
      />
      <ProfileValue colors={colors} label="Phone" value={profile.phoneE164 ?? 'Not provided'} />
      {profile.phoneVerificationRequired && (
        <ProfileValue colors={colors} label="Phone verification" value={profile.phoneVerifiedAt ? 'Verified' : 'Required'} />
      )}
      <ActionButton
        colors={colors}
        label={result.completion === 'completion_required' ? 'Complete profile' : 'Edit profile'}
        onPress={onEdit}
        testID="edit-bluebird-profile"
      />
    </View>
  );
}

function ProfileValue({ colors, label, value }: { colors: ReturnType<typeof useColors>; label: string; value: string }) {
  return (
    <View style={[styles.valueRow, { borderBottomColor: colors.separator }]}>
      <Text style={[styles.valueLabel, { color: colors.mutedForegroundLight }]}>{label}</Text>
      <Text style={[styles.value, { color: colors.textOnSurface }]}>{value}</Text>
    </View>
  );
}

function StatusRow({
  colors,
  label,
  value,
  testID,
}: {
  colors: ReturnType<typeof useColors>;
  label: string;
  value: string;
  testID: string;
}) {
  return (
    <View style={[styles.statusRow, { backgroundColor: colors.surface, borderColor: colors.border }]} testID={testID}>
      <Text style={[styles.statusLabel, { color: colors.mutedForegroundLight }]}>{label}</Text>
      <Text style={[styles.statusValue, { color: colors.textOnSurface }]}>{value}</Text>
    </View>
  );
}

function ProfileInput({
  colors,
  value,
  onChangeText,
  testID,
  ...props
}: {
  colors: ReturnType<typeof useColors>;
  value: string;
  onChangeText: (value: string) => void;
  testID?: string;
} & Omit<React.ComponentProps<typeof TextInput>, 'value' | 'onChangeText' | 'style'>) {
  return (
    <TextInput
      {...props}
      value={value}
      onChangeText={onChangeText}
      testID={testID}
      style={[styles.input, { backgroundColor: colors.input, color: colors.foreground, borderColor: colors.border }]}
      placeholderTextColor={colors.mutedForeground}
    />
  );
}

function ChoiceButton({
  colors,
  label,
  selected,
  onPress,
  testID,
}: {
  colors: ReturnType<typeof useColors>;
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.choice,
        { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary + '14' : colors.surface },
      ]}
      testID={testID}
    >
      <Text style={[styles.choiceText, { color: selected ? colors.primary : colors.textOnSurface }]}>{label}</Text>
    </Pressable>
  );
}

function ActionButton({
  colors,
  label,
  onPress,
  disabled = false,
  secondary = false,
  testID,
}: {
  colors: ReturnType<typeof useColors>;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, busy: disabled && /saving|requesting|checking/i.test(label) }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.actionButton,
        {
          backgroundColor: secondary ? colors.surface : colors.primary,
          borderColor: secondary ? colors.border : colors.primary,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
      testID={testID}
    >
      <Text style={[styles.actionText, { color: secondary ? colors.textOnSurface : colors.primaryForeground }]}>{label}</Text>
    </Pressable>
  );
}

function StateCard({
  colors,
  message,
  title,
  loading = false,
  action,
  onAction,
}: {
  colors: ReturnType<typeof useColors>;
  message: string;
  title?: string;
  loading?: boolean;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={[styles.stateCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {loading && <ActivityIndicator color={colors.primary} />}
      {title && <Text style={[styles.cardTitle, { color: colors.textOnSurface }]}>{title}</Text>}
      <Text style={[styles.helper, { color: colors.mutedForegroundLight }]}>{message}</Text>
      {action && onAction && <ActionButton colors={colors} label={action} onPress={onAction} />}
    </View>
  );
}

function CenteredState({
  colors,
  title,
  message,
  loading = false,
}: {
  colors: ReturnType<typeof useColors>;
  title: string;
  message?: string;
  loading?: boolean;
}) {
  return (
    <View style={[styles.center, { backgroundColor: colors.background }]}>
      {loading && <ActivityIndicator color={colors.primary} />}
      <Text style={[styles.title, { color: colors.textOnSurface }]}>{title}</Text>
      {message && <Text style={[styles.subtitle, { color: colors.mutedForegroundLight }]}>{message}</Text>}
    </View>
  );
}

function completionLabel(completion: 'complete' | 'completion_required' | 'unverified'): string {
  switch (completion) {
    case 'complete': return 'Complete';
    case 'completion_required': return 'Completion needed';
    case 'unverified': return 'Unverified';
  }
}

function normalizePhone(value: string): string {
  return value.trim().replace(/[\s().-]/g, '');
}

function isAdultDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
  const now = new Date();
  let age = now.getUTCFullYear() - date.getUTCFullYear();
  const beforeBirthday = now.getUTCMonth() < date.getUTCMonth() ||
    (now.getUTCMonth() === date.getUTCMonth() && now.getUTCDate() < date.getUTCDate());
  if (beforeBirthday) age -= 1;
  return date.getTime() < now.getTime() && age >= 18;
}

function getProfileErrorMessage(error: unknown): string {
  const typed = error as { code?: string; status?: number; message?: string };
  if (typed?.code === 'session_expired' || typed?.status === 401) {
    return 'The API session expired. Sign in again, then reopen your profile.';
  }
  if (typed?.code === 'network' || typed?.code === 'timeout') {
    return 'Bluebird could not be reached. Check your connection and try again.';
  }
  if (typed?.code === 'invalid_schema') {
    return 'Bluebird returned profile data in an unexpected format. No changes were made.';
  }
  if (typed?.code === 'http' && typed.status === 400) {
    return 'Bluebird rejected one or more profile fields. Check the information and try again.';
  }
  return 'Bluebird could not complete this profile request. Please try again.';
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 22, gap: 12 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  backLink: { alignSelf: 'flex-start', paddingVertical: 8, paddingRight: 16 },
  linkText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  eyebrow: { fontSize: 12, fontFamily: 'Inter_600SemiBold', letterSpacing: 1.4, marginTop: 4 },
  title: { fontSize: 28, fontFamily: 'Inter_700Bold', letterSpacing: -0.4 },
  subtitle: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 21, marginBottom: 6 },
  statusRow: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 5 },
  statusLabel: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  statusValue: { fontSize: 15, fontFamily: 'Inter_600SemiBold', textTransform: 'capitalize' },
  helper: { fontSize: 13, lineHeight: 19, fontFamily: 'Inter_400Regular' },
  infoCard: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 8, marginTop: 4 },
  stateCard: { borderWidth: 1, borderRadius: 16, padding: 18, gap: 12, marginTop: 8 },
  formCard: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 12, marginTop: 4 },
  cardTitle: { fontSize: 18, lineHeight: 24, fontFamily: 'Inter_700Bold' },
  valueRow: { gap: 4, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  valueLabel: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  value: { fontSize: 15, lineHeight: 21, fontFamily: 'Inter_500Medium' },
  fieldLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', marginTop: 3 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, fontSize: 15, fontFamily: 'Inter_400Regular' },
  choiceRow: { flexDirection: 'row', gap: 9, flexWrap: 'wrap' },
  cityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { minHeight: 39, borderWidth: 1, borderRadius: 999, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
  choiceText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  phoneCard: { borderWidth: 1, borderRadius: 14, padding: 13, gap: 10 },
  verifiedText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  buttonRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  actionButton: { minHeight: 46, flex: 1, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  error: { fontSize: 13, lineHeight: 19, fontFamily: 'Inter_500Medium' },
  success: { fontSize: 13, lineHeight: 19, fontFamily: 'Inter_600SemiBold' },
});
