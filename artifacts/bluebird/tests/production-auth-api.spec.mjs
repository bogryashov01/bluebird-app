import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAuthenticatedProductionApiClient,
  ProductionAuthConfigurationError,
  productionAuthenticatedQueryKey,
  ProductionAuthCancelledError,
  ProductionAuthHttpError,
  ProductionAuthInvalidJsonError,
  ProductionAuthNetworkError,
  ProductionAuthSchemaError,
  ProductionAuthTimeoutError,
  parseProfileDiagnosticSummary,
} from "../scripts/.production-auth-api.test.mjs";

process.env.EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT = "production";
process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL = "https://bluebirdjets.com/api";
process.env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY = "pk_live_Y2xlcmsuZXhhbXBsZS5jb20k";

const mockOnlyToken = "mock-only-token-never-log";

const anonymous = {
  isAuthenticated: false,
  isAdmin: false,
  isConcierge: false,
  isMember: false,
  memberTier: null,
  email: null,
  firstName: null,
  lastName: null,
  isProfileComplete: false,
  needsPlanDecision: false,
  needsSignupPhone: false,
  impersonation: null,
};

const currentUser = {
  isAuthenticated: true,
  isAdmin: false,
  isConcierge: false,
  isMember: true,
  memberTier: "plus",
  email: "member@example.test",
  firstName: "Preview",
  lastName: "Member",
  isProfileComplete: true,
  needsPlanDecision: false,
  needsSignupPhone: false,
  impersonation: null,
};

const notificationPrefs = {
  mode: "specific",
  allChannels: null,
  emptyLegHomeAirport: "email",
  departingFavorite: null,
  arrivingFavorite: null,
  queueUpdates: "email",
  winningNotifications: "email",
};

const profile = {
  firstName: "Preview",
  lastName: "Member",
  dob: "1990-01-02",
  gender: "male",
  homeAirportCode: "APF",
  homeAirportLabel: "Naples Municipal",
  favoriteAirportCodes: ["MIA"],
  favoriteAirportLabels: ["Miami International"],
  favoriteCityKeys: ["miami"],
  favoriteCityLabels: ["Miami"],
  phoneE164: "+15555550123",
  phoneCountry: "US",
  phoneVerifiedAt: "2026-01-01T00:00:00.000Z",
  phoneVerificationRequired: false,
  notificationPrefs,
  smsConsent: false,
  smsConsentAt: null,
  smsConsentRevokedAt: null,
  email: "member@example.test",
  emailLocked: true,
  signupChannel: "email",
  isComplete: true,
  upgradeCreditBalances: { skipTheLine: 1, internationalPass: 0 },
  weightLbs: 170,
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const profileUpdate = {
  firstName: "Preview",
  lastName: "Member",
  dob: "1990-01-02",
  gender: "male",
  homeAirportCode: "APF",
  favoriteCityKeys: ["miami"],
  phoneE164: "+15555550123",
  phoneCountry: "US",
  notificationPrefs,
  smsConsent: false,
  email: "member@example.test",
  weightLbs: 170,
};

const membership = {
  isMember: true,
  tier: "plus",
  status: "active",
  cancelAtPeriodEnd: false,
  currentPeriodStart: "2026-01-01T00:00:00.000Z",
  currentPeriodEnd: "2027-01-01T00:00:00.000Z",
  paymentStatus: "succeeded",
  paymentMethod: {
    brand: "visa",
    last4: "4242",
    expMonth: "01",
    expYear: "2028",
    billingName: "Preview Member",
    billingAddress: {
      line1: "1 Main St",
      line2: null,
      city: "Naples",
      region: "FL",
      postalCode: "34102",
      country: "US",
    },
  },
  scheduledTierChange: null,
  recentEvents: [{
    id: 11,
    eventType: "activated",
    fromTier: null,
    toTier: "plus",
    source: "self",
    occurredAt: "2026-01-01T00:00:00.000Z",
  }],
  lastPaidAmountCents: 999500,
  lastDiscountPercent: null,
  metaPurchase: null,
};

const trip = {
  leg: {
    id: 81001,
    originAirport: "APF",
    destinationAirport: "MIA",
    originCity: "Naples",
    destinationCity: "Miami",
    departureTime: "2026-11-01T10:00:00.000Z",
    arrivalTime: "2026-11-01T11:00:00.000Z",
    tailNumber: "N123BB",
    aircraftType: "Citation Latitude",
    originFboName: null,
    originFboAddress: null,
    destinationFboName: null,
    destinationFboAddress: null,
    queueClosesAt: "2026-10-31T10:00:00.000Z",
  },
  checklist: {
    emptyLegId: 81001,
    confirmedAt: "2026-10-01T00:00:00.000Z",
    fboVerifiedAt: null,
    manifestAckAt: null,
    policyAckAt: null,
    passLinkSentAt: null,
    manifestLockedAt: null,
    manifestLocked: false,
    boardingPassUrl: null,
    remainingSteps: ["fboVerified", "manifestAck", "policyAck"],
    passengerCount: 1,
    awarded: true,
  },
};

const trips = { current: [trip], past: [] };

const queueEntry = {
  emptyLegId: 81001,
  joinedAt: "2026-10-01T00:00:00.000Z",
  position: 1,
  queueCount: 1,
  memberQueueCount: 1,
  userInQueue: true,
  userTier: "plus",
  userHasLineSkip: false,
  userHasInternationalPass: false,
};

const queueStatus = {
  emptyLegId: 81001,
  queueCount: 0,
  memberQueueCount: 0,
  userInQueue: false,
  lockedForFreeUsers: false,
};

const publicQueue = [{
  position: 1,
  initials: "PM",
  tier: "plus",
  hasLineSkip: false,
  isViewer: true,
}];

const passengerInput = {
  firstName: "Casey",
  middleName: null,
  lastName: "Traveler",
  weight: 165,
  gender: "female",
  dob: "1988-04-05",
  notes: null,
};

const passengerList = {
  passengers: [{
    id: 71,
    emptyLegId: 81001,
    fullName: "Casey Traveler",
    firstName: "Casey",
    middleName: null,
    lastName: "Traveler",
    weight: 165,
    isAccountHolder: false,
    gender: "female",
    dob: "1988-04-05",
    notes: null,
    createdAt: "2026-10-01T00:00:00.000Z",
  }],
  passengerCap: 5,
  pets: [{
    id: 91,
    emptyLegId: 81001,
    breed: "Golden Retriever",
    weight: 55,
    createdAt: "2026-10-01T00:00:00.000Z",
  }],
};

const emptyLeg = {
  id: 81001,
  originAirport: "APF",
  destinationAirport: "MIA",
  departureTime: "2026-11-01T10:00:00.000Z",
  isInternational: false,
  status: "published",
  pricePerHour: 0,
  queueCount: 1,
  memberQueueCount: 1,
  userInQueue: true,
  lockedForFreeUsers: false,
  lineSkipPriceUsd: 0,
  lineSkipSold: false,
  viewerHasLineSkip: false,
  internationalPassPriceUsd: 0,
  internationalPassRequired: false,
  viewerHasInternationalPass: false,
  viewerIsEffectiveWinner: true,
  changeFlagSeverity: "none",
  aircraftGalleryUrls: [],
  aircraftGalleryAlts: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  totalPrice: null,
  msrpUsd: null,
};

const phoneVerificationStatus = {
  method: "pin",
  expiresAt: "2026-10-12T12:00:00.000Z",
  cooldownSeconds: 30,
  status: "pending",
  clerkWarning: null,
  profile: null,
};

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function makeClient(fetcher, overrides = {}) {
  const { tokenProvider: suppliedTokenProvider, ...restOverrides } = overrides;
  return createAuthenticatedProductionApiClient({
    environment: "production",
    baseUrl: "https://bluebirdjets.com/api",
    tokenProvider: {
      environment: "production",
      ...suppliedTokenProvider,
      ...(suppliedTokenProvider ? {} : { getVerifiedAccessToken: async () => mockOnlyToken }),
    },
    fetcher,
    ...restOverrides,
  });
}

function makeDevelopmentClient(fetcher) {
  const values = {
    EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT: process.env.EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT,
    EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_BASE_URL: process.env.EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_BASE_URL,
    EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY,
    EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_CLERK_ISSUER: process.env.EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_CLERK_ISSUER,
  };
  Object.assign(process.env, {
    EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT: "development",
    EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_BASE_URL: "https://development.bluebird.test/api",
    EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_CLERK_PUBLISHABLE_KEY: "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k",
    EXPO_PUBLIC_BLUEBIRD_DEVELOPMENT_API_CLERK_ISSUER: "https://clerk.example.com",
  });
  try {
    return createAuthenticatedProductionApiClient({
      environment: "development",
      baseUrl: "https://development.bluebird.test/api",
      tokenProvider: {
        environment: "development",
        getVerifiedAccessToken: async () => "development-only-mock-token",
      },
      fetcher,
    });
  } finally {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function contractPath(url) {
  return new URL(url).pathname.replace(/^\/api/, "");
}

test("construction is inert and /api/me HTTP 200 false is a signed-out result", async () => {
  let tokenReads = 0;
  let requests = 0;
  const client = createAuthenticatedProductionApiClient({
    environment: "production",
    baseUrl: "https://bluebirdjets.com/api",
    tokenProvider: {
      environment: "production",
      getVerifiedAccessToken: async () => {
        tokenReads += 1;
        return mockOnlyToken;
      },
    },
    fetcher: async () => {
      requests += 1;
      return jsonResponse(anonymous);
    },
  });

  assert.equal(tokenReads, 0);
  assert.equal(requests, 0);
  const result = await client.getMe();
  assert.equal(result.isAuthenticated, false);
  assert.equal(result.memberTier, null);
  assert.equal(tokenReads, 1);
  assert.equal(requests, 1);
});

test("invokes the fetch implementation with the global fetch receiver", async () => {
  let fetchReceiver;
  const client = makeClient(async function (_url, _init) {
    fetchReceiver = this;
    return jsonResponse(anonymous);
  });
  await client.getMe();
  assert.equal(fetchReceiver, globalThis);
});

test("/api/me returns projections without inferring linked or registration state", async () => {
  for (const projection of [
    anonymous,
    { ...currentUser, isMember: false, memberTier: null },
    { ...currentUser, isAuthenticated: false },
  ]) {
    const client = makeClient(async () => jsonResponse(projection));
    const result = await client.getMe();
    assert.deepEqual(result, projection);
  }

  const memberClient = makeClient(async () => jsonResponse(currentUser));
  const memberResult = await memberClient.getMe();
  assert.equal(memberResult.isAuthenticated, true);
  assert.equal(memberResult.isMember, true);
  assert.equal("memberId" in memberResult, false);
  assert.equal("upgradeCreditBalances" in memberResult, false);
});

test("/api/me rejects non-boolean or missing contract routing flags", async () => {
  for (const invalidProjection of [
    { ...currentUser, isAuthenticated: "true" },
    { ...currentUser, isProfileComplete: 1 },
    { ...currentUser, isMember: "false" },
    (({ isAuthenticated, ...rest }) => rest)(currentUser),
    (({ isProfileComplete, ...rest }) => rest)(currentUser),
    (({ isMember, ...rest }) => rest)(currentUser),
  ]) {
    const client = makeClient(async () => jsonResponse(invalidProjection));
    await assert.rejects(client.getMe(), { code: "invalid_schema" });
  }
});

test("base URL safety and bearer-only request headers are preserved", async () => {
  let request;
  const client = makeClient(async (url, init) => {
    request = { url, init };
    return jsonResponse(currentUser);
  });
  assert.equal((await client.getMe()).isAuthenticated, true);
  assert.equal(request.url, "https://bluebirdjets.com/api/me");
  assert.equal(request.init.method, "GET");
  assert.equal(request.init.headers.Authorization, `Bearer ${mockOnlyToken}`);
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
        environment: "production",
        tokenProvider: { environment: "production", getVerifiedAccessToken: async () => mockOnlyToken },
        baseUrl,
        fetcher: async () => jsonResponse(anonymous),
      }),
      /Main Bluebird API configuration/i,
    );
  }
});

test("documented member methods use the production paths, verbs, and bodies", async () => {
  const requests = [];
  const client = makeClient(async (url, init) => {
    const path = contractPath(url);
    requests.push({ path, method: init.method, body: init.body });
    if (path === "/me") return jsonResponse(currentUser);
    if (path === "/me/profile" && init.method === "GET") return jsonResponse(profile);
    if (path === "/me/profile" && init.method === "PUT") return jsonResponse(currentUser);
    if (path === "/membership") return jsonResponse(membership);
    if (path === "/trips") return jsonResponse(trips);
    if (path === "/empty-legs/81001/queue" && init.method === "GET") return jsonResponse(publicQueue);
    if (path === "/empty-legs/81001/queue" && init.method === "POST") return jsonResponse(queueEntry);
    if (path === "/empty-legs/81001/queue" && init.method === "DELETE") return jsonResponse(queueStatus);
    if (path === "/empty-legs/81001/skip-line") return jsonResponse(emptyLeg);
    if (path === "/empty-legs/81001/passengers" && init.method === "GET") return jsonResponse(passengerList);
    if (path === "/empty-legs/81001/passengers" && init.method === "POST") return jsonResponse(passengerList);
    if (path === "/empty-legs/81001/passengers/71" && init.method === "PATCH") return jsonResponse(passengerList);
    if (path === "/empty-legs/81001/passengers/71" && init.method === "DELETE") return jsonResponse(passengerList);
    if (path === "/empty-legs/81001/pets" && init.method === "POST") return jsonResponse(passengerList);
    if (path === "/empty-legs/81001/pets/91" && init.method === "PATCH") return jsonResponse(passengerList);
    if (path === "/empty-legs/81001/pets/91" && init.method === "DELETE") return jsonResponse(passengerList);
    if (path === "/empty-legs/81001/passengers/71/weight") return jsonResponse(passengerList);
    if (path === "/empty-legs/81001/winner/confirm") return jsonResponse(emptyLeg);
    if (path === "/empty-legs/81001/winner/decline") return jsonResponse(emptyLeg);
    if (path === "/me/phone-verification/start") return jsonResponse({ ok: true, cooldownSeconds: 30 });
    if (path === "/me/phone-verification/check") return jsonResponse(phoneVerificationStatus);
    if (path === "/me/phone-verification/status") return jsonResponse(phoneVerificationStatus);
    throw new Error(`Unexpected mocked route ${init.method} ${path}`);
  });

  assert.equal((await client.getMe()).isAuthenticated, true);
  const loadedProfile = await client.getProfile();
  assert.equal(loadedProfile.weightLbs, 170);
  assert.deepEqual(loadedProfile.notificationPrefs, notificationPrefs);
  assert.deepEqual(
    await client.updateProfile({ ...profileUpdate, localOnlyField: "must not escape" }),
    currentUser,
  );
  assert.equal((await client.getMembership()).paymentMethod.last4, "4242");
  const tripResponse = await client.listTrips();
  assert.deepEqual(Object.keys(tripResponse), ["current", "past"]);
  assert.equal(tripResponse.current[0].leg.id, 81001);
  assert.equal(tripResponse.current[0].checklist.awarded, true);
  assert.deepEqual(await client.getEmptyLegQueue(81001), publicQueue);
  await client.joinEmptyLegQueue(81001, {
    internationalPassAuthorized: true,
    useInternationalPassCredit: true,
  });
  await client.leaveEmptyLegQueue(81001);
  assert.equal((await client.skipLine(81001, { useCredit: true, checkoutUrl: "must not escape" })).pricePerHour, 0);
  await client.getEmptyLegPassengers(81001);
  await client.addEmptyLegPassenger(81001, passengerInput);
  await client.updateEmptyLegPassenger(81001, 71, { ...passengerInput, passengerOrder: 3 });
  await client.removeEmptyLegPassenger(81001, 71);
  await client.addEmptyLegPet(81001, { breed: "Golden Retriever", weight: 55 });
  await client.updateEmptyLegPet(81001, 91, { breed: "Golden Retriever", weight: 55, species: "must not escape" });
  await client.removeEmptyLegPet(81001, 91);
  await client.updateEmptyLegPassengerWeight(81001, 71, { weight: 170 });
  await client.confirmEmptyLegWinner(81001);
  await client.declineEmptyLegWinner(81001);
  await client.startPhoneVerification({ countryIso2: "US", phoneE164: "+15555550123" });
  await client.checkPhoneVerification({ phoneE164: "+15555550123", code: "123456" });
  await client.getPhoneVerificationStatus("+15555550123");

  assert.deepEqual(requests.map(({ method, path }) => `${method} ${path}`), [
    "GET /me",
    "GET /me/profile",
    "PUT /me/profile",
    "GET /membership",
    "GET /trips",
    "GET /empty-legs/81001/queue",
    "POST /empty-legs/81001/queue",
    "DELETE /empty-legs/81001/queue",
    "POST /empty-legs/81001/skip-line",
    "GET /empty-legs/81001/passengers",
    "POST /empty-legs/81001/passengers",
    "PATCH /empty-legs/81001/passengers/71",
    "DELETE /empty-legs/81001/passengers/71",
    "POST /empty-legs/81001/pets",
    "PATCH /empty-legs/81001/pets/91",
    "DELETE /empty-legs/81001/pets/91",
    "PATCH /empty-legs/81001/passengers/71/weight",
    "POST /empty-legs/81001/winner/confirm",
    "POST /empty-legs/81001/winner/decline",
    "POST /me/phone-verification/start",
    "POST /me/phone-verification/check",
    "GET /me/phone-verification/status",
  ]);

  assert.deepEqual(JSON.parse(requests[2].body), profileUpdate);
  assert.deepEqual(JSON.parse(requests[6].body), {
    internationalPassAuthorized: true,
    useInternationalPassCredit: true,
  });
  assert.deepEqual(JSON.parse(requests[8].body), { useCredit: true });
  assert.deepEqual(JSON.parse(requests[11].body), passengerInput);
  assert.deepEqual(JSON.parse(requests[14].body), { breed: "Golden Retriever", weight: 55 });
  assert.deepEqual(JSON.parse(requests[16].body), { weight: 170 });
  assert.equal(requests[21].path, "/me/phone-verification/status");
});

test("phone status encodes query data and profile weight/body rules are enforced", async () => {
  let requestedUrl;
  const client = makeClient(async (url) => {
    requestedUrl = url;
    return jsonResponse(phoneVerificationStatus);
  });
  await client.getPhoneVerificationStatus("+15555550123");
  assert.equal(new URL(requestedUrl).searchParams.get("phoneE164"), "+15555550123");

  let requests = 0;
  const guardedClient = makeClient(async () => {
    requests += 1;
    return jsonResponse(profile);
  });
  assert.throws(() => guardedClient.updateProfile({ ...profileUpdate, firstName: undefined }), TypeError);
  assert.throws(() => guardedClient.updateProfile({ ...profileUpdate, dob: undefined }), TypeError);
  assert.throws(() => guardedClient.updateProfile({ ...profileUpdate, homeAirportCode: undefined }), TypeError);
  assert.throws(() => guardedClient.updateProfile({ ...profileUpdate, weightLbs: 170.5 }), TypeError);
  assert.throws(() => guardedClient.updateProfile({ ...profileUpdate, favoriteCityKeys: [] }), TypeError);
  assert.throws(() => guardedClient.addEmptyLegPassenger(81001, { ...passengerInput, weight: 165.5 }), TypeError);
  assert.throws(() => guardedClient.addEmptyLegPassenger(81001, { ...passengerInput, dob: "04/05/1988" }), TypeError);
  assert.throws(() => guardedClient.addEmptyLegPet(81001, { breed: "Dog", weight: 55.2 }), TypeError);
  assert.throws(() => guardedClient.checkPhoneVerification({ phoneE164: "+15555550123", code: "12ab56" }), TypeError);
  assert.equal(requests, 0);
});

test("all Empty Leg and passenger/pet path identifiers are positive safe integers", async () => {
  let requests = 0;
  const client = makeClient(async () => {
    requests += 1;
    return jsonResponse(publicQueue);
  });
  for (const invalid of [0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1, "81001"]) {
    assert.throws(() => client.getEmptyLegQueue(invalid), /positive integer/i);
  }
  assert.throws(() => client.removeEmptyLegPassenger(81001, 0), /positive integer/i);
  assert.throws(() => client.removeEmptyLegPet(81001, -3), /positive integer/i);
  assert.equal(requests, 0);
});

test("trips use numeric Empty Leg identifiers and reject invented trip/status/UUID fields", async () => {
  const client = makeClient(async () => jsonResponse(trips));
  const parsed = await client.listTrips();
  assert.deepEqual(parsed, trips);
  assert.equal(parsed.current[0].leg.id, 81001);
  assert.equal("id" in parsed.current[0], false);
  assert.equal("status" in parsed.current[0], false);

  const sourceWithUnmodeledFields = makeClient(async () => jsonResponse({
    current: [{ ...trip, id: "trip-uuid", status: "upcoming" }],
    past: [],
  }));
  const response = await sourceWithUnmodeledFields.listTrips();
  assert.equal("id" in response.current[0], false);
  assert.equal("status" in response.current[0], false);
});

test("membership and profile parsers reject fields with the wrong documented shape", async () => {
  const badMembership = makeClient(async () => jsonResponse({ ...membership, tier: "concierge" }));
  await assert.rejects(badMembership.getMembership(), ProductionAuthSchemaError);

  const badProfile = makeClient(async () => jsonResponse({ ...profile, weightLbs: 170.5 }));
  await assert.rejects(badProfile.getProfile(), ProductionAuthSchemaError);

  const altered = { ...trip, leg: { ...trip.leg, id: "81001" } };
  const badLeg = makeClient(async () => jsonResponse({ current: [altered], past: [] }));
  await assert.rejects(badLeg.listTrips(), ProductionAuthSchemaError);
});

test("phone verification distinguishes its verified profile from UserProfile", async () => {
  const { upgradeCreditBalances, ...phoneVerifiedProfile } = profile;
  const verified = {
    ...phoneVerificationStatus,
    status: "verified",
    profile: phoneVerifiedProfile,
  };
  const client = makeClient(async () => jsonResponse(verified));
  const result = await client.checkPhoneVerification({ phoneE164: "+15555550123", code: "123456" });
  assert.equal(result.status, "verified");
  assert.equal(result.profile.weightLbs, 170);
  assert.equal("upgradeCreditBalances" in result.profile, false);

  const wrongProjection = makeClient(async () => jsonResponse({
    ...verified,
    profile,
  }));
  // Extra source properties are tolerated by the server's ordinary object
  // parsing, but this client projection deliberately doesn't expose balances.
  const parsed = await wrongProjection.checkPhoneVerification({ phoneE164: "+15555550123", code: "123456" });
  assert.equal("upgradeCreditBalances" in parsed.profile, false);
  assert.equal("upgradeCreditBalances" in profile, true);
});

test("HTTP errors and session expiration remain sanitized", async () => {
  const expiredClient = makeClient(async () => jsonResponse({ error: "unauthorized" }, 401));
  await assert.rejects(
    expiredClient.getProfile(),
    (error) => error instanceof ProductionAuthHttpError &&
      error.status === 401 &&
      error.code === "session_expired",
  );
  const serverErrorClient = makeClient(async () => jsonResponse({ error: "not stable" }, 500));
  await assert.rejects(
    serverErrorClient.getMembership(),
    (error) => error instanceof ProductionAuthHttpError && error.status === 500 && error.code === "http",
  );
});

test("missing or failed token acquisition never reaches the injected fetcher", async () => {
  let requests = 0;
  const fetcher = async () => {
    requests += 1;
    return jsonResponse(anonymous);
  };
  const missing = createAuthenticatedProductionApiClient({
    environment: "production",
    baseUrl: "https://bluebirdjets.com/api",
    tokenProvider: { environment: "production", getVerifiedAccessToken: async () => null },
    fetcher,
  });
  await assert.rejects(missing.getMe(), (error) => error.code === "token");

  const failed = createAuthenticatedProductionApiClient({
    environment: "production",
    baseUrl: "https://bluebirdjets.com/api",
    tokenProvider: { environment: "production", getVerifiedAccessToken: async () => { throw new Error(mockOnlyToken); } },
    fetcher,
  });
  await assert.rejects(failed.getMe(), (error) => error.code === "token");
  assert.equal(requests, 0);
});

test("retrieves a fresh verified token for each explicit request", async () => {
  let tokenReads = 0;
  const authorizationHeaders = [];
  const client = createAuthenticatedProductionApiClient({
    environment: "production",
    baseUrl: "https://bluebirdjets.com/api",
    tokenProvider: {
      environment: "production",
      getVerifiedAccessToken: async () => `mock-session-token-${++tokenReads}`,
    },
    fetcher: async (url, init) => {
      authorizationHeaders.push(init.headers.Authorization);
      return jsonResponse(anonymous);
    },
  });

  await client.getMe();
  await client.getMe();

  assert.equal(tokenReads, 2);
  assert.deepEqual(authorizationHeaders, [
    "Bearer mock-session-token-1",
    "Bearer mock-session-token-2",
  ]);
});

test("network, timeout, and caller cancellation are distinct sanitized errors", async () => {
  const networkClient = makeClient(async () => { throw new Error(`failed ${mockOnlyToken}`); });
  await assert.rejects(networkClient.getMe(), ProductionAuthNetworkError);

  const timeoutClient = makeClient(async () => new Promise(() => {}), { timeoutMs: 5 });
  await assert.rejects(timeoutClient.getMe(), ProductionAuthTimeoutError);

  let requestsWhileTokenPending = 0;
  const stalledTokenClient = createAuthenticatedProductionApiClient({
    environment: "production",
    baseUrl: "https://bluebirdjets.com/api",
    tokenProvider: { environment: "production", getVerifiedAccessToken: () => new Promise(() => {}) },
    timeoutMs: 5,
    fetcher: async () => {
      requestsWhileTokenPending += 1;
      return jsonResponse(anonymous);
    },
  });
  await assert.rejects(stalledTokenClient.getMe(), ProductionAuthTimeoutError);
  assert.equal(requestsWhileTokenPending, 0);

  const controller = new AbortController();
  let wasAborted = false;
  let startFetch;
  const fetchStarted = new Promise((resolve) => { startFetch = resolve; });
  const cancelClient = makeClient((url, init) => new Promise((_, reject) => {
    startFetch();
    init.signal.addEventListener("abort", () => {
      wasAborted = true;
      reject(new Error("aborted"));
    }, { once: true });
  }));
  const cancelled = cancelClient.getMe({ signal: controller.signal });
  await fetchStarted;
  controller.abort();
  await assert.rejects(cancelled, ProductionAuthCancelledError);
  assert.equal(wasAborted, true);
  await assert.rejects(cancelClient.getMe({ signal: AbortSignal.abort() }), ProductionAuthCancelledError);
});

test("invalid JSON and malformed source contracts produce typed errors", async () => {
  const invalidJsonClient = makeClient(async () => ({
    ok: true,
    status: 200,
    json: async () => { throw new SyntaxError("invalid json"); },
  }));
  await assert.rejects(invalidJsonClient.getMe(), ProductionAuthInvalidJsonError);

  const malformedMe = makeClient(async () => jsonResponse({ ...anonymous, isAdmin: "false" }));
  await assert.rejects(malformedMe.getMe(), ProductionAuthSchemaError);

  const malformedPassengers = makeClient(async () => jsonResponse({
    ...passengerList,
    passengers: [{ ...passengerList.passengers[0], id: "71" }],
  }));
  await assert.rejects(malformedPassengers.getEmptyLegPassengers(81001), ProductionAuthSchemaError);

  const malformedWinner = makeClient(async () => jsonResponse({ ...emptyLeg, pricePerHour: 1.25 }));
  await assert.rejects(malformedWinner.confirmEmptyLegWinner(81001), ProductionAuthSchemaError);
});

test("profile GET remains strict while profile PUT parses CurrentUser without upgradeCreditBalances", async () => {
  const { upgradeCreditBalances, ...profileWithoutCredits } = profile;
  let capturedStatus = null;
  const strictGet = makeClient(async (_url, init) => {
    assert.equal(init.method, "GET");
    return jsonResponse(profileWithoutCredits, 200);
  });
  await assert.rejects(
    strictGet.getProfile({ onResponseStatus: (status) => { capturedStatus = status; } }),
    (error) => error instanceof ProductionAuthSchemaError &&
      error.field === "profile.upgradeCreditBalances",
  );
  assert.equal(capturedStatus, 200);

  capturedStatus = null;
  const currentUserPut = makeClient(async (_url, init) => {
    assert.equal(init.method, "PUT");
    return jsonResponse(currentUser, 200);
  });
  assert.deepEqual(
    await currentUserPut.updateProfile(profileUpdate, {
      onResponseStatus: (status) => { capturedStatus = status; },
    }),
    currentUser,
  );
  assert.equal(capturedStatus, 200);

  capturedStatus = null;
  const malformedPut = makeClient(async () => jsonResponse({
    ...currentUser,
    isAdmin: undefined,
  }, 200));
  await assert.rejects(
    malformedPut.updateProfile(profileUpdate, {
      onResponseStatus: (status) => { capturedStatus = status; },
    }),
    (error) => error instanceof ProductionAuthSchemaError &&
      error.field === "currentUser.isAdmin",
  );
  assert.equal(capturedStatus, 200);

  let failedStatus = null;
  const failedWrite = makeClient(async () => jsonResponse({ error: "unavailable" }, 503));
  await assert.rejects(
    failedWrite.updateProfile(profileUpdate, {
      onResponseStatus: (status) => { failedStatus = status; },
    }),
    (error) => error instanceof ProductionAuthHttpError && error.status === 503,
  );
  assert.equal(failedStatus, 503);
});

test("diagnostic projection reports only field presence and conditional completion requirements", () => {
  const summary = parseProfileDiagnosticSummary({
    ...profile,
    upgradeCreditBalances: { skipTheLine: 0, internationalPass: 2 },
  });
  assert.deepEqual(summary.fields, {
    firstName: "present",
    lastName: "present",
    dob: "present",
    gender: "present",
    homeAirport: "present",
    favoriteCities: "present",
    email: "present",
    verifiedPhone: "present",
  });
  assert.equal(summary.profileIsComplete, true);
  assert.equal(summary.emailRequired, true);
  assert.equal(summary.emailLocked, true);
  assert.equal(summary.signupChannel, "email");
  assert.equal(summary.phoneVerificationRequired, false);
  assert.equal(summary.verifiedPhoneRequirementSatisfied, true);
  assert.equal(summary.upgradeCreditBalances, "valid");

  const phoneRequired = parseProfileDiagnosticSummary({
    ...profile,
    phoneVerificationRequired: true,
    phoneE164: "+15555550123",
    phoneVerifiedAt: null,
    email: null,
    upgradeCreditBalances: undefined,
  });
  assert.equal(phoneRequired.fields.verifiedPhone, "absent");
  assert.equal(phoneRequired.verifiedPhoneRequirementSatisfied, false);
  assert.equal(phoneRequired.fields.email, "absent");
  assert.equal(phoneRequired.upgradeCreditBalances, "missing");

  const unknownPolicy = parseProfileDiagnosticSummary({
    ...profile,
    phoneVerificationRequired: "yes",
    phoneVerifiedAt: null,
    upgradeCreditBalances: { skipTheLine: -1, internationalPass: 0 },
  });
  assert.equal(unknownPolicy.phoneVerificationRequired, null);
  assert.equal(unknownPolicy.verifiedPhoneRequirementSatisfied, null);
  assert.equal(unknownPolicy.upgradeCreditBalances, "invalid");
  const invalidRoot = parseProfileDiagnosticSummary(null);
  assert.deepEqual(invalidRoot.fields, {
    firstName: "unknown",
    lastName: "unknown",
    dob: "unknown",
    gender: "unknown",
    homeAirport: "unknown",
    favoriteCities: "unknown",
    email: "unknown",
    verifiedPhone: "unknown",
  });
  assert.equal(invalidRoot.upgradeCreditBalances, "invalid");
});

test("manual profile diagnostic issues GETs only and requires authenticated /api/me first", async () => {
  const requests = [];
  const client = makeDevelopmentClient(async (url, init) => {
    const path = contractPath(url);
    requests.push(`${init.method} ${path}`);
    if (path === "/me") return jsonResponse(currentUser);
    if (path === "/me/profile") return jsonResponse({
      ...profile,
      firstName: null,
      upgradeCreditBalances: undefined,
    });
    throw new Error(`Unexpected request ${init.method} ${path}`);
  });

  const me = await client.getMe();
  assert.equal(me.isAuthenticated, true);
  const result = await client.getProfileDiagnostic();
  assert.equal(result.fields.firstName, "absent");
  assert.equal(result.upgradeCreditBalances, "missing");
  const serializedDiagnostic = JSON.stringify(result);
  assert.equal(serializedDiagnostic.includes("Preview"), false);
  assert.equal(serializedDiagnostic.includes("member@example.test"), false);
  assert.equal(serializedDiagnostic.includes(mockOnlyToken), false);
  assert.deepEqual(requests, ["GET /me", "GET /me/profile"]);
  assert.equal(requests.some((request) => request.startsWith("PUT ")), false);

  let productionRequests = 0;
  const productionClient = makeClient(async () => {
    productionRequests += 1;
    return jsonResponse(profile);
  });
  assert.throws(
    () => productionClient.getProfileDiagnostic(),
    ProductionAuthConfigurationError,
  );
  assert.equal(productionRequests, 0, "production cannot issue the diagnostic profile request");
});

test("side-effecting GETs are never invoked during setup or used as probes", async () => {
  const requests = [];
  const client = makeClient(async (url, init) => {
    requests.push(`${init.method} ${contractPath(url)}`);
    if (contractPath(url) === "/me/profile") return jsonResponse(profile);
    if (contractPath(url) === "/empty-legs/81001/passengers") return jsonResponse(passengerList);
    if (contractPath(url).startsWith("/me/phone-verification/status")) return jsonResponse(phoneVerificationStatus);
    throw new Error("Unexpected mock URL");
  });
  assert.deepEqual(requests, []);
  assert.equal(requests.some((request) => /me\/profile|passengers|phone-verification\/status/.test(request)), false);
  // Each potentially mutating GET is issued only because the test explicitly
  // invokes that method, and only against the injected mock fetcher.
  await client.getProfile();
  await client.getEmptyLegPassengers(81001);
  await client.getPhoneVerificationStatus("+15555550123");
  assert.deepEqual(requests, [
    "GET /me/profile",
    "GET /empty-legs/81001/passengers",
    "GET /me/phone-verification/status",
  ]);
});

test("token values are not exposed in errors, logs, or authenticated query keys", async () => {
  const logged = [];
  const methods = ["debug", "info", "log", "warn", "error"];
  const original = Object.fromEntries(methods.map((method) => [method, console[method]]));
  for (const method of methods) console[method] = (...args) => logged.push(args.join(" "));
  let error;
  try {
    const client = makeClient(async () => { throw new Error(`network rejected ${mockOnlyToken}`); });
    try {
      await client.getMe();
    } catch (caught) {
      error = caught;
    }
  } finally {
    for (const method of methods) console[method] = original[method];
  }
  assert.equal(JSON.stringify(error).includes(mockOnlyToken), false);
  assert.equal(String(error).includes(mockOnlyToken), false);
  assert.deepEqual(logged, []);

  const first = productionAuthenticatedQueryKey("member-a", "trips");
  const second = productionAuthenticatedQueryKey("member-b", "trips");
  assert.deepEqual(first, ["production-auth", "member-a", "trips"]);
  assert.deepEqual(second, ["production-auth", "member-b", "trips"]);
  assert.notDeepEqual(first, second);
  assert.throws(() => productionAuthenticatedQueryKey("  ", "trips"), /member ID/i);
  assert.equal(JSON.stringify(first).includes(mockOnlyToken), false);
});
