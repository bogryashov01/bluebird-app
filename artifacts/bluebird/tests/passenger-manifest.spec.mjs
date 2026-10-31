import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";
import {
  PASSENGER_GENDER_NOTE,
  PASSENGER_SAVE_UNAVAILABLE,
  additionalPassengerLimit,
  additionalPassengerOffer,
  canCreateProductionPassenger,
  canDeleteProductionPassenger,
  canUpdateProductionPassenger,
  emptyPassengerForm,
  manifestEditsLocked,
  manifestMatchesFlight,
  passengerFormFromRecord,
  passengerPartyLimit,
  presentManifestLock,
  presentPassengerFailure,
  presentPassengerRoster,
  presentPetSummary,
  resolvePassengerManifestAccess,
  reviewCreateProductionPassenger,
  reviewDeleteProductionPassenger,
  reviewUpdateProductionPassenger,
  shouldApplyPassengerManifest,
  validatePassengerForm,
} from "../scripts/.passenger-manifest.test.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const today = "2026-10-29";

function person(overrides = {}) {
  return {
    id: 1,
    emptyLegId: 42,
    firstName: "Alex",
    lastName: "Morgan",
    weight: 175,
    isAccountHolder: false,
    gender: "female",
    dob: "1990-05-12",
    ...overrides,
  };
}

function validForm(overrides = {}) {
  return {
    ...emptyPassengerForm(),
    firstName: "Alex",
    lastName: "Morgan",
    weightLbs: "175",
    dob: "1990-05-12",
    gender: "female",
    ...overrides,
  };
}

test("the account holder stays first and cannot be deleted", () => {
  const roster = presentPassengerRoster([
    person({ id: 2, firstName: "Guest" }),
    person({ id: 1, firstName: "Lead", isAccountHolder: true }),
    person({ id: 3, firstName: "Second", isAccountHolder: true }),
  ]);
  assert.equal(roster.accountHolder.id, 1);
  assert.deepEqual(roster.guests.map((guest) => guest.id), [2]);
  assert.deepEqual(roster.protectedPassengers.map((row) => row.id), [3]);
  assert.equal(reviewDeleteProductionPassenger(42, 1, true, true).status, "invalid");
  assert.equal(presentPassengerRoster([]).accountHolder, null);
  const screen = readFileSync(resolve(projectRoot, "app/flight/passengers.tsx"), "utf8");
  assert.match(screen, /Passenger 1 — You/);
  assert.match(screen, /if \(passenger\.isAccountHolder \|\| locked \|\| !canDeleteProductionPassenger\(\)\) return/);
  assert.match(screen, /The account holder’s passenger record is not available/);
});

test("additional passengers stop at five and at a smaller aircraft capacity", () => {
  assert.equal(passengerPartyLimit(8), 6);
  assert.equal(passengerPartyLimit(4), 4);
  assert.equal(passengerPartyLimit(0), null);
  assert.equal(additionalPassengerLimit(8), 5);
  assert.equal(additionalPassengerLimit(4), 3);
  assert.equal(additionalPassengerLimit(1), 0);
  assert.equal(additionalPassengerOffer({
    passengerCount: 6,
    guestCount: 5,
    passengerCap: 8,
    manifestLocked: false,
  }).allowed, false);
  assert.match(additionalPassengerOffer({
    passengerCount: 6,
    guestCount: 5,
    passengerCap: 8,
    manifestLocked: false,
  }).reason, /five additional passengers/);
  const smallAircraft = additionalPassengerOffer({
    passengerCount: 4,
    guestCount: 3,
    passengerCap: 4,
    manifestLocked: false,
  });
  assert.equal(smallAircraft.allowed, false);
  assert.match(smallAircraft.reason, /4 passengers total/);
  assert.equal(additionalPassengerOffer({
    passengerCount: 3,
    guestCount: 2,
    passengerCap: 4,
    manifestLocked: false,
  }).allowed, true);
});

test("required passenger fields, pounds, dates, and gender are validated without a guess", () => {
  const missing = validatePassengerForm(emptyPassengerForm(), today);
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.firstName);
  assert.ok(missing.errors.lastName);
  assert.ok(missing.errors.weightLbs);
  assert.ok(missing.errors.dob);
  assert.ok(missing.errors.gender);
  assert.equal(emptyPassengerForm().gender, null);
  const valid = validatePassengerForm(validForm(), today);
  assert.equal(valid.ok, true);
  assert.equal(valid.body.weight, 175);
  assert.equal(valid.body.gender, "female");
  assert.equal(valid.body.dob, "1990-05-12");
  assert.equal(Object.hasOwn(valid.body, "middleName"), false);
  assert.equal(validatePassengerForm(validForm({ weightLbs: "1000" }), today).ok, true);
  assert.equal(validatePassengerForm(validForm({ weightLbs: "1001" }), today).ok, false);
  assert.equal(validatePassengerForm(validForm({ weightLbs: "0" }), today).ok, false);
  assert.equal(validatePassengerForm(validForm({ weightLbs: "175.5" }), today).ok, false);
  assert.equal(validatePassengerForm(validForm({ weightLbs: "70kg" }), today).ok, false);
  assert.equal(validatePassengerForm(validForm({ dob: "2026-10-30" }), today).ok, false);
  assert.equal(validatePassengerForm(validForm({ dob: "2026-02-31" }), today).ok, false);
  assert.equal(validatePassengerForm(validForm({ dob: "04/05/1988" }), today).ok, false);
  assert.equal(validatePassengerForm(validForm({ dob: "2026-10-29" }), today).ok, true);
  assert.equal(validatePassengerForm(validForm({ gender: null }), today).ok, false);
  const fromRecord = passengerFormFromRecord(person({ gender: null, weight: null }));
  assert.equal(fromRecord.gender, null);
  assert.equal(fromRecord.weightLbs, "");
  assert.match(PASSENGER_GENDER_NOTE, /product confirmation/);
});

test("a locked or unknown manifest disables edits, and passenger writes stay disabled", () => {
  assert.equal(manifestEditsLocked(true), true);
  assert.equal(manifestEditsLocked(undefined), true);
  assert.equal(manifestEditsLocked(null), true);
  assert.equal(manifestEditsLocked(false), false);
  assert.equal(additionalPassengerOffer({
    passengerCount: 1,
    guestCount: 0,
    passengerCap: 8,
    manifestLocked: null,
  }).allowed, false);
  assert.equal(canCreateProductionPassenger(), false);
  assert.equal(canUpdateProductionPassenger(), false);
  assert.equal(canDeleteProductionPassenger(), false);
  const created = reviewCreateProductionPassenger(42, validForm(), today);
  const updated = reviewUpdateProductionPassenger(42, 7, validForm(), today);
  const removed = reviewDeleteProductionPassenger(42, 7, false, true);
  assert.equal(created.status, "disabled");
  assert.equal(created.method, "POST");
  assert.equal(created.path, "/empty-legs/42/passengers");
  assert.equal(created.body.firstName, "Alex");
  assert.equal(updated.status, "disabled");
  assert.equal(updated.method, "PATCH");
  assert.equal(updated.path, "/empty-legs/42/passengers/7");
  assert.equal(removed.status, "disabled");
  assert.equal(removed.method, "DELETE");
  assert.equal(removed.body, null);
  assert.equal(reviewDeleteProductionPassenger(42, 7, false, false).status, "needs-confirmation");
  assert.match(PASSENGER_SAVE_UNAVAILABLE, /unavailable in this build/);
});

test("passenger screens do not send mutations or invent a saved passenger", () => {
  const screen = readFileSync(resolve(projectRoot, "app/flight/passengers.tsx"), "utf8");
  const form = readFileSync(resolve(projectRoot, "components/PassengerForm.tsx"), "utf8");
  const library = readFileSync(resolve(projectRoot, "lib/passengerManifest.ts"), "utf8");
  for (const source of [screen, form, library]) {
    assert.doesNotMatch(source, /addEmptyLegPassenger|updateEmptyLegPassenger|removeEmptyLegPassenger|(?<![\w.])fetch\(|AsyncStorage|console\.log|passport|Passenger added|passenger was saved/);
  }
  assert.match(screen, /getEmptyLegPassengers\(requestedLegId, \{ signal \}\)/);
  assert.match(screen, /if \(decision\.status !== 'ready'\) return/);
  assert.match(screen, /if \(decision\.status === 'invalid'\)/);
  assert.match(screen, /Alert\.alert/);
  assert.match(screen, /disabled=\{!canDeleteProductionPassenger\(\) \|\| locked\}/);
  assert.match(screen, /retry: false/);
  assert.match(screen, /refetchInterval: false/);
  assert.match(screen, /refetchOnWindowFocus: false/);
  assert.match(screen, /refetchOnReconnect: false/);
  assert.match(screen, /refetchOnMount: false/);
  assert.doesNotMatch(form, /passport/);
});

test("manifest reads stay on the explicit passenger screen and acknowledgement stays server-owned", () => {
  const details = readFileSync(resolve(projectRoot, "app/flight/[id].tsx"), "utf8");
  const notice = readFileSync(resolve(projectRoot, "components/WinnerFlightNotice.tsx"), "utf8");
  const checklist = readFileSync(resolve(projectRoot, "app/flight/checklist.tsx"), "utf8");
  assert.doesNotMatch(details, /getEmptyLegPassengers|flight\/passengers/);
  assert.doesNotMatch(notice, /getEmptyLegPassengers|flight\/passengers/);
  assert.doesNotMatch(checklist, /getEmptyLegPassengers/);
  assert.match(checklist, /pathname: '\/flight\/passengers'/);
  assert.match(checklist, /disabled=\{!canAcknowledgeProductionManifest\(\)\}/);
  const winner = readFileSync(resolve(projectRoot, "lib/winnerChecklist.ts"), "utf8");
  assert.match(winner, /complete: hasTimestamp\(checklist\.manifestAckAt\)/);
  assert.match(winner, /export function canAcknowledgeProductionManifest\(\): boolean \{\n  return false;\n\}/);
  assert.match(winner, /reviewPost\(legId, `\/trips\/\$\{legId\}\/checklist\/manifestAck`, canAcknowledgeProductionManifest\(\)\)/);
});

test("passenger manifests stay on the signed-in account and failures hide server payloads", () => {
  assert.equal(shouldApplyPassengerManifest({
    requestedUserId: "user-a",
    activeUserId: "user-a",
    signedIn: true,
  }), true);
  assert.equal(shouldApplyPassengerManifest({
    requestedUserId: "user-a",
    activeUserId: "user-b",
    signedIn: true,
  }), false);
  assert.equal(manifestMatchesFlight([{ emptyLegId: 42 }, { emptyLegId: 42 }], 42), true);
  assert.equal(manifestMatchesFlight([{ emptyLegId: 7 }], 42), false);
  const failure = presentPassengerFailure(409);
  assert.match(failure.body, /Nothing was changed/);
  assert.doesNotMatch(`${failure.title} ${failure.body}`, /Alex|Morgan|1990|token/);
  assert.equal(presentPassengerFailure(400).title, "Check passenger details");
  assert.equal(presentPassengerFailure(401).title, "Sign in required");
  assert.equal(presentPassengerFailure(403).title, "Not available");
  assert.equal(presentPassengerFailure(404).title, "Unavailable");
  assert.equal(presentPetSummary(2), "This flight includes 2 pet records. Pet changes are not available here.");
  assert.equal(presentPetSummary(0), null);
  const auth = readFileSync(resolve(projectRoot, "context/AuthContext.tsx"), "utf8");
  assert.match(auth, /queryClient\.clear\(\)/);
  const screen = readFileSync(resolve(projectRoot, "app/flight/passengers.tsx"), "utf8");
  assert.match(screen, /'empty-leg-passengers', legId/);
  assert.match(screen, /removeQueries/);
  assert.match(screen, /'trip', legId/);
});

test("passenger information loads a missing trip and does not treat an unknown manifest as locked or unlocked", () => {
  const account = {
    legId: 42,
    signedIn: true,
    activeUserId: "user-a",
    accountUserId: "user-a",
  };
  const trip = (manifestLocked) => ({
    leg: { id: 42 },
    checklist: { emptyLegId: 42, ...(manifestLocked === undefined ? {} : { manifestLocked }) },
  });
  assert.equal(resolvePassengerManifestAccess({
    ...account,
    phase: "pending",
    trip: null,
  }), "loading");
  assert.equal(resolvePassengerManifestAccess({
    ...account,
    phase: "error",
    trip: null,
  }), "error");
  assert.equal(resolvePassengerManifestAccess({
    ...account,
    phase: "success",
    trip: trip(true),
  }), "locked");
  assert.equal(resolvePassengerManifestAccess({
    ...account,
    phase: "success",
    trip: trip(false),
  }), "unlocked");
  assert.equal(presentManifestLock(undefined), "unknown");
  assert.equal(resolvePassengerManifestAccess({
    ...account,
    phase: "success",
    trip: trip(undefined),
  }), "unknown");
  assert.equal(resolvePassengerManifestAccess({
    ...account,
    signedIn: false,
    activeUserId: null,
    phase: "pending",
    trip: trip(false),
  }), "error");
  assert.equal(resolvePassengerManifestAccess({
    ...account,
    activeUserId: "user-b",
    phase: "pending",
    trip: trip(false),
  }), "error");
  assert.equal(resolvePassengerManifestAccess({
    ...account,
    legId: 99,
    phase: "success",
    trip: trip(false),
  }), "error");
  assert.equal(manifestEditsLocked(undefined), true);
  assert.equal(manifestEditsLocked(false), false);
  const screen = readFileSync(resolve(projectRoot, "app/flight/passengers.tsx"), "utf8");
  const checklist = readFileSync(resolve(projectRoot, "app/flight/checklist.tsx"), "utf8");
  assert.match(screen, /getTrip\(requestedLegId, \{ signal \}\)/);
  assert.match(screen, /resolvePassengerManifestAccess/);
  assert.match(screen, /passengers-loading/);
  assert.match(screen, /passengers-locked/);
  assert.match(screen, /passengers-manifest-unknown/);
  assert.match(screen, /shouldApplyTripChecklist/);
  assert.match(screen, /tripQuery\.refetch\(\)/);
  assert.doesNotMatch(screen, /getQueryData/);
  assert.doesNotMatch(checklist, /getEmptyLegPassengers/);
  assert.doesNotMatch(screen, /manifestLocked === undefined \? false|manifestLocked !== true/);
});
