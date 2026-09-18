import React from 'react';
import {
  ActivityIndicator, Image, KeyboardAvoidingView, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { File as ExpoFile } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGetNetworkingProfile, useRequestUploadUrl, useUpdateNetworkingProfile } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';

type ProfilePhotoContentType = 'image/jpeg' | 'image/png' | 'image/webp';

function toPhotoUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const baseUrl = process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : '';
  return `${baseUrl}${path.startsWith('/api/') ? path : `/api/storage${path}`}`;
}

export default function NetworkingProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useGetNetworkingProfile({
    query: { enabled: !!user && user.membershipTier !== 'none', refetchOnMount: 'always' },
  });
  const save = useUpdateNetworkingProfile();
  const uploadPhoto = useRequestUploadUrl();
  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [industry, setIndustry] = React.useState('');
  const [bio, setBio] = React.useState('');
  const [linkedinUrl, setLinkedinUrl] = React.useState('');
  const [instagramUrl, setInstagramUrl] = React.useState('');
  const [photoUrl, setPhotoUrl] = React.useState<string | null>(null);
  const [photoAssetPath, setPhotoAssetPath] = React.useState<string | null>(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = React.useState(false);
  const [error, setError] = React.useState('');
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    if (!data) return;
    setFirstName(data.firstName);
    setLastName(data.lastName);
    setIndustry(data.industry);
    setBio(data.bio);
    setLinkedinUrl(data.linkedinUrl ?? '');
    setInstagramUrl(data.instagramUrl ?? '');
    setPhotoUrl(data.photoUrl ?? null);
    setPhotoAssetPath(data.photoAssetPath ?? null);
  }, [data]);

  const choosePhoto = async () => {
    setError('');
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'] as any,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.75,
      });
      const asset = result.canceled ? null : result.assets[0];
      if (!asset) return;
      const contentType = asset.mimeType?.toLowerCase() as ProfilePhotoContentType | undefined;
      if (!contentType || !['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
        setError('Choose a JPEG, PNG, or WebP profile photo.');
        return;
      }
      const file = new ExpoFile(asset.uri);
      const size = asset.fileSize ?? file.size;
      if (!size || size > 1_500_000) {
        setError('Profile photos must be smaller than 1.5 MB.');
        return;
      }
      setIsUploadingPhoto(true);
      const upload = await uploadPhoto.mutateAsync({
        data: {
          name: asset.fileName ?? `profile.${contentType.slice('image/'.length).replace('jpeg', 'jpg')}`,
          size,
          contentType,
        },
      });
      const body = Platform.OS === 'web'
        ? await (await fetch(asset.uri)).blob()
        : file;
      const response = await expoFetch(upload.uploadURL, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: body as any,
      });
      if (!response.ok) throw new Error('Photo upload failed');
      setPhotoAssetPath(upload.objectPath);
      setPhotoUrl(toPhotoUrl(upload.objectPath));
    } catch (uploadError: any) {
      setError(uploadError?.data?.error ?? uploadError?.message ?? 'Could not upload your profile photo.');
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const submit = () => {
    setError('');
    if (!firstName.trim() || !lastName.trim() || !industry.trim() || !bio.trim() || (!photoUrl && !photoAssetPath)) {
      setError('Add your name, photo, industry, and a short bio to complete your profile.');
      return;
    }
    save.mutate({
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
        setSaved(true);
        queryClient.invalidateQueries({ queryKey: ['/api/networking/profile'] });
        setTimeout(() => setSaved(false), 2200);
      },
      onError: (err: any) => setError(err?.data?.error ?? err?.message ?? 'Could not save your profile.'),
    });
  };

  if (user?.membershipTier === 'none') {
    return (
      <View style={[styles.center, { backgroundColor: colors.offWhite }]}>
        <Text style={[styles.title, { color: colors.textOnSurface }]}>Networking is for members</Text>
        <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>Join a Bluebird membership to create your networking profile.</Text>
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.primary, width: '100%' }]} onPress={() => router.push('/membership/plans' as any)}>
          <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>View membership plans</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (isLoading) return <View style={[styles.center, { backgroundColor: colors.offWhite }]}><ActivityIndicator color={colors.primary} /></View>;
  if (isError || !data) {
    return (
      <View style={[styles.center, { backgroundColor: colors.offWhite }]}>
        <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>We couldn't load your networking profile.</Text>
        <TouchableOpacity onPress={() => refetch()}><Text style={[styles.link, { color: colors.primary }]}>Try again</Text></TouchableOpacity>
      </View>
    );
  }

  const field = (label: string, value: string, onChangeText: (value: string) => void, placeholder: string, multiline = false) => (
    <React.Fragment key={label}>
      <Text style={[styles.label, { color: colors.mutedForegroundLight }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForegroundLight}
        multiline={multiline}
        style={[styles.input, multiline && styles.bioInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.textOnSurface }]}
        textAlignVertical={multiline ? 'top' : 'center'}
        maxLength={multiline ? 280 : 80}
      />
    </React.Fragment>
  );

  return (
    <KeyboardAvoidingView style={[styles.root, { backgroundColor: colors.offWhite }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.intro}>
          <Text style={[styles.title, { color: colors.textOnSurface }]}>Your flight network</Text>
          <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>Share enough to make relevant introductions before a shared flight. Your full profile is only shown after you connect.</Text>
        </View>
        <TouchableOpacity onPress={choosePhoto} disabled={isUploadingPhoto} activeOpacity={0.8} style={styles.photoButton}>
          {photoUrl ? <Image source={{ uri: photoUrl }} style={styles.photo} /> : <View style={[styles.photo, { backgroundColor: colors.backgroundMid }]}><Text style={[styles.photoText, { color: colors.textOnBrand }]}>+</Text></View>}
          <Text style={[styles.photoLink, { color: colors.primary }]}>{isUploadingPhoto ? 'Uploading profile photo…' : photoUrl ? 'Change profile photo' : 'Add profile photo'}</Text>
        </TouchableOpacity>
        {field('First name', firstName, setFirstName, 'First name')}
        {field('Last name', lastName, setLastName, 'Last name')}
        {field('Industry or category', industry, setIndustry, 'e.g. Venture capital')}
        {field('Short bio', bio, setBio, 'Write a short discrption about yourself.', true)}
        {field('LinkedIn (optional)', linkedinUrl, setLinkedinUrl, 'https://linkedin.com/in/you')}
        {field('Instagram (optional)', instagramUrl, setInstagramUrl, 'https://instagram.com/you')}
        <View style={[styles.status, { backgroundColor: data.completed ? colors.success + '16' : colors.primary + '12' }]}>
          <Text style={[styles.statusText, { color: data.completed ? colors.success : colors.primary }]}>
            {data.completed ? '✓ Profile complete — you can send introductions.' : `Still needed: ${data.missing.join(', ')}`}
          </Text>
        </View>
        {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
        {saved ? <Text style={[styles.saved, { color: colors.success }]}>Saved across your devices.</Text> : null}
        <TouchableOpacity onPress={submit} disabled={save.isPending} activeOpacity={0.8} style={[styles.button, { backgroundColor: colors.primary, opacity: save.isPending ? 0.6 : 1 }]}>
          {save.isPending ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Save profile</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: 18, gap: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  intro: { gap: 7, marginBottom: 12 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 23, letterSpacing: -0.4 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 },
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 14, marginBottom: 7 },
  input: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13, fontFamily: 'Inter_400Regular', fontSize: 15 },
  bioInput: { minHeight: 105, paddingTop: 13 },
  photoButton: { alignItems: 'center', gap: 8, marginVertical: 5 },
  photo: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
  photoText: { fontFamily: 'Inter_400Regular', fontSize: 34 },
  photoLink: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  status: { borderRadius: 12, padding: 12, marginTop: 18 },
  statusText: { fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 },
  error: { fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18, marginTop: 12 },
  saved: { fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 12 },
  link: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  button: { borderRadius: 999, paddingVertical: 16, alignItems: 'center', marginTop: 18 },
  buttonText: { fontFamily: 'Inter_700Bold', fontSize: 15 },
});