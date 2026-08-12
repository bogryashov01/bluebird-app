import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform, Alert, ImageBackground, useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGetFlight, useGetFlightMyStatus, useCancelQueueEntry, useConfirmQueueEntry } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { confirmDialog } from '@/lib/confirmDialog';

// ── Aircraft image matching ────────────────────────────────────────────────────
const AIRCRAFT_IMAGES = [
  { match: /gulfstream|g280|challenger|falcon/i,  source: require('@/assets/images/aircraft-heavy.jpg') },
  { match: /king air|pilatus|pc-12|turboprop/i,   source: require('@/assets/images/aircraft-turboprop.jpg') },
  { match: /phenom|xls|latitude/i,                source: require('@/assets/images/aircraft-midsize.jpg') },
];
const LIGHT_JET = require('@/assets/images/aircraft-light.jpg');
function aircraftImage(type: string) {
  for (const { match, source } of AIRCRAFT_IMAGES) if (match.test(type)) return source;
  return LIGHT_JET;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function computeArrival(departureTime: string, duration: string): string {
  const [depH, depM] = departureTime.split(':').map(Number);
  const hours = duration.match(/(\d+)h/);
  const mins  = duration.match(/(\d+)m/);
  const totalMins = depH * 60 + depM
    + (hours ? parseInt(hours[1]) * 60 : 0)
    + (mins  ? parseInt(mins[1])       : 0);
  const arrH = Math.floor(totalMins / 60) % 24;
  const arrM = totalMins % 60;
  return `${String(arrH).padStart(2, '0')}:${String(arrM).padStart(2, '0')}`;
}

function formatDate(d: string) {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

function amenities(f: any) {
  return [
    { label: 'Duration',  value: f.duration },
    { label: 'Seats',     value: `${f.seatsAvailable} / ${f.aircraftCapacity}` },
    { label: 'WiFi',      value: 'Onboard' },
    { label: 'Pets',      value: 'Welcome' },
    { label: 'Baggage',   value: '2 per seat' },
    { label: 'Aircraft',  value: (f.aircraftType as string).split(' ').slice(-2).join(' ') },
  ];
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function FlightDetailScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  // Scale hero with screen height so small iPhones keep content above the fold
  const heroHeight = Math.round(Math.min(300, Math.max(200, windowHeight * 0.32)));
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [passengers, setPassengers] = useState(1);

  const { data: flight, isLoading, isError } = useGetFlight(id!);

  // Fetch the user's relationship to this flight (requires auth)
  const {
    data: myStatus,
    isLoading: statusLoading,
  } = useGetFlightMyStatus(id!, {
    query: { enabled: !!user && !!id },
  });

  const topPad  = Platform.OS === 'web' ? 60 : insets.top;
  const botPad  = Platform.OS === 'web' ? 34 : insets.bottom;
  const backTop = topPad + 14;

  const cancelMutation = useCancelQueueEntry({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['/api/queue/status'] });
        queryClient.invalidateQueries({ queryKey: [`/api/flights/${id}/my-status`] });
      },
      onError: (err: any) => {
        const msg = err?.data?.error || err?.message || 'Failed to leave queue';
        Alert.alert('Error', msg);
      },
    },
  });

  const confirmMutation = useConfirmQueueEntry({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['/api/queue/status'] });
        queryClient.invalidateQueries({ queryKey: ['/api/trips'] });
        queryClient.invalidateQueries({ queryKey: [`/api/flights/${id}/my-status`] });
        const fl = flight as any;
        router.push({
          pathname: '/flight/confirmed',
          params: fl ? {
            from: fl.fromAirport, to: fl.toAirport,
            fromCity: fl.fromCity, toCity: fl.toCity,
            departureDate: fl.departureDate, departureTime: fl.departureTime,
            duration: fl.duration, aircraftType: fl.aircraftType,
          } : {},
        });
      },
      onError: (err: any) => {
        const msg = err?.data?.error || err?.message || 'Failed to confirm seat';
        Alert.alert('Could not confirm', msg);
      },
    },
  });

  const handleLeaveQueue = async () => {
    if (!myStatus?.queueEntryId) return;
    const ok = await confirmDialog('Leave Queue?', 'You will lose your position in the queue.', 'Leave Queue', true);
    if (ok) cancelMutation.mutate({ id: myStatus.queueEntryId! });
  };

  const handleConfirmSeat = async () => {
    if (!myStatus?.queueEntryId) return;
    const ok = await confirmDialog('Confirm your seat?', 'This will reserve your spot on this flight.');
    if (ok) confirmMutation.mutate({ id: myStatus.queueEntryId! });
  };

  // ── Loading / Error — guards before any flight-property access ──
  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.offWhite }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }
  if (isError || !flight) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.offWhite }]}>
        <Text style={[styles.errText, { color: colors.mutedForegroundLight }]}>Flight not found</Text>
      </View>
    );
  }

  // f is guaranteed non-null below this point
  const f         = flight as any;
  const imgSource = aircraftImage(f.aircraftType);
  const price     = f.priceUsd ? `$${f.priceUsd.toLocaleString()}` : null;

  const status = myStatus?.status ?? 'none';

  const joinFlowParams = (extra: Record<string, string> = {}) => ({
    flightId:      f.id,
    fromCity:      f.fromCity,
    toCity:        f.toCity,
    from:          f.fromAirport,
    to:            f.toAirport,
    passengers:    String(passengers),
    departureDate: f.departureDate,
    departureTime: f.departureTime,
    duration:      f.duration,
    aircraftType:  f.aircraftType,
    flightStatus:  f.status,
    international: f.international ? '1' : '',
    feeUsd:        String(f.internationalFeeUsd ?? 0),
    ...extra,
  });

  const handleJoinQueue = () => {
    if (!user) {
      // Not signed in — send to the auth flow instead of an API call that
      // would fail with 401. They can come back to the flight afterward.
      router.push('/(auth)/welcome');
      return;
    }
    router.push({ pathname: '/queue/join', params: joinFlowParams() });
  };

  const flightAvailable = f.status === 'available';
  const STATUS_LABELS: Record<string, string> = {
    boarding: 'Boarding',
    departed: 'Departed',
    completed: 'Completed',
    cancelled: 'Cancelled',
  };
  const statusLabel = STATUS_LABELS[f.status as string] ?? 'Unavailable';

  // ── CTA footer rendering — branched on my-status ─────────────────────────
  function renderCTA() {
    // Non-available flight: joining is impossible, so show the flight's
    // status instead of any join action. Confirmed/waiting members still see
    // their own state below (e.g. a confirmed trip on a departed flight).
    if (!flightAvailable && (!user || !myStatus || myStatus.status === 'none')) {
      return (
        <>
          <View style={[styles.unavailableBadge, { backgroundColor: colors.muted }]}>
            <Text style={[styles.unavailableBadgeText, { color: colors.mutedForegroundLight }]}>
              {f.status === 'cancelled' ? '✕' : '—'}  {statusLabel}
            </Text>
          </View>
          <Text style={[styles.unavailableHint, { color: colors.mutedForegroundLight }]}>
            This flight is no longer accepting join requests.
          </Text>
        </>
      );
    }

    if (!user) {
      // Unauthenticated: show join CTA
      return (
        <TouchableOpacity style={[styles.joinBtn, { backgroundColor: colors.primary }]} onPress={handleJoinQueue} activeOpacity={0.8}>
          <Text style={[styles.joinBtnText, { color: colors.primaryForeground }]}>Request to Join</Text>
        </TouchableOpacity>
      );
    }

    // Hold the CTA behind a spinner until we actually know the user's status —
    // covers both the initial fetch and any state where data isn't available
    // yet, so a confirmed user never sees a "Request to Join" flash.
    if (statusLoading || !myStatus) {
      return (
        <View style={styles.statusLoadingRow}>
          <ActivityIndicator color={colors.primary} size="small" />
        </View>
      );
    }

    if (status === 'confirmed') {
      return (
        <>
          <View style={[styles.confirmedBadge, { backgroundColor: colors.success + '15' }]}>
            <Text style={[styles.confirmedBadgeEmoji, { color: colors.success }]}>✓</Text>
            <Text style={[styles.confirmedBadgeText, { color: colors.success }]}>You're confirmed on this flight</Text>
          </View>
          <TouchableOpacity
            style={[styles.viewTripBtn, { backgroundColor: colors.backgroundMid }]}
            onPress={() => router.push('/(tabs)/trips')}
            activeOpacity={0.8}
          >
            <Text style={[styles.viewTripBtnText, { color: colors.primaryForeground }]}>View in My Trips</Text>
          </TouchableOpacity>
        </>
      );
    }

    if (status === 'waiting') {
      const canConfirm = myStatus?.canConfirm === true;
      const anyPending = cancelMutation.isPending || confirmMutation.isPending;
      return (
        <>
          <View style={[styles.queuePositionCard, { backgroundColor: colors.primary + '12' }]}>
            <Text style={[styles.queuePositionLabel, { color: colors.mutedForegroundLight }]}>Your queue position</Text>
            <Text style={[styles.queuePositionNumber, { color: colors.textOnSurface }]}>
              #{myStatus?.queuePosition}
              <Text style={[styles.queuePositionTotal, { color: colors.mutedForegroundLight }]}> of {myStatus?.totalInQueue}</Text>
            </Text>
            {canConfirm && (
              <Text style={[styles.queuePositionEligible, { color: colors.success }]}>Your seat is ready — confirm now</Text>
            )}
          </View>
          {canConfirm && (
            <TouchableOpacity
              style={[styles.confirmSeatBtn, { backgroundColor: colors.success, shadowColor: colors.success }, anyPending && { opacity: 0.6 }]}
              onPress={handleConfirmSeat}
              disabled={anyPending}
              activeOpacity={0.8}
            >
              {confirmMutation.isPending
                ? <ActivityIndicator color={colors.successForeground} size="small" />
                : <Text style={[styles.confirmSeatBtnText, { color: colors.successForeground }]}>✓  Confirm your seat</Text>
              }
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.leaveQueueBtn, { borderColor: colors.border }, anyPending && { opacity: 0.6 }]}
            onPress={handleLeaveQueue}
            disabled={anyPending}
            activeOpacity={0.75}
          >
            {cancelMutation.isPending
              ? <ActivityIndicator color={colors.mutedForegroundLight} size="small" />
              : <Text style={[styles.leaveQueueBtnText, { color: colors.mutedForegroundLight }]}>Leave Queue</Text>
            }
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.conciergeLink}
            onPress={() =>
              router.push({
                pathname: '/queue/status',
                params: myStatus?.queueEntryId
                  ? { entryId: myStatus.queueEntryId }
                  : { flightId: id! },
              })
            }
            activeOpacity={0.7}
          >
            <Text style={[styles.conciergeLinkText, { color: colors.mutedForegroundLight }]}>View full queue status</Text>
          </TouchableOpacity>
        </>
      );
    }

    // status === 'none' — full join flow
    return (
      <>
        {user.linePassCount > 0 && (
          <TouchableOpacity
            style={[styles.skipBtn, { borderColor: colors.primary }]}
            onPress={() =>
              router.push({ pathname: '/queue/join', params: joinFlowParams({ useLinePass: '1' }) })
            }
            activeOpacity={0.8}
          >
            <Text style={[styles.skipBtnText, { color: colors.primary }]}>⚡ Skip the Line ({user.linePassCount})</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.joinBtn, { backgroundColor: colors.primary }]} onPress={handleJoinQueue} activeOpacity={0.8}>
          <Text style={[styles.joinBtnText, { color: colors.primaryForeground }]}>Request to Join</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.conciergeLink}
          onPress={() => router.push('/concierge')}
          activeOpacity={0.7}
        >
          <Text style={[styles.conciergeLinkText, { color: colors.mutedForegroundLight }]}>Ask AI Concierge about this flight</Text>
        </TouchableOpacity>
      </>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]}>
      {/* ── Frosted back button (floats above hero) ── */}
      <TouchableOpacity
        style={[styles.backBtn, { top: backTop, backgroundColor: colors.surface + 'CC' }]}
        onPress={() => router.back()}
        activeOpacity={0.75}
      >
        <Text style={[styles.backChevron, { color: colors.textOnSurface }]}>‹</Text>
      </TouchableOpacity>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: botPad + 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero image with gradient ── */}
        <ImageBackground source={imgSource} style={[styles.hero, { height: heroHeight }]}>
          {/* Top-to-middle dark fade so back button is visible */}
          <LinearGradient
            colors={['rgba(6,11,31,0.50)', 'rgba(6,11,31,0.0)']}
            locations={[0, 0.55]}
            style={StyleSheet.absoluteFill}
          />
          {/* Bottom fade to the screen bg so hero blends into content below */}
          <LinearGradient
            colors={[colors.offWhite + '00', colors.offWhite]}
            locations={[0.55, 1]}
            style={StyleSheet.absoluteFill}
          />

          {/* Route pill at bottom of hero */}
          <View style={[styles.routePill, { backgroundColor: colors.primaryForeground + '2E', borderColor: colors.primaryForeground + '4D' }]}>
            <Text style={[styles.routePillText, { color: colors.primaryForeground }]}>
              {f.fromAirport} → {f.toAirport}
            </Text>
          </View>
        </ImageBackground>

        {/* ── Title row ── */}
        <View style={styles.titleRow}>
          <Text style={[styles.aircraftName, { color: colors.textOnSurface }]} numberOfLines={1}>{f.aircraftType}</Text>
          {price && <Text style={[styles.priceText, { color: colors.primary }]}>{price}</Text>}
        </View>

        {/* ── Date row ── */}
        <Text style={[styles.dateText, { color: colors.mutedForegroundLight }]}>{formatDate(f.departureDate)}</Text>

        {/* ── Horizontal route card ── */}
        <View style={[styles.routeCard, { backgroundColor: colors.surface }]}>
          <View style={styles.routeEndpoint}>
            <Text style={[styles.routeCode, { color: colors.textOnSurface }]}>{f.fromAirport}</Text>
            <Text style={[styles.routeTime, { color: colors.textOnSurface }]}>{f.departureTime}</Text>
            <Text style={[styles.routeCity, { color: colors.mutedForegroundLight }]} numberOfLines={1}>{f.fromCity}</Text>
          </View>
          <View style={styles.routeCenter}>
            <View style={[styles.routeLine, { backgroundColor: colors.separator }]} />
            <View style={[styles.routeDot, { backgroundColor: colors.primary }]} />
            <Text style={[styles.routeDuration, { color: colors.mutedForegroundLight }]}>{f.duration}</Text>
            <View style={[styles.routeDot, { backgroundColor: colors.primary }]} />
            <View style={[styles.routeLine, { backgroundColor: colors.separator }]} />
          </View>
          <View style={[styles.routeEndpoint, { alignItems: 'flex-end' }]}>
            <Text style={[styles.routeCode, { color: colors.textOnSurface }]}>{f.toAirport}</Text>
            <Text style={[styles.routeTime, { color: colors.textOnSurface }]}>{computeArrival(f.departureTime, f.duration)}</Text>
            <Text style={[styles.routeCity, { color: colors.mutedForegroundLight }]} numberOfLines={1}>{f.toCity}</Text>
          </View>
        </View>

        {/* ── Amenity tile grid ── */}
        <View style={styles.amenityGrid}>
          {amenities(f).map((a) => (
            <View key={a.label} style={[styles.amenityTile, { backgroundColor: colors.surface }]}>
              <Text style={[styles.amenityLabel, { color: colors.mutedForegroundLight }]}>{a.label}</Text>
              <Text style={[styles.amenityValue, { color: colors.textOnSurface }]}>{a.value}</Text>
            </View>
          ))}
        </View>

        {/* ── Passenger stepper — only shown when user can still join.
             For signed-in users, wait until status is known so the stepper
             never flashes for someone already queued or confirmed. ── */}
        {flightAvailable && (!user || (!!myStatus && status === 'none')) && (
          <View style={[styles.stepperCard, { backgroundColor: colors.surface }]}>
            <View style={styles.stepperLeft}>
              <Text style={[styles.stepperTitle, { color: colors.textOnSurface }]}>Passengers</Text>
              <Text style={[styles.stepperHint, { color: colors.mutedForegroundLight }]}>Max {f.seatsAvailable} seat{f.seatsAvailable !== 1 ? 's' : ''} available</Text>
            </View>
            <View style={styles.stepper}>
              <TouchableOpacity
                style={[styles.stepBtn, { backgroundColor: colors.muted }, passengers <= 1 && styles.stepBtnDisabled]}
                onPress={() => setPassengers(Math.max(1, passengers - 1))}
                activeOpacity={0.7}
              >
                <Text style={[styles.stepBtnText, { color: colors.textOnSurface }]}>−</Text>
              </TouchableOpacity>
              <Text style={[styles.stepCount, { color: colors.textOnSurface }]}>{passengers}</Text>
              <TouchableOpacity
                style={[styles.stepBtn, { backgroundColor: colors.muted }, passengers >= f.seatsAvailable && styles.stepBtnDisabled]}
                onPress={() => setPassengers(Math.min(f.seatsAvailable, passengers + 1))}
                activeOpacity={0.7}
              >
                <Text style={[styles.stepBtnText, { color: colors.textOnSurface }]}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Policy link ── */}
        <TouchableOpacity
          style={[styles.policyRow, { borderTopColor: colors.separator }]}
          onPress={() => router.push('/flight/policy')}
          activeOpacity={0.7}
        >
          <Text style={[styles.policyText, { color: colors.mutedForegroundLight }]}>View Flight Policy & Terms</Text>
          <Text style={[styles.policyChevron, { color: colors.mutedForegroundLight }]}>›</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* ── Bottom sticky CTA ── */}
      <View style={[styles.ctaBar, { backgroundColor: colors.offWhite, borderTopColor: colors.separator, paddingBottom: botPad + 12 }]}>
        {renderCTA()}
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root:    { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errText: { fontFamily: 'Inter_400Regular', fontSize: 16 },

  // Back button
  backBtn: {
    position: 'absolute', zIndex: 20, left: 16,
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
  },
  backChevron: { fontFamily: 'Inter_500Medium', fontSize: 22, marginTop: -2 },

  // Hero
  hero: { width: '100%', justifyContent: 'flex-end' },
  routePill: {
    marginBottom: 18, alignSelf: 'center',
    borderRadius: 100, paddingHorizontal: 16, paddingVertical: 6,
    borderWidth: 1,
  },
  routePillText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, letterSpacing: 0.5 },

  // Title row
  titleRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, marginTop: 8,
  },
  aircraftName: { fontFamily: 'Inter_700Bold', fontSize: 22, flex: 1, marginRight: 12 },
  priceText:   { fontFamily: 'Inter_700Bold', fontSize: 22 },

  // Date
  dateText: { fontFamily: 'Inter_400Regular', fontSize: 14, paddingHorizontal: 20, marginTop: 4, marginBottom: 18 },

  // Horizontal route card
  routeCard: {
    marginHorizontal: 16,
    borderRadius: 18, padding: 18, flexDirection: 'row', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowRadius: 20, shadowOpacity: 0.05, elevation: 3,
    marginBottom: 14,
  },
  routeEndpoint: { flex: 1, alignItems: 'flex-start' },
  routeCode:   { fontFamily: 'Inter_700Bold', fontSize: 18 },
  routeTime:   { fontFamily: 'Inter_500Medium', fontSize: 14, marginTop: 2 },
  routeCity:   { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  routeCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  routeLine:   { flex: 1, height: 1 },
  routeDot:    { width: 5, height: 5, borderRadius: 3 },
  routeDuration: { fontFamily: 'Inter_500Medium', fontSize: 11 },

  // Amenity grid: 2-column
  amenityGrid: {
    flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 10, marginBottom: 14,
  },
  amenityTile: {
    width: '47.5%', borderRadius: 14, padding: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2,
  },
  amenityLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
  amenityValue: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },

  // Passenger stepper
  stepperCard: {
    marginHorizontal: 16, borderRadius: 18,
    paddingVertical: 14, paddingHorizontal: 18,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2,
    marginBottom: 16,
  },
  stepperLeft:  {},
  stepperTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  stepperHint:  { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  stepper:      { flexDirection: 'row', alignItems: 'center', gap: 16 },
  stepBtn: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
  stepBtnDisabled: { opacity: 0.35 },
  stepBtnText: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  stepCount:   { fontFamily: 'Inter_700Bold', fontSize: 18, minWidth: 22, textAlign: 'center' },

  // Policy link
  policyRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: 16, paddingVertical: 14,
    borderTopWidth: 1,
  },
  policyText:    { fontFamily: 'Inter_400Regular', fontSize: 14 },
  policyChevron: { fontFamily: 'Inter_400Regular', fontSize: 20 },

  // CTA bar
  ctaBar: {
    paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: 1,
    gap: 10,
  },
  statusLoadingRow: { alignItems: 'center', paddingVertical: 16 },

  // none / join state
  skipBtn: {
    borderWidth: 1.5, borderRadius: 14, paddingVertical: 13, alignItems: 'center',
  },
  skipBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  joinBtn: {
    borderRadius: 14, paddingVertical: 15, alignItems: 'center',
  },
  joinBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16 },

  // waiting state
  queuePositionCard: {
    borderRadius: 14, paddingVertical: 14, paddingHorizontal: 18,
    alignItems: 'center', gap: 4,
  },
  queuePositionLabel: { fontFamily: 'Inter_500Medium', fontSize: 12, marginBottom: 4 },
  queuePositionNumber: { fontFamily: 'Inter_700Bold', fontSize: 24 },
  queuePositionTotal: { fontFamily: 'Inter_400Regular', fontSize: 16 },
  queuePositionEligible: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginTop: 4 },
  confirmSeatBtn: {
    borderRadius: 14, paddingVertical: 15, alignItems: 'center',
    shadowOffset: { width: 0, height: 6 }, shadowRadius: 16, shadowOpacity: 0.28, elevation: 4,
  },
  confirmSeatBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  leaveQueueBtn: {
    borderWidth: 1, borderRadius: 14,
    paddingVertical: 13, alignItems: 'center',
  },
  leaveQueueBtnText: { fontFamily: 'Inter_500Medium', fontSize: 15 },

  // confirmed state
  confirmedBadge: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8,
    borderRadius: 14, paddingVertical: 14,
  },
  confirmedBadgeEmoji: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  confirmedBadgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  viewTripBtn: {
    borderRadius: 14, paddingVertical: 15, alignItems: 'center',
  },
  viewTripBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16 },

  // unavailable state
  unavailableBadge: {
    borderRadius: 14, paddingVertical: 15, alignItems: 'center',
  },
  unavailableBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  unavailableHint: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', paddingBottom: 4 },

  conciergeLink: { alignItems: 'center', paddingBottom: 4 },
  conciergeLinkText: { fontFamily: 'Inter_500Medium', fontSize: 13 },
});
