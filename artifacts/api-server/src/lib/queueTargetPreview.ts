/**
 * Secure Flight Queue member preview for the position-1 opaque reference.
 *
 * The public queue roster stays initials-only. A signed-in member below first
 * may resolve first and last name through the current connectionTargetReference.
 * Privacy, blocks, membership, and queue eligibility are enforced here before
 * any identity fields are returned. Phone, email, and user ids never leave.
 */

const NAME = /^[\p{L}][\p{L}\p{M}'’.\- ]{0,79}$/u;
const QUEUE_TARGET_REFERENCE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type QueueTargetPreviewFailure =
  | { ok: false; status: 400; code: 'invalid_body' }
  | { ok: false; status: 401; code: 'unauthorized' }
  | { ok: false; status: 403; code: 'active_membership_required' }
  | { ok: false; status: 404; code: 'queue_target_unavailable' };

export type QueueTargetPreviewDecision =
  | { ok: true }
  | QueueTargetPreviewFailure;

export interface QueueTargetPreview {
  firstName: string;
  lastName: string;
  position: number;
}

/** UUID shape for the opaque queue target. Values are never logged here. */
export function isQueueTargetReference(value: unknown): value is string {
  return typeof value === 'string' && QUEUE_TARGET_REFERENCE.test(value.trim());
}

/**
 * Authorization for GET /me/connections/queue-targets/:queueTargetReference/preview.
 *
 * Unavailable reasons (privacy off, block, stale reference, not below first,
 * target left first, self) share queue_target_unavailable so the client cannot
 * distinguish them.
 */
export function evaluateQueueTargetPreview(input: {
  authenticated: boolean;
  activeMembership: boolean;
  reference: string | null;
  viewerPosition: number | null;
  referenceMatchesCurrentLeader: boolean;
  leaderStillFirst: boolean;
  incomingAllowed: boolean;
  blocked: boolean;
  isSelf: boolean;
}): QueueTargetPreviewDecision {
  if (!input.authenticated) {
    return { ok: false, status: 401, code: 'unauthorized' };
  }
  if (!input.activeMembership) {
    return { ok: false, status: 403, code: 'active_membership_required' };
  }
  if (!isQueueTargetReference(input.reference)) {
    return { ok: false, status: 400, code: 'invalid_body' };
  }
  if (
    input.viewerPosition == null ||
    !Number.isSafeInteger(input.viewerPosition) ||
    input.viewerPosition < 2 ||
    !input.referenceMatchesCurrentLeader ||
    !input.leaderStillFirst ||
    !input.incomingAllowed ||
    input.blocked ||
    input.isSelf
  ) {
    return { ok: false, status: 404, code: 'queue_target_unavailable' };
  }
  return { ok: true };
}

/**
 * Success body for the preview route. Extra identity fields are dropped.
 * An incomplete or unsafe name fails closed so the client keeps initials.
 */
export function presentQueueTargetPreview(input: {
  firstName: unknown;
  lastName: unknown;
  position: unknown;
  userId?: unknown;
  email?: unknown;
  phone?: unknown;
  phoneE164?: unknown;
}): QueueTargetPreview | null {
  const firstName = normalizeName(input.firstName);
  const lastName = normalizeName(input.lastName);
  const position = input.position;
  if (
    !firstName ||
    !lastName ||
    typeof position !== 'number' ||
    !Number.isSafeInteger(position) ||
    position < 1
  ) {
    return null;
  }
  return { firstName, lastName, position };
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  if (!NAME.test(name)) return null;
  return name;
}
