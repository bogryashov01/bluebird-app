import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUpdateMe } from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

export default function PersonalInfoScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { user, updateUser } = useAuth();

  const [name, setName]   = React.useState(user?.name ?? '');
  const [email, setEmail] = React.useState(user?.email ?? '');
  const [phone, setPhone] = React.useState(user?.phone ?? '');
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const updateMutation = useUpdateMe({
    mutation: {
      onSuccess: (data: any) => {
        if (user) updateUser({ ...user, name: data.name, email: data.email, phone: data.phone ?? null });
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      },
      onError: (err: any) => setErrorMsg(err?.response?.data?.error ?? 'Failed to save changes'),
    },
  });

  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const dirty =
    name !== (user?.name ?? '') ||
    email !== (user?.email ?? '') ||
    (phone ?? '') !== (user?.phone ?? '');

  const handleSave = () => {
    setErrorMsg(null);
    if (!name.trim()) { setErrorMsg('Name cannot be empty'); return; }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setErrorMsg('Enter a valid email address'); return; }
    updateMutation.mutate({ data: { name: name.trim(), email: email.trim(), phone: phone.trim() } });
  };

  const fieldStyle = [
    styles.input,
    { backgroundColor: colors.surface, color: colors.textOnSurface, borderColor: colors.border },
  ];

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: botPad + 40 }]}
        showsVerticalScrollIndicator={false}
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

        <Text style={[styles.fieldLabel, { color: colors.mutedForegroundLight }]}>Email</Text>
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
          style={fieldStyle}
          value={phone ?? ''}
          onChangeText={setPhone}
          placeholder="+1 (555) 000-0000"
          placeholderTextColor={colors.mutedForegroundLight}
          keyboardType="phone-pad"
        />

        {errorMsg && <Text style={[styles.errorText, { color: colors.destructive }]}>{errorMsg}</Text>}
        {saved && <Text style={[styles.savedText, { color: colors.primary }]}>✓ Changes saved</Text>}

        <TouchableOpacity
          style={[
            styles.saveBtn,
            { backgroundColor: colors.primary, opacity: dirty && !updateMutation.isPending ? 1 : 0.5 },
          ]}
          activeOpacity={0.85}
          disabled={!dirty || updateMutation.isPending}
          onPress={handleSave}
        >
          {updateMutation.isPending
            ? <ActivityIndicator color={colors.primaryForeground} />
            : <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>Save changes</Text>}
        </TouchableOpacity>
      </ScrollView>
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
  errorText: { fontFamily: 'Inter_500Medium', fontSize: 13, marginBottom: 12 },
  savedText: { fontFamily: 'Inter_500Medium', fontSize: 13, marginBottom: 12 },
  saveBtn: { borderRadius: 999, paddingVertical: 16, alignItems: 'center', marginTop: 6 },
  saveBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
});
