import React, { useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useListAirports, useUpdateMe } from '@workspace/api-client-react';
import { AirportMultiSelect } from '@/components/AirportMultiSelect';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

export default function AirportPickerScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { user, updateUser } = useAuth();
  const [selected, setSelected] = useState<string[]>(() => user?.homeAirports ?? []);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { data: groups, isLoading, isError, refetch } = useListAirports();
  const updateMutation = useUpdateMe();
  const topPad = Platform.OS === 'web' ? 60 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

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
        onChange={setSelected}
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

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  backButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  backChevron: { fontFamily: 'Inter_500Medium', fontSize: 22, marginTop: -2 },
  headerText: { flex: 1 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 20 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, marginTop: 2 },
});