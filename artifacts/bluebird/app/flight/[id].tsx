import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform, Alert, ImageBackground,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGetFlight } from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';

// ── Aircraft image matching (same regex as Discover) ──────────────────────────
const AIRCRAFT_IMAGES = [
  { match: /gulfstream|g280|challenger|falcon/i,      source: require('@/assets/images/aircraft-heavy.jpg') },
  { match: /king air|pilatus|pc-12|turboprop/i,       source: require('@/assets/images/aircraft-turboprop.jpg') },
  { match: /phenom|xls|latitude/i,                   source: require('@/assets/images/aircraft-midsize.jpg') },
];
const LIGHT_JET = require('@/assets/images/aircraft-light.jpg');
function aircraftImage(type: string) {
  for (const { match, source } of AIRCRAFT_IMAGES) if (match.test(type)) return source;
  return LIGHT_JET;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
/** Compute arrival time from "HH:MM" departure and "Xh YYm" duration. */
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

// Amenity tile data (mixes real flight fields + standard charter amenities)
function amenities(f: any) {
  return [
    { label: 'Duration',   value: f.duration },
    { label: 'Seats',      value: `${f.seatsAvailable} / ${f.aircraftCapacity}` },
    { label: 'WiFi',       value: 'Onboard' },
    { label: 'Pets',       value: 'Welcome' },
    { label: 'Baggage',    value: '2 per seat' },
    { label: 'Aircraft',   value: (f.aircraftType as string).split(' ').slice(-2).join(' ') },
  ];
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function FlightDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [passengers, setPassengers] = useState(1);

  const { data: flight, isLoading, isError } = useGetFlight(id!);

  const topPad  = Platform.OS === 'web' ? 60 : insets.top;
  const botPad  = Platform.OS === 'web' ? 34 : insets.bottom;
  const backTop = topPad + 14;

  // ── Loading / Error — guards before any flight-property access ──
  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#1259F2" size="large" />
      </View>
    );
  }
  if (isError || !flight) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errText}>Flight not found</Text>
      </View>
    );
  }

  // f is guaranteed non-null below this point
  const f         = flight as any;
  const imgSource = aircraftImage(f.aircraftType);
  const price     = f.priceUsd ? `$${f.priceUsd.toLocaleString()}` : null;

  const handleJoinQueue = () => {
    router.push({
      pathname: '/queue/join',
      params: {
        flightId:   f.id,
        fromCity:   f.fromCity,
        toCity:     f.toCity,
        from:       f.fromAirport,
        to:         f.toAirport,
        passengers: String(passengers),
      },
    });
  };

  return (
    <View style={styles.root}>
      {/* ── Frosted back button (floats above hero) ── */}
      <TouchableOpacity
        style={[styles.backBtn, { top: backTop }]}
        onPress={() => router.back()}
        activeOpacity={0.75}
      >
        <Text style={styles.backChevron}>‹</Text>
      </TouchableOpacity>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: botPad + 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero image with gradient ── */}
        <ImageBackground source={imgSource} style={styles.hero}>
          {/* Top-to-middle dark fade so back button is visible */}
          <LinearGradient
            colors={['rgba(6,11,31,0.50)', 'rgba(6,11,31,0.0)']}
            locations={[0, 0.55]}
            style={StyleSheet.absoluteFill}
          />
          {/* Bottom fade to #FAFAF8 so hero blends into content below */}
          <LinearGradient
            colors={['rgba(250,250,248,0)', '#FAFAF8']}
            locations={[0.55, 1]}
            style={StyleSheet.absoluteFill}
          />

          {/* Route pill at bottom of hero */}
          <View style={styles.routePill}>
            <Text style={styles.routePillText}>
              {f.fromAirport} → {f.toAirport}
            </Text>
          </View>
        </ImageBackground>

        {/* ── Title row ── */}
        <View style={styles.titleRow}>
          <Text style={styles.aircraftName} numberOfLines={1}>{f.aircraftType}</Text>
          {price && <Text style={styles.priceText}>{price}</Text>}
        </View>

        {/* ── Date row ── */}
        <Text style={styles.dateText}>{formatDate(f.departureDate)}</Text>

        {/* ── Horizontal route card ── */}
        <View style={styles.routeCard}>
          <View style={styles.routeEndpoint}>
            <Text style={styles.routeCode}>{f.fromAirport}</Text>
            <Text style={styles.routeTime}>{f.departureTime}</Text>
            <Text style={styles.routeCity} numberOfLines={1}>{f.fromCity}</Text>
          </View>
          <View style={styles.routeCenter}>
            <View style={styles.routeLine} />
            <View style={styles.routeDot} />
            <Text style={styles.routeDuration}>{f.duration}</Text>
            <View style={styles.routeDot} />
            <View style={styles.routeLine} />
          </View>
          <View style={[styles.routeEndpoint, { alignItems: 'flex-end' }]}>
            <Text style={styles.routeCode}>{f.toAirport}</Text>
            <Text style={styles.routeTime}>{computeArrival(f.departureTime, f.duration)}</Text>
            <Text style={styles.routeCity} numberOfLines={1}>{f.toCity}</Text>
          </View>
        </View>

        {/* ── Amenity tile grid ── */}
        <View style={styles.amenityGrid}>
          {amenities(f).map((a) => (
            <View key={a.label} style={styles.amenityTile}>
              <Text style={styles.amenityLabel}>{a.label}</Text>
              <Text style={styles.amenityValue}>{a.value}</Text>
            </View>
          ))}
        </View>

        {/* ── Passenger stepper ── */}
        <View style={styles.stepperCard}>
          <View style={styles.stepperLeft}>
            <Text style={styles.stepperTitle}>Passengers</Text>
            <Text style={styles.stepperHint}>Max {f.seatsAvailable} seat{f.seatsAvailable !== 1 ? 's' : ''} available</Text>
          </View>
          <View style={styles.stepper}>
            <TouchableOpacity
              style={[styles.stepBtn, passengers <= 1 && styles.stepBtnDisabled]}
              onPress={() => setPassengers(Math.max(1, passengers - 1))}
              activeOpacity={0.7}
            >
              <Text style={styles.stepBtnText}>−</Text>
            </TouchableOpacity>
            <Text style={styles.stepCount}>{passengers}</Text>
            <TouchableOpacity
              style={[styles.stepBtn, passengers >= f.seatsAvailable && styles.stepBtnDisabled]}
              onPress={() => setPassengers(Math.min(f.seatsAvailable, passengers + 1))}
              activeOpacity={0.7}
            >
              <Text style={styles.stepBtnText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Policy link ── */}
        <TouchableOpacity
          style={styles.policyRow}
          onPress={() => router.push('/flight/policy')}
          activeOpacity={0.7}
        >
          <Text style={styles.policyText}>View Flight Policy & Terms</Text>
          <Text style={styles.policyChevron}>›</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* ── Bottom sticky CTA ── */}
      <View style={[styles.ctaBar, { paddingBottom: botPad + 12 }]}>
        {user && user.linePassCount > 0 && (
          <TouchableOpacity
            style={styles.skipBtn}
            onPress={() =>
              router.push({
                pathname: '/queue/join',
                params: {
                  flightId: f.id, fromCity: f.fromCity, toCity: f.toCity,
                  from: f.fromAirport, to: f.toAirport, useLinePass: '1',
                  passengers: String(passengers),
                },
              })
            }
            activeOpacity={0.8}
          >
            <Text style={styles.skipBtnText}>⚡ Skip the Line ({user.linePassCount})</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.joinBtn} onPress={handleJoinQueue} activeOpacity={0.8}>
          <Text style={styles.joinBtnText}>Request to Join</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.conciergeLink}
          onPress={() => router.push('/concierge')}
          activeOpacity={0.7}
        >
          <Text style={styles.conciergeLinkText}>Ask AI Concierge about this flight</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const BG   = '#FAFAF8';
const DARK = '#0A1128';
const MUTED = 'rgba(10,17,40,0.45)';
const BLUE  = '#1259F2';
const CARD  = '#fff';

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: BG },
  centered: { flex: 1, backgroundColor: BG, justifyContent: 'center', alignItems: 'center' },
  errText: { fontFamily: 'Inter_400Regular', fontSize: 16, color: MUTED },

  // Back button
  backBtn: {
    position: 'absolute', zIndex: 20, left: 16,
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.80)',
    alignItems: 'center', justifyContent: 'center',
  },
  backChevron: { fontFamily: 'Inter_500Medium', fontSize: 22, color: DARK, marginTop: -2 },

  // Hero
  hero: { width: '100%', height: 280, justifyContent: 'flex-end' },
  routePill: {
    marginBottom: 18, alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 100, paddingHorizontal: 16, paddingVertical: 6,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.30)',
  },
  routePillText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: '#fff', letterSpacing: 0.5 },

  // Title row
  titleRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, marginTop: 8,
  },
  aircraftName: { fontFamily: 'Inter_700Bold', fontSize: 22, color: DARK, flex: 1, marginRight: 12 },
  priceText:   { fontFamily: 'Inter_700Bold', fontSize: 22, color: BLUE },

  // Date
  dateText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: MUTED, paddingHorizontal: 20, marginTop: 4, marginBottom: 18 },

  // Horizontal route card
  routeCard: {
    marginHorizontal: 16, backgroundColor: CARD,
    borderRadius: 18, padding: 18, flexDirection: 'row', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowRadius: 20, shadowOpacity: 0.05, elevation: 3,
    marginBottom: 14,
  },
  routeEndpoint: { flex: 1, alignItems: 'flex-start' },
  routeCode:   { fontFamily: 'Inter_700Bold', fontSize: 18, color: DARK },
  routeTime:   { fontFamily: 'Inter_500Medium', fontSize: 14, color: DARK, marginTop: 2 },
  routeCity:   { fontFamily: 'Inter_400Regular', fontSize: 12, color: MUTED, marginTop: 2 },
  routeCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  routeLine:   { flex: 1, height: 1, backgroundColor: 'rgba(10,17,40,0.10)' },
  routeDot:    { width: 5, height: 5, borderRadius: 3, backgroundColor: BLUE },
  routeDuration: { fontFamily: 'Inter_500Medium', fontSize: 11, color: MUTED },

  // Amenity grid: 2-column
  amenityGrid: {
    flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 10, marginBottom: 14,
  },
  amenityTile: {
    width: '47.5%', backgroundColor: CARD, borderRadius: 14, padding: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2,
  },
  amenityLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
  amenityValue: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: DARK },

  // Passenger stepper
  stepperCard: {
    marginHorizontal: 16, backgroundColor: CARD, borderRadius: 18,
    paddingVertical: 14, paddingHorizontal: 18,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2,
    marginBottom: 16,
  },
  stepperLeft:  {},
  stepperTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: DARK },
  stepperHint:  { fontFamily: 'Inter_400Regular', fontSize: 12, color: MUTED, marginTop: 2 },
  stepper:      { flexDirection: 'row', alignItems: 'center', gap: 16 },
  stepBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(10,17,40,0.06)',
    alignItems: 'center', justifyContent: 'center',
  },
  stepBtnDisabled: { opacity: 0.35 },
  stepBtnText: { fontFamily: 'Inter_700Bold', fontSize: 18, color: DARK },
  stepCount:   { fontFamily: 'Inter_700Bold', fontSize: 18, color: DARK, minWidth: 22, textAlign: 'center' },

  // Policy link
  policyRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: 16, paddingVertical: 14,
    borderTopWidth: 1, borderTopColor: 'rgba(10,17,40,0.08)',
  },
  policyText:    { fontFamily: 'Inter_400Regular', fontSize: 14, color: MUTED },
  policyChevron: { fontFamily: 'Inter_400Regular', fontSize: 20, color: MUTED },

  // CTA bar
  ctaBar: {
    backgroundColor: BG, paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: 'rgba(10,17,40,0.08)',
    gap: 10,
  },
  skipBtn: {
    borderWidth: 1.5, borderColor: BLUE, borderRadius: 14, paddingVertical: 13, alignItems: 'center',
  },
  skipBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: BLUE },
  joinBtn: {
    backgroundColor: BLUE, borderRadius: 14, paddingVertical: 15, alignItems: 'center',
  },
  joinBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: '#fff' },
  conciergeLink: { alignItems: 'center', paddingBottom: 4 },
  conciergeLinkText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: MUTED },
});
