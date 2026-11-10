import type { ProductionTrip, ProductionTripChecklist, ProductionTrips } from './productionAuthApi';

/** Winner confirmation awards the flight through the existing winner endpoint. */
export function canConfirmProductionWinner(): boolean {
  return true;
}

/** Decline uses the existing winner endpoint and may advance the next member. */
export function canDeclineProductionWinner(): boolean {
  return true;
}

export function canVerifyProductionFbo(): boolean {
  return true;
}

export function canAcknowledgeProductionManifest(): boolean {
  return true;
}

export function canAcknowledgeProductionPolicy(): boolean {
  return true;
}

/** Sending a boarding pass uses the existing trip endpoint. Delivery is recorded only by passLinkSentAt. */
export function canSendProductionBoardingPass(): boolean {
  return true;
}

export type WinnerPresentation =
  { kind: 'hidden' } | { kind: 'selected'; confirmationLabel: string; actions: boolean } | { kind: 'awarded' } | { kind: 'declined' };

export function isQueueClosed(queueClosesAt: string | null, nowMs: number): boolean {
  if (!queueClosesAt || !Number.isFinite(nowMs)) return false;
  const closingMs = Date.parse(queueClosesAt);
  return Number.isFinite(closingMs) && closingMs <= nowMs;
}

/**
 * Effective-winner copy is shown only for a closed queue that the trip list
 * says is not awarded. Position, a local queue entry, and booked-passenger
 * status are intentionally not inputs.
 */
export function presentWinnerState(input: {
  viewerAuthenticated: boolean;
  viewerIsEffectiveWinner: boolean | null;
  viewerConfirmationStatus: string | null;
  queueClosesAt: string | null;
  nowMs: number;
  awarded: boolean | null;
}): WinnerPresentation {
  if (!input.viewerAuthenticated || input.awarded === null) return { kind: 'hidden' };
  const confirmation = input.viewerConfirmationStatus?.trim().toLowerCase() ?? '';
  if (confirmation === 'declined' && input.awarded !== true) return { kind: 'declined' };
  if (input.awarded === true) return { kind: 'awarded' };
  if (input.viewerIsEffectiveWinner !== true) return { kind: 'hidden' };
  if (!isQueueClosed(input.queueClosesAt, input.nowMs)) return { kind: 'hidden' };
  if (confirmation === 'confirmed') {
    return {
      kind: 'selected',
      actions: false,
      confirmationLabel: 'Confirmation recorded. This flight is not awarded yet.',
    };
  }
  return {
    kind: 'selected',
    actions: true,
    confirmationLabel: confirmation === 'pending' ? 'Awaiting your confirmation' : 'Not confirmed',
  };
}

export function awardStateForFlight(trips: ProductionTrips | undefined, flightId: number): boolean | null {
  if (!trips || !Number.isSafeInteger(flightId) || flightId < 1) return null;
  const match = [...trips.current, ...trips.past].find((trip) => tripMatchesFlight(trip, flightId));
  if (!match) return false;
  return match.checklist.awarded === true;
}

export function labelCurrentTrips(trips: ProductionTrips): Array<{ flightId: number; label: string }> {
  return trips.current.map((trip) => ({
    flightId: trip.checklist.emptyLegId,
    label: presentTripChecklistStatus({
      list: 'current',
      awarded: trip.checklist.awarded,
      remainingSteps: trip.checklist.remainingSteps,
      status: trip.status ?? null,
    }),
  }));
}

export type TripListStatusLabel =
  | 'Past trip'
  | 'Pending'
  | 'Winner confirmation required'
  | 'Awaiting award'
  | 'Awaiting confirmation'
  | 'Checklist in progress'
  | 'Confirmed';

/**
 * Trips labels follow GET /trips lifecycle status when present.
 * queue_pending must never look like a winner confirmation prompt.
 * Older backends without status keep the unawarded → Pending fallback.
 */
export function presentTripChecklistStatus(input: {
  list: 'current' | 'past';
  awarded: boolean;
  remainingSteps: readonly string[];
  status?: string | null;
}): TripListStatusLabel {
  if (input.list === 'past') return 'Past trip';
  const status = typeof input.status === 'string' ? input.status.trim().toLowerCase() : '';
  if (status === 'queue_pending') return 'Pending';
  if (status === 'winner_confirmation_required') return 'Winner confirmation required';
  if (status === 'awaiting_award') return 'Awaiting award';
  if (status === 'awarded' || input.awarded === true) {
    return input.remainingSteps.length > 0 ? 'Checklist in progress' : 'Confirmed';
  }
  return 'Pending';
}

/**
 * A current trip can open the existing checklist only when this account's
 * trip list says the flight is awarded and the leg id is usable.
 * Membership in Current Trips is not eligibility. The list has no
 * effective-winner field, so an unawarded trip stays on the card.
 * Past trips stay on the card. The checklist read happens after the tap.
 */
export function currentTripChecklistTarget(input: {
  list: 'current' | 'past';
  awarded: boolean;
  legId: number;
}): { pathname: '/flight/checklist'; params: { legId: string } } | null {
  if (input.list !== 'current' || input.awarded !== true) return null;
  if (!Number.isSafeInteger(input.legId) || input.legId < 1) return null;
  return { pathname: '/flight/checklist', params: { legId: String(input.legId) } };
}

/** Recheck the signed-in account's current-trip cache at the moment of the tap. */
export function resolveCurrentTripChecklistNavigation(input: {
  signedIn: boolean;
  activeUserId: string | null;
  accountUserId: string | null;
  cachedTrips: { current: readonly { leg: { id: number }; checklist: { awarded: boolean } }[] } | null;
  legId: number;
}): { pathname: '/flight/checklist'; params: { legId: string } } | null {
  const account = input.accountUserId?.trim() ?? '';
  const active = input.activeUserId?.trim() ?? '';
  if (input.signedIn !== true || account.length === 0 || active !== account) return null;
  const match = input.cachedTrips?.current.find((trip) => trip.leg.id === input.legId);
  if (!match) return null;
  return currentTripChecklistTarget({
    list: 'current',
    awarded: match.checklist.awarded,
    legId: match.leg.id,
  });
}

export function checklistFullyComplete(checklist: Pick<
  ProductionTripChecklist,
  'awarded' | 'remainingSteps' | 'confirmedAt' | 'fboVerifiedAt' | 'manifestAckAt' | 'policyAckAt'
>): boolean {
  if (checklist.awarded !== true || checklist.remainingSteps.length > 0) return false;
  return hasTimestamp(checklist.confirmedAt) &&
    hasTimestamp(checklist.fboVerifiedAt) &&
    hasTimestamp(checklist.manifestAckAt) &&
    hasTimestamp(checklist.policyAckAt);
}

export function presentBoardingPass(input: { awarded: boolean; boardingPassUrl: string | null }): string | null {
  if (input.awarded !== true) return null;
  const url = input.boardingPassUrl?.trim() ?? '';
  if (!url.startsWith('https://') || /\s/.test(url)) return null;
  return url;
}

export interface ChecklistStepView {
  id: 'confirmed' | 'fboVerified' | 'manifestAck' | 'policyAck';
  title: string;
  complete: boolean;
  detail: string;
}

export function presentChecklistSteps(
  checklist: Pick<ProductionTripChecklist, 'confirmedAt' | 'fboVerifiedAt' | 'manifestAckAt' | 'policyAckAt'>,
  options?: {
    passengerDetailsAvailable?: boolean;
    policyDocumentAvailable?: boolean;
  },
): ChecklistStepView[] {
  return [
    {
      id: 'confirmed',
      title: 'Confirm Flight',
      complete: hasTimestamp(checklist.confirmedAt),
      detail:
        hasTimestamp(checklist.confirmedAt) ? 'Confirmed.'
        : canConfirmProductionWinner() ? 'Confirm this flight.'
        : 'Confirmation is not available in this build.',
    },
    {
      id: 'fboVerified',
      title: 'Verify FBO',
      complete: hasTimestamp(checklist.fboVerifiedAt),
      detail:
        hasTimestamp(checklist.fboVerifiedAt) ? 'FBO verified.'
        : canVerifyProductionFbo() ? 'Verify the departure FBO.'
        : 'FBO verification is not available in this build.',
    },
    {
      id: 'manifestAck',
      title: 'Passenger Information',
      complete: hasTimestamp(checklist.manifestAckAt),
      detail:
        hasTimestamp(checklist.manifestAckAt) ? 'Passenger information acknowledged.'
        : options?.passengerDetailsAvailable === false ? 'Passenger details are not available in this build. No passenger request is sent.'
        : canAcknowledgeProductionManifest() ?
          'Review the passenger list, then acknowledge it. Saving a passenger does not complete this step.'
        : 'Review passenger details on the passenger screen. Saving changes is not available in this build.',
    },
    {
      id: 'policyAck',
      title: 'Flight Policy',
      complete: hasTimestamp(checklist.policyAckAt),
      detail:
        hasTimestamp(checklist.policyAckAt) ? 'Policy acknowledged.'
        : options?.policyDocumentAvailable === false ?
          'The flight policy cannot be loaded in this build. Acknowledgement is not available. No request is sent.'
        : canAcknowledgeProductionPolicy() ? 'Read the flight policy and agree.'
        : 'Read the active flight policy. Acknowledgement is not available in this build.',
    },
  ];
}

export const PASSENGER_PLACEHOLDER_NOTE =
  'You can add up to five passengers. First name, last name, weight in pounds, date of birth, and gender are required. Seat capacity may be lower.';

export const PASSENGER_DETAILS_UNAVAILABLE_NOTE = 'Passenger details are not available in this build. No passenger request is sent.';

export const POLICY_DOCUMENT_UNAVAILABLE_NOTE =
  'The flight policy cannot be loaded in this build. Acknowledgement is not available. No request is sent.';

export const CHECKLIST_LIST_UNAVAILABLE_TITLE = 'Checklist unavailable';

export const CHECKLIST_LIST_UNAVAILABLE_BODY =
  'This build cannot load a separate trip checklist. Return to Trips to use the trip list already on this device. No additional request is sent.';

export const CHECKLIST_BACK_TO_TRIPS_LABEL = 'Back to Trips';

/**
 * The trip list from GET /api/trips already carries the checklist fields.
 * Auth-test builds use that copy and do not call GET /api/trips/:id.
 */
export function listedTripForChecklist(trips: ProductionTrips | null | undefined, legId: number): ProductionTrip | null {
  if (!trips || !Number.isSafeInteger(legId) || legId < 1) return null;
  return trips.current.find((trip) => trip.checklist.awarded === true && tripMatchesFlight(trip, legId)) ?? null;
}

/**
 * The website asks the member to read the active flight policy, scroll to the
 * end, and agree. Acknowledgement uses the existing policy request.
 * The join-flow Flight Policy screen is a separate local document and is not
 * this contract.
 */
export const POLICY_UNAVAILABLE_NOTE =
  'Read the flight policy and agree. Acceptance is recorded when Bluebird confirms it.';

export type ChecklistMutationReview =
  | { status: 'invalid' }
  | { status: 'needs-confirmation'; method: 'POST'; path: string; body: null }
  | { status: 'disabled'; method: 'POST'; path: string; body: null }
  | { status: 'ready'; method: 'POST'; path: string; body: null };

export type WinnerActionBlock = 'not-winner' | 'already-confirmed' | 'already-declined' | 'not-open';

/** A known future queue close means the selection is not open. A missing close time stays for the server to decide. */
export function winnerSelectionNotOpen(queueClosesAt: string | null, nowMs: number): boolean {
  if (!queueClosesAt || !Number.isFinite(nowMs)) return false;
  const closingMs = Date.parse(queueClosesAt);
  return Number.isFinite(closingMs) && closingMs > nowMs;
}

export function winnerActionBlock(input: {
  isWinner: boolean;
  awarded: boolean;
  confirmed: boolean;
  confirmedAt: string | null;
  declined: boolean;
  queueClosesAt: string | null;
  nowMs: number;
}): WinnerActionBlock | null {
  if (input.declined) return 'already-declined';
  if (input.awarded || input.confirmed || hasTimestamp(input.confirmedAt)) return 'already-confirmed';
  if (!input.isWinner) return 'not-winner';
  if (winnerSelectionNotOpen(input.queueClosesAt, input.nowMs)) return 'not-open';
  return null;
}

export const WINNER_DECLINE_DIALOG = 'Declining gives up this selection and may give the opportunity to another member.';
export const WINNER_CONFIRMED = 'Bluebird recorded your confirmation. The checklist shows the server confirmation time.';
export const WINNER_DECLINED = 'Bluebird recorded that you declined this flight.';
export const WINNER_UNCONFIRMED = 'Bluebird did not confirm this change. Nothing was saved on this device.';
export const WINNER_DUPLICATE = 'A winner request is already in progress. No second request was sent.';

export function presentWinnerBlock(block: WinnerActionBlock): TripActionFailure {
  if (block === 'not-winner') {
    return {
      title: 'Not available',
      body: 'This account is not the eligible winner for this flight. No request was sent.',
    };
  }
  if (block === 'already-confirmed') {
    return {
      title: 'Already confirmed',
      body: 'This confirmation is already recorded. No request was sent.',
    };
  }
  if (block === 'already-declined') {
    return {
      title: 'Already declined',
      body: 'This flight was already declined. No request was sent.',
    };
  }
  return {
    title: 'Selection not open',
    body: 'This winner selection is not open. No request was sent.',
  };
}

export function reviewWinnerConfirmation(legId: number): ChecklistMutationReview {
  return reviewPost(legId, `/empty-legs/${legId}/winner/confirm`, canConfirmProductionWinner());
}

export function reviewWinnerDecline(legId: number, explicitConfirm: boolean): ChecklistMutationReview {
  if (!Number.isSafeInteger(legId) || legId < 1) return { status: 'invalid' };
  const path = `/empty-legs/${legId}/winner/decline`;
  if (explicitConfirm !== true) return { status: 'needs-confirmation', method: 'POST', path, body: null };
  if (!canDeclineProductionWinner()) return { status: 'disabled', method: 'POST', path, body: null };
  return { status: 'ready', method: 'POST', path, body: null };
}

export function reviewFboVerification(legId: number): ChecklistMutationReview {
  return reviewPost(legId, `/trips/${legId}/checklist/fboVerified`, canVerifyProductionFbo());
}

export function reviewManifestAcknowledgement(legId: number): ChecklistMutationReview {
  return reviewPost(legId, `/trips/${legId}/checklist/manifestAck`, canAcknowledgeProductionManifest());
}

export function reviewPolicyAcknowledgement(legId: number): ChecklistMutationReview {
  return reviewPost(legId, `/trips/${legId}/checklist/policyAck`, canAcknowledgeProductionPolicy());
}

export function reviewBoardingPassSend(legId: number): ChecklistMutationReview {
  return reviewPost(legId, `/trips/${legId}/boarding-pass/send`, canSendProductionBoardingPass());
}

/** A send counts only when this trip matches the leg and the server recorded passLinkSentAt. */
export function sentBoardingPassTripForLeg(legId: number, trip: ProductionTrip): ProductionTrip | null {
  if (!Number.isSafeInteger(legId) || legId < 1 || !tripMatchesFlight(trip, legId)) return null;
  if (!hasTimestamp(trip.checklist.passLinkSentAt)) return null;
  return trip;
}

export type BoardingPassActionBlock = 'checklist-unavailable' | 'not-awarded' | 'pass-unavailable' | 'already-sent';

export function boardingPassActionBlock(input: {
  checklistAvailable: boolean;
  awarded: boolean;
  boardingPassUrl: string | null;
  passLinkSentAt: string | null;
}): BoardingPassActionBlock | null {
  if (input.checklistAvailable !== true) return 'checklist-unavailable';
  if (input.awarded !== true) return 'not-awarded';
  if (presentBoardingPass({ awarded: true, boardingPassUrl: input.boardingPassUrl }) === null) {
    return 'pass-unavailable';
  }
  if (hasTimestamp(input.passLinkSentAt)) return 'already-sent';
  return null;
}

export const BOARDING_PASS_SEND_DIALOG =
  'This asks Bluebird to send the boarding pass link for this flight. It does not confirm that the message arrives.';
export const BOARDING_PASS_SENT = 'Bluebird recorded that the boarding pass link was sent. Delivery is not confirmed on this device.';
export const BOARDING_PASS_UNCONFIRMED = 'Bluebird did not confirm that the boarding pass link was sent. Nothing was saved on this device.';
export const BOARDING_PASS_DUPLICATE = 'A boarding pass request is already in progress. No second request was sent.';

export function presentBoardingPassBlock(block: BoardingPassActionBlock): TripActionFailure {
  if (block === 'not-awarded') {
    return {
      title: 'Not available',
      body: 'A boarding pass is available only after this flight is awarded. No request was sent.',
    };
  }
  if (block === 'pass-unavailable') {
    return {
      title: 'Boarding pass unavailable',
      body: 'This flight does not have a boarding pass link that can be opened. No request was sent.',
    };
  }
  if (block === 'already-sent') {
    return {
      title: 'Already recorded',
      body: 'Bluebird already recorded a boarding pass send for this flight. No second request was sent.',
    };
  }
  return {
    title: 'Checklist unavailable',
    body: 'This checklist is not available for the signed-in account. No request was sent.',
  };
}

export interface TripActionFailure {
  title: string;
  body: string;
}

export function presentTripActionFailure(status: number | null): TripActionFailure {
  if (status === 400) {
    return { title: 'Request not accepted', body: 'Bluebird did not accept this request. Nothing was changed.' };
  }
  if (status === 401) {
    return { title: 'Sign in required', body: 'Sign in again before continuing. Nothing was changed.' };
  }
  if (status === 403) {
    return { title: 'Not available', body: 'This trip is not available for the signed-in account. Nothing was changed.' };
  }
  if (status === 404) {
    return { title: 'Flight unavailable', body: 'This flight is no longer available.' };
  }
  if (status === 409) {
    return {
      title: 'Trip not changed',
      body: 'The queue may still be open, the selection may have been declined, or the flight may already be awarded. Nothing was changed.',
    };
  }
  return { title: 'Connection problem', body: 'Bluebird could not be reached. Nothing was changed.' };
}

export class TripChecklistSessionError extends Error {
  constructor() {
    super('The signed-in account changed.');
    this.name = 'TripChecklistSessionError';
  }
}

export class TripChecklistMismatchError extends Error {
  constructor() {
    super('This trip does not match the opened flight.');
    this.name = 'TripChecklistMismatchError';
  }
}

export function shouldApplyTripChecklist(input: { requestedUserId: string; activeUserId: string | null; signedIn: boolean }): boolean {
  const requested = input.requestedUserId.trim();
  return input.signedIn === true && requested.length > 0 && input.activeUserId === requested;
}

export function tripMatchesFlight(trip: ProductionTrip, flightId: number): boolean {
  return trip.checklist.emptyLegId === flightId || trip.leg.id === flightId;
}

/** Confirmation counts only when this trip matches the leg and the server recorded a confirmation time. */
export function confirmedTripForLeg(legId: number, trip: ProductionTrip): ProductionTrip | null {
  if (!Number.isSafeInteger(legId) || legId < 1 || !tripMatchesFlight(trip, legId)) return null;
  if (!hasTimestamp(trip.checklist.confirmedAt)) return null;
  return trip;
}

/** FBO verification counts only when this trip matches the leg and the server recorded fboVerifiedAt. */
export function verifiedFboTripForLeg(legId: number, trip: ProductionTrip): ProductionTrip | null {
  if (!Number.isSafeInteger(legId) || legId < 1 || !tripMatchesFlight(trip, legId)) return null;
  if (!hasTimestamp(trip.checklist.fboVerifiedAt)) return null;
  return trip;
}

/** Policy acknowledgement counts only when this trip matches the leg and the server recorded policyAckAt. */
export function acknowledgedPolicyTripForLeg(legId: number, trip: ProductionTrip): ProductionTrip | null {
  if (!Number.isSafeInteger(legId) || legId < 1 || !tripMatchesFlight(trip, legId)) return null;
  if (!hasTimestamp(trip.checklist.policyAckAt)) return null;
  return trip;
}

/** Acknowledgement counts only when this trip matches the leg and the server recorded manifestAckAt. */
export function acknowledgedManifestTripForLeg(legId: number, trip: ProductionTrip): ProductionTrip | null {
  if (!Number.isSafeInteger(legId) || legId < 1 || !tripMatchesFlight(trip, legId)) return null;
  if (!hasTimestamp(trip.checklist.manifestAckAt)) return null;
  return trip;
}

export type ManifestActionBlock =
  'not-winner' | 'already-acknowledged' | 'checklist-unavailable' | 'manifest-unavailable' | 'manifest-locked';

export function manifestActionBlock(input: {
  isWinner: boolean;
  checklistAvailable: boolean;
  manifestAvailable: boolean;
  manifestAckAt: string | null;
  manifestLocked: boolean;
}): ManifestActionBlock | null {
  if (input.checklistAvailable !== true) return 'checklist-unavailable';
  if (input.isWinner !== true) return 'not-winner';
  if (input.manifestAvailable !== true) return 'manifest-unavailable';
  if (hasTimestamp(input.manifestAckAt)) return 'already-acknowledged';
  if (input.manifestLocked === true) return 'manifest-locked';
  return null;
}

export const MANIFEST_ACK_DIALOG = 'This acknowledges the passenger list. It does not save passenger changes.';
export const MANIFEST_ACKNOWLEDGED = 'Bluebird recorded the passenger acknowledgement.';
export const MANIFEST_UNCONFIRMED = 'Bluebird did not confirm this passenger acknowledgement. Nothing was saved on this device.';
export const MANIFEST_DUPLICATE = 'A passenger acknowledgement is already in progress. No second request was sent.';

export function presentManifestBlock(block: ManifestActionBlock): TripActionFailure {
  if (block === 'not-winner') {
    return {
      title: 'Not available',
      body: 'This account is not the eligible winner for this flight. No request was sent.',
    };
  }
  if (block === 'already-acknowledged') {
    return {
      title: 'Already acknowledged',
      body: 'This passenger list is already acknowledged. No request was sent.',
    };
  }
  if (block === 'manifest-unavailable') {
    return {
      title: 'Passenger list unavailable',
      body: 'Review the passenger list before acknowledging it. No request was sent.',
    };
  }
  if (block === 'manifest-locked') {
    return {
      title: 'Passenger list locked',
      body: 'This passenger manifest is locked. No request was sent.',
    };
  }
  return {
    title: 'Checklist unavailable',
    body: 'This checklist is not available for the signed-in account. No request was sent.',
  };
}

export type PolicyActionBlock =
  'not-winner' | 'already-acknowledged' | 'checklist-unavailable' | 'policy-unavailable' | 'scroll-incomplete' | 'consent-required';

export function policyActionBlock(input: {
  isWinner: boolean;
  checklistAvailable: boolean;
  policyAvailable: boolean;
  scrollComplete: boolean;
  consentChecked: boolean;
  policyAckAt: string | null;
}): PolicyActionBlock | null {
  if (input.checklistAvailable !== true) return 'checklist-unavailable';
  if (input.isWinner !== true) return 'not-winner';
  if (input.policyAvailable !== true) return 'policy-unavailable';
  if (hasTimestamp(input.policyAckAt)) return 'already-acknowledged';
  if (input.scrollComplete !== true) return 'scroll-incomplete';
  if (input.consentChecked !== true) return 'consent-required';
  return null;
}

export const POLICY_ACKNOWLEDGED = 'Bluebird recorded the flight policy acknowledgement.';
export const POLICY_UNCONFIRMED = 'Bluebird did not confirm this flight policy acknowledgement. Nothing was saved on this device.';
export const POLICY_DUPLICATE = 'A flight policy acknowledgement is already in progress. No second request was sent.';
export const POLICY_CONSENT_REQUIRED = 'Agree to the flight policy before acknowledging it. No request was sent.';

export function presentPolicyBlock(block: PolicyActionBlock): TripActionFailure {
  if (block === 'not-winner') {
    return {
      title: 'Not available',
      body: 'This account is not the eligible winner for this flight. No request was sent.',
    };
  }
  if (block === 'already-acknowledged') {
    return {
      title: 'Already acknowledged',
      body: 'This flight policy is already acknowledged. No request was sent.',
    };
  }
  if (block === 'policy-unavailable') {
    return {
      title: 'Flight policy unavailable',
      body: 'The flight policy could not be shown. No request was sent.',
    };
  }
  if (block === 'scroll-incomplete') {
    return {
      title: 'Keep reading',
      body: 'Scroll to the end of the flight policy before acknowledging it. No request was sent.',
    };
  }
  if (block === 'consent-required') {
    return { title: 'Agreement required', body: POLICY_CONSENT_REQUIRED };
  }
  return {
    title: 'Checklist unavailable',
    body: 'Open the winner checklist for this flight before acknowledging the policy. No request was sent.',
  };
}

export type FboActionBlock = 'not-winner' | 'already-verified' | 'checklist-unavailable';

export function fboActionBlock(input: {
  isWinner: boolean;
  checklistAvailable: boolean;
  fboVerifiedAt: string | null;
}): FboActionBlock | null {
  if (input.checklistAvailable !== true) return 'checklist-unavailable';
  if (input.isWinner !== true) return 'not-winner';
  if (hasTimestamp(input.fboVerifiedAt)) return 'already-verified';
  return null;
}

export const FBO_VERIFY_DIALOG = 'This records that you checked the departure and arrival FBO for this flight.';
export const FBO_VERIFIED = 'Bluebird recorded your FBO verification.';
export const FBO_UNCONFIRMED = 'Bluebird did not confirm this FBO verification. Nothing was saved on this device.';
export const FBO_DUPLICATE = 'An FBO verification is already in progress. No second request was sent.';

export function presentFboBlock(block: FboActionBlock): TripActionFailure {
  if (block === 'not-winner') {
    return {
      title: 'Not available',
      body: 'This account is not the eligible winner for this flight. No request was sent.',
    };
  }
  if (block === 'already-verified') {
    return {
      title: 'Already verified',
      body: 'FBO verification is already recorded. No request was sent.',
    };
  }
  return {
    title: 'Checklist unavailable',
    body: 'This checklist is not available for the signed-in account. No request was sent.',
  };
}

/** Decline counts only when this flight matches and a parsed confirmation status is declined. Promotion is not inferred. */
export function declinedFlightForId(
  flightId: number,
  flight: {
    id: number;
    viewerConfirmationStatus?: string | null;
    winnerConfirmationStatus?: string | null;
  },
): boolean {
  const declined = flight.viewerConfirmationStatus === 'declined' || flight.winnerConfirmationStatus === 'declined';
  return Number.isSafeInteger(flightId) && flightId >= 1 && flight.id === flightId && declined;
}

function reviewPost(legId: number, path: string, gateOpen: boolean): ChecklistMutationReview {
  if (!Number.isSafeInteger(legId) || legId < 1) return { status: 'invalid' };
  if (!gateOpen) return { status: 'disabled', method: 'POST', path, body: null };
  return { status: 'ready', method: 'POST', path, body: null };
}

function hasTimestamp(value: string | null): boolean {
  return typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}
