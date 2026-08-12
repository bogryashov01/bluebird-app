import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useListAirports, useUpdateMe, type AirportInfo } from '@workspace/api-client-react';
import { useAuth, type AuthUser } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

// Airport picker for the member's saved home airport. Opened from
// Notification Settings; saves the choice to the account via PATCH /auth/me.
export default function AirportPickerScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { user, updateUser } = useAuth();
  const [search, setSearch] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const { data: airports, isLoading, isError, refetch } = useListAirports();
  const updateMutation = useUpdateMe();

  const topPad = Platform.OS === 'web' ? 60 : insets.top;
  const current = user?.homeAirport ?? null;

  const filtered = useMemo(() => {
    if (!airports) return [];
    const q = search.trim().toLowerCase();
    if (!q) return airports;
    return airports.filter(
      (a) =>
        a.code.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.city.toLowerCase().includes(q),
    );
  }, [airports, search]);

  const selectAirport = (a: AirportInfo) => {
    if (updateMutation.isPending) return;
    setSaveError(null);
    updateMutation.mutate(
      { data: { homeAirport: a.code } },
      {
        onSuccess: (updated) => {
          updateUser(updated as AuthUser);
          router.back();
        },
        onError: (err: any) => {
          setSaveError(err?.error ?? "Couldn't save your home airport. Please try again.");
        },
      },
    );
  };

  const renderAirport = ({ item }: { item: AirportInfo }) => {
    const isCurrent = item.code === current;
    return (
      <TouchableOpacity
        style={[
          styles.row,
          { backgroundColor: colors.card, borderColor: isCurrent ? colors.primary : colors.border },
        ]}
        onPress={() => selectAirport(item)}
        activeOpacity={0.75}
        disabled={updateMutation.isPending}
      >
        <View style={[styles.codeBadge, { backgroundColor: colors.primary + '14' }]}>
          <Text style={[styles.codeText, { color: colors.primary }]}>{item.code}</Text>
        </View>
        <View style={styles.rowText}>
          <Text style={[styles.rowName, { color: colors.foreground }]} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={[styles.rowCity, { color: colors.mutedForeground }]} numberOfLines={1}>
            {item.city} · {item.flightCount} flights
          </Text>
        </View>
        {isCurrent ? (
          <Feather name="check-circle" size={18} color={colors.primary} />
        ) : (
          <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.offWhite, paddingTop: topPad }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={[styles.backBtn, { backgroundColor: colors.muted }]}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Text style={[styles.backChevron, { color: colors.textOnSurface }]}>‹</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.textOnSurface }]}>Home Airport</Text>
        {updateMutation.isPending && <ActivityIndicator color={colors.primary} size="small" />}
      </View>
      <Text style={[styles.subtitle, { color: colors.mutedForegroundLight }]}>
        Pick the airport you usually fly from. We'll save it to your account.
      </Text>

      <View style={[styles.searchWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name="search" size={16} color={colors.mutedForeground} />
        <TextInput
          style={[styles.searchInput, { color: colors.foreground }]}
          placeholder="Search airport, code, or city"
          placeholderTextColor={colors.mutedForeground}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="x" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        )}
      </View>

      {saveError && (
        <Text style={[styles.errorText, { color: colors.destructive }]}>{saveError}</Text>
      )}

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Feather name="wifi-off" size={26} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Couldn't load airports.</Text>
          <TouchableOpacity
            style={[styles.retryBtn, { backgroundColor: colors.primary }]}
            onPress={() => refetch()}
            activeOpacity={0.85}
          >
            <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.code}
          renderItem={renderAirport}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40, gap: 10 }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                No airports match "{search}"
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  backChevron: { fontFamily: 'Inter_500Medium', fontSize: 22, marginTop: -2 },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 20, flex: 1 },
  subtitle: {
    fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20,
    paddingHorizontal: 20, marginBottom: 14,
  },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 20, marginBottom: 14,
    borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, height: 46,
  },
  searchInput: {
    flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null),
  },
  errorText: {
    fontFamily: 'Inter_500Medium', fontSize: 13,
    paddingHorizontal: 20, marginBottom: 10,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 18, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 13,
  },
  codeBadge: {
    width: 52, height: 40, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center',
  },
  codeText: { fontSize: 14, fontFamily: 'Inter_700Bold', letterSpacing: 0.5 },
  rowText: { flex: 1 },
  rowName: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  rowCity: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  center: { alignItems: 'center', gap: 10, paddingVertical: 40 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  retryBtn: { borderRadius: 999, paddingHorizontal: 22, height: 42, justifyContent: 'center', marginTop: 4 },
  retryText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
});
