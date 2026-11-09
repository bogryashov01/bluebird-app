import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton, SecondaryButton } from '@/components/PrimaryButton';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { useClerkAuthSnapshot } from '@/lib/dormantClerkIntegration';
import { createClerkProductionTokenProvider, type ClerkSessionSnapshot } from '@/lib/clerkProductionTokenProvider';
import {
  FLIGHT_DETAIL_QUERY_BEHAVIOR,
  productionFlightDetailQueryKey,
  readProductionFlightDetailCache,
} from '@/lib/flightDetailPresentation';
import { getMainBluebirdApiConfigurationOrNull } from '@/lib/mainBluebirdApiConfig';
import { fetchProductionFlight, parseProductionFlightId } from '@/lib/productionFlights';
import { isQueueClosed } from '@/lib/winnerChecklist';
import {
  claimWinnerCelebration,
  presentWinnerOffer,
  presentWinnerOfferCopy,
} from '@/lib/winnerOfferPresentation';

export default function WinnerReviewScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ flightId?: string }>();
  const flightId = parseProductionFlightId(params.flightId);
  const { authMode, clerkUserId } = useAuth();
  const session = useClerkAuthSnapshot();
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const configuration = getMainBluebirdApiConfigurationOrNull();
  const signedIn = authMode === 'clerk' &&
    session?.isLoaded === true &&
    session.isSignedIn === true &&
    session.userId === clerkUserId &&
    !!clerkUserId;
  const flightQuery = useQuery({
    queryKey: configuration && clerkUserId && flightId !== null
      ? productionFlightDetailQueryKey(flightId, clerkUserId)
      : ['production-empty-leg', flightId ?? 'invalid', 'signed-out'],
    enabled: signedIn && !!configuration && flightId !== null,
    retry: false,
    ...FLIGHT_DETAIL_QUERY_BEHAVIOR,
    queryFn: async ({ signal }) => {
      if (!configuration || flightId === null || !clerkUserId) {
        throw new Error('A signed-in account is required.');
      }
      const requestedUserId = clerkUserId;
      const tokenProvider = createClerkProductionTokenProvider({
        getCurrentSession: () => {
          const current = sessionRef.current;
          if (!current || current.userId !== requestedUserId || current.isSignedIn !== true) {
            return {
              isLoaded: true,
              isSignedIn: false,
              getToken: async () => null,
              signOut: async () => {},
            } satisfies ClerkSessionSnapshot;
          }
          return current;
        },
      }, configuration.environment);
      const token = await tokenProvider.getVerifiedAccessToken();
      if (sessionRef.current?.userId !== requestedUserId) {
        throw Object.assign(new Error('The signed-in account changed.'), { code: 'cancelled' });
      }
      const flight = await fetchProductionFlight(flightId, { signal, accessToken: token });
      return { flight, viewerAuthenticated: true };
    },
  });
  const flight = readProductionFlightDetailCache(flightQuery.data)?.flight;
  const offer = presentWinnerOffer({
    viewerIsEffectiveWinner: flight?.viewerIsEffectiveWinner ?? null,
    viewerConfirmationStatus: flight?.viewerConfirmationStatus ?? null,
    queueClosed: flight ? isQueueClosed(flight.queueClosesAt, Date.now()) : null,
    awarded: null,
    bookedPassenger: flight?.viewerIsBookedPassenger ?? null,
    flightStatus: flight?.status ?? null,
    deadlineIso: null,
    nowMs: Date.now(),
  });
  const copy = presentWinnerOfferCopy(offer);
  const route = flight
    ? [flight.fromAirport, flight.toAirport].filter(Boolean).join(' → ')
    : '';
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (offer.kind !== 'pending' || !clerkUserId || flightId === null) return;
    if (!claimWinnerCelebration(clerkUserId, flightId)) return;
    opacity.setValue(0);
    scale.setValue(0.94);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 12, bounciness: 6 }),
    ]).start();
  }, [clerkUserId, flightId, offer.kind, opacity, scale]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.offWhite, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <Animated.View style={[styles.hero, { opacity, transform: [{ scale }] }]}>
        <Text style={[styles.kicker, { color: colors.primary }]}>BLUEBIRD</Text>
        <Text testID="winner-review-route" style={[styles.route, { color: colors.textOnSurface }]}>
          {route || 'Flight details unavailable'}
        </Text>
        <Text testID="winner-review-title" style={[styles.title, { color: colors.textOnSurface }]}>
          {copy?.title ?? 'Winner details are not available'}
        </Text>
        <Text testID="winner-review-status" style={[styles.body, { color: colors.mutedForegroundLight }]}>
          {copy?.body ?? 'This screen is waiting for the signed-in flight details.'}
        </Text>
      </Animated.View>
      {offer.kind === 'pending' && flightId !== null ? (
        <PrimaryButton
          label="Continue"
          testID="winner-review-continue"
          onPress={() => {
            void flightQuery.refetch();
            router.replace({ pathname: '/flight/[id]', params: { id: String(flightId) } });
          }}
        />
      ) : null}
      {offer.kind === 'confirmed' ? (
        <SecondaryButton
          label="View checklist"
          testID="winner-review-checklist"
          onPress={() => router.push({ pathname: '/flight/checklist', params: { legId: String(flightId) } })}
        />
      ) : null}
      <SecondaryButton label="Back" testID="winner-review-back" onPress={() => router.back()} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 24, justifyContent: 'center', gap: 28 },
  hero: { gap: 12 },
  kicker: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 1.4 },
  route: { fontFamily: 'Inter_700Bold', fontSize: 28, letterSpacing: -0.6 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 22, lineHeight: 28 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 23 },
});
