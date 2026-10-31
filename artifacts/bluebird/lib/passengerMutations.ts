import type { ProductionEmptyLegPassengerList, ProductionPassengerInput } from './productionAuthApi';
import {
  ProductionAuthHttpError,
  ProductionAuthNetworkError,
  ProductionAuthRequestError,
  ProductionAuthSchemaError,
  ProductionAuthTimeoutError,
} from './productionAuthApi';

export {
  ProductionAuthHttpError,
  ProductionAuthNetworkError,
  ProductionAuthRequestError,
  ProductionAuthSchemaError,
  createAuthenticatedProductionApiClient,
} from './productionAuthApi';
export {
  canCreateProductionPassenger,
  canDeleteProductionPassenger,
  canUpdateProductionPassenger,
  emptyPassengerForm,
} from './passengerManifest';
import { parseProductionFlightId } from './productionFlights';
import { mainBluebirdAuthenticatedQueryKey } from './mainBluebirdApi';
import type { MainBluebirdApiEnvironment } from './mainBluebirdApiConfig';
import {
  additionalPassengerOffer,
  createdPassengerConfirmed,
  deletedPassengerConfirmed,
  PASSENGER_DUPLICATE,
  PASSENGER_LOCKED,
  PASSENGER_PROTECTED,
  PASSENGER_UNCONFIRMED,
  presentPassengerFailure,
  updatedPassengerConfirmed,
  validatePassengerForm,
  type PassengerFormErrors,
  type PassengerFormValues,
} from './passengerManifest';

export interface PassengerMutationClient {
  addEmptyLegPassenger: (emptyLegId: number, data: ProductionPassengerInput) => Promise<ProductionEmptyLegPassengerList>;
  updateEmptyLegPassenger: (
    emptyLegId: number,
    passengerId: number,
    data: ProductionPassengerInput,
  ) => Promise<ProductionEmptyLegPassengerList>;
  removeEmptyLegPassenger: (emptyLegId: number, passengerId: number) => Promise<ProductionEmptyLegPassengerList>;
}

export type PassengerWriteResult =
  | { status: 'disabled' | 'needs-confirmation' }
  | { status: 'saved'; list: ProductionEmptyLegPassengerList }
  | { status: 'removed'; list: ProductionEmptyLegPassengerList }
  | { status: 'invalid'; errors: PassengerFormErrors }
  | { status: 'duplicate'; failure: { title: string; body: string } }
  | { status: 'failed'; failure: { title: string; body: string } };

function duplicateFailure(): { title: string; body: string } {
  return { title: 'Request already in progress', body: PASSENGER_DUPLICATE };
}

function unconfirmedFailure(): { title: string; body: string } {
  return { title: 'Change not confirmed', body: PASSENGER_UNCONFIRMED };
}

function presentPassengerError(error: unknown): { title: string; body: string } {
  if (
    error instanceof ProductionAuthSchemaError ||
    (error instanceof ProductionAuthRequestError && error.code === 'invalid_json')
  ) {
    return unconfirmedFailure();
  }
  if (error instanceof ProductionAuthHttpError) return presentPassengerFailure(error.status);
  if (error instanceof ProductionAuthNetworkError || error instanceof ProductionAuthTimeoutError) {
    return presentPassengerFailure(null);
  }
  if (
    error instanceof ProductionAuthRequestError &&
    (error.code === 'token' || error.code === 'session_expired')
  ) {
    return presentPassengerFailure(401);
  }
  return presentPassengerFailure(null);
}

function lockedFailure(): PassengerWriteResult {
  return { status: 'failed', failure: { title: 'Passenger changes are locked', body: PASSENGER_LOCKED } };
}

/**
 * POST /api/empty-legs/:id/passengers. A closed gate returns before the client
 * exists. Success requires the returned roster to contain the submitted passenger.
 */
export async function submitPassengerCreate(input: {
  gateOpen: boolean;
  flightId: number;
  values: PassengerFormValues;
  signedIn: boolean;
  editsLocked: boolean;
  passengerCount: number;
  guestCount: number;
  passengerCap: number;
  inFlight: { current: boolean };
  createClient: () => Pick<PassengerMutationClient, 'addEmptyLegPassenger'>;
  today?: string;
}): Promise<PassengerWriteResult> {
  if (input.gateOpen !== true) return { status: 'disabled' };
  const flightId = parseProductionFlightId(input.flightId);
  if (flightId === null) return { status: 'failed', failure: presentPassengerFailure(400) };
  if (input.signedIn !== true) return { status: 'failed', failure: presentPassengerFailure(401) };
  const validated = validatePassengerForm(input.values, input.today);
  if (!validated.ok) return { status: 'invalid', errors: validated.errors };
  if (input.editsLocked === true) return lockedFailure();
  const offer = additionalPassengerOffer({
    passengerCount: input.passengerCount,
    guestCount: input.guestCount,
    passengerCap: input.passengerCap,
    manifestLocked: false,
  });
  if (!offer.allowed) {
    return { status: 'failed', failure: { title: 'No remaining seats', body: `${offer.reason} No request was sent.` } };
  }
  if (input.inFlight.current) return { status: 'duplicate', failure: duplicateFailure() };
  input.inFlight.current = true;
  try {
    const list = await input.createClient().addEmptyLegPassenger(flightId, validated.body);
    if (!createdPassengerConfirmed(flightId, list, validated.body)) {
      return { status: 'failed', failure: unconfirmedFailure() };
    }
    return { status: 'saved', list };
  } catch (error) {
    return { status: 'failed', failure: presentPassengerError(error) };
  } finally {
    input.inFlight.current = false;
  }
}

/**
 * PATCH /api/empty-legs/:id/passengers/:passengerId with the full passenger
 * input. Success requires that same id to come back with the submitted fields.
 */
export async function submitPassengerUpdate(input: {
  gateOpen: boolean;
  flightId: number;
  passengerId: number;
  values: PassengerFormValues;
  signedIn: boolean;
  editsLocked: boolean;
  passengerPresent: boolean;
  inFlight: { current: boolean };
  createClient: () => Pick<PassengerMutationClient, 'updateEmptyLegPassenger'>;
  today?: string;
}): Promise<PassengerWriteResult> {
  if (input.gateOpen !== true) return { status: 'disabled' };
  const flightId = parseProductionFlightId(input.flightId);
  const passengerId = parseProductionFlightId(input.passengerId);
  if (flightId === null || passengerId === null) return { status: 'failed', failure: presentPassengerFailure(400) };
  if (input.signedIn !== true) return { status: 'failed', failure: presentPassengerFailure(401) };
  const validated = validatePassengerForm(input.values, input.today);
  if (!validated.ok) return { status: 'invalid', errors: validated.errors };
  if (input.editsLocked === true) return lockedFailure();
  if (input.passengerPresent !== true) return { status: 'failed', failure: presentPassengerFailure(404) };
  if (input.inFlight.current) return { status: 'duplicate', failure: duplicateFailure() };
  input.inFlight.current = true;
  try {
    const list = await input.createClient().updateEmptyLegPassenger(flightId, passengerId, validated.body);
    if (!updatedPassengerConfirmed(flightId, passengerId, list, validated.body)) {
      return { status: 'failed', failure: unconfirmedFailure() };
    }
    return { status: 'saved', list };
  } catch (error) {
    return { status: 'failed', failure: presentPassengerError(error) };
  } finally {
    input.inFlight.current = false;
  }
}

/**
 * DELETE /api/empty-legs/:id/passengers/:passengerId with no body. The account
 * holder is refused before a client exists. Success requires the id to be gone.
 */
export async function submitPassengerDelete(input: {
  gateOpen: boolean;
  flightId: number;
  passengerId: number;
  isAccountHolder: boolean;
  explicitConfirm: boolean;
  signedIn: boolean;
  editsLocked: boolean;
  passengerPresent: boolean;
  inFlight: { current: boolean };
  createClient: () => Pick<PassengerMutationClient, 'removeEmptyLegPassenger'>;
}): Promise<PassengerWriteResult> {
  if (input.gateOpen !== true) return { status: 'disabled' };
  const flightId = parseProductionFlightId(input.flightId);
  const passengerId = parseProductionFlightId(input.passengerId);
  if (flightId === null || passengerId === null) return { status: 'failed', failure: presentPassengerFailure(400) };
  if (input.signedIn !== true) return { status: 'failed', failure: presentPassengerFailure(401) };
  if (input.isAccountHolder === true) {
    return { status: 'failed', failure: { title: 'Not available', body: PASSENGER_PROTECTED } };
  }
  if (input.explicitConfirm !== true) return { status: 'needs-confirmation' };
  if (input.editsLocked === true) return lockedFailure();
  if (input.passengerPresent !== true) return { status: 'failed', failure: presentPassengerFailure(404) };
  if (input.inFlight.current) return { status: 'duplicate', failure: duplicateFailure() };
  input.inFlight.current = true;
  try {
    const list = await input.createClient().removeEmptyLegPassenger(flightId, passengerId);
    if (!deletedPassengerConfirmed(flightId, passengerId, list)) {
      return { status: 'failed', failure: unconfirmedFailure() };
    }
    return { status: 'removed', list };
  } catch (error) {
    return { status: 'failed', failure: presentPassengerError(error) };
  } finally {
    input.inFlight.current = false;
  }
}

export function passengerMutationRefreshKeys(input: {
  environment: MainBluebirdApiEnvironment;
  clerkUserId: string;
  flightId: number;
}) {
  const flightId = parseProductionFlightId(input.flightId);
  if (flightId === null) return null;
  return {
    passengers: mainBluebirdAuthenticatedQueryKey(input.environment, input.clerkUserId, 'empty-leg-passengers', flightId),
    trip: mainBluebirdAuthenticatedQueryKey(input.environment, input.clerkUserId, 'trip', flightId),
    trips: mainBluebirdAuthenticatedQueryKey(input.environment, input.clerkUserId, 'trips'),
  };
}

export function applyPassengerMutationRefresh(input: {
  gateOpen: boolean;
  requestedUserId: string;
  activeUserId: string | null;
  signedIn: boolean;
  environment: MainBluebirdApiEnvironment;
  flightId: number;
  invalidate: (key: readonly unknown[]) => void;
}): boolean {
  const requested = input.requestedUserId.trim();
  const keys = passengerMutationRefreshKeys({
    environment: input.environment,
    clerkUserId: requested,
    flightId: input.flightId,
  });
  if (
    !keys ||
    input.gateOpen !== true ||
    input.signedIn !== true ||
    requested.length === 0 ||
    input.activeUserId !== requested
  ) {
    return false;
  }
  input.invalidate(keys.passengers);
  input.invalidate(keys.trip);
  input.invalidate(keys.trips);
  return true;
}
