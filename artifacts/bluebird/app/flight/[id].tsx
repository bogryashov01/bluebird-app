import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform, Alert, ImageBackground, useWindowDimensions,
  Modal, Pressable, Linking, TextInput,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, router } from 'expo-router';
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
import { getProductionQueueReadOnlyMessage } from '@/lib/productionQueueReadiness';
import {
  fetchProductionAirports,
  fetchProductionFlights,
  findProductionFlightById,
  getFlightAirportCodes,
  getFlightImagePresentation,
  isLocalFlightReadMode,
  mapLocalFlight,
  parseProductionFlightId,
  PRODUCTION_FLIGHTS_QUERY_KEY,
  productionReadRetryDelay,
  shouldRetryProductionRead,
  type AirportRecord,
  type FlightView,
} from '@/lib/productionFlights';

// ── Aircraft image matching ────────────────────────────────────────────────────
const AIRCRAFT_IMAGES = [
  { match: /gulfstream|g280|challenger|falcon/i,  source: require('@/assets/images/aircraft-heavy.jpg') },
  { match: /king air|pilatus|pc-12|turboprop/i,   source: require('@/assets/images/aircraft-turboprop.jpg') },
  { match: /phenom|xls|latitude/i,                source: require('@/assets/images/aircraft-midsize.jpg') },
];
const LIGHT_JET = require('@/assets/images/aircraft-light.jpg');
function aircraftImage(type: string | null) {
  for (const { match, source } of AIRCRAFT_IMAGES) if (match.test(type ?? '')) return source;
  return LIGHT_JET;
}

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
  return value.charAt(0).toUpperCase() + value.slice(1);
}
function infoTiles(f: FlightView) {
  const tiles: { label: string; value: string }[] = [];
  if (Number.isSafeInteger(f.seatsAvailable) && f.seatsAvailable! >= 0) {
    tiles.push({
      label: 'Seats',
      value: `${f.seatsAvailable!.toLocaleString()} available`,
    });
  }
  if (f.rangeNm !== null && Number.isFinite(f.rangeNm) && f.rangeNm > 0) {
    tiles.push({ label: 'Range', value: `${f.rangeNm.toLocaleString()} nm` });
  }
  return tiles;
}

interface FlightInfoItem {
  label: string;
  value: string;
  testID?: string;
}

type AirportDisplayRecord = Pick<AirportRecord, 'code' | 'name' | 'city' | 'state' | 'country'>;

function FlightInfoGroup({
  title,
  items,
  testID,
  compactLayout,
  colors,
}: {
  title: string;
  items: FlightInfoItem[];
  testID: string;
  compactLayout: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  if (items.length === 0) return null;
  return (
    <View
      testID={testID}
      style={[
        styles.flightInfoGroup,
        compactLayout && styles.flightInfoGroupCompact,
        { backgroundColor: colors.surface },
      ]}
    >
      <Text style={[styles.flightInfoHeading, { color: colors.textOnSurface }]}>{title}</Text>
      {items.map((item) => (
        <View key={item.label} style={styles.flightInfoRow}>
          <Text style={[styles.flightInfoLabel, { color: colors.mutedForegroundLight }]}>{item.label}</Text>
          <Text
            testID={item.testID}
            style={[styles.flightInfoValue, { color: colors.textOnSurface }]}
          >
            {item.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function FlightDetailScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  // Scale hero with screen height so small iPhones keep content above the fold
  const heroHeight = Math.round(Math.min(300, Math.max(200, windowHeight * 0.32)));
  const compactLayout = windowWidth < 380;
  const { user, updateUser, authMode } = useAuth();
  const queryClient = useQueryClient();
  const localReadMode = shouldUseLocalFlightReadMode(authMode, isLocalFlightReadMode());
  const numericFlightId = parseProductionFlightId(id);
  const [directionsOpen, setDirectionsOpen] = useState(false);
  const [networkMessage, setNetworkMessage] = useState('');
  const [networkError, setNetworkError] = useState('');

  const localFlightQuery = useGetFlight(id ?? '', {
    query: { enabled: localReadMode && !!id },
  });
  const productionFlightsQuery = useQuery({
    queryKey: PRODUCTION_FLIGHTS_QUERY_KEY,
    queryFn: ({ signal }) => fetchProductionFlights({ signal }),
    enabled: !localReadMode && numericFlightId !== null,
    retry: shouldRetryProductionRead,
    retryDelay: productionReadRetryDelay,
  });
  const flight: FlightView | undefined = localReadMode
    ? (localFlightQuery.data ? mapLocalFlight(localFlightQuery.data) : undefined)
    : findProductionFlightById(productionFlightsQuery.data, numericFlightId);
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
  const localAirportRecords = (localAirportsQuery.data ?? []).flatMap((group) =>
    group.airports.map((airport) => ({
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
  const isLoading = localReadMode ? localFlightQuery.isLoading : productionFlightsQuery.isLoading;
  const isError = localReadMode ? localFlightQuery.isError : productionFlightsQuery.isError;
  const isRetryingFlight = localReadMode ? localFlightQuery.isFetching : productionFlightsQuery.isFetching;
  const retryFlight = localReadMode ? localFlightQuery.refetch : productionFlightsQuery.refetch;

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
            This flight could not be found in the available flight list.
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
  const imgSource = imagePresentation === 'provided'
    ? { uri: f.imageUrl! }
    : imagePresentation === 'local-fallback'
      ? aircraftImage(aircraftName)
      : null;
  const readOnlyProduction = f.source === 'production';

  const status = myStatus?.status ?? 'none';
  // Public flight responses intentionally omit FBO details. A confirmed
  // member receives them only from the authenticated status response.
  const confirmedFbo = status === 'confirmed' ? myStatus?.confirmedFlight : undefined;
  const departureFbo = confirmedFbo?.departureFbo ?? null;
  const departureFboAddress = confirmedFbo?.departureFboAddress ?? null;
  const canOpenDirections = status === 'confirmed' && !!departureFboAddress?.trim();
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
  const scheduleParts = [
    dateLabel,
    departureTime
      ? `Departs ${departureTime}${f.departureTimeZone ? ` ${f.departureTimeZone}` : ''}`
      : null,
  ].filter((part): part is string => !!part);
  const hasRouteDetails = !!(fromLabel || toLabel);
  const findAirport = (code: string | null) =>
    code ? airportRecords.find((airport) => airport.code === code.toUpperCase()) : undefined;
  const originAirportInfo = findAirport(fromAirport);
  const destinationAirportInfo = findAirport(toAirport);
  const airportInformation = (
    code: string | null,
    city: string | null,
    airport: AirportDisplayRecord | undefined,
  ): FlightInfoItem[] => {
    const items: FlightInfoItem[] = [];
    const airportName = airport?.name?.trim();
    if (airportName) {
      items.push({ label: 'Airport', value: `${airportName}${code ? ` (${code})` : ''}` });
    } else if (code) {
      items.push({ label: 'Airport', value: code });
    }
    const location = [
      airport?.city?.trim() || city,
      airport?.state?.trim(),
      airport?.country?.trim(),
    ].filter((part): part is string => !!part?.trim());
    if (location.length > 0) items.push({ label: 'Location', value: location.join(', ') });
    return items;
  };
  const departureInformation = [
    ...airportInformation(fromAirport, fromCity, originAirportInfo),
    ...(dateLabel ? [{ label: 'Date', value: dateLabel, testID: 'flight-info-departure-date' }] : []),
    ...(departureTime ? [{
      label: 'Time',
      value: `${departureTime}${f.departureTimeZone ? ` ${f.departureTimeZone}` : ''}`,
      testID: 'flight-info-departure-time',
    }] : []),
  ];
  const arrivalInformation = [
    ...airportInformation(toAirport, toCity, destinationAirportInfo),
    ...(arrivalDateLabel ? [{ label: 'Date', value: arrivalDateLabel, testID: 'flight-info-arrival-date' }] : []),
    ...(arrivalTime ? [{
      label: 'Time',
      value: `${arrivalTime}${f.arrivalTimeZone ? ` ${f.arrivalTimeZone}` : ''}`,
      testID: 'flight-info-arrival-time',
    }] : []),
  ];
  const aircraftInformation: FlightInfoItem[] = [
    ...(aircraftName ? [{ label: 'Type', value: aircraftName, testID: 'flight-info-aircraft-type' }] : []),
    ...(f.aircraftTypeCode?.trim()
      ? [{ label: 'Code', value: f.aircraftTypeCode.trim(), testID: 'flight-info-aircraft-code' }]
      : []),
  ];
  const additionalInformation: FlightInfoItem[] = [
    ...(f.duration?.trim()
      ? [{ label: 'Estimated duration', value: f.duration.trim(), testID: 'flight-info-duration' }]
      : []),
    ...(flightStatusText(f.status)
      ? [{ label: 'Status', value: flightStatusText(f.status)!, testID: 'flight-info-status' }]
      : []),
    ...(f.international !== null
      ? [{ label: 'Route type', value: f.international ? 'International' : 'Domestic', testID: 'flight-info-international' }]
      : []),
    ...(Number.isSafeInteger(f.queueCount) && f.queueCount! >= 0
      ? [{ label: 'Queue count', value: f.queueCount!.toLocaleString(), testID: 'flight-info-queue-count' }]
      : []),
  ];
  const legacyInfoTiles = infoTiles(f);

  const showMapError = () => {
    const message = `We couldn't open maps. Search for this address instead:\n\n${departureFboAddress}`;
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') window.alert(message);
    } else {
      Alert.alert('Unable to open maps', message);
    }
  };

  const openDirections = async (service: 'apple' | 'google') => {
    setDirectionsOpen(false);
    const address = departureFboAddress?.trim();
    if (!address) return;
    const destination = encodeURIComponent(address.replace(/\n/g, ', '));
    const url = service === 'apple'
      ? `https://maps.apple.com/?daddr=${destination}&dirflg=d`
      : `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
    try {
      await Linking.openURL(url);
    } catch {
      showMapError();
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
    // Production flight detail reads are public-only in this app. Keep the
    // notice explicit and do not expose a production mutation path.
    if (readOnlyProduction) {
      return (
        <>
          <View style={[styles.unavailableBadge, { backgroundColor: colors.muted }]}>
            <Text style={[styles.unavailableBadgeText, { color: colors.mutedForegroundLight }]}>
              Flight details
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
            accessibilityLabel="View read-only queue access"
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
              View read-only queue access
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
        contentContainerStyle={{ paddingBottom: botPad + 180 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero image with gradient ── */}
        <View style={[styles.heroFrame, { height: heroHeight }]}>
          {imgSource ? (
            <ImageBackground source={imgSource} style={StyleSheet.absoluteFill}>
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
            <View style={[styles.heroUnavailable, { backgroundColor: colors.muted }]}>
              <Feather name="image" size={28} color={colors.mutedForeground} />
              <Text style={[styles.heroUnavailableText, { color: colors.mutedForeground }]}>
                Aircraft photo unavailable
              </Text>
            </View>
          )}
          {/* Route pill at bottom of hero */}
          <View
            style={[
              styles.routePill,
              {
                backgroundColor: imgSource ? colors.primaryForeground + '2E' : colors.card,
                borderColor: imgSource ? colors.primaryForeground + '4D' : colors.border,
              },
            ]}
          >
            <Text
              testID="flight-detail-route"
              style={[styles.routePillText, { color: imgSource ? colors.primaryForeground : colors.foreground }]}
            >
              {fromLabel && toLabel
                ? `${fromLabel} → ${toLabel}`
                : fromLabel ?? toLabel ?? 'Route unavailable'}
            </Text>
          </View>
        </View>

        {/* ── Aircraft name ── */}
        {!!aircraftName && (
          <View style={styles.titleRow}>
            <Text style={[styles.aircraftName, { color: colors.textOnSurface }]} numberOfLines={1}>
              {aircraftName}
            </Text>
          </View>
        )}

        {/* ── Local schedule, when supplied ── */}
        {scheduleParts.length > 0 && (
          <Text style={[styles.dateText, { color: colors.mutedForegroundLight }]}>
            {scheduleParts.join(' · ')}
          </Text>
        )}

        {/* ── Route and schedule details ── */}
        {hasRouteDetails && (
          <View style={[styles.routeCard, compactLayout && styles.routeCardCompact, { backgroundColor: colors.surface }]}>
            <View style={styles.routeEndpoint}>
              {fromLabel && (
                <Text style={[styles.routeCode, compactLayout && styles.routeCodeCompact, { color: colors.textOnSurface }]} numberOfLines={1}>
                  {fromLabel}
                </Text>
              )}
              {departureTime && (
                <Text style={[styles.routeTime, { color: colors.textOnSurface }]} numberOfLines={1}>
                  {departureTime}{f.departureTimeZone ? ` ${f.departureTimeZone}` : ''}
                </Text>
              )}
              {fromAirport && fromCity && (
                <Text style={[styles.routeCity, { color: colors.mutedForegroundLight }]} numberOfLines={1}>{fromCity}</Text>
              )}
            </View>
            <View style={[styles.routeCenter, compactLayout && styles.routeCenterCompact]}>
              <View style={[styles.routeLine, { backgroundColor: colors.separator }]} />
              <View style={[styles.routeDot, { backgroundColor: colors.primary }]} />
              {!!f.duration && (
                <Text style={[styles.routeDuration, compactLayout && styles.routeDurationCompact, { color: colors.mutedForegroundLight }]} numberOfLines={1}>
                  {f.duration}
                </Text>
              )}
              <View style={[styles.routeDot, { backgroundColor: colors.primary }]} />
              <View style={[styles.routeLine, { backgroundColor: colors.separator }]} />
            </View>
            <View style={[styles.routeEndpoint, { alignItems: 'flex-end' }]}>
              {toLabel && (
                <Text style={[styles.routeCode, compactLayout && styles.routeCodeCompact, { color: colors.textOnSurface }]} numberOfLines={1}>
                  {toLabel}
                </Text>
              )}
              {arrivalTime && (
                <Text style={[styles.routeTime, { color: colors.textOnSurface }]} numberOfLines={1}>
                  {arrivalTime}{f.arrivalTimeZone ? ` ${f.arrivalTimeZone}` : ''}
                </Text>
              )}
              {toAirport && toCity && (
                <Text style={[styles.routeCity, { color: colors.mutedForegroundLight }]} numberOfLines={1}>{toCity}</Text>
              )}
            </View>
          </View>
        )}

        {/* ── Existing read-only flight data, grouped by topic ── */}
        <View style={styles.flightInfoSection}>
          <Text testID="flight-info-section-title" style={[styles.flightInfoTitle, { color: colors.textOnSurface }]}>
            Flight Information
          </Text>
          <View style={styles.flightInfoGrid}>
            <FlightInfoGroup
              title="Departure"
              items={departureInformation}
              testID="flight-info-departure"
              compactLayout={compactLayout}
              colors={colors}
            />
            <FlightInfoGroup
              title="Arrival"
              items={arrivalInformation}
              testID="flight-info-arrival"
              compactLayout={compactLayout}
              colors={colors}
            />
            <FlightInfoGroup
              title="Aircraft"
              items={aircraftInformation}
              testID="flight-info-aircraft"
              compactLayout={compactLayout}
              colors={colors}
            />
            <FlightInfoGroup
              title="Additional Details"
              items={additionalInformation}
              testID="flight-info-additional"
              compactLayout={compactLayout}
              colors={colors}
            />
          </View>
        </View>

        {/* ── Existing local-only range/seat values remain data-backed ── */}
        {legacyInfoTiles.length > 0 && (
          <View style={[styles.amenityGrid, compactLayout && styles.amenityGridCompact]}>
            {legacyInfoTiles.map((a) => (
              <View
                key={a.label}
                style={[
                  styles.amenityTile,
                  compactLayout && styles.amenityTileCompact,
                  { backgroundColor: colors.surface },
                ]}
              >
                <Text style={[styles.amenityLabel, { color: colors.mutedForegroundLight }]}>{a.label}</Text>
                <Text style={[styles.amenityValue, { color: colors.textOnSurface }]}>{a.value}</Text>
              </View>
            ))}
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

        {/* ── FBO departure card ── */}
        {!!departureFbo && (
          <TouchableOpacity
            style={[styles.fboCard, { backgroundColor: colors.backgroundMid }]}
            disabled={!canOpenDirections}
            onPress={() => setDirectionsOpen(true)}
            activeOpacity={0.78}
            accessibilityRole={canOpenDirections ? 'button' : undefined}
            accessibilityLabel={canOpenDirections ? `Get directions to ${departureFbo}` : undefined}
            accessibilityHint={canOpenDirections ? 'Choose Apple Maps or Google Maps' : undefined}
            testID={canOpenDirections ? 'departure-fbo-directions' : undefined}
          >
            <View style={styles.fboHeader}>
              <Text style={[styles.fboLabel, { color: colors.mutedOnBrand }]}>FBO · DEPARTURE</Text>
              {canOpenDirections && <Feather name="navigation" size={19} color={colors.textOnBrand} />}
            </View>
            <Text style={[styles.fboValue, { color: colors.textOnBrand }]}>
              {departureFbo}{fromAirport ? ` — ${fromAirport}` : ''}
            </Text>
            {canOpenDirections && (
              <>
                <Text style={[styles.fboAddress, { color: colors.mutedOnBrand }]}>
                  {departureFboAddress}
                </Text>
                <Text style={[styles.fboAction, { color: colors.textOnBrand }]}>Get directions</Text>
              </>
            )}
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
        visible={directionsOpen && canOpenDirections && !!departureFbo}
        transparent
        animationType="fade"
        onRequestClose={() => setDirectionsOpen(false)}
      >
        <Pressable
          style={[styles.modalBackdrop, { backgroundColor: colors.backgroundMid + 'B8', paddingBottom: botPad + 12 }]}
          onPress={() => setDirectionsOpen(false)}
        >
          <Pressable style={[styles.mapSheet, { backgroundColor: colors.surface }]} onPress={(event) => event.stopPropagation()}>
            <View style={styles.mapSheetHeader}>
              <View style={styles.mapSheetTitleGroup}>
                <Text style={[styles.mapSheetTitle, { color: colors.textOnSurface }]}>Open directions</Text>
                <Text style={[styles.mapSheetAddress, { color: colors.mutedForegroundLight }]}>{departureFboAddress}</Text>
              </View>
              <TouchableOpacity
                onPress={() => setDirectionsOpen(false)}
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
  heroFrame: { width: '100%', justifyContent: 'flex-end', position: 'relative', overflow: 'hidden' },
  heroUnavailable: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  heroUnavailableText: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  routePill: {
    marginBottom: 18, alignSelf: 'center',
    borderRadius: 100, paddingHorizontal: 16, paddingVertical: 6,
    borderWidth: 1,
  },
  routePillText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, letterSpacing: 0.5 },

  // Title row
  titleRow: {
    paddingHorizontal: 20, marginTop: 8,
  },
  aircraftName: { fontFamily: 'Inter_700Bold', fontSize: 22 },

  // Date
  dateText: { fontFamily: 'Inter_400Regular', fontSize: 14, paddingHorizontal: 20, marginTop: 4, marginBottom: 18 },

  // Horizontal route card
  routeCard: {
    marginHorizontal: 16,
    borderRadius: 18, padding: 18, flexDirection: 'row', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowRadius: 20, shadowOpacity: 0.05, elevation: 3,
    marginBottom: 14,
  },
  routeCardCompact: { paddingHorizontal: 12 },
  routeEndpoint: { flex: 1, alignItems: 'flex-start' },
  routeCode:   { fontFamily: 'Inter_700Bold', fontSize: 18 },
  routeCodeCompact: { fontSize: 16 },
  routeTime:   { fontFamily: 'Inter_500Medium', fontSize: 14, marginTop: 2 },
  routeCity:   { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  routeCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  routeCenterCompact: { flex: 0.8, gap: 3 },
  routeLine:   { flex: 1, height: 1 },
  routeDot:    { width: 5, height: 5, borderRadius: 3 },
  routeDuration: { fontFamily: 'Inter_500Medium', fontSize: 11 },
  routeDurationCompact: { fontSize: 10 },

  // Flight information
  flightInfoSection: { marginHorizontal: 16, marginBottom: 14 },
  flightInfoTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, marginHorizontal: 2, marginBottom: 10 },
  flightInfoGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  flightInfoGroup: {
    width: '48.5%', borderRadius: 14, padding: 14, marginBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2,
  },
  flightInfoGroupCompact: { width: '100%' },
  flightInfoHeading: { fontFamily: 'Inter_600SemiBold', fontSize: 14, marginBottom: 10 },
  flightInfoRow: { marginTop: 6 },
  flightInfoLabel: { fontFamily: 'Inter_500Medium', fontSize: 11, letterSpacing: 0.2 },
  flightInfoValue: { fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20, marginTop: 2 },

  // Contract-backed detail grid
  amenityGrid: {
    flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 10, marginBottom: 14,
  },
  amenityGridCompact: { paddingHorizontal: 16 },
  amenityTile: {
    width: '47.5%', borderRadius: 14, padding: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.04, elevation: 2,
  },
  amenityTileCompact: { width: '100%' },
  amenityLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
  amenityValue: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },

  // Dark FBO departure card
  fboCard: {
    marginHorizontal: 16, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 18,
    marginBottom: 14,
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
    flex: 1, justifyContent: 'flex-end', paddingHorizontal: 12,
  },
  mapSheet: { borderRadius: 20, padding: 18, gap: 10 },
  mapSheetHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 },
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
