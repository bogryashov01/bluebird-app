import React from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import {
  fetchFullAppDemoFlight,
  fetchFullAppDemoQueue,
} from '@/lib/fullAppDemoLiveReads';
import {
  parseProductionFlightId,
  ProductionReadHttpError,
  productionReadRetryDelay,
  shouldRetryProductionRead,
} from '@/lib/productionFlights';

function formatDate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.valueOf())
    ? null
    : date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function describeEndpointError(error: unknown, endpoint: string): string {
  if (error instanceof ProductionReadHttpError) {
    return `GET ${endpoint} — HTTP ${error.status}`;
  }
  if (error instanceof Error && error.name === 'ProductionReadSchemaError') {
    return `GET ${endpoint} returned data that does not match the safe public contract.`;
  }
  return `GET ${endpoint} could not be completed. Check the connection and try again.`;
}

export default function FullAppDemoFlightDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const flightId = parseProductionFlightId(rawId);
  const endpointPrefix = flightId === null ? null : `/api/empty-legs/${flightId}`;

  const flightQuery = useQuery({
    queryKey: ['full-app-demo-flight', flightId],
    queryFn: ({ signal }) => fetchFullAppDemoFlight(flightId!, { signal }),
    enabled: flightId !== null,
    retry: shouldRetryProductionRead,
    retryDelay: productionReadRetryDelay,
  });
  const queueQuery = useQuery({
    queryKey: ['full-app-demo-flight-queue', flightId],
    queryFn: ({ signal }) => fetchFullAppDemoQueue(flightId!, { signal }),
    enabled: flightId !== null,
    retry: shouldRetryProductionRead,
    retryDelay: productionReadRetryDelay,
  });

  const content = (
    <ScrollView contentContainerStyle={styles.content}>
      <TouchableOpacity
        testID="full-app-demo-flight-back"
        accessibilityRole="button"
        accessibilityLabel="Back to Discover"
        style={[styles.backButton, { borderColor: colors.border }]}
        onPress={() => router.back()}
      >
        <Feather name="arrow-left" size={18} color={colors.foreground} />
        <Text style={[styles.backText, { color: colors.foreground }]}>Discover</Text>
      </TouchableOpacity>

      <View style={styles.heading}>
        <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>LIVE FLIGHT · READ ONLY</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>Flight details</Text>
      </View>

      {flightId === null ? (
        <View testID="full-app-demo-flight-invalid" style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>This flight identifier is invalid.</Text>
        </View>
      ) : flightQuery.isLoading ? (
        <View testID="full-app-demo-flight-loading" style={[styles.card, styles.centered, { backgroundColor: colors.card }]}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.body, { color: colors.mutedForeground }]}>Loading live flight details…</Text>
        </View>
      ) : flightQuery.isError || !flightQuery.data ? (
        <View testID="full-app-demo-flight-error" style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Flight details unavailable</Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            {describeEndpointError(
              flightQuery.error,
              `${endpointPrefix}`,
            )}
          </Text>
          <RetryButton
            colors={colors}
            loading={flightQuery.isFetching}
            onPress={() => void flightQuery.refetch()}
          />
        </View>
      ) : (
        <View testID="full-app-demo-flight-summary" style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.route, { color: colors.foreground }]}>
            {flightQuery.data.fromAirport || flightQuery.data.fromCity || '—'} → {flightQuery.data.toAirport || flightQuery.data.toCity || '—'}
          </Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            {[formatDate(flightQuery.data.departureDate), flightQuery.data.departureTime, flightQuery.data.departureTimeZone]
              .filter(Boolean).join(' · ') || 'Departure schedule unavailable'}
          </Text>
          {(flightQuery.data.aircraftTypeName || flightQuery.data.aircraftType) && (
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              {flightQuery.data.aircraftTypeName || flightQuery.data.aircraftType}
            </Text>
          )}
        </View>
      )}

      <View style={styles.heading}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Queue</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          Public queue view. This demo profile is not a queue participant.
        </Text>
      </View>
      {flightId === null ? null : queueQuery.isLoading ? (
        <View testID="full-app-demo-queue-loading" style={[styles.card, styles.centered, { backgroundColor: colors.card }]}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.body, { color: colors.mutedForeground }]}>Loading queue…</Text>
        </View>
      ) : queueQuery.isError ? (
        <View testID="full-app-demo-queue-error" style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Queue unavailable</Text>
          <Text testID="full-app-demo-queue-endpoint-error" style={[styles.body, { color: colors.mutedForeground }]}>
            {describeEndpointError(queueQuery.error, `${endpointPrefix}/queue`)}
          </Text>
          <RetryButton
            colors={colors}
            loading={queueQuery.isFetching}
            onPress={() => void queueQuery.refetch()}
          />
        </View>
      ) : (
        <View testID="full-app-demo-queue" style={[styles.queueCard, { backgroundColor: colors.card }]}>
          {queueQuery.data?.length ? queueQuery.data.map((entry) => (
            <View
              key={entry.position}
              testID={`full-app-demo-queue-entry-${entry.position}`}
              style={[styles.queueEntry, { borderBottomColor: colors.border }]}
            >
              <View style={[styles.initials, { backgroundColor: colors.backgroundMid }]}>
                <Text style={[styles.initialsText, { color: colors.textOnBrand }]}>{entry.initials}</Text>
              </View>
              <View style={styles.queueCopy}>
                <Text style={[styles.queuePosition, { color: colors.foreground }]}>Position {entry.position}</Text>
                <Text style={[styles.body, { color: colors.mutedForeground }]}>
                  {entry.tier === 'free' ? 'Free' : entry.tier === 'base' ? 'Base' : 'Plus'} · {entry.hasLineSkip ? 'Line skip' : 'Standard'}
                </Text>
              </View>
            </View>
          )) : (
            <Text testID="full-app-demo-queue-empty" style={[styles.body, { color: colors.mutedForeground }]}>
              The public queue is empty.
            </Text>
          )}
        </View>
      )}
      <Text style={[styles.disclaimer, { color: colors.mutedForeground }]}>
        Read-only demo. No booking, queue, pass, payment, or membership actions are available.
      </Text>
    </ScrollView>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {Platform.OS === 'web' ? <View style={{ height: 12 }} /> : null}
      <View style={{ height: Platform.OS === 'web' ? 0 : insets.top }} />
      {content}
    </View>
  );
}

function RetryButton({
  colors,
  loading,
  onPress,
}: {
  colors: ReturnType<typeof useColors>;
  loading: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      testID="full-app-demo-detail-retry"
      disabled={loading}
      onPress={onPress}
      style={[styles.retryButton, { backgroundColor: colors.primary, opacity: loading ? 0.65 : 1 }]}
    >
      {loading
        ? <ActivityIndicator color={colors.primaryForeground} />
        : <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Try again</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { width: '100%', maxWidth: 680, alignSelf: 'center', padding: 20, paddingBottom: 40, gap: 16 },
  backButton: { minHeight: 42, alignSelf: 'flex-start', paddingHorizontal: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  backText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  heading: { gap: 5 },
  eyebrow: { fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 1 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 26 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  card: { borderRadius: 18, padding: 18, gap: 8 },
  centered: { alignItems: 'center', justifyContent: 'center', minHeight: 88 },
  route: { fontFamily: 'Inter_700Bold', fontSize: 22 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
  queueCard: { borderRadius: 18, paddingHorizontal: 16, paddingVertical: 6 },
  queueEntry: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  initials: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  initialsText: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  queueCopy: { flex: 1, gap: 2 },
  queuePosition: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  disclaimer: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18 },
  retryButton: { minHeight: 42, alignSelf: 'flex-start', minWidth: 120, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginTop: 6 },
  retryText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
});
