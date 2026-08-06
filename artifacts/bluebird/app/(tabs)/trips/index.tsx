import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Platform, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useListTrips } from '@workspace/api-client-react';

type TripStatus = 'upcoming' | 'completed' | 'cancelled';

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function TripsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<TripStatus>('upcoming');

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const { data: trips, isLoading, refetch, isRefetching } = useListTrips({});

  const filtered = React.useMemo(() => {
    if (!trips) return [];
    return (trips as any[]).filter((t) => t.status === activeTab);
  }, [trips, activeTab]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 16 }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>My Trips</Text>
      </View>

      {/* Tabs */}
      <View style={[styles.tabRow, { borderBottomColor: colors.border }]}>
        {(['upcoming', 'completed'] as TripStatus[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tabItem, activeTab === tab && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[
              styles.tabLabel,
              { color: activeTab === tab ? colors.primary : colors.mutedForeground, fontFamily: activeTab === tab ? 'Inter_600SemiBold' : 'Inter_400Regular' }
            ]}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.centered}>
          <Feather name="briefcase" size={36} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
            No {activeTab} trips
          </Text>
          <Text style={[styles.emptyBody, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            {activeTab === 'upcoming'
              ? 'Join a queue to get your first flight.'
              : 'Completed trips will appear here.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.listContent, { paddingBottom: bottomPad + 80 }]}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          renderItem={({ item }) => {
            const flight = item.flight;
            return (
              <View style={[styles.tripCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.tripHeader}>
                  <View style={styles.routeRow}>
                    <Text style={[styles.airportCode, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
                      {flight?.fromAirport ?? '?'}
                    </Text>
                    <Feather name="send" size={14} color={colors.primary} style={{ transform: [{ rotate: '-45deg' }] }} />
                    <Text style={[styles.airportCode, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
                      {flight?.toAirport ?? '?'}
                    </Text>
                  </View>
                  <View style={[
                    styles.statusBadge,
                    { backgroundColor: activeTab === 'upcoming' ? colors.primary + '20' : colors.mutedForeground + '20' }
                  ]}>
                    <Text style={[styles.statusText, { color: activeTab === 'upcoming' ? colors.primary : colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
                      {activeTab === 'upcoming' ? 'Upcoming' : 'Completed'}
                    </Text>
                  </View>
                </View>

                <View style={[styles.tripDetails, { borderTopColor: colors.border }]}>
                  <View style={styles.detailRow}>
                    <Feather name="map-pin" size={13} color={colors.mutedForeground} />
                    <Text style={[styles.detailText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                      {flight?.fromCity ?? ''} → {flight?.toCity ?? ''}
                    </Text>
                  </View>
                  {flight && (
                    <>
                      <View style={styles.detailRow}>
                        <Feather name="calendar" size={13} color={colors.mutedForeground} />
                        <Text style={[styles.detailText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                          {formatDate(flight.departureDate)} · {flight.departureTime}
                        </Text>
                      </View>
                      <View style={styles.detailRow}>
                        <Feather name="send" size={13} color={colors.mutedForeground} />
                        <Text style={[styles.detailText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                          {flight.aircraftType}
                        </Text>
                      </View>
                    </>
                  )}
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  headerTitle: { fontSize: 28 },
  tabRow: { flexDirection: 'row', borderBottomWidth: 1, marginHorizontal: 20, marginBottom: 16 },
  tabItem: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabLabel: { fontSize: 14 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  emptyTitle: { fontSize: 18 },
  emptyBody: { fontSize: 14, lineHeight: 22, textAlign: 'center', paddingHorizontal: 32 },
  listContent: { padding: 16, gap: 12 },
  tripCard: { borderRadius: 16, borderWidth: 1, overflow: 'hidden', padding: 16 },
  tripHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  airportCode: { fontSize: 22 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusText: { fontSize: 12 },
  tripDetails: { borderTopWidth: 1, paddingTop: 12, gap: 8 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailText: { fontSize: 13 },
});
