import React, { useCallback, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform, Alert, ImageBackground, useWindowDimensions,
  Modal, Pressable, Linking, TextInput,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useGetFlight, useGetFlightMyStatus, useCancelQueueEntry, useCancelTrip, useListAirports,
  useGetNetworkingFrontMember, useCreateNetworkingRequest,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { confirmDialog } from '@/lib/confirmDialog';
import { shouldUseLocalFlightReadMode } from '@/lib/clerkAuthSession';
import {
  getProductionQueueReadOnlyMessage,
  isProductionQueueVerified,
} from '@/lib/productionQueueReadiness';
import { ClerkQueuePanel } from '@/components/ClerkQueuePanel';
import {
  fetchProductionAirports,
  fetchProductionFlight,
  findProductionFlightById,
  getFlightAirportCodes,
  getFlightImagePresentation,
  isLocalFlightReadMode,
  mapLocalFlight,
  parseProductionFlightId,
  productionReadRetryDelay,
  shouldRetryProductionRead,
  type AirportRecord,
  type FlightView,
} from '@/lib/productionFlights';

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDate(d: string | null) {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const [y, m, day] = d.split('-').map(Number);
  const value = new Date(y, m - 1, day);
  if (value.getFullYear() !== y || value.getMonth() !== m - 1 || value.getDate() !== day) {
    return null;
  }
  return value.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

function formatTime12(t: string | null): string | null {
  if (!t || !/^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(t)) return null;
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m).padStart(2, '0')} ${ampm}`;
}
function flightStatusText(status: string | null): string | null {
  const value = status?.trim();
  if (!value) return null;
  if (value === 'available') return 'Available';
  if (value === 'published') return 'Available';
  return value.charAt(0).toUpperCase() + value.slice(1);
}
interface FlightInfoItem {
  label: string;
  value: string;
  detail?: string;
  detailTestID?: string;
  testID?: string;
  valueTestID?: string;
}

type AirportDisplayRecord = Pick<AirportRecord, 'code' | 'name' | 'city' | 'state' | 'country'>
  & Partial<Pick<AirportRecord, 'latitude' | 'longitude'>>;

interface DirectionsTarget {
  kind: 'airport' | 'fbo';
  label: string;
  destination: string;
  location?: string;
}

function FlightInfoCard({
  item,
  testID,
  colors,
}: {
  item: FlightInfoItem;
  testID: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View
      testID={testID}
      style={[styles.flightInfoCard, { backgroundColor: colors.surface, borderColor: colors.separator }]}
    >
      <Text style={[styles.flightInfoLabel, { color: colors.mutedForegroundLight }]}>{item.label}</Text>
      <Text
        testID={item.valueTestID}
        style={[styles.flightInfoValue, { color: colors.textOnSurface }]}
        numberOfLines={2}
      >
        {item.value}
      </Text>
      {!!item.detail && (
        <Text testID={item.detailTestID} style={[styles.flightInfoDetail, { color: colors.mutedForegroundLight }]} numberOfLines={1}>
          {item.detail}
        </Text>
      )}
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function FlightDetailScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  // Keep the aircraft image present without pushing the key flight details below the fold.
  const heroHeight = Math.round(Math.min(240, Math.max(150, windowHeight * 0.23)));
  const {
    user,
    updateUser,
    authMode,
    clerkSignedIn,
    clerkMemberResolution,
  } = useAuth();
  const queryClient = useQueryClient();
  const localReadMode = shouldUseLocalFlightReadMode(authMode, isLocalFlightReadMode());
  const numericFlightId = parseProductionFlightId(id);
  const [directionsTarget, setDirectionsTarget] = useState<DirectionsTarget | null>(null);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const [networkMessage, setNetworkMessage] = useState('');
  const [networkError, setNetworkError] = useState('');
  const [skipLineNavigationPending, setSkipLineNavigationPending] = useState(false);
  const skipLineNavigationLock = useRef(false);
  useFocusEffect(useCallback(() => {
    skipLineNavigationLock.current = false;
    setSkipLineNavigationPending(false);
  }, []));

  const localFlightQuery = useGetFlight(id ?? '', {
    query: { enabled: localReadMode && !!id },
  });
  const productionFlightQuery = useQuery({
    queryKey: ['production-empty-leg', numericFlightId],
    queryFn: ({ signal }) => fetchProductionFlight(numericFlightId!, { signal }),
    enabled: !localReadMode && numericFlightId !== null,
    retry: shouldRetryProductionRead,
    retryDelay: productionReadRetryDelay,
  });
  const flight: FlightView | undefined = localReadMode
    ? (localFlightQuery.data ? mapLocalFlight(localFlightQuery.data) : undefined)
    : findProductionFlightById(
      productionFlightQuery.data ? [productionFlightQuery.data] : undefined,
      numericFlightId,
    );
  const localAirportsQuery = useListAirports({
    query: { enabled: localReadMode && !!flight },
  });
  const productionAirportCodes = getFlightAirportCodes(
    flight?.source === 'production' ? [flight] : [],
  );
  const productionAirportsQuery = useQuery({
    queryKey: ['production-airports', productionAirportCodes],
    queryFn: ({ signal }) => fetchProductionAirports(productionAirportCodes, { signal }),
    enabled: !localReadMode && flight?.source === 'production' && productionAirportCodes.length > 0,
    retry: shouldRetryProductionRead,
    retryDelay: productionReadRetryDelay,
  });
  const localAirportGroups = Array.isArray(localAirportsQuery.data) ? localAirportsQuery.data : [];
  const localAirportRecords = localAirportGroups.flatMap((group) =>
    (Array.isArray(group?.airports) ? group.airports : []).map((airport) => ({
      code: airport.code,
      name: airport.name,
      city: airport.city,
      state: null,
      country: null,
    })),
  );
  const airportRecords: AirportDisplayRecord[] = localReadMode
    ? localAirportRecords
    : productionAirportsQuery.data ?? [];
  const isLoading = localReadMode ? localFlightQuery.isLoading : productionFlightQuery.isLoading;
  const isError = localReadMode ? localFlightQuery.isError : productionFlightQuery.isError;
  const isRetryingFlight = localReadMode ? localFlightQuery.isFetching : productionFlightQuery.isFetching;
  const retryFlight = localReadMode ? localFlightQuery.refetch : productionFlightQuery.refetch;

  // Fetch the user's relationship to this flight (requires auth)
  const {
    data: myStatus,
    isLoading: statusLoading,
  } = useGetFlightMyStatus(id!, {
    query: {
      enabled: localReadMode && !!user && !!id,
      refetchInterval: user ? 10_000 : false,
      refetchOnMount: 'always',
    },
  });
  const { data: frontMember } = useGetNetworkingFrontMember(id!, {
    query: {
      enabled: localReadMode && !!user && String(user.membershipTier) !== 'none' && !!id,
      refetchInterval: 15000,
      refetchOnMount: 'always',
    },
  });
  const networkingRequest = useCreateNetworkingRequest();

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

  const cancelTripMutation = useCancelTrip({
    mutation: {
      onSuccess: (data: any) => {
        queryClient.invalidateQueries({ queryKey: ['/api/trips'] });
        queryClient.invalidateQueries({ queryKey: ['/api/queue/status'] });
        queryClient.invalidateQueries({ queryKey: ['/api/flights'] });
        queryClient.invalidateQueries({ queryKey: [`/api/flights/${id}`] });
        queryClient.invalidateQueries({ queryKey: [`/api/flights/${id}/my-status`] });
        if (user && typeof data?.linePassCount === 'number') {
          updateUser({ ...user, linePassCount: data.linePassCount });
        }
      },
      onError: (err: any) => {
        const msg = err?.data?.error || err?.message || 'Failed to cancel booking';
        if (Platform.OS === 'web') {
          if (typeof window !== 'undefined') window.alert(msg);
        } else {
          Alert.alert('Cancellation failed', msg);
        }
      },
    },
  });

  const handleCancelBooking = async () => {
    if (!myStatus?.tripId || cancelTripMutation.isPending) return;
    const route = flight ? `${(flight as any).fromCity} → ${(flight as any).toCity}` : 'this flight';
    const ok = await confirmDialog(
      'Cancel booking?',
      `Your seat on ${route} will be released to the next member in line. If you used a Skip the Line pass for this booking, it will be returned to your balance.`,
      'Cancel Booking',
      true,
    );
    if (ok) cancelTripMutation.mutate({ id: myStatus.tripId });
  };

  const handleLeaveQueue = async () => {
    if (!myStatus?.queueEntryId) return;
    const ok = await confirmDialog('Leave Queue?', 'You will lose your position in the queue.', 'Leave Queue', true);
    if (ok) cancelMutation.mutate({ id: myStatus.queueEntryId! });
  };

  const sendNetworkingRequest = () => {
    const message = networkMessage.trim();
    if (!message || networkingRequest.isPending) return;
    setNetworkError('');
    networkingRequest.mutate({ data: { flightId: id!, message } }, {
      onSuccess: () => setNetworkMessage(''),
      onError: (err: any) => {
        if (err?.data?.code === 'MEMBERSHIP_REQUIRED') {
          router.push('/membership/plans' as any);
          return;
        }
        setNetworkError(err?.data?.error ?? err?.message ?? 'Could not send your introduction.');
      },
    });
  };

  // ── Loading / Error — guards before any flight-property access ──
  if (isLoading && !flight) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.offWhite }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }
  if (!flight) {
    const canRetry = localReadMode ? !!id : numericFlightId !== null;
    return (
      <View style={[styles.centered, { backgroundColor: colors.offWhite }]}>
        <Text style={[styles.errText, { color: colors.mutedForegroundLight }]}>
          {isError ? 'Could not load flight details' : 'Flight unavailable'}
        </Text>
        {isError && (
          <Text style={[styles.errorBody, { color: colors.mutedForegroundLight }]}>
            Check your connection and try again.
          </Text>
        )}
        {!isError && (
          <Text style={[styles.errorBody, { color: colors.mutedForegroundLight }]}>
            This flight could not be found in the selected flight service.
          </Text>
        )}
        {canRetry && (
          <TouchableOpacity
            testID="flight-detail-retry"
            accessibilityRole="button"
            disabled={isRetryingFlight}
            style={[styles.retryBtn, { backgroundColor: colors.primary, opacity: isRetryingFlight ? 0.65 : 1 }]}
            onPress={() => void retryFlight()}
          >
            {isRetryingFlight
              ? <ActivityIndicator color={colors.primaryForeground} />
              : <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Try again</Text>}
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // f is guaranteed non-null below this point
  const f = flight;
  const imagePresentation = getFlightImagePresentation(f);
  const aircraftName = f.aircraftTypeName?.trim() || f.aircraftType?.trim() || null;
  const imgSource = imagePresentation === 'provided' && failedImageUrl !== f.imageUrl
    ? { uri: f.imageUrl! }
    : null;
  const readOnlyProduction = f.source === 'production';
  const clerkMembership =
    authMode === 'clerk' && clerkMemberResolution.status === 'profile_complete'
      ? clerkMemberResolution.currentUser.isMember
      : null;
  const skipLineRequiresMembership =
    authMode === 'clerk'
      ? !clerkSignedIn || clerkMembership === false
      : !user || String(user.membershipTier) === 'none';

  const openSkipLinePass = () => {
    if (skipLineNavigationLock.current) return;
    skipLineNavigationLock.current = true;
    setSkipLineNavigationPending(true);
    if (skipLineRequiresMembership) {
      router.push({
        pathname: '/membership/join' as any,
        params: { flightId: String(f.id) },
      });
      return;
    }
    router.push({
      pathname: '/flight/skip-line-pass',
      params: {
        flightId: String(f.id),
        route: routeSummary,
        flightAvailable: flightAvailable ? 'true' : 'false',
      },
    } as any);
  };

  const status = myStatus?.status ?? 'none';
  // Public flight responses intentionally omit FBO details. A confirmed
  // member receives them only from the authenticated status response.
  const confirmedFbo = status === 'confirmed' ? myStatus?.confirmedFlight : undefined;
  const departureFbo = confirmedFbo?.departureFbo ?? null;
  const departureFboAddress = confirmedFbo?.departureFboAddress ?? null;
  const hasAuthorizedFboLocation =
    status === 'confirmed' &&
    !!departureFbo?.trim() &&
    !!departureFboAddress?.trim();
  const fromAirport = f.fromAirport?.trim() || null;
  const fromCity = f.fromCity?.trim() || null;
  const toAirport = f.toAirport?.trim() || null;
  const toCity = f.toCity?.trim() || null;
  const fromLabel = fromAirport ?? fromCity;
  const toLabel = toAirport ?? toCity;
  const departureTime = formatTime12(f.departureTime);
  const arrivalTime = formatTime12(f.arrivalTime);
  const dateLabel = formatDate(f.departureDate);
  const arrivalDateLabel = formatDate(f.arrivalDate);
  const distinctArrivalDate = arrivalDateLabel && arrivalDateLabel !== dateLabel
    ? arrivalDateLabel
    : null;
  const scheduleParts = [
    dateLabel,
    departureTime
      ? `Departs ${departureTime}${f.departureTimeZone ? ` ${f.departureTimeZone}` : ''}`
      : null,
  ].filter((part): part is string => !!part);
  const routeSummary = fromAirport || toAirport
    ? `${fromAirport ?? '—'} → ${toAirport ?? '—'}`
    : 'Route unavailable';
  const findAirport = (code: string | null) =>
    code ? airportRecords.find((airport) => airport.code === code.toUpperCase()) : undefined;
  const originAirportInfo = findAirport(fromAirport);
  const destinationAirportInfo = findAirport(toAirport);
  const formatAirportLocation = (airport: AirportDisplayRecord | undefined, city: string | null) =>
    [
      airport?.city?.trim() || city,
      airport?.state?.trim(),
      airport?.country?.trim(),
    ].filter((part): part is string => !!part?.trim()).join(', ');
  const hasCoordinates = (airport: AirportDisplayRecord | undefined) =>
    Number.isFinite(airport?.latitude) && Number.isFinite(airport?.longitude);
  const airportDirectionsTarget = (
    code: string | null,
    airport: AirportDisplayRecord | undefined,
  ): DirectionsTarget | null => {
    if (!hasCoordinates(airport)) return null;
    const label = airport?.name?.trim()
      ? `${airport.name.trim()}${code ? ` (${code})` : ''}`
      : code ?? airport?.city?.trim() ?? null;
    if (!label) return null;
    return {
      kind: 'airport',
      label,
      destination: `${airport!.latitude},${airport!.longitude}`,
      location: formatAirportLocation(airport, null) || undefined,
    };
  };
  const departureAirportTarget = airportDirectionsTarget(fromAirport, originAirportInfo);
  const arrivalAirportTarget = airportDirectionsTarget(toAirport, destinationAirportInfo);
  const departureAirportLocation = formatAirportLocation(originAirportInfo, fromCity);
  const arrivalAirportLocation = formatAirportLocation(destinationAirportInfo, toCity);
  const departureFboTarget: DirectionsTarget | null = hasAuthorizedFboLocation
    ? {
      kind: 'fbo',
      label: departureFbo!.trim(),
      destination: departureFboAddress!.trim(),
    }
    : null;
  const flightInformation: FlightInfoItem[] = [
    ...(aircraftName
      ? [{
        label: 'Aircraft',
        value: aircraftName,
        detail: f.aircraftTypeCode?.trim() || undefined,
        testID: 'flight-info-aircraft',
        detailTestID: 'flight-info-aircraft-code',
        valueTestID: 'flight-info-aircraft-type',
      }]
      : []),
    ...(f.duration?.trim()
      ? [{
        label: 'Duration',
        value: f.duration.trim(),
        testID: 'flight-info-duration-card',
        valueTestID: 'flight-info-duration',
      }]
      : []),
    ...(f.international !== null
      ? [{
        label: 'Route type',
        value: f.international ? 'International' : 'Domestic',
        testID: 'flight-info-international-card',
        valueTestID: 'flight-info-international',
      }]
      : []),
    ...(flightStatusText(f.status)
      ? [{
        label: 'Status',
        value: flightStatusText(f.status)!,
        testID: 'flight-info-status-card',
        valueTestID: 'flight-info-status',
      }]
      : []),
  ];

  const showMapError = (target: string) => {
    const message = `We couldn't open maps. Search for this location instead:\n\n${target}`;
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') window.alert(message);
    } else {
      Alert.alert('Unable to open maps', message);
    }
  };

  const openDirections = async (service: 'apple' | 'google') => {
    const target = directionsTarget;
    setDirectionsTarget(null);
    if (!target) return;
    const destination = encodeURIComponent(target.destination.replace(/\n/g, ', '));
    const url = service === 'apple'
      ? `https://maps.apple.com/?daddr=${destination}&dirflg=d`
      : `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
    try {
      await Linking.openURL(url);
    } catch {
      showMapError(target.kind === 'fbo' ? target.destination : target.label);
    }
  };

  const flightAvailable = f.status === 'available';
  const STATUS_LABELS: Record<string, string> = {
    boarding: 'Boarding',
    departed: 'Departed',
    completed: 'Completed',
    cancelled: 'Cancelled',
  };
  const statusLabel = STATUS_LABELS[f.status as string] ?? 'Unavailable';
  const responseFlightId = readOnlyProduction ? parseProductionFlightId(f.id) : null;
  const productionFlightId =
    responseFlightId !== null && responseFlightId === numericFlightId
      ? responseFlightId
      : null;

  // ── CTA footer rendering — branched on my-status ─────────────────────────
  function renderCTA() {
    // Keep production queue actions behind the runtime verification gate.
    // Until it opens, this stays a public read-only details screen.
    if (readOnlyProduction) {
      if (isProductionQueueVerified()) {
        return productionFlightId === null ? (
          renderUnavailableCTA('Queue unavailable', 'This flight does not have a valid queue identifier.')
        ) : (
          <ClerkQueuePanel
            emptyLegId={productionFlightId}
            existingSkipLineCredits={0}
            flightStatus={f.status}
          />
        );
      }
      return (
        <>
          <View style={[styles.unavailableBadge, { backgroundColor: colors.muted }]}>
            <Text style={[styles.unavailableBadgeText, { color: colors.mutedForegroundLight }]}>
              Queue temporarily unavailable
            </Text>
          </View>
          <Text
            testID="production-queue-read-only-message"
            style={[styles.unavailableHint, { color: colors.mutedForegroundLight }]}
          >
            {getProductionQueueReadOnlyMessage()}
          </Text>
          <TouchableOpacity
            testID="production-queue-read-only-cta"
            accessibilityRole="button"
            accessibilityLabel="View queue availability"
            disabled={productionFlightId === null}
            onPress={() => {
              if (productionFlightId === null) return;
              router.push({
                pathname: '/queue/production-unavailable',
                params: { flightId: String(productionFlightId) },
              });
            }}
            style={[
              styles.queueReadOnlyLink,
              { backgroundColor: colors.primary, opacity: productionFlightId === null ? 0.5 : 1 },
            ]}
          >
            <Text style={[styles.queueReadOnlyLinkText, { color: colors.primaryForeground }]}>
              View availability
            </Text>
          </TouchableOpacity>
        </>
      );
    }

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
      return renderUnavailableCTA(
        'Sign in required',
        'Sign in to review account-specific access. Queue and booking requests are unavailable from this screen.',
      );
    }

    if (String(user.membershipTier) === 'none') {
      return renderUnavailableCTA(
        'Membership required',
        'A membership is required to join. Membership changes are unavailable from this flight detail screen.',
      );
    }

    // Keep queue state explicit while it is loading; if the request fails,
    // avoid leaving a spinner on screen or implying that a request was sent.
    if (statusLoading) {
      return (
        <View style={styles.statusLoadingRow}>
          <ActivityIndicator color={colors.primary} size="small" />
        </View>
      );
    }
    if (!myStatus) {
      return renderUnavailableCTA(
        'Queue access unavailable',
        'We could not verify your access for this flight. No queue or booking request was sent.',
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
          {!!myStatus?.tripId && (
            <TouchableOpacity
              testID="open-passenger-list"
              style={[styles.leaveQueueBtn, { borderColor: colors.primary }]}
              onPress={() => router.push(`/trip/${myStatus.tripId}/passengers` as any)}
              activeOpacity={0.75}
            >
              <Text style={[styles.leaveQueueBtnText, { color: colors.primary }]}>
                Passenger Information{myStatus?.manifest ? ` — ${myStatus.manifest.completedCount} of ${myStatus.manifest.requiredCount} completed` : ''}
              </Text>
            </TouchableOpacity>
          )}
          {!!myStatus?.tripId && (
            <TouchableOpacity
              style={[styles.leaveQueueBtn, { borderColor: colors.border }, cancelTripMutation.isPending && { opacity: 0.6 }]}
              onPress={handleCancelBooking}
              disabled={cancelTripMutation.isPending}
              activeOpacity={0.75}
            >
              {cancelTripMutation.isPending
                ? <ActivityIndicator color={colors.mutedForegroundLight} size="small" />
                : <Text style={[styles.leaveQueueBtnText, { color: colors.mutedForegroundLight }]}>Cancel Booking</Text>
              }
            </TouchableOpacity>
          )}
        </>
      );
    }

    if (status === 'waiting') {
      const anyPending = cancelMutation.isPending;
      return (
        <>
          <View style={[styles.queuePositionCard, { backgroundColor: colors.primary + '12' }]}>
            <Text style={[styles.queuePositionLabel, { color: colors.mutedForegroundLight }]}>Your queue position</Text>
            <Text style={[styles.queuePositionNumber, { color: colors.textOnSurface }]}>
              #{myStatus?.queuePosition}
              <Text style={[styles.queuePositionTotal, { color: colors.mutedForegroundLight }]}> of {myStatus?.totalInQueue}</Text>
            </Text>
            {myStatus?.queuePosition === 1 && (
              <Text style={[styles.queuePositionEligible, { color: colors.success }]}>You're next — your seat will be confirmed automatically</Text>
            )}
          </View>
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

    return renderUnavailableCTA(
      'Request unavailable',
      'Queue and booking requests are not available from this flight detail screen.',
    );
  }

  function renderUnavailableCTA(title: string, message: string) {
    return (
      <>
        <View style={[styles.unavailableBadge, { backgroundColor: colors.muted }]}>
          <Text style={[styles.unavailableBadgeText, { color: colors.mutedForegroundLight }]}>{title}</Text>
        </View>
        <Text style={[styles.unavailableHint, { color: colors.mutedForegroundLight }]}>{message}</Text>
      </>
    );
  }

  function renderAirportRow(
    label: 'Departure' | 'Arrival',
    code: string | null,
    city: string | null,
    airport: AirportDisplayRecord | undefined,
    location: string,
    target: DirectionsTarget | null,
  ) {
    const airportName = airport?.name?.trim() || null;
    const primary = airportName
      ? `${airportName}${code ? ` (${code})` : ''}`
      : code ?? city;
    if (!primary) return null;
    const rowContent = (
      <>
        <View style={styles.airportRowCopy}>
          <Text style={[styles.airportRowLabel, { color: colors.mutedForegroundLight }]}>{label}</Text>
          <Text style={[styles.airportRowName, { color: colors.textOnSurface }]} numberOfLines={1}>
            {primary}
          </Text>
          {!!location && (
            <Text style={[styles.airportRowLocation, { color: colors.mutedForegroundLight }]} numberOfLines={1}>
              {location}
            </Text>
          )}
        </View>
        {target && (
          <Feather name="navigation" size={17} color={colors.primary} />
        )}
      </>
    );
    return (
      <View
        key={label}
        testID={`flight-airport-${label.toLowerCase()}`}
        style={[styles.airportRow, { backgroundColor: colors.surface }]}
      >
        {target ? (
          <TouchableOpacity
            testID={label === 'Departure' ? 'departure-airport-directions' : 'arrival-airport-directions'}
            style={styles.airportRowAction}
            onPress={() => setDirectionsTarget(target)}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={`Get directions to ${target.label}`}
            accessibilityHint="Choose Apple Maps or Google Maps"
          >
            {rowContent}
          </TouchableOpacity>
        ) : (
          <View style={styles.airportRowAction}>{rowContent}</View>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.offWhite }]}>
      {/* ── Frosted back button (floats above hero) ── */}
      <TouchableOpacity
        style={[styles.backBtn, { top: backTop, backgroundColor: colors.surface + 'CC' }]}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/discover'))}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Back to flights"
        testID="flight-detail-back"
      >
        <Text style={[styles.backChevron, { color: colors.textOnSurface }]}>‹</Text>
      </TouchableOpacity>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: botPad + 180 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero image with gradient ── */}
        <View style={[styles.heroFrame, { height: heroHeight }]}>
          {imgSource ? (
            <ImageBackground
              testID="flight-detail-photo"
              source={imgSource}
              style={StyleSheet.absoluteFill}
              onError={() => setFailedImageUrl(f.imageUrl)}
            >
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
            </ImageBackground>
          ) : (
            <View
              testID="flight-detail-photo-unavailable"
              style={[styles.heroUnavailable, { backgroundColor: colors.muted }]}
            >
              <Feather name="image" size={28} color={colors.mutedForeground} />
              <Text style={[styles.heroUnavailableText, { color: colors.mutedForeground }]}>
                Aircraft photo unavailable
              </Text>
            </View>
          )}
          {!!(fromAirport || toAirport) && (
            <View
              testID="flight-detail-hero-route"
              style={[
                styles.heroRouteBadge,
                {
                  backgroundColor: imgSource ? colors.primaryForeground + '2E' : colors.surface,
                  borderColor: imgSource ? colors.primaryForeground + '4D' : colors.border,
                },
              ]}
            >
              <Text style={[styles.heroRouteBadgeText, { color: imgSource ? colors.primaryForeground : colors.textOnSurface }]}>
                {routeSummary}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.flightHeader}>
          {!!aircraftName && (
            <Text style={[styles.aircraftName, { color: colors.textOnSurface }]} numberOfLines={1}>
              {aircraftName}
            </Text>
          )}
          {scheduleParts.length > 0 && (
            <Text style={[styles.dateText, { color: colors.mutedForegroundLight }]} numberOfLines={1}>
              {scheduleParts.join(' · ')}
            </Text>
          )}
        </View>

        {/* ── Compact route and local schedule ── */}
        <View
          testID="flight-detail-route-card"
          style={[styles.routeCard, { backgroundColor: colors.surface, borderColor: colors.separator }]}
        >
          <Text
            testID="flight-detail-route"
            style={[styles.routeSummary, { color: colors.textOnSurface }]}
            numberOfLines={1}
          >
            {routeSummary}
          </Text>
          <View style={styles.routeSchedule}>
            <View style={styles.routeEndpoint}>
              {departureTime && (
                <Text
                  testID="flight-detail-route-departure-time"
                  style={[styles.routeTime, { color: colors.textOnSurface }]}
                  numberOfLines={1}
                >
                  {departureTime}
                </Text>
              )}
              {!!(fromCity || originAirportInfo?.city) && (
                <Text style={[styles.routeCity, { color: colors.mutedForegroundLight }]} numberOfLines={1}>
                  {fromCity || originAirportInfo?.city}
                </Text>
              )}
            </View>
            <View style={styles.routeCenter}>
              <View style={[styles.routeLine, { backgroundColor: colors.separator }]} />
              <View style={[styles.routeDot, { backgroundColor: colors.primary }]} />
              {!!f.duration && (
                <Text testID="flight-detail-route-duration" style={[styles.routeDuration, { color: colors.mutedForegroundLight }]} numberOfLines={1}>
                  {f.duration}
                </Text>
              )}
              <View style={[styles.routeDot, { backgroundColor: colors.primary }]} />
              <View style={[styles.routeLine, { backgroundColor: colors.separator }]} />
            </View>
            <View style={[styles.routeEndpoint, styles.routeEndpointRight]}>
              {arrivalTime && (
                <Text
                  testID="flight-detail-route-arrival-time"
                  style={[styles.routeTime, { color: colors.textOnSurface }]}
                  numberOfLines={1}
                >
                  {arrivalTime}
                </Text>
              )}
              {!!distinctArrivalDate && (
                <Text
                  testID="flight-detail-route-arrival-date"
                  style={[styles.routeCity, { color: colors.mutedForegroundLight }]}
                  numberOfLines={1}
                >
                  Arrives {distinctArrivalDate}
                </Text>
              )}
              {!!(toCity || destinationAirportInfo?.city) && (
                <Text style={[styles.routeCity, { color: colors.mutedForegroundLight }]} numberOfLines={1}>
                  {toCity || destinationAirportInfo?.city}
                </Text>
              )}
            </View>
          </View>
        </View>

        <TouchableOpacity
          testID="flight-skip-line-pass-card"
          accessibilityRole="button"
          accessibilityLabel="Skip the Line Pass details"
          accessibilityHint="Opens pass eligibility and availability information"
          disabled={skipLineNavigationPending}
          onPress={openSkipLinePass}
          activeOpacity={0.78}
          style={[
            styles.skipLineCard,
            { backgroundColor: colors.surface, borderColor: colors.separator },
            skipLineNavigationPending && { opacity: 0.7 },
          ]}
        >
          <View style={[styles.skipLineIcon, { backgroundColor: colors.primary + '16' }]}>
            <Feather name="fast-forward" size={19} color={colors.primary} />
          </View>
          <View style={styles.skipLineCopy}>
            <Text style={[styles.skipLineTitle, { color: colors.textOnSurface }]}>Skip the Line Pass</Text>
            <Text style={[styles.skipLineSubtitle, { color: colors.mutedForegroundLight }]}>
              Check pass details, eligibility and availability
            </Text>
          </View>
          <Feather name="chevron-right" size={19} color={colors.mutedForegroundLight} />
        </TouchableOpacity>

        {/* ── Four supported flight facts ── */}
        {flightInformation.length > 0 && (
          <View style={styles.flightInfoSection}>
            <Text testID="flight-info-section-title" style={[styles.flightInfoTitle, { color: colors.textOnSurface }]}>
              Flight information
            </Text>
            <View style={styles.flightInfoGrid}>
              {flightInformation.map((item) => (
                <FlightInfoCard
                  key={item.label}
                  item={item}
                  testID={item.testID!}
                  colors={colors}
                />
              ))}
            </View>
          </View>
        )}

        {/* ── Airport locations only use names and locations returned by the readers ── */}
        {(fromLabel || toLabel) && (
          <View style={styles.airportSection}>
            <Text style={[styles.flightInfoTitle, { color: colors.textOnSurface }]}>Airport locations</Text>
            {renderAirportRow(
              'Departure',
              fromAirport,
              fromCity,
              originAirportInfo,
              departureAirportLocation,
              departureAirportTarget,
            )}
            {renderAirportRow(
              'Arrival',
              toAirport,
              toCity,
              destinationAirportInfo,
              arrivalAirportLocation,
              arrivalAirportTarget,
            )}
          </View>
        )}

        {!!frontMember?.eligible && frontMember.member && (
          <View style={[styles.networkCard, { backgroundColor: colors.surface, borderColor: colors.primary + '35' }]}>
            <View style={styles.networkHeading}>
              <View style={[styles.networkAvatar, { backgroundColor: colors.primary + '18' }]}>
                <Text style={[styles.networkAvatarText, { color: colors.primary }]}>{frontMember.member.firstName?.[0] ?? '?'}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.networkEyebrow, { color: colors.primary }]}>MEET YOUR FELLOW MEMBER</Text>
                <Text style={[styles.networkName, { color: colors.textOnSurface }]}>{frontMember.member.firstName}</Text>
                <Text style={[styles.networkIndustry, { color: colors.mutedForegroundLight }]}>{frontMember.member.industry}</Text>
              </View>
            </View>
            <Text style={[styles.networkCopy, { color: colors.mutedForegroundLight }]}>
              They’re currently first in line for this flight. Send a short introduction without changing your queue position.
            </Text>
            <TextInput
              value={networkMessage}
              onChangeText={setNetworkMessage}
              placeholder="Hi — I’d enjoy meeting before the flight…"
              placeholderTextColor={colors.mutedForegroundLight}
              maxLength={240}
              multiline
              style={[styles.networkInput, { color: colors.textOnSurface, backgroundColor: colors.muted, borderColor: colors.border }]}
            />
            {networkError ? <Text style={[styles.networkError, { color: colors.destructive }]}>{networkError}</Text> : null}
            <TouchableOpacity
              style={[styles.networkButton, { backgroundColor: colors.primary, opacity: networkMessage.trim() && !networkingRequest.isPending ? 1 : 0.55 }]}
              disabled={!networkMessage.trim() || networkingRequest.isPending}
              onPress={sendNetworkingRequest}
              activeOpacity={0.8}
            >
              {networkingRequest.isPending
                ? <ActivityIndicator color={colors.primaryForeground} size="small" />
                : <Text style={[styles.networkButtonText, { color: colors.primaryForeground }]}>Send introduction</Text>}
            </TouchableOpacity>
          </View>
        )}

        {/* ── FBO destination remains separate and is only read for confirmed members ── */}
        {!!departureFboTarget && (
          <TouchableOpacity
            style={[styles.fboCard, { backgroundColor: colors.backgroundMid }]}
            onPress={() => setDirectionsTarget(departureFboTarget)}
            activeOpacity={0.78}
            accessibilityRole="button"
            accessibilityLabel={`Get directions to ${departureFboTarget.label}`}
            accessibilityHint="Choose Apple Maps or Google Maps"
            testID="departure-fbo-directions"
          >
            <View style={styles.fboHeader}>
              <Text style={[styles.fboLabel, { color: colors.mutedOnBrand }]}>
                FBO · DEPARTURE
              </Text>
              <Feather name="navigation" size={19} color={colors.textOnBrand} />
            </View>
            <Text style={[styles.fboValue, { color: colors.textOnBrand }]}>
              {departureFboTarget.label}
            </Text>
            <Text style={[styles.fboAddress, { color: colors.mutedOnBrand }]}>
              {departureFboAddress}
            </Text>
            <Text style={[styles.fboAction, { color: colors.textOnBrand }]}>Get directions</Text>
          </TouchableOpacity>
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

      <Modal
        visible={!!directionsTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setDirectionsTarget(null)}
      >
        <Pressable
          style={[styles.modalBackdrop, { backgroundColor: colors.backgroundMid + 'B8', paddingBottom: botPad + 12 }]}
          onPress={() => setDirectionsTarget(null)}
        >
          <Pressable style={[styles.mapSheet, { backgroundColor: colors.surface }]} onPress={(event) => event.stopPropagation()}>
            <View style={styles.mapSheetHeader}>
              <View style={styles.mapSheetTitleGroup}>
                <Text style={[styles.mapSheetTitle, { color: colors.textOnSurface }]}>
                  Directions to {directionsTarget?.label}
                </Text>
                <Text style={[styles.mapSheetAddress, { color: colors.mutedForegroundLight }]}>
                  {directionsTarget?.kind === 'fbo'
                    ? directionsTarget.destination
                    : directionsTarget?.location || directionsTarget?.label}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.mapSheetClose}
                onPress={() => setDirectionsTarget(null)}
                accessibilityRole="button"
                accessibilityLabel="Close directions choices"
              >
                <Feather name="x" size={23} color={colors.mutedForegroundLight} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.mapChoice, { borderColor: colors.separator }]}
              onPress={() => openDirections('apple')}
              testID="open-apple-maps"
            >
              <Feather name="map-pin" size={20} color={colors.primary} />
              <Text style={[styles.mapChoiceText, { color: colors.textOnSurface }]}>Open in Apple Maps</Text>
              <Feather name="external-link" size={17} color={colors.mutedForegroundLight} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.mapChoice, { borderColor: colors.separator }]}
              onPress={() => openDirections('google')}
              testID="open-google-maps"
            >
              <Feather name="map" size={20} color={colors.primary} />
              <Text style={[styles.mapChoiceText, { color: colors.textOnSurface }]}>Open in Google Maps</Text>
              <Feather name="external-link" size={17} color={colors.mutedForegroundLight} />
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Bottom sticky CTA ── */}
      {!directionsTarget && (
        <View style={[styles.ctaBar, { backgroundColor: colors.offWhite, borderTopColor: colors.separator, paddingBottom: botPad + 12 }]}>
          {renderCTA()}
          <TouchableOpacity
            style={styles.conciergeLink}
            onPress={() => router.push({ pathname: '/concierge' })}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Ask AI Concierge"
          >
            <Text style={[styles.conciergeLinkText, { color: colors.mutedForegroundLight }]}>Ask AI Concierge</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root:    { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errText: { fontFamily: 'Inter_400Regular', fontSize: 16 },
  errorBody: { fontFamily: 'Inter_400Regular', fontSize: 14, textAlign: 'center', marginTop: 8, paddingHorizontal: 28 },
  retryBtn: { borderRadius: 999, minHeight: 44, minWidth: 132, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22, marginTop: 18 },
  retryText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },

  // Back button
  backBtn: {
    position: 'absolute', zIndex: 20, left: 16,
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
  },
  backChevron: { fontFamily: 'Inter_500Medium', fontSize: 22, marginTop: -2 },

  // Hero
  heroFrame: {
    width: '100%', justifyContent: 'flex-end', position: 'relative', overflow: 'hidden',
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
  },
  heroUnavailable: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  heroUnavailableText: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  heroRouteBadge: {
    position: 'absolute', left: 16, bottom: 13,
    borderRadius: 999, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 6,
  },
  heroRouteBadgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, letterSpacing: 0.35 },
  // Aircraft and date header
  flightHeader: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 10 },
  aircraftName: { fontFamily: 'Inter_700Bold', fontSize: 20 },

  // Date
  dateText: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 3 },

  // Compact route card
  routeCard: {
    marginHorizontal: 16, marginBottom: 12,
    borderRadius: 16, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 13,
  },
  skipLineCard: {
    minHeight: 74,
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 15,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  skipLineIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  skipLineCopy: { flex: 1, minWidth: 0 },
  skipLineTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  skipLineSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16, marginTop: 3 },
  routeSummary: { fontFamily: 'Inter_700Bold', fontSize: 19, textAlign: 'center', letterSpacing: 0.2 },
  routeSchedule: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  routeEndpoint: { flex: 1, minWidth: 0, alignItems: 'flex-start' },
  routeEndpointRight: { alignItems: 'flex-end' },
  routeTime:   { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  routeCity:   { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 2 },
  routeCenter: { flex: 1.1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  routeLine:   { flex: 1, height: 1 },
  routeDot:    { width: 5, height: 5, borderRadius: 3 },
  routeDuration: { fontFamily: 'Inter_500Medium', fontSize: 10 },

  // Flight information
  flightInfoSection: { marginHorizontal: 16, marginBottom: 12 },
  flightInfoTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, marginHorizontal: 2, marginBottom: 7 },
  flightInfoGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  flightInfoCard: {
    width: '48.5%', borderRadius: 13, borderWidth: 1, borderColor: 'transparent',
    paddingHorizontal: 12, paddingVertical: 9, marginBottom: 7,
  },
  flightInfoLabel: { fontFamily: 'Inter_500Medium', fontSize: 10, letterSpacing: 0.3 },
  flightInfoValue: { fontFamily: 'Inter_600SemiBold', fontSize: 14, lineHeight: 18, marginTop: 3 },
  flightInfoDetail: { fontFamily: 'Inter_400Regular', fontSize: 10, marginTop: 1 },

  // Compact airport rows
  airportSection: { marginHorizontal: 16, marginBottom: 12 },
  airportRow: { borderRadius: 13, marginBottom: 7, overflow: 'hidden' },
  airportRowAction: {
    minHeight: 58, paddingHorizontal: 13, paddingVertical: 9,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  },
  airportRowCopy: { flex: 1, minWidth: 0 },
  airportRowLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 9, letterSpacing: 0.8 },
  airportRowName: { fontFamily: 'Inter_600SemiBold', fontSize: 13, marginTop: 2 },
  airportRowLocation: { fontFamily: 'Inter_400Regular', fontSize: 10, marginTop: 1 },

  // Dark FBO departure card
  fboCard: {
    marginHorizontal: 16, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 18,
    marginBottom: 12,
  },
  fboLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 1, marginBottom: 4 },
  fboValue: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  fboHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fboAddress: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, marginTop: 7 },
  fboAction: { fontFamily: 'Inter_600SemiBold', fontSize: 13, marginTop: 8, textDecorationLine: 'underline' },

  networkCard: {
    marginHorizontal: 16, borderRadius: 18, borderWidth: 1,
    padding: 16, marginBottom: 14,
  },
  networkHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  networkAvatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  networkAvatarText: { fontFamily: 'Inter_700Bold', fontSize: 19 },
  networkEyebrow: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.7 },
  networkName: { fontFamily: 'Inter_700Bold', fontSize: 17, marginTop: 3 },
  networkIndustry: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 1 },
  networkCopy: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, marginTop: 12 },
  networkInput: { minHeight: 64, borderWidth: 1, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 10, marginTop: 12, fontFamily: 'Inter_400Regular', fontSize: 14 },
  networkError: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17, marginTop: 8 },
  networkButton: { borderRadius: 999, alignItems: 'center', paddingVertical: 13, marginTop: 12 },
  networkButtonText: { fontFamily: 'Inter_700Bold', fontSize: 14 },

  modalBackdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100,
    flex: 1, justifyContent: 'flex-end', paddingHorizontal: 12,
  },
  mapSheet: { borderRadius: 20, padding: 18, gap: 10 },
  mapSheetHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 },
  mapSheetClose: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', marginTop: -6 },
  mapSheetTitleGroup: { flex: 1, paddingRight: 16 },
  mapSheetTitle: { fontFamily: 'Inter_700Bold', fontSize: 19 },
  mapSheetAddress: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, marginTop: 4 },
  mapChoice: {
    minHeight: 54, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  mapChoiceText: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 15 },

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

  // waiting state
  queuePositionCard: {
    borderRadius: 14, paddingVertical: 14, paddingHorizontal: 18,
    alignItems: 'center', gap: 4,
  },
  queuePositionLabel: { fontFamily: 'Inter_500Medium', fontSize: 12, marginBottom: 4 },
  queuePositionNumber: { fontFamily: 'Inter_700Bold', fontSize: 24 },
  queuePositionTotal: { fontFamily: 'Inter_400Regular', fontSize: 16 },
  queuePositionEligible: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginTop: 4 },
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
  queueReadOnlyLink: { minHeight: 46, borderRadius: 14, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  queueReadOnlyLinkText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },

  conciergeLink: { alignItems: 'center', paddingBottom: 4 },
  conciergeLinkText: { fontFamily: 'Inter_500Medium', fontSize: 13 },
});
