import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform, Alert,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useGetFlight } from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

export default function FlightDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const { data: flight, isLoading, isError } = useGetFlight(id!);

  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (isError || !flight) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>Flight not found</Text>
      </View>
    );
  }

  // @ts-ignore
  const f = flight as any;

  const handleJoinQueue = () => {
    router.push({ pathname: '/queue/join', params: { flightId: f.id, fromCity: f.fromCity, toCity: f.toCity, from: f.fromAirport, to: f.toAirport } });
  };

  const handleSkipLine = () => {
    if (!user || user.linePassCount < 1) {
      Alert.alert('No Line Passes', 'Upgrade to Plus or Concierge membership to get Skip the Line passes.', [
        { text: 'View Membership', onPress: () => router.push('/(tabs)/membership') },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }
    router.push({ pathname: '/queue/join', params: { flightId: f.id, fromCity: f.fromCity, toCity: f.toCity, from: f.fromAirport, to: f.toAirport, useLinePass: '1' } });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad + 100 }]} showsVerticalScrollIndicator={false}>
        {/* Aircraft hero */}
        <View style={[styles.hero, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.heroIconBg, { backgroundColor: colors.primary + '20', borderColor: colors.primary + '30' }]}>
            <Feather name="send" size={48} color={colors.primary} style={{ transform: [{ rotate: '-45deg' }] }} />
          </View>
          <Text style={[styles.heroAircraft, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            {f.aircraftType}
          </Text>
        </View>

        {/* Route */}
        <View style={styles.section}>
          <View style={styles.routeRow}>
            <View style={styles.airportBlock}>
              <Text style={[styles.airportCode, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>{f.fromAirport}</Text>
              <Text style={[styles.cityName, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{f.fromCity}</Text>
            </View>
            <View style={styles.routeCenter}>
              <View style={[styles.routeLine, { backgroundColor: colors.border }]} />
              <Feather name="send" size={16} color={colors.primary} style={{ transform: [{ rotate: '-45deg' }] }} />
              <View style={[styles.routeLine, { backgroundColor: colors.border }]} />
            </View>
            <View style={[styles.airportBlock, { alignItems: 'flex-end' }]}>
              <Text style={[styles.airportCode, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>{f.toAirport}</Text>
              <Text style={[styles.cityName, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{f.toCity}</Text>
            </View>
          </View>
        </View>

        {/* Details card */}
        <View style={[styles.detailCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {[
            { icon: 'calendar', label: 'Date', value: formatDate(f.departureDate) },
            { icon: 'clock', label: 'Departure', value: f.departureTime },
            { icon: 'activity', label: 'Duration', value: f.duration },
            { icon: 'users', label: 'Seats available', value: `${f.seatsAvailable} of ${f.aircraftCapacity}` },
          ].map((row, i) => (
            <React.Fragment key={row.label}>
              {i > 0 && <View style={[styles.separator, { backgroundColor: colors.border }]} />}
              <View style={styles.detailRow}>
                <View style={styles.detailLeft}>
                  <Feather name={row.icon as any} size={16} color={colors.mutedForeground} />
                  <Text style={[styles.detailLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{row.label}</Text>
                </View>
                <Text style={[styles.detailValue, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>{row.value}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>

        {/* Policy link */}
        <TouchableOpacity
          style={[styles.policyLink, { borderColor: colors.border }]}
          onPress={() => router.push('/flight/policy')}
          activeOpacity={0.7}
        >
          <Feather name="file-text" size={16} color={colors.mutedForeground} />
          <Text style={[styles.policyText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            View Flight Policy & Terms
          </Text>
          <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
        </TouchableOpacity>
      </ScrollView>

      {/* CTA buttons */}
      <View style={[styles.ctaBar, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: bottomPad + 12 }]}>
        {user && user.linePassCount > 0 && (
          <TouchableOpacity
            style={[styles.skipBtn, { backgroundColor: colors.secondary, borderColor: colors.primary + '60' }]}
            onPress={handleSkipLine}
            activeOpacity={0.8}
          >
            <Feather name="zap" size={16} color={colors.primary} />
            <Text style={[styles.skipBtnText, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>
              Skip the Line ({user.linePassCount})
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.queueBtn, { backgroundColor: colors.primary }]} onPress={handleJoinQueue} activeOpacity={0.8}>
          <Text style={[styles.queueBtnText, { color: '#fff', fontFamily: 'Inter_600SemiBold' }]}>Join the Queue</Text>
          <Feather name="arrow-right" size={18} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { fontSize: 16 },
  scrollContent: { paddingTop: 8 },
  hero: {
    marginHorizontal: 16, marginBottom: 8, borderRadius: 16, borderWidth: 1,
    padding: 32, justifyContent: 'center', alignItems: 'center', gap: 16,
  },
  heroIconBg: {
    width: 100, height: 100, borderRadius: 50,
    borderWidth: 1, justifyContent: 'center', alignItems: 'center',
  },
  heroAircraft: { fontSize: 14 },
  section: { paddingHorizontal: 16, marginVertical: 16 },
  routeRow: { flexDirection: 'row', alignItems: 'center' },
  airportBlock: { flex: 1 },
  airportCode: { fontSize: 32 },
  cityName: { fontSize: 14, marginTop: 2 },
  routeCenter: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 6 },
  routeLine: { flex: 1, height: 1, width: 30 },
  detailCard: {
    marginHorizontal: 16, borderRadius: 16, borderWidth: 1, overflow: 'hidden',
  },
  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: 16,
  },
  detailLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  detailLabel: { fontSize: 14 },
  detailValue: { fontSize: 14 },
  separator: { height: 1 },
  policyLink: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 12, paddingVertical: 14, paddingHorizontal: 16,
    borderWidth: 1, borderRadius: 12,
  },
  policyText: { flex: 1, fontSize: 14 },
  ctaBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1, gap: 10,
  },
  skipBtn: {
    height: 50, borderRadius: 14, flexDirection: 'row', justifyContent: 'center',
    alignItems: 'center', gap: 8, borderWidth: 1,
  },
  skipBtnText: { fontSize: 15 },
  queueBtn: {
    height: 56, borderRadius: 14, flexDirection: 'row',
    justifyContent: 'center', alignItems: 'center', gap: 8,
  },
  queueBtnText: { fontSize: 16 },
});
