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
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useListAirports, type AirportInfo } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const [search, setSearch] = useState('');
  const { data: airports, isLoading, isError, refetch } = useListAirports();

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const isDark = colors.scheme === 'dark';

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
    router.push({ pathname: '/(auth)/airport-summary', params: { code: a.code } });
  };

  const renderAirport = ({ item }: { item: AirportInfo }) => (
    <TouchableOpacity
      style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => selectAirport(item)}
      activeOpacity={0.75}
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
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundMid, paddingTop: topPad }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <View style={styles.header}>
        <View style={[styles.logoCircle, { backgroundColor: colors.primary + '1A' }]}>
          <Feather name="send" size={22} color={colors.primary} style={{ transform: [{ rotate: '-45deg' }] }} />
        </View>
        <Text style={[styles.title, { color: colors.textOnBrand }]}>Where do you fly from?</Text>
        <Text style={[styles.subtitle, { color: colors.mutedOnBrand }]}>
          Pick your home airport to see real Bluebird activity near you.
        </Text>
      </View>

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
          contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: bottomPad + 80, gap: 10 }}
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

      <View style={[styles.footer, { paddingBottom: bottomPad + 16 }]}>
        <TouchableOpacity onPress={() => router.push('/(auth)/welcome')} activeOpacity={0.8}>
          <Text style={[styles.skipText, { color: colors.mutedOnBrand }]}>
            Skip — go to sign in <Text style={{ color: colors.primary }}>→</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 18, alignItems: 'flex-start' },
  logoCircle: {
    width: 48, height: 48, borderRadius: 24,
    justifyContent: 'center', alignItems: 'center', marginBottom: 16,
  },
  title: {
    fontSize: 28, fontFamily: 'Inter_700Bold', letterSpacing: -0.5, lineHeight: 34,
  },
  subtitle: {
    fontSize: 15, fontFamily: 'Inter_400Regular', marginTop: 8, lineHeight: 22,
  },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 24, marginBottom: 14,
    borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, height: 46,
  },
  searchInput: {
    flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null),
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
  footer: { paddingHorizontal: 24, paddingTop: 10, alignItems: 'center' },
  skipText: { fontSize: 14, fontFamily: 'Inter_500Medium' },
});
