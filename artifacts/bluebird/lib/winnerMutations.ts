import type { ProductionEmptyLeg, ProductionTrip } from './productionAuthApi';
import {
  ProductionAuthHttpError,
  ProductionAuthNetworkError,
  ProductionAuthRequestError,
  ProductionAuthSchemaError,
  ProductionAuthTimeoutError,
} from './productionAuthApi';

export {
  ProductionAuthHttpError,
  ProductionAuthInvalidJsonError,
  ProductionAuthNetworkError,
  ProductionAuthRequestError,
  ProductionAuthSchemaError,
  createAuthenticatedProductionApiClient,
} from './productionAuthApi';
export {
  canConfirmProductionWinner,
  canDeclineProductionWinner,
  canVerifyProductionFbo,
  canAcknowledgeProductionManifest,
  canAcknowledgeProductionPolicy,
  canSendProductionBoardingPass,
  BOARDING_PASS_SENT,
  declinedFlightForId,
  boardingPassActionBlock,
  fboActionBlock,
  manifestActionBlock,
  policyActionBlock,
  presentBoardingPass,
  winnerActionBlock,
} from './winnerChecklist';
import { parseProductionFlightId } from './productionFlights';
import { productionFlightDetailQueryKey } from './flightDetailPresentation';
import { mainBluebirdAuthenticatedQueryKey } from './mainBluebirdApi';
import type { MainBluebirdApiEnvironment } from './mainBluebirdApiConfig';
import {
  declinedFlightForId,
  FBO_DUPLICATE,
  FBO_UNCONFIRMED,
  MANIFEST_DUPLICATE,
  MANIFEST_UNCONFIRMED,
  BOARDING_PASS_DUPLICATE,
  BOARDING_PASS_UNCONFIRMED,
  POLICY_DUPLICATE,
  POLICY_UNCONFIRMED,
  acknowledgedManifestTripForLeg,
  acknowledgedPolicyTripForLeg,
  presentBoardingPassBlock,
  presentFboBlock,
  presentManifestBlock,
  presentPolicyBlock,
  presentTripActionFailure,
  presentWinnerBlock,
  sentBoardingPassTripForLeg,
  verifiedFboTripForLeg,
  WINNER_DUPLICATE,
  WINNER_UNCONFIRMED,
  type BoardingPassActionBlock,
  type FboActionBlock,
  type ManifestActionBlock,
  type PolicyActionBlock,
  type TripActionFailure,
  type WinnerActionBlock,
} from './winnerChecklist';

export interface WinnerMutationClient {
  confirmEmptyLegWinner: (emptyLegId: number) => Promise<ProductionEmptyLeg>;
  declineEmptyLegWinner: (emptyLegId: number) => Promise<ProductionEmptyLeg>;
  verifyTripFbo: (legId: number) => Promise<ProductionTrip>;
  acknowledgeTripManifest: (legId: number) => Promise<ProductionTrip>;
  acknowledgeTripPolicy: (legId: number) => Promise<ProductionTrip>;
  sendTripBoardingPass: (legId: number) => Promise<ProductionTrip>;
}

type WinnerSubmission =
  | { status: 'disabled' | 'needs-confirmation' }
  | { status: 'confirmed'; flight: ProductionEmptyLeg }
  | { status: 'verified'; trip: ProductionTrip }
  | { status: 'acknowledged'; trip: ProductionTrip }
  | { status: 'policy-acknowledged'; trip: ProductionTrip }
  | { status: 'pass-recorded'; trip: ProductionTrip }
  | { status: 'declined' }
  | { status: 'duplicate'; failure: TripActionFailure }
  | { status: 'failed'; failure: TripActionFailure };

function duplicateFailure(): TripActionFailure {
  return { title: 'Request already in progress', body: WINNER_DUPLICATE };
}

function fboDuplicateFailure(): TripActionFailure {
  return { title: 'Request already in progress', body: FBO_DUPLICATE };
}

function fboUnconfirmedFailure(): TripActionFailure {
  return { title: 'Change not confirmed', body: FBO_UNCONFIRMED };
}

function presentFboError(error: unknown): TripActionFailure {
  if (error instanceof ProductionAuthSchemaError || (error instanceof ProductionAuthRequestError && error.code === 'invalid_json')) {
    return fboUnconfirmedFailure();
  }
  return presentWinnerError(error);
}

function unconfirmedFailure(): TripActionFailure {
  return { title: 'Change not confirmed', body: WINNER_UNCONFIRMED };
}

function presentWinnerError(error: unknown): TripActionFailure {
  if (error instanceof ProductionAuthSchemaError || (error instanceof ProductionAuthRequestError && error.code === 'invalid_json')) {
    return unconfirmedFailure();
  }
  if (error instanceof ProductionAuthHttpError) return presentTripActionFailure(error.status);
  if (error instanceof ProductionAuthNetworkError || error instanceof ProductionAuthTimeoutError) {
    return presentTripActionFailure(null);
  }
  if (error instanceof ProductionAuthRequestError && (error.code === 'token' || error.code === 'session_expired')) {
    return presentTripActionFailure(401);
  }
  return presentTripActionFailure(null);
}

function blocked(block: WinnerActionBlock | null): WinnerSubmission | null {
  if (!block) return null;
  return { status: 'failed', failure: presentWinnerBlock(block) };
}

/** The winner endpoint awards the flight only when this response matches the requested flight and records confirmation. */
export function confirmedFlightForId(
  flightId: number,
  flight: { id: number; viewerConfirmationStatus?: string | null; awardedAt?: string | null },
): boolean {
  if (!Number.isSafeInteger(flightId) || flightId < 1 || flight.id !== flightId) return false;
  if (flight.viewerConfirmationStatus === 'confirmed') return true;
  return typeof flight.awardedAt === 'string' &&
    flight.awardedAt.trim().length > 0 &&
    Number.isFinite(Date.parse(flight.awardedAt));
}

/**
 * POST /api/empty-legs/:id/winner/confirm with no body. This is the winner
 * offer, distinct from the checklist presentation. A closed gate returns
 * before the client is created. Success requires the empty-leg parser and a
 * confirmed or awarded response for the same flight.
 */
export async function submitWinnerConfirmation(input: {
  gateOpen: boolean;
  legId: number;
  signedIn: boolean;
  block: WinnerActionBlock | null;
  inFlight: { current: boolean };
  createClient: () => WinnerMutationClient;
}): Promise<WinnerSubmission> {
  if (input.gateOpen !== true) return { status: 'disabled' };
  const legId = parseProductionFlightId(input.legId);
  if (legId === null) return { status: 'failed', failure: presentTripActionFailure(400) };
  if (input.signedIn !== true) return { status: 'failed', failure: presentTripActionFailure(401) };
  const denied = blocked(input.block);
  if (denied) return denied;
  if (input.inFlight.current) return { status: 'duplicate', failure: duplicateFailure() };
  input.inFlight.current = true;
  try {
    const flight = await input.createClient().confirmEmptyLegWinner(legId);
    if (!confirmedFlightForId(legId, flight)) return { status: 'failed', failure: unconfirmedFailure() };
    return { status: 'confirmed', flight };
  } catch (error) {
    return { status: 'failed', failure: presentWinnerError(error) };
  } finally {
    input.inFlight.current = false;
  }
}

/**
 * POST /api/empty-legs/:id/winner/decline with no body. Success requires the
 * same flight id and a declined viewer status. The next member is not inferred.
 */
export async function submitWinnerDecline(input: {
  gateOpen: boolean;
  flightId: number;
  explicitConfirm: boolean;
  signedIn: boolean;
  block: WinnerActionBlock | null;
  inFlight: { current: boolean };
  createClient: () => WinnerMutationClient;
}): Promise<WinnerSubmission> {
  if (input.gateOpen !== true) return { status: 'disabled' };
  const flightId = parseProductionFlightId(input.flightId);
  if (flightId === null) return { status: 'failed', failure: presentTripActionFailure(400) };
  if (input.signedIn !== true) return { status: 'failed', failure: presentTripActionFailure(401) };
  if (input.explicitConfirm !== true) return { status: 'needs-confirmation' };
  const denied = blocked(input.block);
  if (denied) return denied;
  if (input.inFlight.current) return { status: 'duplicate', failure: duplicateFailure() };
  input.inFlight.current = true;
  try {
    const flight = await input.createClient().declineEmptyLegWinner(flightId);
    if (!declinedFlightForId(flightId, flight)) return { status: 'failed', failure: unconfirmedFailure() };
    return { status: 'declined' };
  } catch (error) {
    return { status: 'failed', failure: presentWinnerError(error) };
  } finally {
    input.inFlight.current = false;
  }
}

/**
 * POST /api/trips/:legId/checklist/fboVerified. A closed gate returns before
 * the client is created. Success requires fboVerifiedAt on the matching trip.
 */
export async function submitFboVerification(input: {
  gateOpen: boolean;
  legId: number;
  explicitConfirm: boolean;
  signedIn: boolean;
  block: FboActionBlock | null;
  inFlight: { current: boolean };
  createClient: () => Pick<WinnerMutationClient, 'verifyTripFbo'>;
}): Promise<WinnerSubmission> {
  if (input.gateOpen !== true) return { status: 'disabled' };
  const legId = parseProductionFlightId(input.legId);
  if (legId === null) return { status: 'failed', failure: presentTripActionFailure(400) };
  if (input.signedIn !== true) return { status: 'failed', failure: presentTripActionFailure(401) };
  if (input.explicitConfirm !== true) return { status: 'needs-confirmation' };
  if (input.block) return { status: 'failed', failure: presentFboBlock(input.block) };
  if (input.inFlight.current) return { status: 'duplicate', failure: fboDuplicateFailure() };
  input.inFlight.current = true;
  try {
    const trip = verifiedFboTripForLeg(legId, await input.createClient().verifyTripFbo(legId));
    if (!trip) return { status: 'failed', failure: fboUnconfirmedFailure() };
    return { status: 'verified', trip };
  } catch (error) {
    return { status: 'failed', failure: presentFboError(error) };
  } finally {
    input.inFlight.current = false;
  }
}

function manifestDuplicateFailure(): TripActionFailure {
  return { title: 'Request already in progress', body: MANIFEST_DUPLICATE };
}

function manifestUnconfirmedFailure(): TripActionFailure {
  return { title: 'Change not confirmed', body: MANIFEST_UNCONFIRMED };
}

function presentManifestError(error: unknown): TripActionFailure {
  if (error instanceof ProductionAuthSchemaError || (error instanceof ProductionAuthRequestError && error.code === 'invalid_json')) {
    return manifestUnconfirmedFailure();
  }
  return presentWinnerError(error);
}

/**
 * POST /api/trips/:legId/checklist/manifestAck. A closed gate returns before
 * the client is created. Success requires manifestAckAt on the matching trip.
 * Saving a passenger does not call this request.
 */
export async function submitManifestAcknowledgement(input: {
  gateOpen: boolean;
  legId: number;
  explicitConfirm: boolean;
  signedIn: boolean;
  block: ManifestActionBlock | null;
  inFlight: { current: boolean };
  createClient: () => Pick<WinnerMutationClient, 'acknowledgeTripManifest'>;
}): Promise<WinnerSubmission> {
  if (input.gateOpen !== true) return { status: 'disabled' };
  const legId = parseProductionFlightId(input.legId);
  if (legId === null) return { status: 'failed', failure: presentTripActionFailure(400) };
  if (input.signedIn !== true) return { status: 'failed', failure: presentTripActionFailure(401) };
  if (input.explicitConfirm !== true) return { status: 'needs-confirmation' };
  if (input.block) return { status: 'failed', failure: presentManifestBlock(input.block) };
  if (input.inFlight.current) return { status: 'duplicate', failure: manifestDuplicateFailure() };
  input.inFlight.current = true;
  try {
    const trip = acknowledgedManifestTripForLeg(legId, await input.createClient().acknowledgeTripManifest(legId));
    if (!trip) return { status: 'failed', failure: manifestUnconfirmedFailure() };
    return { status: 'acknowledged', trip };
  } catch (error) {
    return { status: 'failed', failure: presentManifestError(error) };
  } finally {
    input.inFlight.current = false;
  }
}

function policyDuplicateFailure(): TripActionFailure {
  return { title: 'Request already in progress', body: POLICY_DUPLICATE };
}

function policyUnconfirmedFailure(): TripActionFailure {
  return { title: 'Change not confirmed', body: POLICY_UNCONFIRMED };
}

function presentPolicyError(error: unknown): TripActionFailure {
  if (error instanceof ProductionAuthSchemaError || (error instanceof ProductionAuthRequestError && error.code === 'invalid_json')) {
    return policyUnconfirmedFailure();
  }
  return presentWinnerError(error);
}

/**
 * POST /api/trips/:legId/checklist/policyAck. A closed gate returns before
 * the client is created. No policy version is sent. Success requires
 * policyAckAt on the matching trip.
 */
export async function submitPolicyAcknowledgement(input: {
  gateOpen: boolean;
  legId: number;
  explicitConfirm: boolean;
  signedIn: boolean;
  block: PolicyActionBlock | null;
  inFlight: { current: boolean };
  createClient: () => Pick<WinnerMutationClient, 'acknowledgeTripPolicy'>;
}): Promise<WinnerSubmission> {
  if (input.gateOpen !== true) return { status: 'disabled' };
  const legId = parseProductionFlightId(input.legId);
  if (legId === null) return { status: 'failed', failure: presentTripActionFailure(400) };
  if (input.signedIn !== true) return { status: 'failed', failure: presentTripActionFailure(401) };
  if (input.block) return { status: 'failed', failure: presentPolicyBlock(input.block) };
  if (input.explicitConfirm !== true) return { status: 'needs-confirmation' };
  if (input.inFlight.current) return { status: 'duplicate', failure: policyDuplicateFailure() };
  input.inFlight.current = true;
  try {
    const trip = acknowledgedPolicyTripForLeg(legId, await input.createClient().acknowledgeTripPolicy(legId));
    if (!trip) return { status: 'failed', failure: policyUnconfirmedFailure() };
    return { status: 'policy-acknowledged', trip };
  } catch (error) {
    return { status: 'failed', failure: presentPolicyError(error) };
  } finally {
    input.inFlight.current = false;
  }
}

function boardingPassDuplicateFailure(): TripActionFailure {
  return { title: 'Request already in progress', body: BOARDING_PASS_DUPLICATE };
}

function boardingPassUnconfirmedFailure(): TripActionFailure {
  return { title: 'Change not confirmed', body: BOARDING_PASS_UNCONFIRMED };
}

function presentBoardingPassError(error: unknown): TripActionFailure {
  if (error instanceof ProductionAuthSchemaError || (error instanceof ProductionAuthRequestError && error.code === 'invalid_json')) {
    return boardingPassUnconfirmedFailure();
  }
  return presentWinnerError(error);
}

/**
 * POST /api/trips/:legId/boarding-pass/send. A closed gate returns before the
 * client is created. No body. Success requires passLinkSentAt on the matching
 * trip. That timestamp records the send request. It does not prove delivery.
 */
export async function submitBoardingPassSend(input: {
  gateOpen: boolean;
  legId: number;
  explicitConfirm: boolean;
  signedIn: boolean;
  block: BoardingPassActionBlock | null;
  inFlight: { current: boolean };
  createClient: () => Pick<WinnerMutationClient, 'sendTripBoardingPass'>;
}): Promise<WinnerSubmission> {
  if (input.gateOpen !== true) return { status: 'disabled' };
  const legId = parseProductionFlightId(input.legId);
  if (legId === null) return { status: 'failed', failure: presentTripActionFailure(400) };
  if (input.signedIn !== true) return { status: 'failed', failure: presentTripActionFailure(401) };
  if (input.block) return { status: 'failed', failure: presentBoardingPassBlock(input.block) };
  if (input.explicitConfirm !== true) return { status: 'needs-confirmation' };
  if (input.inFlight.current) return { status: 'duplicate', failure: boardingPassDuplicateFailure() };
  input.inFlight.current = true;
  try {
    const trip = sentBoardingPassTripForLeg(legId, await input.createClient().sendTripBoardingPass(legId));
    if (!trip) return { status: 'failed', failure: boardingPassUnconfirmedFailure() };
    return { status: 'pass-recorded', trip };
  } catch (error) {
    return { status: 'failed', failure: presentBoardingPassError(error) };
  } finally {
    input.inFlight.current = false;
  }
}

export function winnerMutationRefreshKeys(input: { environment: MainBluebirdApiEnvironment; clerkUserId: string; legId: number }) {
  const legId = parseProductionFlightId(input.legId);
  if (legId === null) return null;
  return {
    trip: mainBluebirdAuthenticatedQueryKey(input.environment, input.clerkUserId, 'trip', legId),
    trips: mainBluebirdAuthenticatedQueryKey(input.environment, input.clerkUserId, 'trips'),
    detail: productionFlightDetailQueryKey(legId, input.clerkUserId),
    queue: mainBluebirdAuthenticatedQueryKey(input.environment, input.clerkUserId, 'empty-leg-queue', legId),
    myQueues: mainBluebirdAuthenticatedQueryKey(input.environment, input.clerkUserId, 'empty-leg-queue'),
    flightList: mainBluebirdAuthenticatedQueryKey(input.environment, input.clerkUserId, 'empty-leg-list'),
  };
}

export function applyWinnerMutationRefresh(input: {
  gateOpen: boolean;
  requestedUserId: string;
  activeUserId: string | null;
  signedIn: boolean;
  environment: MainBluebirdApiEnvironment;
  legId: number;
  invalidate: (key: readonly unknown[]) => void;
}): boolean {
  const requested = input.requestedUserId.trim();
  const keys = winnerMutationRefreshKeys({
    environment: input.environment,
    clerkUserId: requested,
    legId: input.legId,
  });
  if (!keys || input.gateOpen !== true || input.signedIn !== true || requested.length === 0 || input.activeUserId !== requested) {
    return false;
  }
  input.invalidate(keys.trip);
  input.invalidate(keys.trips);
  input.invalidate(keys.detail);
  input.invalidate(keys.queue);
  input.invalidate(keys.myQueues);
  input.invalidate(keys.flightList);
  return true;
}
