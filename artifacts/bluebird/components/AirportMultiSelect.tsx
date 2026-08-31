import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { AirportGroup, AirportInfo } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import {
  filterAirportGroups,
  groupSelectionState,
  toggleAirport,
  toggleAirportGroup,
  type GroupSelectionState,
} from './airport-selection';

type ListRow =
  | { kind: 'group'; group: AirportGroup; visibleAirports: AirportInfo[] }
  | { kind: 'airport'; airport: AirportInfo };

interface AirportMultiSelectProps {
  groups?: AirportGroup[];
  selected: string[];
  onChange: (codes: string[]) => void;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  actionLabel: string;
  onAction: () => void;
  isSaving?: boolean;
  saveError?: string | null;
  bottomInset?: number;
  secondaryLabel?: string;
  onSecondaryAction?: () => void;
}

export function AirportMultiSelect({
  groups,
  selected,
  onChange,
  isLoading,
  isError,
  onRetry,
  actionLabel,
  onAction,
  isSaving = false,
  saveError,
  bottomInset = 0,
  secondaryLabel,
  onSecondaryAction,
}: AirportMultiSelectProps) {
  const colors = useColors();
  const [search, setSearch] = useState('');
  const filteredGroups = useMemo(() => filterAirportGroups(groups ?? [], search), [groups, search]);
  const sourceByCity = useMemo(
    () => new Map((groups ?? []).map((group) => [group.city, group])),
    [groups],
  );
  const rows = useMemo<ListRow[]>(
    () =>
      filteredGroups.flatMap((filteredGroup) => {
        const fullGroup = sourceByCity.get(filteredGroup.city) ?? filteredGroup;
        return [
          { kind: 'group' as const, group: fullGroup, visibleAirports: filteredGroup.airports },
          ...filteredGroup.airports.map((airport) => ({ kind: 'airport' as const, airport })),
        ];
      }),
    [filteredGroups, sourceByCity],
  );

  const checkbox = (state: GroupSelectionState) => (
    <View
      style={[
        styles.checkbox,
        {
          backgroundColor: state === 'none' ? colors.card : colors.primary,
          borderColor: state === 'none' ? colors.border : colors.primary,
        },
      ]}
    >
      {state === 'all' && <Feather name="check" size={15} color={colors.primaryForeground} />}
      {state === 'partial' && <Feather name="minus" size={15} color={colors.primaryForeground} />}
    </View>
  );

  return (
    <View style={styles.container}>
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
        {!!search && (
          <TouchableOpacity onPress={() => setSearch('')} accessibilityLabel="Clear search" hitSlop={8}>
            <Feather name="x" size={17} color={colors.mutedForeground} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.selectionBar}>
        <Text style={[styles.selectionText, { color: colors.mutedForeground }]}>
          {selected.length === 0
            ? 'No airports selected'
            : `${selected.length} airport${selected.length === 1 ? '' : 's'} selected`}
        </Text>
        {selected.length > 0 && (
          <TouchableOpacity onPress={() => onChange([])} disabled={isSaving}>
            <Text style={[styles.clearText, { color: colors.primary }]}>Clear selections</Text>
          </TouchableOpacity>
        )}
      </View>

      {saveError ? <Text style={[styles.errorText, { color: colors.destructive }]}>{saveError}</Text> : null}

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Loading airports…</Text>
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Feather name="wifi-off" size={26} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Couldn&apos;t load airports.</Text>
          <TouchableOpacity style={[styles.retryButton, { backgroundColor: colors.primary }]} onPress={onRetry}>
            <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.kind === 'group' ? `group-${row.group.city}` : row.airport.code}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.listContent, { paddingBottom: 16 }]}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                No airports match &quot;{search}&quot;
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            if (item.kind === 'group') {
              const state = groupSelectionState(item.group, selected);
              return (
                <TouchableOpacity
                  style={[styles.groupRow, { backgroundColor: colors.muted, borderColor: colors.border }]}
                  onPress={() => onChange(toggleAirportGroup(selected, item.group))}
                  disabled={isSaving}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: state === 'partial' ? 'mixed' : state === 'all' }}
                >
                  {checkbox(state)}
                  <Text style={[styles.groupText, { color: colors.foreground }]} numberOfLines={2}>
                    {item.group.city} — All Airports
                  </Text>
                </TouchableOpacity>
              );
            }
            const checked = selected.includes(item.airport.code);
            return (
              <TouchableOpacity
                style={[styles.airportRow, { backgroundColor: colors.card, borderColor: checked ? colors.primary : colors.border }]}
                onPress={() => onChange(toggleAirport(selected, item.airport.code))}
                disabled={isSaving}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
              >
                {checkbox(checked ? 'all' : 'none')}
                <View style={styles.codeBadge}>
                  <Text style={[styles.codeText, { color: colors.primary }]}>{item.airport.code}</Text>
                </View>
                <View style={styles.airportText}>
                  <Text style={[styles.airportName, { color: colors.foreground }]} numberOfLines={1}>
                    {item.airport.name}
                  </Text>
                  <Text style={[styles.airportMeta, { color: colors.mutedForeground }]}>
                    {item.airport.flightCount ?? 0} flights
                  </Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      <View style={[styles.footer, { borderTopColor: colors.border, paddingBottom: bottomInset + 12 }]}>
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: colors.primary, opacity: isSaving || isLoading || isError ? 0.6 : 1 }]}
          onPress={onAction}
          disabled={isSaving || isLoading || isError}
        >
          {isSaving ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={[styles.actionText, { color: colors.primaryForeground }]}>{actionLabel}</Text>
          )}
        </TouchableOpacity>
        {secondaryLabel && onSecondaryAction ? (
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={onSecondaryAction}
            disabled={isSaving}
          >
            <Text style={[styles.secondaryText, { color: colors.mutedForeground }]}>{secondaryLabel} →</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0 },
  searchWrap: {
    height: 46, marginHorizontal: 20, marginBottom: 8, paddingHorizontal: 14,
    borderRadius: 14, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  searchInput: {
    flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null),
  },
  selectionBar: {
    minHeight: 34, paddingHorizontal: 20, flexDirection: 'row',
    justifyContent: 'space-between', alignItems: 'center', gap: 12,
  },
  selectionText: { fontSize: 12, fontFamily: 'Inter_400Regular', flexShrink: 1 },
  clearText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  errorText: { fontSize: 12, lineHeight: 17, fontFamily: 'Inter_500Medium', paddingHorizontal: 20, paddingBottom: 6 },
  listContent: { paddingHorizontal: 20, gap: 8 },
  groupRow: {
    minHeight: 48, borderRadius: 14, borderWidth: 1, paddingHorizontal: 13,
    flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 5,
  },
  groupText: { flex: 1, fontSize: 14, lineHeight: 19, fontFamily: 'Inter_700Bold' },
  airportRow: {
    minHeight: 58, borderRadius: 14, borderWidth: 1, paddingHorizontal: 13,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  codeBadge: { width: 42, alignItems: 'center' },
  codeText: { fontSize: 13, fontFamily: 'Inter_700Bold', letterSpacing: 0.4 },
  airportText: { flex: 1 },
  airportName: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  airportMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  center: { flex: 1, minHeight: 150, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20 },
  emptyText: { fontSize: 14, lineHeight: 20, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  retryButton: { minHeight: 42, borderRadius: 999, paddingHorizontal: 22, justifyContent: 'center' },
  retryText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1 },
  actionButton: { height: 52, borderRadius: 999, justifyContent: 'center', alignItems: 'center' },
  actionText: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  secondaryButton: { minHeight: 36, alignItems: 'center', justifyContent: 'flex-end' },
  secondaryText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
});