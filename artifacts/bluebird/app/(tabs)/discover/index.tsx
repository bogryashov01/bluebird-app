import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, ActivityIndicator, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useListFlights } from '@workspace/api-client-react';
import FlightCard, { FlightData } from '@/components/FlightCard';
import { useAuth } from '@/context/AuthContext';

const FILTERS = ['All', 'Today', 'International', 'Short Hop'];

export default function DiscoverScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [activeFilter, setActiveFilter] = useState('All');

  const { data: flights, isLoading, isError, refetch, isRefetching } = useListFlights({});

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const filteredFlights = React.useMemo(() => {
    if (!flights) return [];
    const today = new Date().toISOString().slice(0, 10);
    switch (activeFilter) {
      case 'Today':
        return flights.filter((f: FlightData) => f.departureDate === today);
      case 'International':
        return flights.filter((f: FlightData) => {
          const intlKeywords = ['TEB', 'MIA', 'JFK', 'LHR', 'CDG'];
          return intlKeywords.some(k => f.fromAirport === k || f.toAirport === k);
        });
      case 'Short Hop':
        return flights.filter((f: FlightData) => {
          const [h] = f.duration.split('h');
          return parseInt(h) < 2;
        });
      default:
        return flights;
    }
  }, [flights, activeFilter]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 16 }]}>
        <View>
          <Text style={[styles.greeting, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Good morning{user?.name ? `, ${user.name.split(' ')[0]}` : ''}
          </Text>
          <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
            Discover
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.notifBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
          onPress={() => router.push('/notifications')}
        >
          <Feather name="bell" size={18} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      {/* Filter chips */}
      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f}
            style={[
              styles.filterChip,
              { borderColor: f === activeFilter ? colors.primary : colors.border, backgroundColor: f === activeFilter ? colors.primary + '20' : 'transparent' },
            ]}
            onPress={() => setActiveFilter(f)}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.filterChipText,
                { color: f === activeFilter ? colors.primary : colors.mutedForeground, fontFamily: 'Inter_500Medium' },
              ]}
            >
              {f}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Flight list */}
      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : isError ? (
        <View style={styles.centered}>
          <Feather name="wifi-off" size={32} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Could not load flights
          </Text>
          <TouchableOpacity style={[styles.retryBtn, { borderColor: colors.border }]} onPress={() => refetch()}>
            <Text style={[styles.retryText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : filteredFlights.length === 0 ? (
        <View style={styles.centered}>
          <Feather name="send" size={32} color={colors.mutedForeground} style={{ transform: [{ rotate: '-45deg' }] }} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            No flights available right now
          </Text>
          <Text style={[styles.emptySubText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Check back soon for new empty legs
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredFlights as FlightData[]}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <FlightCard
              flight={item}
              onPress={() => router.push(`/flight/${item.id}`)}
            />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
    paddingHorizontal: 20, paddingBottom: 16,
  },
  greeting: { fontSize: 13, marginBottom: 2 },
  headerTitle: { fontSize: 28 },
  notifBtn: {
    width: 40, height: 40, borderRadius: 12,
    borderWidth: 1, justifyContent: 'center', alignItems: 'center',
  },
  filterRow: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingBottom: 16, flexWrap: 'wrap',
  },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1,
  },
  filterChipText: { fontSize: 13 },
  listContent: { paddingTop: 4, paddingBottom: 120 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  emptyText: { fontSize: 16, marginTop: 4 },
  emptySubText: { fontSize: 13 },
  retryBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10, marginTop: 4 },
  retryText: { fontSize: 14 },
});
