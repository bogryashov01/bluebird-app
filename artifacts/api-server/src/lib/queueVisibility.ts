/**
 * Queue roster shown to a member who already has an active entry on a flight.
 * Position 1 is the front of the waiting line. It is not a confirmed seat
 * and it does not select a winner.
 */

export interface QueueRosterSource {
  name: string;
  position: number;
  memberRef: string;
  userId?: string;
  phone?: string | null;
  email?: string | null;
}

export interface QueueRosterMember {
  initials: string;
  position: number;
  memberRef: string;
}

export function memberInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "M";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function presentQueueRoster(rows: readonly QueueRosterSource[]): QueueRosterMember[] {
  return [...rows]
    .filter((row) => Number.isInteger(row.position) && row.position >= 1 && row.memberRef.trim().length > 0)
    .sort((a, b) => a.position - b.position || a.memberRef.localeCompare(b.memberRef))
    .map((row) => ({
      initials: memberInitials(row.name),
      position: row.position,
      memberRef: row.memberRef,
    }));
}

export type ConnectionRequestDecision =
  | { ok: true }
  | { ok: false; status: 403 | 409; error: string; code: string };

/**
 * A request may target only the current front of the waiting queue.
 * The recipient's privacy preference is enforced here, before a row is written.
 */
export function evaluateConnectionRequest(input: {
  requesterIsMember: boolean;
  frontUserId: string | null;
  frontMemberRef: string | null;
  requestedMemberRef?: string | null;
  incomingAllowed: boolean;
  blocked: boolean;
  flightAvailable: boolean;
  existingStatus: string | null;
  requesterId: string;
}): ConnectionRequestDecision {
  if (!input.requesterIsMember) {
    return { ok: false, status: 403, error: "A paid Bluebird membership is required for networking.", code: "MEMBERSHIP_REQUIRED" };
  }
  if (!input.flightAvailable) {
    return { ok: false, status: 409, error: "This flight is no longer available", code: "FLIGHT_UNAVAILABLE" };
  }
  if (!input.frontUserId || !input.frontMemberRef || input.frontUserId === input.requesterId) {
    return { ok: false, status: 409, error: "There is no eligible front member for this flight", code: "NO_ELIGIBLE_FRONT_MEMBER" };
  }
  if (input.requestedMemberRef && input.requestedMemberRef !== input.frontMemberRef) {
    return { ok: false, status: 409, error: "Connection requests can only be sent to the first member in this queue", code: "NOT_FRONT_MEMBER" };
  }
  if (!input.incomingAllowed) {
    return { ok: false, status: 403, error: "This member is not accepting connection requests", code: "INCOMING_REQUESTS_DISABLED" };
  }
  if (input.blocked) {
    return { ok: false, status: 403, error: "This member is unavailable for networking", code: "MEMBER_UNAVAILABLE" };
  }
  if (input.existingStatus === "pending" || input.existingStatus === "accepted") {
    return { ok: false, status: 409, error: "You already sent a request for this flight", code: "DUPLICATE_REQUEST" };
  }
  return { ok: true };
}

export function reviewConnectionDecision(input: {
  isRecipient: boolean;
  currentStatus: string;
  action: "accept" | "decline";
}): { ok: true; status: "accepted" | "declined" } | { ok: false; status: 403 | 409; error: string; code: string } {
  if (!input.isRecipient) {
    return { ok: false, status: 403, error: "Only the recipient can respond to this request", code: "UNAUTHORIZED_REQUEST" };
  }
  if (input.currentStatus !== "pending") {
    return { ok: false, status: 409, error: "This request has already been decided", code: "REQUEST_ALREADY_DECIDED" };
  }
  return { ok: true, status: input.action === "accept" ? "accepted" : "declined" };
}

export function canSendConnectionMessage(input: {
  participant: boolean;
  blocked: boolean;
}): boolean {
  return input.participant && !input.blocked;
}

export function requesterReviewProfile(input: {
  firstName: string;
  lastName: string;
  industry: string;
  bio: string;
  photoUrl: string | null;
}): {
  firstName: string;
  lastInitial: string;
  industry: string;
  bio: string;
  photoUrl: string | null;
} {
  const lastName = input.lastName.trim();
  return {
    firstName: input.firstName,
    lastInitial: lastName ? lastName[0].toUpperCase() : "",
    industry: input.industry,
    bio: input.bio,
    photoUrl: input.photoUrl,
  };
}
