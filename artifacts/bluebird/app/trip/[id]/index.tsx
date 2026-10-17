import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useListTrips, type Trip } from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import { TripAvailabilityState } from '@/components/TripAvailabilityState';
import { useColors } from '@/hooks/useColors';
import { isLocalFlightReadMode } from '@/lib/productionFlights';
import { parseTripRouteId } from '@/lib/tripRoutes';
import { PRODUCTION_AUTH_UNAVAILABLE_MESSAGE } from '@/lib/productionAuthState';

function tripStatusLabel(status: string): string {
  switch (status) {
    case 'upcoming': return 'Upcoming';
    case 'completed': return 'Completed';
    case 'cancelled': return 'Cancelled';
    default: return 'Trip status unavailable';
  }
}

function displayDate(value?: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Date unavailable';
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) return 'Date unavailable';
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export default function TripDetailsScreen() {
  const colors = useColors();
  const { id: rawId } = useLocalSearchParams<{ id?: string | string[] }>();
  const tripId = parseTripRouteId(rawId);
  const localDemoFlow = isLocalFlightReadMode();
  const { user } = useAuth();
  const query = useListTrips({
    query: {
      enabled: localDemoFlow && !!user && !!tripId,
      queryKey: ['/api/trips', user?.id ?? 'signed-out'],
    },
  });

  const backToTrips = () => router.dismissTo('/(tabs)/trips');
  if (!tripId) {
    return (
      <TripAvailabilityState
        title="Trip details unavailable"
        description="We couldn’t find this trip. Go back to My Trips and try again."
        actionLabel="Back to My Trips"
        onAction={backToTrips}
      />
    );
  }
  if (!localDemoFlow) {
    return (
      <TripAvailabilityState
        title="Trip details unavailable"
        description={`${PRODUCTION_AUTH_UNAVAILABLE_MESSAGE} Please try again later.`}
        actionLabel="Back to My Trips"
        onAction={backToTrips}
        testID="production-trip-details-unavailable"
      />
    );
  }
  if (!user) {
    return (
      <TripAvailabilityState
        title="Sign in to view trip details"
        description="Trip details require a member session. No trip data is loaded while signed out."
        actionLabel="Back to My Trips"
        onAction={backToTrips}
      />
    );
  }
  if (query.isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]} testID="trip-details-loading">
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={[styles.stateBody, { color: colors.mutedForeground }]}>Loading trip details…</Text>
      </View>
    );
  }
  if (query.isError) {
    const status = (query.error as any)?.status ?? (query.error as any)?.response?.status;
    if (status === 401) {
      return (
        <TripAvailabilityState
          title="Sign in required"
          description="Please sign in again to view this trip."
          actionLabel="Back to My Trips"
          onAction={backToTrips}
          testID="trip-details-auth-required"
        />
      );
    }
    return (
      <TripAvailabilityState
        title="Could not load trip details"
        description="Trip details could not be loaded. Check your connection and try again."
        actionLabel="Try Again"
        onAction={() => { void query.refetch(); }}
        testID="trip-details-api-error"
      />
    );
  }

  const trip = ((query.data as Trip[] | undefined) ?? []).find((item) => item.id === tripId);
  if (!trip) {
    return (
      <TripAvailabilityState
        title="Trip not found"
        description="We couldn’t find this trip. Return to My Trips and choose an existing trip."
        actionLabel="Back to My Trips"
        onAction={backToTrips}
      />
    );
  }

  const flight = trip.flight;
  const manifestProgress = trip.manifest
    ? `${trip.manifest.completedCount} of ${trip.manifest.requiredCount} travelers complete${trip.manifest.isComplete ? '' : ' · Incomplete'}`
    : 'Passenger manifest unavailable';

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      testID="trip-details"
    >
      <View style={[styles.statusCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>TRIP STATUS</Text>
        <Text style={[styles.status, { color: colors.textOnSurface }]} testID="trip-status">
          {tripStatusLabel(trip.status)}
        </Text>
      </View>

      <View style={[styles.flightCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.textOnSurface }]}>Flight details</Text>
        {flight ? (
          <>
            <Text style={[styles.route, { color: colors.textOnSurface }]}>
              {flight.fromCity || flight.fromAirport || 'Origin unavailable'} → {flight.toCity || flight.toAirport || 'Destination unavailable'}
            </Text>
            <Text style={[styles.detail, { color: colors.mutedForegroundLight }]}>
              {displayDate(flight.departureDate)} · {flight.departureTime || 'Departure time unavailable'}
            </Text>
            <Text style={[styles.detail, { color: colors.mutedForegroundLight }]}>
              {flight.aircraftType || 'Aircraft unavailable'}
            </Text>
          </>
        ) : (
          <Text style={[styles.detail, { color: colors.mutedForegroundLight }]}>
            Route, schedule, and aircraft information are unavailable.
          </Text>
        )}
        <Text style={[styles.detail, { color: colors.mutedForegroundLight }]}>
          Assigned FBO information is unavailable in this trip view.
        </Text>
      </View>

      <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.textOnSurface }]}>Passenger &amp; pet information</Text>
        <Text style={[styles.detail, { color: colors.mutedForegroundLight }]}>{manifestProgress}</Text>
        {trip.status === 'upcoming' ? (
          <TouchableOpacity
            testID="trip-passenger-information"
            accessibilityRole="button"
            style={[styles.action, { backgroundColor: colors.primary }]}
            onPress={() => router.push(`/trip/${trip.id}/passengers` as any)}
          >
            <Text style={[styles.actionText, { color: colors.primaryForeground }]}>View passenger and pet information</Text>
          </TouchableOpacity>
        ) : (
          <Text style={[styles.locked, { color: colors.mutedForegroundLight }]}>
            Passenger information is unavailable for this trip status.
          </Text>
        )}
      </View>

      <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.textOnSurface }]}>Boarding pass</Text>
        <Text style={[styles.detail, { color: colors.mutedForegroundLight }]}>A boarding pass is unavailable for this trip.</Text>
        <TouchableOpacity
          testID="trip-boarding-pass"
          accessibilityRole="button"
          style={[styles.secondaryAction, { borderColor: colors.border }]}
          onPress={() => router.push(`/trip/${trip.id}/boarding-pass` as any)}
        >
          <Text style={[styles.secondaryActionText, { color: colors.primary }]}>View boarding-pass availability</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 20, paddingBottom: 40, gap: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 28 },
  stateBody: { fontFamily: 'Inter_400Regular', fontSize: 14, textAlign: 'center' },
  statusCard: { borderWidth: 1, borderRadius: 18, padding: 18 },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.2 },
  status: { fontFamily: 'Inter_700Bold', fontSize: 22, marginTop: 6 },
  flightCard: { borderWidth: 1, borderRadius: 18, padding: 18, gap: 8 },
  sectionCard: { borderWidth: 1, borderRadius: 18, padding: 18, gap: 8 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  route: { fontFamily: 'Inter_700Bold', fontSize: 19, marginTop: 6 },
  detail: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 },
  action: { minHeight: 48, borderRadius: 13, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, marginTop: 6 },
  actionText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, textAlign: 'center' },
  secondaryAction: { minHeight: 46, borderWidth: 1, borderRadius: 13, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, marginTop: 6 },
  secondaryActionText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, textAlign: 'center' },
  locked: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, marginTop: 4 },
});
