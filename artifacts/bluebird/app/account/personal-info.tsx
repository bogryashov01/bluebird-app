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
  const [weightKg, setWeightKg] = React.useState(user?.weightKg == null ? '' : String(user.weightKg));
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const updateMutation = useUpdateMe({
    mutation: {
      onSuccess: (data: any) => {
        if (user) updateUser({
          ...user,
          name: data.name,
          email: data.email ?? null,
          weightKg: data.weightKg ?? null,
        });
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
    weightKg !== (user?.weightKg == null ? '' : String(user.weightKg));

  const handleSave = () => {
    setErrorMsg(null);
    if (!name.trim()) { setErrorMsg('Name cannot be empty'); return; }
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) { setErrorMsg('Enter a valid email address'); return; }
    const trimmedWeight = weightKg.trim();
    const normalizedWeight = trimmedWeight === '' ? null : Number(trimmedWeight);
    if (
      trimmedWeight !== '' &&
      (normalizedWeight === null ||
        !Number.isFinite(normalizedWeight) ||
        normalizedWeight < 1 ||
        normalizedWeight > 500)
    ) {
      setErrorMsg('Weight must be between 1 and 500 kg');
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

        <Text style={[styles.fieldLabel, { color: colors.mutedForegroundLight }]}>Email (optional)</Text>
        <TextInput
          style={fieldStyle}
          value={email ?? ''}
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
  helperText: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: -10, marginBottom: 18, lineHeight: 17 },
  errorText: { fontFamily: 'Inter_500Medium', fontSize: 13, marginBottom: 12 },
  savedText: { fontFamily: 'Inter_500Medium', fontSize: 13, marginBottom: 12 },
  saveBtn: { borderRadius: 999, paddingVertical: 16, alignItems: 'center', marginTop: 6 },
  saveBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
});
