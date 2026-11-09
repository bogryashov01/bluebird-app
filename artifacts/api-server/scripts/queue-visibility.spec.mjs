import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canSendConnectionMessage,
  evaluateConnectionRequest,
  presentQueueRoster,
  requesterReviewProfile,
  reviewConnectionDecision,
} from "./.queue-visibility.test.mjs";

const front = {
  requesterId: "member-a",
  requesterIsMember: true,
  frontUserId: "member-b",
  frontMemberRef: "b".repeat(32),
  incomingAllowed: true,
  blocked: false,
  flightAvailable: true,
  existingStatus: null,
};

test("the waiting queue is ordered and keeps only initials, position, and member ref", () => {
  const roster = presentQueueRoster([
    { name: "Nora Jones", position: 2, memberRef: "n".repeat(32), userId: "user-n", phone: "+15550001111", email: "nora@example.test" },
    { name: "Ada Lovelace", position: 1, memberRef: "a".repeat(32), userId: "user-a", phone: "+15550002222", email: "ada@example.test" },
    { name: "Grace Hopper", position: 3, memberRef: "g".repeat(32), userId: "user-g" },
  ]);
  assert.deepEqual(roster, [
    { initials: "AL", position: 1, memberRef: "a".repeat(32) },
    { initials: "NJ", position: 2, memberRef: "n".repeat(32) },
    { initials: "GH", position: 3, memberRef: "g".repeat(32) },
  ]);
  assert.equal(JSON.stringify(roster).includes("user-"), false);
  assert.equal(JSON.stringify(roster).includes("+1555"), false);
  assert.equal(JSON.stringify(roster).includes("@"), false);
  assert.equal(JSON.stringify(roster).includes("Lovelace"), false);
});

test("position one can be requested and is not treated as a confirmed winner", () => {
  const decision = evaluateConnectionRequest(front);
  assert.equal(decision.ok, true);
  assert.equal("winner" in decision, false);
});

test("self requests, later positions, duplicates, and closed flights are rejected", () => {
  assert.equal(evaluateConnectionRequest({ ...front, frontUserId: "member-a" }).code, "NO_ELIGIBLE_FRONT_MEMBER");
  assert.equal(evaluateConnectionRequest({ ...front, requestedMemberRef: "c".repeat(32) }).code, "NOT_FRONT_MEMBER");
  assert.equal(evaluateConnectionRequest({ ...front, existingStatus: "pending" }).code, "DUPLICATE_REQUEST");
  assert.equal(evaluateConnectionRequest({ ...front, existingStatus: "accepted" }).code, "DUPLICATE_REQUEST");
  assert.equal(evaluateConnectionRequest({ ...front, flightAvailable: false }).code, "FLIGHT_UNAVAILABLE");
  assert.equal(evaluateConnectionRequest({ ...front, requesterIsMember: false }).code, "MEMBERSHIP_REQUIRED");
  assert.equal(evaluateConnectionRequest({ ...front, blocked: true }).code, "MEMBER_UNAVAILABLE");
});

test("a disabled incoming-request preference is enforced before a request is created", () => {
  const decision = evaluateConnectionRequest({ ...front, incomingAllowed: false });
  assert.deepEqual(decision, {
    ok: false,
    status: 403,
    error: "This member is not accepting connection requests",
    code: "INCOMING_REQUESTS_DISABLED",
  });
});

test("only the recipient can accept or decline a pending request", () => {
  assert.deepEqual(reviewConnectionDecision({ isRecipient: true, currentStatus: "pending", action: "accept" }), {
    ok: true,
    status: "accepted",
  });
  assert.deepEqual(reviewConnectionDecision({ isRecipient: true, currentStatus: "pending", action: "decline" }), {
    ok: true,
    status: "declined",
  });
  assert.equal(reviewConnectionDecision({ isRecipient: false, currentStatus: "pending", action: "accept" }).code, "UNAUTHORIZED_REQUEST");
  assert.equal(reviewConnectionDecision({ isRecipient: true, currentStatus: "accepted", action: "decline" }).code, "REQUEST_ALREADY_DECIDED");
});

test("messaging requires an accepted connection and stays closed before acceptance", () => {
  assert.equal(canSendConnectionMessage({ participant: false, blocked: false }), false);
  assert.equal(canSendConnectionMessage({ participant: true, blocked: true }), false);
  assert.equal(canSendConnectionMessage({ participant: true, blocked: false }), true);
});

test("a request review shows a profile without a phone number, email, or full last name", () => {
  const profile = requesterReviewProfile({
    firstName: "Rae",
    lastName: "Requester",
    industry: "Technology",
    bio: "Builds useful products.",
    photoUrl: "https://example.com/rae.jpg",
  });
  assert.deepEqual(profile, {
    firstName: "Rae",
    lastInitial: "R",
    industry: "Technology",
    bio: "Builds useful products.",
    photoUrl: "https://example.com/rae.jpg",
  });
  assert.equal(JSON.stringify(profile).includes("Requester"), false);
  assert.equal("phone" in profile, false);
  assert.equal("email" in profile, false);
});
