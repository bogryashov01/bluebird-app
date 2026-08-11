import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useGetAirportSummary } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import FlightMap from '@/components/FlightMap';
import FlightCard from '@/components/FlightCard';

export default function AirportSummaryScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { code } = useLocalSearchParams<{ code: string }>();
  const airportCode = String(code ?? '').toUpperCase();

  const { data: summary, isLoading, isError, refetch } = useGetAirportSummary(airportCode, {
    query: { enabled: airportCode.length > 0 },
  });

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const isDark = colors.scheme === 'dark';

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundMid }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      {/* Header bar */}
      <View style={[styles.headerBar, { paddingTop: topPad + 8 }]}>
        <TouchableOpacity
          style={[styles.backBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(auth)/onboarding'))}
          activeOpacity={0.8}
        >
          <Feather name="arrow-left" size={18} color={colors.foreground} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.replace('/(auth)/onboarding')} activeOpacity={0.8}>
          <Text style={[styles.changeText, { color: colors.primary }]}>Change airport</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : isError || !summary ? (
        <View style={styles.center}>
          <Feather name="wifi-off" size={26} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Couldn't load airport activity.
          </Text>
          <TouchableOpacity
            style={[styles.retryBtn, { backgroundColor: colors.primary }]}
            onPress={() => refetch()}
            activeOpacity={0.85}
          >
            <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 24 }}
            showsVerticalScrollIndicator={false}
          >
            {/* Headline */}
            <View style={styles.headline}>
              <Text style={[styles.overline, { color: colors.primary }]}>
                YES — BLUEBIRD FLIES FROM
              </Text>
              <Text style={[styles.title, { color: colors.textOnBrand }]}>
                {summary.airport.name}
              </Text>
              <Text style={[styles.subtitle, { color: colors.mutedOnBrand }]}>
                {summary.airport.city} · {summary.airport.code}
              </Text>
            </View>

            {/* 30-day stat */}
            <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.statIcon, { backgroundColor: colors.primary + '14' }]}>
                <Feather name="trending-up" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.statNumber, { color: colors.foreground }]}>
                  {summary.flightCount30d} flights
                </Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                  in the last 30 days
                </Text>
              </View>
            </View>

            {/* Top destinations */}
            {summary.topDestinations.length > 0 && (
              <>
                <Text style={[styles.sectionTitle, { color: colors.textOnBrand }]}>
                  Popular destinations
                </Text>
                <View style={styles.destRow}>
                  {summary.topDestinations.map((d, i) => (
                    <View
                      key={d.code}
                      style={[styles.destCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                    >
                      <Text style={[styles.destRank, { color: colors.primary }]}>#{i + 1}</Text>
                      <Text style={[styles.destCity, { color: colors.foreground }]} numberOfLines={1}>
                        {d.city}
                      </Text>
                      <Text style={[styles.destMeta, { color: colors.mutedForeground }]}>
                        {d.code} · {d.count} flights
                      </Text>
                    </View>
                  ))}
                </View>
              </>
            )}

            {/* Route map */}
            {summary.recentFlights.length > 0 && (
              <>
                <Text style={[styles.sectionTitle, { color: colors.textOnBrand }]}>
                  Recent routes from {summary.airport.code}
                </Text>
                <FlightMap flights={summary.recentFlights} />
              </>
            )}

            {/* Recent completed flights */}
            {summary.recentFlights.length > 0 && (
              <>
                <Text style={[styles.sectionTitle, { color: colors.textOnBrand }]}>
                  Recently completed flights
                </Text>
                {summary.recentFlights.map((f) => (
                  <FlightCard key={f.id} flight={f} />
                ))}
              </>
            )}
          </ScrollView>

          {/* CTA */}
          <View style={[styles.footer, { paddingBottom: bottomPad + 16, borderTopColor: colors.border }]}>
            <TouchableOpacity
              style={[styles.ctaBtn, { backgroundColor: colors.primary }]}
              onPress={() => router.push('/(auth)/welcome')}
              activeOpacity={0.85}
            >
              <Text style={[styles.ctaText, { color: colors.primaryForeground }]}>
                Get Started — It's Free
              </Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingBottom: 8,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19, borderWidth: 1,
    justifyContent: 'center', alignItems: 'center',
  },
  changeText: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  headline: { paddingHorizontal: 24, paddingTop: 10, paddingBottom: 20 },
  overline: {
    fontSize: 12, fontFamily: 'Inter_700Bold', letterSpacing: 1.2, marginBottom: 8,
  },
  title: { fontSize: 30, fontFamily: 'Inter_700Bold', letterSpacing: -0.5, lineHeight: 36 },
  subtitle: { fontSize: 15, fontFamily: 'Inter_400Regular', marginTop: 6 },
  statCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    marginHorizontal: 20, marginBottom: 22,
    borderRadius: 18, borderWidth: 1, padding: 16,
  },
  statIcon: {
    width: 44, height: 44, borderRadius: 22,
    justifyContent: 'center', alignItems: 'center',
  },
  statNumber: { fontSize: 22, fontFamily: 'Inter_700Bold', letterSpacing: -0.3 },
  statLabel: { fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 2 },
  sectionTitle: {
    fontSize: 17, fontFamily: 'Inter_700Bold', letterSpacing: -0.2,
    paddingHorizontal: 24, marginBottom: 12,
  },
  destRow: {
    flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginBottom: 22,
  },
  destCard: {
    flex: 1, borderRadius: 16, borderWidth: 1, padding: 12,
  },
  destRank: { fontSize: 11, fontFamily: 'Inter_700Bold', marginBottom: 6 },
  destCity: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  destMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 3 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  retryBtn: { borderRadius: 999, paddingHorizontal: 22, height: 42, justifyContent: 'center', marginTop: 4 },
  retryText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  footer: { paddingHorizontal: 24, paddingTop: 14, borderTopWidth: 1 },
  ctaBtn: {
    height: 54, borderRadius: 999, justifyContent: 'center', alignItems: 'center',
  },
  ctaText: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
});
