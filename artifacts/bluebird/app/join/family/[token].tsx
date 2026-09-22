import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAcceptFamilyInvitation } from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

export default function FamilyInvitationScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [error, setError] = React.useState<string | null>(null);
  const acceptMutation = useAcceptFamilyInvitation({
    mutation: {
      onSuccess: () => router.replace('/membership/family' as any),
      onError: (err: any) => setError(err?.response?.data?.error ?? err?.data?.error ?? 'This invitation could not be accepted.'),
    },
  });

  if (!user) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.offWhite }]}>
        <Text style={[styles.title, { color: colors.textOnSurface }]}>Family invitation</Text>
        <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>Sign in with the invited email address, then open this link again to activate Family Plus access.</Text>
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.primary }]} onPress={() => router.replace('/(auth)/phone' as any)}>
          <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Sign in</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.centered, { backgroundColor: colors.offWhite, padding: 28 }]}>
      <Text style={[styles.title, { color: colors.textOnSurface }]}>Join Family/Corporate</Text>
      <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>Accept this invitation to receive Plus access under the primary holder's annual plan.</Text>
      {!!error && <Text style={[styles.body, { color: colors.destructive }]}>{error}</Text>}
      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.primary, opacity: acceptMutation.isPending ? 0.7 : 1 }]}
        disabled={acceptMutation.isPending || !token}
        onPress={() => token && acceptMutation.mutate({ token })}
      >
        {acceptMutation.isPending ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Accept invitation</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 24, textAlign: 'center' },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 10, marginBottom: 20 },
  button: { borderRadius: 999, paddingHorizontal: 24, paddingVertical: 14, minWidth: 180, alignItems: 'center' },
  buttonText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
});