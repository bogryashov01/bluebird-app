import { ProductionReadHttpError, PRODUCTION_FLIGHTS_QUERY_KEY, type FlightView } from './productionFlights';

/**
 * Flight Details stays behind the existing Clerk navigation gate
 * (`isClerkHomeAvailable`, which follows `isProfileComplete`). This reader
 * does not add membership checks or new required profile fields. The website
 * RequireCompleteProfile field list is not available in this app.
 */
export const FLIGHT_DETAIL_FRESHNESS_MS = 60_000;

/** One read per flight and viewer while fresh. Countdown ticks do not refetch. */
export const FLIGHT_DETAIL_QUERY_BEHAVIOR = {
  staleTime: FLIGHT_DETAIL_FRESHNESS_MS,
  gcTime: 5 * 60_000,
  refetchInterval: false as const,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  refetchOnMount: true as const,
};

export class FlightDetailSessionError extends Error {
  constructor() {
    super('The signed-in session changed before flight details could be read.');
    this.name = 'FlightDetailSessionError';
  }
}

export function flightDetailViewerScope(input: {
  demoMode: boolean;
  authMode: string;
  signedIn: boolean;
  clerkUserId: string | null;
}): string {
  if (input.demoMode) return 'demo';
  if (
    input.authMode === 'clerk' &&
    input.signedIn &&
    typeof input.clerkUserId === 'string' &&
    input.clerkUserId.trim().length > 0
  ) {
    return input.clerkUserId.trim();
  }
  return 'anonymous';
}

export function isFlightDetailIdentityReady(input: {
  demoMode: boolean;
  authMode: string;
  sessionLoaded: boolean;
  signedIn: boolean;
  sessionUserId: string | null;
  clerkUserId: string | null;
}): boolean {
  if (input.demoMode || input.authMode !== 'clerk') return true;
  if (!input.sessionLoaded) return false;
  if (!input.signedIn) return true;
  return typeof input.clerkUserId === 'string' &&
    input.clerkUserId.trim().length > 0 &&
    input.sessionUserId === input.clerkUserId;
}

export function productionFlightDetailQueryKey(
  flightId: number,
  viewerScope: string,
): readonly [string, number, string] {
  return ['production-empty-leg', flightId, viewerScope];
}

export function isDiscoverFlightListKey(key: readonly unknown[]): boolean {
  return (key.length === PRODUCTION_FLIGHTS_QUERY_KEY.length &&
      key[0] === PRODUCTION_FLIGHTS_QUERY_KEY[0]) ||
    (key[0] === 'full-app-demo' && key[1] === PRODUCTION_FLIGHTS_QUERY_KEY[0]);
}

export function prepareFlightDetailRequest(input: {
  scope: string;
  token: string | null;
  activeScope: string;
}): { accessToken: string | null; viewerAuthenticated: boolean } {
  if (input.scope !== input.activeScope) {
    throw new FlightDetailSessionError();
  }
  if (input.scope === 'anonymous' || input.scope === 'demo') {
    return { accessToken: null, viewerAuthenticated: false };
  }
  const token = input.token;
  if (typeof token !== 'string' || token.length === 0 || /\s/.test(token)) {
    throw new FlightDetailSessionError();
  }
  return { accessToken: token, viewerAuthenticated: true };
}

export function stripViewerIdentity(flight: FlightView): FlightView {
  return {
    ...flight,
    userInQueue: null,
    viewerQueuePosition: null,
    lockedForFreeUsers: null,
    viewerHasLineSkip: null,
    viewerHasInternationalPass: null,
    viewerIsBookedPassenger: null,
    viewerIsEffectiveWinner: null,
    viewerConfirmationStatus: null,
  };
}

export type FlightDetailPhase = 'idle' | 'pending' | 'success' | 'error';

export function flightDetailHttpStatus(error: unknown): number | null {
  return error instanceof ProductionReadHttpError ? error.status : null;
}

export function selectDisplayedFlight(input: {
  cached: FlightView | undefined;
  detail: FlightView | undefined;
  phase: FlightDetailPhase;
  httpStatus: number | null;
  viewerAuthenticated: boolean;
}): {
  flight: FlightView | undefined;
  showingCachedDiscover: boolean;
  confirmedMissing: boolean;
  refreshFailed: boolean;
} {
  if (input.httpStatus === 404) {
    return {
      flight: undefined,
      showingCachedDiscover: false,
      confirmedMissing: true,
      refreshFailed: false,
    };
  }
  if (input.phase === 'success' && input.detail) {
    return {
      flight: input.viewerAuthenticated ? input.detail : stripViewerIdentity(input.detail),
      showingCachedDiscover: false,
      confirmedMissing: false,
      refreshFailed: false,
    };
  }
  if (input.cached?.source === 'production' || input.cached?.source === 'local') {
    return {
      flight: input.cached ? stripViewerIdentity(input.cached) : undefined,
      showingCachedDiscover: true,
      confirmedMissing: false,
      refreshFailed: input.phase === 'error',
    };
  }
  return {
    flight: undefined,
    showingCachedDiscover: false,
    confirmedMissing: false,
    refreshFailed: input.phase === 'error',
  };
}

export function presentFlightDetailQueue(
  flight: Pick<
    FlightView,
    | 'queueCount'
    | 'viewerQueuePosition'
    | 'viewerIsBookedPassenger'
    | 'viewerIsEffectiveWinner'
    | 'viewerConfirmationStatus'
    | 'userInQueue'
  >,
  viewerAuthenticated: boolean,
): { countLabel: string | null; positionLabel: string | null; statusLabel: string | null } {
  const countLabel = typeof flight.queueCount === 'number' && Number.isSafeInteger(flight.queueCount) && flight.queueCount >= 0
    ? flight.queueCount === 1 ? '1 person in queue' : `${flight.queueCount} people in queue`
    : null;
  if (!viewerAuthenticated) {
    return { countLabel, positionLabel: null, statusLabel: null };
  }
  const positionLabel = typeof flight.viewerQueuePosition === 'number' &&
    Number.isSafeInteger(flight.viewerQueuePosition) &&
    flight.viewerQueuePosition > 0
    ? `Your position is #${flight.viewerQueuePosition}`
    : null;
  let statusLabel: string | null = null;
  const confirmation = flight.viewerConfirmationStatus?.trim() ?? '';
  if (flight.viewerIsBookedPassenger === true) statusLabel = 'Booked passenger';
  else if (confirmation === 'confirmed') statusLabel = 'Confirmed';
  else if (confirmation === 'pending') statusLabel = 'Confirmation pending';
  else if (confirmation === 'declined') statusLabel = 'Declined';
  else if (confirmation) statusLabel = null;
  else if (flight.viewerIsEffectiveWinner === true) statusLabel = 'Current winner — not yet formally awarded';
  else if (flight.userInQueue === true) statusLabel = 'In queue';
  return { countLabel, positionLabel, statusLabel };
}

/** A seat count is shown only when the flight model already carries a whole number. Queue length is not a seat count. */
export function presentSeatsAvailable(seatsAvailable: number | null | undefined): string | null {
  if (typeof seatsAvailable !== 'number' || !Number.isSafeInteger(seatsAvailable) || seatsAvailable < 0) {
    return null;
  }
  return String(seatsAvailable);
}

export function presentAircraftGallery(flight: Pick<FlightView, 'imageUrl' | 'aircraftGalleryUrls'>): string[] {
  const urls = Array.isArray(flight.aircraftGalleryUrls)
    ? flight.aircraftGalleryUrls.filter((url) => typeof url === 'string' && url.trim().length > 0)
    : [];
  if (urls.length > 0) return urls;
  return flight.imageUrl ? [flight.imageUrl] : [];
}
