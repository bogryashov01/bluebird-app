import React from 'react';
import {
  ActivityIndicator, Image, Platform, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
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
import { router } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { uploadProfilePhoto } from '@/lib/profile-photo-upload';

function toPhotoUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const baseUrl = process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : '';
  return `${baseUrl}${path.startsWith('/api/') ? path : `/api/storage${path}`}`;
}

export default function PersonalInfoScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { user, updateUser } = useAuth();
  const queryClient = useQueryClient();

  // Account and networking data intentionally remain separate. The account
  // form is available while the member-only networking query is loading or
  // unavailable.
  const updateMutation = useUpdateMe({
    mutation: {
      onSuccess: (data: any) => {
        if (user) updateUser({
          ...user,
          name: data.name,
          email: data.email ?? null,
          weightKg: data.weightKg ?? null,
        });
        setAccountSaved(true);
        setTimeout(() => setAccountSaved(false), 2500);
      },
      onError: (err: any) => setAccountError(err?.response?.data?.error ?? 'Failed to save changes'),
    },
  });
  const networkingEnabled = !!user && user.membershipTier !== 'none';
  const {
    data: networkingData,
    isLoading: networkingLoading,
    isError: networkingError,
    refetch: refetchNetworking,
  } = useGetNetworkingProfile({
    query: { enabled: networkingEnabled, refetchOnMount: 'always' },
  });
  const networkingSave = useUpdateNetworkingProfile();
  const uploadPhoto = useRequestUploadUrl();

  const [name, setName] = React.useState(user?.name ?? '');
  const [email, setEmail] = React.useState(user?.email ?? '');
  const [weightKg, setWeightKg] = React.useState(user?.weightKg == null ? '' : String(user.weightKg));
  const [accountError, setAccountError] = React.useState<string | null>(null);
  const [accountSaved, setAccountSaved] = React.useState(false);

  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [industry, setIndustry] = React.useState('');
  const [bio, setBio] = React.useState('');
  const [linkedinUrl, setLinkedinUrl] = React.useState('');
  const [instagramUrl, setInstagramUrl] = React.useState('');
  const [photoUrl, setPhotoUrl] = React.useState<string | null>(null);
  const [photoAssetPath, setPhotoAssetPath] = React.useState<string | null>(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = React.useState(false);
  const [networkingErrorMessage, setNetworkingErrorMessage] = React.useState('');
  const [networkingSaved, setNetworkingSaved] = React.useState(false);

  React.useEffect(() => {
    if (!networkingData) return;
    setFirstName(networkingData.firstName);
    setLastName(networkingData.lastName);
    setIndustry(networkingData.industry);
    setBio(networkingData.bio);
    setLinkedinUrl(networkingData.linkedinUrl ?? '');
    setInstagramUrl(networkingData.instagramUrl ?? '');
    setPhotoUrl(networkingData.photoUrl ?? null);
    setPhotoAssetPath(networkingData.photoAssetPath ?? null);
  }, [networkingData]);

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

  const choosePhoto = async () => {
    setNetworkingErrorMessage('');
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'] as any,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.75,
      });
      const asset = result.canceled ? null : result.assets[0];
      if (!asset) return;
      setIsUploadingPhoto(true);
      const upload = await uploadProfilePhoto(asset, {
        platform: Platform.OS,
        createNativeFile: (uri) => new ExpoFile(uri),
        readWebBlob: async (uri) => (await (await fetch(uri)).blob()),
        requestUpload: async (metadata) => uploadPhoto.mutateAsync({ data: metadata }),
        put: (url, options) => expoFetch(url, options as any),
      });
      setPhotoAssetPath(upload.objectPath);
      setPhotoUrl(toPhotoUrl(upload.objectPath));
    } catch (uploadError: any) {
      setNetworkingErrorMessage(uploadError?.data?.error ?? uploadError?.message ?? 'Could not upload your profile photo.');
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handleNetworkingSave = () => {
    setNetworkingErrorMessage('');
    if (!firstName.trim() || !lastName.trim() || !industry.trim() || !bio.trim() || (!photoUrl && !photoAssetPath)) {
      setNetworkingErrorMessage('Add your name, photo, industry, and a short bio to complete your profile.');
      return;
    }
    networkingSave.mutate({
      data: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        industry: industry.trim(),
        bio: bio.trim(),
        photoUrl: photoAssetPath ? null : photoUrl,
        photoAssetPath,
        linkedinUrl: linkedinUrl.trim() || null,
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
  ) => (
    <React.Fragment key={label}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForegroundLight }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForegroundLight}
        multiline={multiline}
        style={[...fieldStyle, multiline && styles.bioInput]}
        textAlignVertical={multiline ? 'top' : 'center'}
        maxLength={multiline ? 280 : 80}
      />
    </React.Fragment>
  );
  const bottomPadding = (Platform.OS === 'web' ? 34 : insets.bottom) + 40;

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomPadding }]}
        showsVerticalScrollIndicator={false}
        bottomOffset={20}
        keyboardShouldPersistTaps="handled"
      >
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
              <TouchableOpacity onPress={choosePhoto} disabled={isUploadingPhoto} activeOpacity={0.8} style={styles.photoButton}>
                {photoUrl
                  ? <Image source={{ uri: photoUrl }} style={styles.photo} />
                  : <View style={[styles.photo, { backgroundColor: colors.backgroundMid }]}>
                    <Text style={[styles.photoText, { color: colors.textOnBrand }]}>+</Text>
                  </View>}
                <Text style={[styles.photoLink, { color: colors.primary }]}>
                  {isUploadingPhoto ? 'Uploading profile photo…' : photoUrl ? 'Change profile photo' : 'Add profile photo'}
                </Text>
              </TouchableOpacity>
              {networkingField('First name', firstName, setFirstName, 'First name')}
              {networkingField('Last name', lastName, setLastName, 'Last name')}
              {networkingField('Industry or category', industry, setIndustry, 'e.g. Venture capital')}
              {networkingField('Short bio', bio, setBio, 'What would you enjoy talking about?', true)}
              {networkingField('LinkedIn (optional)', linkedinUrl, setLinkedinUrl, 'https://linkedin.com/in/you')}
              {networkingField('Instagram (optional)', instagramUrl, setInstagramUrl, 'https://instagram.com/you')}
              <View style={[styles.status, { backgroundColor: networkingData.completed ? colors.success + '16' : colors.primary + '12' }]}>
                <Text style={[styles.statusText, { color: networkingData.completed ? colors.success : colors.primary }]}>
                  {networkingData.completed
                    ? '✓ Profile complete — you can send introductions.'
                    : `Still needed: ${networkingData.missing.join(', ')}`}
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
  fieldLabel: {
    fontFamily: 'Inter_600SemiBold', fontSize: 12,
    textTransform: 'uppercase', letterSpacing: 0.6,
    marginBottom: 8, marginTop: 6,
  },
  input: {
    borderRadius: 14, borderWidth: 1,
    paddingHorizontal: 16, paddingVertical: 14,
    fontFamily: 'Inter_500Medium', fontSize: 15,
    marginBottom: 18,
  },
  bioInput: { minHeight: 105, paddingTop: 13 },
  helperText: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: -10, marginBottom: 18, lineHeight: 17 },
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
  photoButton: { alignItems: 'center', gap: 8, marginVertical: 5 },
  photo: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
  photoText: { fontFamily: 'Inter_400Regular', fontSize: 34 },
  photoLink: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  status: { borderRadius: 12, padding: 12, marginTop: 18 },
  statusText: { fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 },
});
