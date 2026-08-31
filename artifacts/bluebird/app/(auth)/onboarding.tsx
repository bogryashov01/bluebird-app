import React, { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useListAirports, useUpdateMe } from '@workspace/api-client-react';
import { AirportMultiSelect } from '@/components/AirportMultiSelect';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { token, updateUser } = useAuth();
  const [selected, setSelected] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { data: groups, isLoading, isError, refetch } = useListAirports();
  const updateMutation = useUpdateMe();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const continueOnboarding = () => {
    if (!token) {
      router.push('/(auth)/welcome');
      return;
    }
    setSaveError(null);
    updateMutation.mutate(
      { data: { homeAirports: selected } },
      {
        onSuccess: (updated) => {
          updateUser(updated);
          router.replace('/(tabs)/discover');
        },
        onError: (error: any) => {
          setSaveError(error?.error ?? error?.message ?? "Couldn't save your airports. Please try again.");
        },
      },
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundMid, paddingTop: topPad }]}>
      <StatusBar style={colors.scheme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <View style={[styles.logoCircle, { backgroundColor: colors.primary }]}>
          <Feather name="send" size={21} color={colors.primaryForeground} style={{ transform: [{ rotate: '-45deg' }] }} />
        </View>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.textOnBrand }]}>Where do you fly from?</Text>
          <Text style={[styles.subtitle, { color: colors.mutedOnBrand }]}>
            Choose one or more home airports for relevant Bluebird activity.
          </Text>
        </View>
      </View>

      <AirportMultiSelect
        groups={groups}
        selected={selected}
        onChange={setSelected}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        actionLabel="Continue"
        onAction={continueOnboarding}
        isSaving={updateMutation.isPending}
        saveError={saveError}
        bottomInset={bottomPad}
        secondaryLabel={token ? 'Skip for now' : 'Skip — go to sign in'}
        onSecondaryAction={() => router.replace(token ? '/(tabs)/discover' : '/(auth)/welcome')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  logoCircle: { width: 42, height: 42, borderRadius: 21, justifyContent: 'center', alignItems: 'center' },
  headerText: { flex: 1 },
  title: { fontSize: 24, lineHeight: 29, fontFamily: 'Inter_700Bold', letterSpacing: -0.4 },
  subtitle: { fontSize: 13, lineHeight: 18, fontFamily: 'Inter_400Regular', marginTop: 3 },
});