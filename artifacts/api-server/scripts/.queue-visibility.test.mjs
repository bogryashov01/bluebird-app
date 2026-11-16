// src/lib/queueVisibility.ts
function memberInitials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "M";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
function presentQueueRoster(rows) {
  return [...rows].filter((row) => Number.isInteger(row.position) && row.position >= 1 && row.memberRef.trim().length > 0).sort((a, b) => a.position - b.position || a.memberRef.localeCompare(b.memberRef)).map((row) => ({
    initials: memberInitials(row.name),
    position: row.position,
    memberRef: row.memberRef
  }));
}
function evaluateConnectionRequest(input) {
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
function reviewConnectionDecision(input) {
  if (!input.isRecipient) {
    return { ok: false, status: 403, error: "Only the recipient can respond to this request", code: "UNAUTHORIZED_REQUEST" };
  }
  if (input.currentStatus !== "pending") {
    return { ok: false, status: 409, error: "This request has already been decided", code: "REQUEST_ALREADY_DECIDED" };
  }
  return { ok: true, status: input.action === "accept" ? "accepted" : "declined" };
}
function canSendConnectionMessage(input) {
  return input.participant && !input.blocked;
}
function requesterReviewProfile(input) {
  const lastName = input.lastName.trim();
  return {
    firstName: input.firstName,
    lastInitial: lastName ? lastName[0].toUpperCase() : "",
    industry: input.industry,
    bio: input.bio,
    photoUrl: input.photoUrl
  };
}
export {
  canSendConnectionMessage,
  evaluateConnectionRequest,
  memberInitials,
  presentQueueRoster,
  requesterReviewProfile,
  reviewConnectionDecision
};
