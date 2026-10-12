import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAuthenticatedProductionApiClient,
  productionAuthenticatedQueryKey,
  ProductionAuthCancelledError,
  ProductionAuthHttpError,
  ProductionAuthInvalidJsonError,
  ProductionAuthNetworkError,
  ProductionAuthSchemaError,
  ProductionAuthTimeoutError,
} from "../scripts/.production-auth-api.test.mjs";

const secretToken = "mock-only-token-never-log";

const user = {
  id: "member-7",
  name: "Preview Member",
  phone: "+15555550123",
  email: "member@example.test",
  photoAssetPath: null,
  photoUrl: null,
  weightKg: 70,
  membershipTier: "plus",
  linePassCount: 2,
  referralCode: "MEMBER7",
  homeAirports: ["APF"],
  notificationChannel: "app",
  createdAt: "2026-01-02T03:04:05.000Z",
};

const membership = {
  tier: "plus",
  plans: [{ id: "plus", label: "Plus" }],
  linePassCount: 2,
  renewalDate: "2027-01-02",
  features: ["Member queue access"],
  totalSavedUsd: 1000,
  lifetimeCompletedFlights: 1,
  annualFlightAllowance: 10,
  flightsThisYear: 1,
};

const trip = {
  id: "trip-7",
  flightId: "flight-22",
  status: "upcoming",
  bookedAt: "2026-06-01T12:00:00.000Z",
  cleaningFeeUsd: 0,
  flight: { id: "flight-22", fromAirport: "APF", toAirport: "MIA" },
};

const manifest = {
  tripId: "trip-7",
  requiredCount: 1,
  completedCount: 0,
  isComplete: false,
  international: false,
  bringingPet: false,
  pet: null,
  passengers: [{ passengerOrder: 1, firstName: "Preview", lastName: "Member" }],
  version: 1,
  submittedAt: null,
  deliveryStatus: null,
  operationsNotified: false,
};

const savedPassenger = {
  id: "passenger-7",
  firstName: "Casey",
  lastName: "Traveler",
  phone: null,
  email: null,
  weightKg: 64,
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-01T00:00:00.000Z",
};

const queueEntry = {
  id: "queue-7",
  flightId: "flight-22",
  flight: { id: "flight-22", fromAirport: "APF", toAirport: "MIA" },
  position: 1,
  totalInQueue: 1,
  status: "waiting",
  createdAt: "2026-07-01T00:00:00.000Z",
  bringingPet: false,
  queueMembers: [{ initials: "PM", position: 1 }],
};

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function makeClient(fetcher, overrides = {}) {
  return createAuthenticatedProductionApiClient({
    tokenProvider: { getVerifiedAccessToken: async () => secretToken },
    fetcher,
    ...overrides,
  });
}

test("client construction does not acquire a token or issue a request", async () => {
  let tokenReads = 0;
  let requests = 0;
  const client = createAuthenticatedProductionApiClient({
    tokenProvider: {
      getVerifiedAccessToken: async () => {
        tokenReads += 1;
        return secretToken;
      },
    },
    fetcher: async () => {
      requests += 1;
      return jsonResponse(user);
    },
  });

  assert.equal(tokenReads, 0);
  assert.equal(requests, 0);
  assert.deepEqual(await client.getMe(), user);
  assert.equal(tokenReads, 1);
  assert.equal(requests, 1);
});

test("the request layer follows the checked-in auth path and reuses production URL safety", async () => {
  let request;
  const client = makeClient(async (url, init) => {
    request = { url, init };
    return jsonResponse(user);
  });

  assert.deepEqual(await client.getMe(), user);
  assert.equal(request.url, "https://bluebirdjets.com/api/auth/me");
  assert.equal(request.init.method, "GET");
  assert.equal(request.init.headers.Authorization, `Bearer ${secretToken}`);
  assert.equal(request.init.headers.Accept, "application/json");
  assert.equal(request.init.credentials, "omit");
  assert.equal(request.init.headers.Cookie, undefined);

  for (const baseUrl of [
    "http://bluebirdjets.com/api",
    "https://untrusted.example/api",
    "https://bluebirdjets.com/other",
    "https://bluebirdjets.com/api?debug=1",
    "https://user:password@bluebirdjets.com/api",
  ]) {
    assert.throws(
      () => createAuthenticatedProductionApiClient({
        tokenProvider: { getVerifiedAccessToken: async () => secretToken },
        baseUrl,
        fetcher: async () => jsonResponse(user),
      }),
      /production flight API/i,
    );
  }
});

test("all typed methods use only documented contract routes and verbs", async () => {
  const requests = [];
  const client = makeClient(async (url, init) => {
    requests.push({ path: new URL(url).pathname.replace("/api", ""), method: init.method, body: init.body });
    if (init.method === "GET" && url.endsWith("/auth/me")) return jsonResponse(user);
    if (init.method === "PATCH") return jsonResponse(user);
    if (url.endsWith("/membership")) return jsonResponse(membership);
    if (url.endsWith("/trips")) return jsonResponse([trip]);
    if (url.endsWith("/trips/trip-7/cancel")) {
      return jsonResponse({ success: true, passRefunded: false, linePassCount: 2, trip });
    }
    if (url.endsWith("/manifest/submit") || url.endsWith("/manifest")) return jsonResponse(manifest);
    if (url.endsWith("/passengers") && init.method === "GET") return jsonResponse([savedPassenger]);
    if (url.endsWith("/passengers") && init.method === "POST") return jsonResponse(savedPassenger, 201);
    if (url.endsWith("/passengers/passenger-7") && init.method === "PUT") return jsonResponse(savedPassenger);
    if (url.endsWith("/passengers/passenger-7") && init.method === "DELETE") return jsonResponse({ success: true });
    if (url.endsWith("/queue/status")) return jsonResponse([queueEntry]);
    if (url.endsWith("/queue/join")) return jsonResponse(queueEntry, 201);
    if (url.endsWith("/queue/queue-7/use-pass")) return jsonResponse({ ...queueEntry, status: "confirmed", linePassCount: 1 });
    if (url.endsWith("/queue/queue-7")) return jsonResponse({ success: true });
    throw new Error("Unexpected mocked route");
  });

  await client.getMe();
  await client.updateMe({ name: "Updated Member" });
  const status = await client.getMembership();
  assert.equal(status.tier, "plus");
  assert.equal(status.plans[0].id, "plus");
  const trips = await client.listTrips();
  assert.equal(trips[0].id, "trip-7");
  assert.equal(trips[0].flightId, "flight-22");
  assert.equal((await client.cancelTrip("trip-7")).success, true);
  await client.getTripManifest("trip-7");
  await client.saveTripManifest("trip-7", { passengers: manifest.passengers });
  await client.submitTripManifest("trip-7");
  await client.listSavedPassengers();
  await client.createSavedPassenger({ firstName: "Casey", lastName: "Traveler", weightKg: 64 });
  await client.updateSavedPassenger("passenger-7", { firstName: "Casey", lastName: "Traveler", weightKg: 64 });
  await client.deleteSavedPassenger("passenger-7");
  await client.getQueueStatus();
  await client.joinQueue({ flightId: "flight-22", bringingPet: false });
  await client.leaveQueue("queue-7");
  const passResult = await client.useLinePass("queue-7");
  assert.equal(passResult.status, "confirmed");

  assert.deepEqual(requests.map(({ method, path }) => `${method} ${path}`), [
    "GET /auth/me",
    "PATCH /auth/me",
    "GET /membership",
    "GET /trips",
    "POST /trips/trip-7/cancel",
    "GET /trips/trip-7/manifest",
    "PUT /trips/trip-7/manifest",
    "POST /trips/trip-7/manifest/submit",
    "GET /passengers",
    "POST /passengers",
    "PUT /passengers/passenger-7",
    "DELETE /passengers/passenger-7",
    "GET /queue/status",
    "POST /queue/join",
    "DELETE /queue/queue-7",
    "POST /queue/queue-7/use-pass",
  ]);
  assert.equal(requests.some(({ path }) => /phone|winner|confirm|decline/i.test(path)), false);
});

test("contract arrays may be empty and trip IDs remain distinct from flight IDs", async () => {
  const client = makeClient(async () => jsonResponse([]));
  assert.deepEqual(await client.listTrips(), []);
  assert.deepEqual(await client.listSavedPassengers(), []);
  assert.deepEqual(await client.getQueueStatus(), []);

  const tripClient = makeClient(async () => jsonResponse([trip]));
  const [result] = await tripClient.listTrips();
  assert.equal(result.id, "trip-7");
  assert.equal(result.flightId, "flight-22");
  assert.notEqual(result.id, result.flightId);
});

test("unauthorized and expired sessions produce a structured 401 error", async () => {
  const client = makeClient(async () => jsonResponse({ error: "Invalid or expired token" }, 401));
  await assert.rejects(
    client.getMe(),
    (error) => error instanceof ProductionAuthHttpError &&
      error.status === 401 &&
      error.code === "session_expired",
  );
});

test("missing or failed token acquisition never sends a request", async () => {
  let requests = 0;
  const fetcher = async () => {
    requests += 1;
    return jsonResponse(user);
  };
  const missing = createAuthenticatedProductionApiClient({
    tokenProvider: { getVerifiedAccessToken: async () => null },
    fetcher,
  });
  await assert.rejects(missing.getMe(), (error) => error.code === "token");

  const failed = createAuthenticatedProductionApiClient({
    tokenProvider: { getVerifiedAccessToken: async () => { throw new Error(secretToken); } },
    fetcher,
  });
  await assert.rejects(failed.getMe(), (error) => error.code === "token");
  assert.equal(requests, 0);
});

test("network, timeout and caller cancellation are distinct sanitized errors", async () => {
  const networkClient = makeClient(async () => { throw new Error(`failed ${secretToken}`); });
  await assert.rejects(networkClient.getMe(), (error) => error instanceof ProductionAuthNetworkError);

  const timeoutClient = makeClient(
    async () => new Promise(() => {}),
    { timeoutMs: 5 },
  );
  await assert.rejects(timeoutClient.getMe(), (error) => error instanceof ProductionAuthTimeoutError);

  const controller = new AbortController();
  let wasAborted = false;
  let startedFetch;
  const fetchStarted = new Promise((resolve) => { startedFetch = resolve; });
  const cancelClient = makeClient((url, init) => new Promise((_, reject) => {
    startedFetch();
    init.signal.addEventListener("abort", () => {
      wasAborted = true;
      reject(new Error("aborted"));
    }, { once: true });
  }));
  const cancelled = cancelClient.getMe({ signal: controller.signal });
  await fetchStarted;
  controller.abort();
  await assert.rejects(cancelled, (error) => error instanceof ProductionAuthCancelledError);
  assert.equal(wasAborted, true);
  await assert.rejects(cancelClient.getMe({ signal: AbortSignal.abort() }), ProductionAuthCancelledError);
});

test("invalid JSON and contract-shape responses are rejected with structured errors", async () => {
  const invalidJsonClient = makeClient(async () => ({
    ok: true,
    status: 200,
    json: async () => { throw new SyntaxError("invalid json"); },
  }));
  await assert.rejects(invalidJsonClient.getMe(), ProductionAuthInvalidJsonError);

  const malformedClient = makeClient(async () => jsonResponse({
    ...user,
    membershipTier: "imaginary",
  }));
  await assert.rejects(
    malformedClient.getMe(),
    (error) => error instanceof ProductionAuthSchemaError && error.code === "invalid_schema",
  );

  const malformedListClient = makeClient(async () => jsonResponse([{
    ...trip,
    status: "waiting",
  }]));
  await assert.rejects(malformedListClient.listTrips(), ProductionAuthSchemaError);
});

test("errors and console output never disclose the token", async () => {
  const logged = [];
  const methods = ["debug", "info", "log", "warn", "error"];
  const original = Object.fromEntries(methods.map((method) => [method, console[method]]));
  for (const method of methods) console[method] = (...args) => logged.push(args.join(" "));
  let error;
  try {
    const client = makeClient(async () => { throw new Error(`network rejected ${secretToken}`); });
    try {
      await client.getMe();
    } catch (caught) {
      error = caught;
    }
  } finally {
    for (const method of methods) console[method] = original[method];
  }
  assert.equal(JSON.stringify(error).includes(secretToken), false);
  assert.equal(String(error).includes(secretToken), false);
  assert.deepEqual(logged, []);
});

test("authenticated cache keys are member-scoped and do not include token values", () => {
  const first = productionAuthenticatedQueryKey("member-a", "trips");
  const second = productionAuthenticatedQueryKey("member-b", "trips");
  assert.deepEqual(first, ["production-auth", "member-a", "trips"]);
  assert.deepEqual(second, ["production-auth", "member-b", "trips"]);
  assert.notDeepEqual(first, second);
  assert.throws(() => productionAuthenticatedQueryKey("  ", "trips"), /member ID/i);
  assert.equal(JSON.stringify(first).includes(secretToken), false);
});
