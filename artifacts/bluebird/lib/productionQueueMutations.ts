import type {
  JoinProductionQueueRequest,
  ProductionEmptyLeg,
  ProductionQueueEntry,
  ProductionQueueStatus,
  PurchaseProductionLineSkipRequest,
} from './productionAuthApi';
import {
  ProductionAuthHttpError,
  ProductionAuthNetworkError,
  ProductionAuthRequestError,
  ProductionAuthTimeoutError,
} from './productionAuthApi';
import {
  assessProductionQueueJoin,
  presentJoinFlightFailure,
  presentQueueLeaveFailure,
  presentQueueSkipFailure,
  QUEUE_JOIN_DUPLICATE,
  QUEUE_JOIN_UNCONFIRMED,
  QUEUE_LEAVE_UNCONFIRMED,
  QUEUE_SKIP_UNCONFIRMED,
  type JoinFlightFailure,
  type QueueJoinConsent,
} from './joinFlightPresentation';

export {
  applyQueueMutationRefresh,
  assessProductionQueueJoin,
  canSubmitProductionQueueJoin,
} from './joinFlightPresentation';
export {
  ProductionAuthHttpError,
  ProductionAuthNetworkError,
  ProductionAuthRequestError,
  sanitizeProductionHttpFailure,
} from './productionAuthApi';
import { parseProductionFlightId } from './productionFlights';
import {
  ProductionQueueContractError,
  validateProductionQueueJoin,
  validateProductionQueueLeave,
  validateProductionSkipLine,
} from './productionQueue';

export interface ProductionQueueMutationClient {
  joinEmptyLegQueue: (
    emptyLegId: number,
    data?: JoinProductionQueueRequest,
  ) => Promise<ProductionQueueEntry>;
  leaveEmptyLegQueue: (emptyLegId: number) => Promise<ProductionQueueStatus>;
}

type JoinSubmission =
  | { status: 'disabled' | 'consent-required' }
  | { status: 'duplicate'; failure: JoinFlightFailure }
  | { status: 'joined'; entry: ProductionQueueEntry }
  | { status: 'failed'; failure: JoinFlightFailure };

type LeaveSubmission =
  | { status: 'disabled' | 'needs-confirmation' }
  | { status: 'duplicate'; failure: JoinFlightFailure }
  | { status: 'left'; queueStatus: ProductionQueueStatus }
  | { status: 'failed'; failure: JoinFlightFailure };

type SkipSubmission =
  | { status: 'disabled' | 'needs-confirmation' | 'needs-credit' }
  | { status: 'duplicate'; failure: JoinFlightFailure }
  | { status: 'applied'; flight: ProductionEmptyLeg }
  | { status: 'failed'; failure: JoinFlightFailure };

export interface ProductionQueueSkipClient {
  skipLine: (
    emptyLegId: number,
    data?: PurchaseProductionLineSkipRequest,
  ) => Promise<ProductionEmptyLeg>;
}

function duplicateFailure(): JoinFlightFailure {
  return {
    status: null,
    code: 'duplicate_submission',
    title: 'Request already in progress',
    body: QUEUE_JOIN_DUPLICATE,
    conflict: null,
    keepsExistingQueue: false,
  };
}

function unconfirmedJoin(): JoinFlightFailure {
  return {
    status: null,
    code: 'invalid_transition',
    title: 'Queue not confirmed',
    body: QUEUE_JOIN_UNCONFIRMED,
    conflict: null,
    keepsExistingQueue: false,
  };
}

function unconfirmedLeave(): JoinFlightFailure {
  return {
    status: null,
    code: 'invalid_transition',
    title: 'Leave not confirmed',
    body: QUEUE_LEAVE_UNCONFIRMED,
    conflict: null,
    keepsExistingQueue: true,
  };
}

function presentQueueJoinError(error: unknown): JoinFlightFailure {
  if (error instanceof ProductionQueueContractError) return unconfirmedJoin();
  if (error instanceof ProductionAuthHttpError) {
    return presentJoinFlightFailure({
      status: error.status,
      code: error.serverCode,
      body: error.failureBody,
    });
  }
  if (error instanceof ProductionAuthNetworkError || error instanceof ProductionAuthTimeoutError) {
    return presentJoinFlightFailure({ status: null });
  }
  if (
    error instanceof ProductionAuthRequestError &&
    (error.code === 'token' || error.code === 'session_expired')
  ) {
    return presentJoinFlightFailure({ status: 401 });
  }
  return presentJoinFlightFailure({ status: null });
}

function unconfirmedSkip(): JoinFlightFailure {
  return {
    status: null,
    code: 'invalid_transition',
    title: 'Pass not confirmed',
    body: QUEUE_SKIP_UNCONFIRMED,
    conflict: null,
    keepsExistingQueue: true,
  };
}

function presentQueueSkipError(error: unknown): JoinFlightFailure {
  if (error instanceof ProductionQueueContractError) return unconfirmedSkip();
  if (error instanceof ProductionAuthHttpError) {
    return presentQueueSkipFailure({
      status: error.status,
      code: error.serverCode,
      body: error.failureBody,
    });
  }
  if (error instanceof ProductionAuthNetworkError || error instanceof ProductionAuthTimeoutError) {
    return presentQueueSkipFailure({ status: null });
  }
  if (
    error instanceof ProductionAuthRequestError &&
    (error.code === 'token' || error.code === 'session_expired')
  ) {
    return presentQueueSkipFailure({ status: 401 });
  }
  return presentQueueSkipFailure({ status: null });
}

function presentQueueLeaveError(error: unknown): JoinFlightFailure {
  if (error instanceof ProductionQueueContractError) return unconfirmedLeave();
  if (error instanceof ProductionAuthHttpError) {
    return presentQueueLeaveFailure({
      status: error.status,
      code: error.serverCode,
      body: error.failureBody,
    });
  }
  if (error instanceof ProductionAuthNetworkError || error instanceof ProductionAuthTimeoutError) {
    return presentQueueLeaveFailure({ status: null });
  }
  if (
    error instanceof ProductionAuthRequestError &&
    (error.code === 'token' || error.code === 'session_expired')
  ) {
    return presentQueueLeaveFailure({ status: 401 });
  }
  return presentQueueLeaveFailure({ status: null });
}

/**
 * POST /api/empty-legs/:id/queue through the authenticated client.
 * A closed gate returns before the client is created. The caller passes the
 * live gate; this function does not turn that gate on.
 */
export async function submitProductionQueueJoin(input: {
  gateOpen: boolean;
  flightId: number;
  consent: QueueJoinConsent;
  creditConfirmed?: boolean;
  internationalPassRequired: boolean | null;
  signedIn: boolean;
  inFlight: { current: boolean };
  createClient: () => ProductionQueueMutationClient;
}): Promise<JoinSubmission> {
  if (input.gateOpen !== true) return { status: 'disabled' };
  const flightId = parseProductionFlightId(input.flightId);
  if (flightId === null) return { status: 'failed', failure: presentJoinFlightFailure({ status: 400 }) };
  if (input.signedIn !== true) return { status: 'failed', failure: presentJoinFlightFailure({ status: 401 }) };
  const review = assessProductionQueueJoin({
    consent: input.consent,
    internationalPassRequired: input.internationalPassRequired,
    creditConfirmed: input.creditConfirmed,
  });
  if (review.status !== 'ready' || review.body === null) return { status: 'consent-required' };
  if (input.inFlight.current) return { status: 'duplicate', failure: duplicateFailure() };
  input.inFlight.current = true;
  try {
    const entry = validateProductionQueueJoin(
      flightId,
      await input.createClient().joinEmptyLegQueue(flightId, review.body),
    );
    return { status: 'joined', entry };
  } catch (error) {
    return { status: 'failed', failure: presentQueueJoinError(error) };
  } finally {
    input.inFlight.current = false;
  }
}

/**
 * DELETE /api/empty-legs/:id/queue through the authenticated client.
 * A closed gate or a missing confirmation returns before the client is created.
 */
export async function submitProductionQueueLeave(input: {
  gateOpen: boolean;
  flightId: number;
  explicitConfirm: boolean;
  signedIn: boolean;
  inFlight: { current: boolean };
  createClient: () => ProductionQueueMutationClient;
}): Promise<LeaveSubmission> {
  if (input.gateOpen !== true) return { status: 'disabled' };
  const flightId = parseProductionFlightId(input.flightId);
  if (flightId === null) return { status: 'failed', failure: presentQueueLeaveFailure({ status: 400 }) };
  if (input.signedIn !== true) return { status: 'failed', failure: presentQueueLeaveFailure({ status: 401 }) };
  if (input.explicitConfirm !== true) return { status: 'needs-confirmation' };
  if (input.inFlight.current) return { status: 'duplicate', failure: duplicateFailure() };
  input.inFlight.current = true;
  try {
    const queueStatus = validateProductionQueueLeave(
      flightId,
      await input.createClient().leaveEmptyLegQueue(flightId),
    );
    return { status: 'left', queueStatus };
  } catch (error) {
    return { status: 'failed', failure: presentQueueLeaveError(error) };
  } finally {
    input.inFlight.current = false;
  }
}

/**
 * POST /api/empty-legs/:id/skip-line for a member who is already queued.
 * useCredit spends an existing pass. A closed gate, a missing confirmation,
 * or a missing credit returns before the client is created. Success updates
 * viewerQueuePosition and viewerHasLineSkip — not a confirmed winner or seat.
 */
export async function submitProductionQueueSkipLine(input: {
  gateOpen: boolean;
  flightId: number;
  explicitConfirm: boolean;
  existingCreditCount: number;
  signedIn: boolean;
  inFlight: { current: boolean };
  createClient: () => ProductionQueueSkipClient;
}): Promise<SkipSubmission> {
  if (input.gateOpen !== true) return { status: 'disabled' };
  const flightId = parseProductionFlightId(input.flightId);
  if (flightId === null) return { status: 'failed', failure: presentQueueSkipFailure({ status: 400 }) };
  if (input.signedIn !== true) return { status: 'failed', failure: presentQueueSkipFailure({ status: 401 }) };
  if (input.explicitConfirm !== true) return { status: 'needs-confirmation' };
  if (!Number.isSafeInteger(input.existingCreditCount) || input.existingCreditCount < 1) {
    return { status: 'needs-credit' };
  }
  if (input.inFlight.current) return { status: 'duplicate', failure: duplicateFailure() };
  input.inFlight.current = true;
  try {
    const flight = validateProductionSkipLine(
      flightId,
      await input.createClient().skipLine(flightId, { useCredit: true }),
    );
    return { status: 'applied', flight };
  } catch (error) {
    return { status: 'failed', failure: presentQueueSkipError(error) };
  } finally {
    input.inFlight.current = false;
  }
}
