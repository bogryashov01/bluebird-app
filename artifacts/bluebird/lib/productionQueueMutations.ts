import type {
  JoinProductionQueueRequest,
  ProductionQueueEntry,
  ProductionQueueStatus,
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
  QUEUE_JOIN_DUPLICATE,
  QUEUE_JOIN_UNCONFIRMED,
  QUEUE_LEAVE_UNCONFIRMED,
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
