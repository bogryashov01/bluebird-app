import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";

process.env.EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT = "production";
process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL = "https://bluebirdjets.com/api";
process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY = "pk_live_Y2xlcmsuZXhhbXBsZS5jb20k";

import {
  ProductionAuthHttpError,
  ProductionAuthNetworkError,
  ProductionAuthRequestError,
  ProductionAuthSchemaError,
  applyPassengerMutationRefresh,
  canCreateProductionPassenger,
  canDeleteProductionPassenger,
  canUpdateProductionPassenger,
  createAuthenticatedProductionApiClient,
  emptyPassengerForm,
  submitPassengerCreate,
  submitPassengerDelete,
  submitPassengerUpdate,
} from "../scripts/.passenger-mutations.test.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const today = "2026-10-29";

function form(overrides = {}) {
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

function row(overrides = {}) {
  return {
    id: 9,
    emptyLegId: 42,
    fullName: "Alex Morgan",
    firstName: "Alex",
    lastName: "Morgan",
    weight: 175,
    isAccountHolder: false,
    gender: "female",
    dob: "1990-05-12",
    createdAt: "2026-10-29T12:00:00.000Z",
    ...overrides,
  };
}

function roster(passengers = [row()]) {
  return { passengers, passengerCap: 8, pets: [] };
}

function openCreate(overrides = {}) {
  const calls = [];
  const input = {
    gateOpen: true,
    flightId: 42,
    values: form(),
    signedIn: true,
    editsLocked: false,
    passengerCount: 1,
    guestCount: 0,
    passengerCap: 8,
    inFlight: { current: false },
    today,
    createClient: () => ({
      addEmptyLegPassenger: async (id, body) => {
        calls.push(["create", id, body]);
        return roster([row({ id: 9 })]);
      },
    }),
    ...overrides,
  };
  return { input, calls };
}

test("a valid passenger is created only when the returned roster contains that person", async () => {
  const { input, calls } = openCreate();
  const result = await submitPassengerCreate(input);
  assert.equal(result.status, "saved");
  assert.equal(result.list.passengers[0].id, 9);
  assert.deepEqual(calls, [[
    "create",
    42,
    { firstName: "Alex", lastName: "Morgan", weight: 175, gender: "female", dob: "1990-05-12" },
  ]]);
});

test("invalid passenger data and a full aircraft send nothing", async () => {
  const invalid = openCreate({ values: form({ firstName: "", weightLbs: "175.5", dob: "04/05/1988", gender: null }) });
  const rejected = await submitPassengerCreate(invalid.input);
  assert.equal(rejected.status, "invalid");
  assert.ok(rejected.errors.firstName);
  assert.ok(rejected.errors.weightLbs);
  assert.ok(rejected.errors.dob);
  assert.ok(rejected.errors.gender);
  assert.equal(invalid.calls.length, 0);

  const full = openCreate({ passengerCount: 6, guestCount: 5, passengerCap: 8 });
  const capacity = await submitPassengerCreate(full.input);
  assert.equal(capacity.status, "failed");
  assert.match(capacity.failure.body, /five additional passengers/);
  assert.match(capacity.failure.body, /No request was sent/);
  assert.equal(full.calls.length, 0);

  const aircraft = openCreate({ passengerCount: 4, guestCount: 3, passengerCap: 4 });
  const small = await submitPassengerCreate(aircraft.input);
  assert.match(small.failure.body, /4 passengers total/);
  assert.equal(aircraft.calls.length, 0);
});

test("an update succeeds only when the same passenger id returns the submitted fields", async () => {
  const calls = [];
  const input = {
    gateOpen: true,
    flightId: 42,
    passengerId: 9,
    values: form({ lastName: "Reed", weightLbs: "180" }),
    signedIn: true,
    editsLocked: false,
    passengerPresent: true,
    inFlight: { current: false },
    today,
    createClient: () => ({
      updateEmptyLegPassenger: async (flightId, passengerId, body) => {
        calls.push([flightId, passengerId, body]);
        return roster([row({ lastName: "Reed", fullName: "Alex Reed", weight: 180 })]);
      },
    }),
  };
  const result = await submitPassengerUpdate(input);
  assert.equal(result.status, "saved");
  assert.deepEqual(calls, [[42, 9, { firstName: "Alex", lastName: "Reed", weight: 180, gender: "female", dob: "1990-05-12" }]]);

  const stale = { ...input, passengerPresent: false, createClient: () => { throw new Error("client"); } };
  const missing = await submitPassengerUpdate(stale);
  assert.equal(missing.failure.title, "Unavailable");

  const unchanged = {
    ...input,
    createClient: () => ({
      updateEmptyLegPassenger: async () => roster([row()]),
    }),
  };
  const unconfirmed = await submitPassengerUpdate(unchanged);
  assert.equal(unconfirmed.status, "failed");
  assert.match(unconfirmed.failure.body, /did not confirm/);
});

test("deletion requires confirmation, protects the account holder, and requires the id to be gone", async () => {
  const calls = [];
  const base = {
    gateOpen: true,
    flightId: 42,
    passengerId: 9,
    isAccountHolder: false,
    explicitConfirm: true,
    signedIn: true,
    editsLocked: false,
    passengerPresent: true,
    inFlight: { current: false },
    createClient: () => ({
      removeEmptyLegPassenger: async (flightId, passengerId) => {
        calls.push([flightId, passengerId]);
        return roster([row({ id: 1, firstName: "Lead", isAccountHolder: true })]);
      },
    }),
  };
  assert.equal((await submitPassengerDelete({ ...base, explicitConfirm: false })).status, "needs-confirmation");
  assert.equal(calls.length, 0);
  const protectedLead = await submitPassengerDelete({ ...base, isAccountHolder: true, explicitConfirm: true });
  assert.match(protectedLead.failure.body, /cannot be removed/);
  assert.equal(calls.length, 0);
  const removed = await submitPassengerDelete(base);
  assert.equal(removed.status, "removed");
  assert.deepEqual(calls, [[42, 9]]);
  const stillThere = await submitPassengerDelete({
    ...base,
    createClient: () => ({
      removeEmptyLegPassenger: async () => roster([row({ id: 9 })]),
    }),
  });
  assert.match(stillThere.failure.body, /did not confirm/);
  const alreadyGone = await submitPassengerDelete({
    ...base,
    passengerPresent: false,
    createClient: () => { throw new Error("client"); },
  });
  assert.equal(alreadyGone.failure.title, "Unavailable");
});

test("a closed gate, a missing id, sign-out, and a locked manifest do not create a client", async () => {
  const closed = openCreate({ gateOpen: canCreateProductionPassenger() });
  assert.equal((await submitPassengerCreate(closed.input)).status, "disabled");
  assert.equal(closed.calls.length, 0);
  const updateClosed = await submitPassengerUpdate({
    gateOpen: canUpdateProductionPassenger(),
    flightId: 42,
    passengerId: 9,
    values: form(),
    signedIn: true,
    editsLocked: false,
    passengerPresent: true,
    inFlight: { current: false },
    today,
    createClient: () => { throw new Error("client"); },
  });
  assert.equal(updateClosed.status, "disabled");
  const deleteClosed = await submitPassengerDelete({
    gateOpen: canDeleteProductionPassenger(),
    flightId: 42,
    passengerId: 9,
    isAccountHolder: false,
    explicitConfirm: true,
    signedIn: true,
    editsLocked: false,
    passengerPresent: true,
    inFlight: { current: false },
    createClient: () => { throw new Error("client"); },
  });
  assert.equal(deleteClosed.status, "disabled");

  for (const flightId of [0, null]) {
    const created = openCreate({ flightId });
    assert.equal((await submitPassengerCreate(created.input)).status, "failed");
    assert.equal(created.calls.length, 0);
  }
  const signedOut = openCreate({ signedIn: false });
  assert.equal((await submitPassengerCreate(signedOut.input)).failure.title, "Sign in required");
  const locked = openCreate({ editsLocked: true });
  assert.match((await submitPassengerCreate(locked.input)).failure.body, /locked/);
  assert.equal(locked.calls.length, 0);
});

test("HTTP 401, 403, 409, schema mismatch, network failure, and a wrong flight stay unconfirmed", async () => {
  async function fail(error) {
    const { input } = openCreate({
      createClient: () => ({ addEmptyLegPassenger: async () => { throw error; } }),
    });
    return submitPassengerCreate(input);
  }
  assert.equal((await fail(new ProductionAuthHttpError(401, null))).failure.title, "Sign in required");
  assert.equal((await fail(new ProductionAuthHttpError(403, null))).failure.title, "Not available");
  assert.match((await fail(new ProductionAuthHttpError(409, null))).failure.body, /Nothing was changed/);
  assert.match((await fail(new ProductionAuthSchemaError("emptyLegPassengers"))).failure.body, /did not confirm/);
  assert.equal((await fail(new ProductionAuthNetworkError())).failure.title, "Connection problem");
  assert.equal((await fail(new ProductionAuthRequestError("Main API access token is unavailable.", "token"))).failure.title, "Sign in required");

  const wrongFlight = openCreate({
    createClient: () => ({
      addEmptyLegPassenger: async () => roster([row({ emptyLegId: 99 })]),
    }),
  });
  assert.match((await submitPassengerCreate(wrongFlight.input)).failure.body, /did not confirm/);
});

test("a second tap does not send a second passenger request", async () => {
  let release = () => {};
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const input = {
    ...openCreate().input,
    createClient: () => ({
      addEmptyLegPassenger: async (id, body) => {
        calls.push(id);
        await gate;
        return roster([row()]);
      },
    }),
  };
  const first = submitPassengerCreate(input);
  const second = await submitPassengerCreate(input);
  assert.equal(second.status, "duplicate");
  release();
  assert.equal((await first).status, "saved");
  assert.deepEqual(calls, [42]);
});

test("an account switch or sign-out does not refresh another member", () => {
  const seen = [];
  assert.equal(applyPassengerMutationRefresh({
    gateOpen: true,
    requestedUserId: "user-a",
    activeUserId: "user-b",
    signedIn: true,
    environment: "production",
    flightId: 42,
    invalidate: (key) => seen.push(key),
  }), false);
  assert.equal(applyPassengerMutationRefresh({
    gateOpen: true,
    requestedUserId: "user-a",
    activeUserId: null,
    signedIn: false,
    environment: "production",
    flightId: 42,
    invalidate: (key) => seen.push(key),
  }), false);
  assert.equal(seen.length, 0);
});

test("passenger gates stay closed and the screen does not bypass them or complete the checklist locally", () => {
  const hook = readFileSync(resolve(projectRoot, "lib/usePassengerActions.ts"), "utf8");
  const screen = readFileSync(resolve(projectRoot, "app/flight/passengers.tsx"), "utf8");
  const form = readFileSync(resolve(projectRoot, "components/PassengerForm.tsx"), "utf8");
  const library = readFileSync(resolve(projectRoot, "lib/passengerManifest.ts"), "utf8");
  const checklist = readFileSync(resolve(projectRoot, "app/flight/checklist.tsx"), "utf8");
  const policy = readFileSync(resolve(projectRoot, "lib/nativeAuthTestPolicy.ts"), "utf8");
  assert.match(hook, /gateOpen: canCreateProductionPassenger\(\)/);
  assert.match(hook, /gateOpen: canUpdateProductionPassenger\(\)/);
  assert.match(hook, /gateOpen: canDeleteProductionPassenger\(\)/);
  assert.match(hook, /explicitConfirm: true/);
  assert.match(hook, /sessionRef\.current\?\.userId !== requestedUserId/);
  assert.doesNotMatch(hook, /gateOpen:\s*true|manifestAckAt\s*=/);
  assert.match(library, /export function canCreateProductionPassenger\(\): boolean \{\n  return false;\n\}/);
  assert.match(library, /export function canUpdateProductionPassenger\(\): boolean \{\n  return false;\n\}/);
  assert.match(library, /export function canDeleteProductionPassenger\(\): boolean \{\n  return false;\n\}/);
  assert.match(library, /MAX_PARTY_SIZE = 6/);
  assert.match(library, /MAX_ADDITIONAL_PASSENGERS = 5/);
  for (const source of [screen, form, library]) {
    assert.doesNotMatch(source, /addEmptyLegPassenger|updateEmptyLegPassenger|removeEmptyLegPassenger|passport|Passenger added|passenger was saved/);
  }
  assert.doesNotMatch(checklist, /manifestAckAt\s*=/);
  assert.match(checklist, /pathname: '\/flight\/passengers'/);
  assert.doesNotMatch(policy, /\/passengers/);
});

test("the authenticated client uses the existing passenger paths and projected body", async () => {
  const requests = [];
  const passenger = {
    id: 9,
    emptyLegId: 42,
    fullName: "Alex Morgan",
    firstName: "Alex",
    lastName: "Morgan",
    weight: 175,
    isAccountHolder: false,
    gender: "female",
    dob: "1990-05-12",
    createdAt: "2026-10-29T12:00:00.000Z",
  };
  const list = { passengers: [passenger], passengerCap: 6, pets: [] };
  const client = createAuthenticatedProductionApiClient({
    environment: "production",
    baseUrl: "https://bluebirdjets.com/api",
    tokenProvider: {
      environment: "production",
      getVerifiedAccessToken: async () => "clerk-test-token",
    },
    fetcher: async (url, init) => {
      requests.push({
        url: String(url),
        method: init.method,
        body: init.body,
        authorization: init.headers?.Authorization,
        credentials: init.credentials,
      });
      const path = String(url);
      if (path.endsWith("/empty-legs/42/passengers") && init.method === "POST") {
        return { ok: true, status: 200, json: async () => list };
      }
      if (path.endsWith("/empty-legs/42/passengers/9") && init.method === "PATCH") {
        return { ok: true, status: 200, json: async () => list };
      }
      if (path.endsWith("/empty-legs/42/passengers/9") && init.method === "DELETE") {
        return { ok: true, status: 200, json: async () => ({ passengers: [], passengerCap: 6, pets: [] }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
  });
  const created = await submitPassengerCreate({
    ...openCreate().input,
    createClient: () => client,
  });
  assert.equal(created.status, "saved");
  const updated = await submitPassengerUpdate({
    gateOpen: true,
    flightId: 42,
    passengerId: 9,
    values: form(),
    signedIn: true,
    editsLocked: false,
    passengerPresent: true,
    inFlight: { current: false },
    today,
    createClient: () => client,
  });
  assert.equal(updated.status, "saved");
  const removed = await submitPassengerDelete({
    gateOpen: true,
    flightId: 42,
    passengerId: 9,
    isAccountHolder: false,
    explicitConfirm: true,
    signedIn: true,
    editsLocked: false,
    passengerPresent: true,
    inFlight: { current: false },
    createClient: () => client,
  });
  assert.equal(removed.status, "removed");
  assert.deepEqual(requests.map((request) => `${request.method} ${request.url.replace("https://bluebirdjets.com/api", "")}`), [
    "POST /empty-legs/42/passengers",
    "PATCH /empty-legs/42/passengers/9",
    "DELETE /empty-legs/42/passengers/9",
  ]);
  assert.equal(requests[0].authorization, "Bearer clerk-test-token");
  assert.equal(requests[0].credentials, "omit");
  assert.deepEqual(JSON.parse(requests[0].body), {
    firstName: "Alex",
    lastName: "Morgan",
    weight: 175,
    gender: "female",
    dob: "1990-05-12",
  });
  assert.equal(requests[2].body, undefined);
  const invalid = await submitPassengerCreate({
    ...openCreate().input,
    flightId: 43,
    createClient: () => client,
  });
  assert.equal(invalid.status, "failed");
  assert.match(invalid.failure.body, /did not confirm/);
});
