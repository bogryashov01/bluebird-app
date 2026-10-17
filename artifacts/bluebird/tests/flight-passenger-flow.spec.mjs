import { expect, test } from "@playwright/test";

const user = {
  id: "flight-flow-user",
  name: "Flight Flow Member",
  email: "flight-flow@example.test",
  membershipTier: "plus",
  linePassCount: 1,
  homeAirports: ["BFI"],
};

const baseUser = {
  ...user,
  id: "base-flight-flow-user",
  email: "base-flight-flow@example.test",
  membershipTier: "base",
};

const flight = {
  id: "flight-1",
  fromAirport: "BFI",
  fromCity: "Seattle",
  toAirport: "SFO",
  toCity: "San Francisco",
  aircraftType: "Citation CJ3",
  aircraftCapacity: 6,
  departureDate: "2026-10-15",
  departureTime: "10:00",
  duration: "2h 0m",
  seatsAvailable: 4,
  international: false,
  status: "available",
  createdAt: "2026-09-18T12:00:00.000Z",
};

const trip = {
  id: "trip-1",
  flightId: "21623",
  flight: { ...flight, id: "21623" },
  status: "upcoming",
  bookedAt: "2026-10-01T12:00:00.000Z",
  cleaningFeeUsd: 0,
  manifest: {
    requiredCount: 1,
    completedCount: 0,
    isComplete: false,
    version: 0,
  },
};

async function mockFlightApi(page, {
  status = { status: "none" },
  cachedUser = user,
  trips = [trip],
  queueEntries = [],
  manifest = {
    tripId: "trip-1",
    requiredCount: 1,
    passengers: [],
    pet: null,
    bringingPet: false,
  },
  manifestErrorStatus,
  statusErrorStatus,
  joinErrorStatus,
  joinDelayMs = 0,
} = {}) {
  let joinBody;
  let joinRequestCount = 0;

  await page.addInitScript(({ cachedUser }) => {
    localStorage.setItem("bluebird_token", "mobile-flight-flow-test-token");
    localStorage.setItem("bluebird_user", JSON.stringify(cachedUser));
  }, { cachedUser });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === "/api/auth/me") return route.fulfill({ json: cachedUser });
    if (path === "/api/trips") return route.fulfill({ json: trips });
    if (path === "/api/notifications") return route.fulfill({ json: [] });
    if (path === "/api/queue/status") return route.fulfill({ json: queueEntries });
    if (path === "/api/flights/flight-1") return route.fulfill({ json: flight });
    if (path === "/api/flights/flight-1/my-status") {
      if (statusErrorStatus) {
        return route.fulfill({
          status: statusErrorStatus,
          json: { error: "Flight access could not be verified." },
        });
      }
      return route.fulfill({ json: status });
    }
    if (path === "/api/networking/flights/flight-1/front-member") {
      return route.fulfill({ json: { eligible: false } });
    }
    if (path === "/api/concierge/history") return route.fulfill({ json: [] });
    if (path === "/api/trips/trip-1/manifest") {
      if (manifestErrorStatus) {
        return route.fulfill({
          status: manifestErrorStatus,
          json: { error: manifestErrorStatus === 409 ? "Passenger information is locked." : "Manifest service unavailable." },
        });
      }
      return route.fulfill({ json: manifest });
    }
    if (path === "/api/passengers") return route.fulfill({ json: [] });
    if (path === "/api/queue/join" && request.method() === "POST") {
      joinRequestCount += 1;
      joinBody = request.postDataJSON();
      if (joinDelayMs) await new Promise((resolve) => setTimeout(resolve, joinDelayMs));
      if (joinErrorStatus) {
        return route.fulfill({
          status: joinErrorStatus,
          json: { error: "Queue service is temporarily unavailable." },
        });
      }
      return route.fulfill({
        json: {
          id: "queue-entry-1",
          status: "waiting",
          position: 1,
          totalInQueue: 1,
          flight,
        },
      });
    }
    return route.continue();
  });

  return { getJoinBody: () => joinBody, getJoinRequestCount: () => joinRequestCount };
}

test("My Trips shows an honest empty state when the member has no trips", async ({ page }) => {
  await mockFlightApi(page, { trips: [] });
  await page.goto("/trips");

  await expect(page.getByText("No upcoming trips", { exact: true })).toBeVisible();
  await expect(page.getByTestId("trip-card-open-details")).toHaveCount(0);
});

test("past cancelled trips keep their status and do not expose passenger details", async ({ page }) => {
  await mockFlightApi(page, { trips: [{ ...trip, status: "cancelled" }] });
  await page.goto("/trips");
  await page.getByText("Past", { exact: true }).click();

  await expect(page.getByText("CANCELLED", { exact: true })).toBeVisible();
  await page.getByTestId("trip-card-open-details").click();
  await expect(page.getByTestId("trip-status")).toHaveText("Cancelled");
  await expect(page.getByTestId("trip-passenger-information")).toHaveCount(0);
  await expect(page.getByText("Passenger information is unavailable for this trip status.", { exact: true })).toBeVisible();
});

test("local trip detail API failures and locked manifests have explicit states", async ({ page }) => {
  await mockFlightApi(page);
  await page.route("**/api/trips", (route) => route.fulfill({
    status: 503,
    json: { error: "Trip service unavailable." },
  }));
  await page.goto("/trip/trip-1");
  await expect(page.getByTestId("trip-details-api-error")).toContainText("Could not load trip details");

  await page.unroute("**/api/trips");
  await mockFlightApi(page, { manifestErrorStatus: 409 });
  await page.goto("/trip/trip-1/passengers");
  await expect(page.getByTestId("passenger-information-unavailable-title")).toHaveText("Passenger information locked");
  await expect(page.getByTestId("passenger-information-unavailable")).toContainText("Passenger information is locked.");
});

test("flight details omit unsupported facts and keep join requests unavailable", async ({ page }) => {
  const { getJoinBody } = await mockFlightApi(page);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/flight/flight-1");

  await expect(page.getByTestId("flight-info-aircraft-type")).toHaveText("Citation CJ3");
  await expect(page.getByText("4 available", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Seats", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Range", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("flight-detail-photo-unavailable")).toBeVisible();
  await expect(page.getByText("Passengers", { exact: true })).toHaveCount(0);
  await expect(page.getByText("View Flight Policy & Terms", { exact: true })).toBeVisible();

  await expect(page.getByText("WiFi", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Pets", { exact: true })).toHaveCount(0);
  await expect(page.getByText("25 kg per passenger", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Request unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText("Request to Join", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Ask AI Concierge", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByText("Ask AI Concierge", { exact: true }).click();
  await expect(page).toHaveURL(/\/concierge$/);
  await expect(page.getByText(/I'm your AI Concierge/)).toBeVisible();
  expect(getJoinBody()).toBeUndefined();
});

test("flight details explain when membership is required without opening purchase or queue flows", async ({ page }) => {
  const nonMember = { ...user, id: "flight-flow-nonmember", membershipTier: "none" };
  const { getJoinBody } = await mockFlightApi(page, { cachedUser: nonMember });
  await page.goto("/flight/flight-1");

  await expect(page.getByText("Membership required", { exact: true })).toBeVisible();
  await expect(page.getByText("Request to Join", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Ask AI Concierge", { exact: true })).toBeVisible();
  expect(getJoinBody()).toBeUndefined();
});

test("flight details show clear signed-out and unavailable access states without queue requests", async ({ page }) => {
  const signedOut = await mockFlightApi(page, { cachedUser: null });
  await page.goto("/flight/flight-1");
  await expect(page.getByText("Sign in required", { exact: true })).toBeVisible();
  await expect(page.getByText("Request to Join", { exact: true })).toHaveCount(0);
  expect(signedOut.getJoinBody()).toBeUndefined();

  await page.unroute("**/api/**");
  const unavailable = await mockFlightApi(page, { statusErrorStatus: 503 });
  await page.goto("/flight/flight-1");
  await expect(page.getByText("Queue access unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText(/No queue or booking request was sent\./)).toBeVisible();
  await expect(page.getByText("Request to Join", { exact: true })).toHaveCount(0);
  expect(unavailable.getJoinBody()).toBeUndefined();
});

test("only confirmed-flight status data can disclose departure FBO details", async ({ page }) => {
  await mockFlightApi(page, {
    status: {
      status: "confirmed",
      tripId: "trip-1",
      confirmedFlight: {
        departureFbo: "Confirmed Departure FBO",
        departureFboAddress: "100 Airport Way",
      },
    },
  });
  await page.goto("/flight/flight-1");
  await expect(page.getByTestId("departure-fbo-directions")).toBeVisible();
  await expect(page.getByText("100 Airport Way", { exact: true }).last()).toBeVisible();
  await page.getByTestId("departure-fbo-directions").click();
  await expect(page.getByText("Directions to Confirmed Departure FBO", { exact: true })).toBeVisible();
  await expect(page.getByText("100 Airport Way", { exact: true }).last()).toBeVisible();
  await page.evaluate(() => {
    window.__bluebirdMapUrls = [];
    window.open = (url) => {
      window.__bluebirdMapUrls.push(String(url));
      return null;
    };
  });
  await page.getByTestId("open-google-maps").click();
  await expect.poll(() => page.evaluate(() => window.__bluebirdMapUrls.length)).toBe(1);
  const fboMapUrl = await page.evaluate(() => window.__bluebirdMapUrls[0]);
  expect(fboMapUrl).toContain("destination=100%20Airport%20Way");

  await page.unroute("**/api/**");
  await mockFlightApi(page, {
    status: {
      status: "waiting",
      queueEntryId: "queue-1",
      confirmedFlight: {
        departureFbo: "Unconfirmed FBO",
        departureFboAddress: "200 Airport Way",
      },
    },
  });
  await page.goto("/flight/flight-1");
  await expect(page.getByTestId("departure-fbo-directions")).toHaveCount(0);
  await expect(page.getByText("Unconfirmed FBO", { exact: false })).toHaveCount(0);
  await expect(page.getByText("200 Airport Way", { exact: true })).toHaveCount(0);
});

test("confirmed flight details still open Passenger Information", async ({ page }) => {
  await mockFlightApi(page, {
    status: {
      status: "confirmed",
      tripId: "trip-1",
      manifest: { completedCount: 0, requiredCount: 1 },
    },
  });
  await page.goto("/flight/flight-1");

  const passengerInformation = page.getByTestId("open-passenger-list");
  await expect(passengerInformation).toBeVisible();
  await passengerInformation.click();
  await expect(page).toHaveURL(/\/trip\/trip-1\/passengers/);
});

test("My Trips opens Trip Details with the trip ID, then exposes passenger and boarding availability", async ({ page }) => {
  await mockFlightApi(page);
  await page.goto("/trips");

  await page.getByTestId("trip-card-open-details").click();
  await expect(page).toHaveURL(/\/trip\/trip-1$/);
  await expect(page.getByTestId("trip-status")).toHaveText("Upcoming");
  await expect(page.getByTestId("trip-details").getByText("Seattle → San Francisco", { exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/trip/trip-1");
  expect(new URL(page.url()).pathname).not.toContain("/flight/21623");

  await page.getByTestId("trip-passenger-information").click();
  await expect(page).toHaveURL(/\/trip\/trip-1\/passengers$/);
  await expect(page.getByTestId("passenger-information-screen").getByText("Passenger Information", { exact: true })).toBeVisible();
  await page.getByTestId("header-back").last().click();
  await expect(page).toHaveURL(/\/trip\/trip-1$/);

  await page.getByTestId("trip-boarding-pass").click();
  await expect(page).toHaveURL(/\/trip\/trip-1\/boarding-pass$/);
  await expect(page.getByTestId("boarding-pass-unavailable")).toContainText("Boarding pass unavailable");
  await expect(page.getByTestId("boarding-pass-unavailable")).toContainText("Apple Wallet is unavailable");
  await expect(page.getByTestId("boarding-pass-unavailable").locator('img, canvas, [data-testid*="qr"]')).toHaveCount(0);
});

test("pet manifest preserves its established weight and crate fields without invented pet identity fields", async ({ page }) => {
  await mockFlightApi(page, {
    manifest: {
      tripId: "trip-1",
      requiredCount: 1,
      passengers: [],
      pet: null,
      bringingPet: true,
    },
  });
  await page.goto("/trip/trip-1/passengers");

  await expect(page.getByText("Travel crate details", { exact: true })).toBeVisible();
  await expect(page.getByTestId("pet-weight-lb")).toBeVisible();
  await expect(page.getByTestId("pet-crate-length")).toBeVisible();
  await expect(page.getByTestId("pet-crate-width")).toBeVisible();
  await expect(page.getByTestId("pet-crate-height")).toBeVisible();
  await expect(page.getByText(/pet name|pet type/i)).toHaveCount(0);
});

test("malformed direct passenger trip ID shows unavailable without loading trip or passenger data", async ({ page }) => {
  const requestedTripData = [];
  await mockFlightApi(page);
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (/\/api\/(?:trips(?:\/|$)|passengers(?:\/|$))/.test(path)) requestedTripData.push(path);
  });
  await page.goto("/trip/%40%40%40/passengers");

  await expect(page.getByTestId("trip-availability-state-title")).toHaveText("Passenger information unavailable");
  await expect(page.getByText("We couldn’t find this trip. Go back to My Trips and try again.", { exact: true })).toBeVisible();
  expect(requestedTripData).toEqual([]);
});

async function acknowledgeJoin(page, { pet = false, submit = true } = {}) {
  await page.getByTestId("queue-ack-pet-policy").click();
  await page.getByTestId("queue-ack-cancellation-risk").click();
  await page.getByTestId("queue-ack-baggage-limit").click();
  await page.getByTestId("queue-ack-punctuality").click();
  await page.getByTestId(`bringing-pet-${pet ? "yes" : "no"}`).click();

  if (pet) {
    await page.getByTestId("pet-weight-lbs").fill("25");
    await page.getByTestId("pet-fee-acknowledgement").click();
  }

  if (submit) await page.getByText("I Acknowledge — Continue", { exact: true }).click();
}

test("pet, cancellation, and baggage acknowledgements start unchecked and are individually required", async ({ page }) => {
  await mockFlightApi(page);
  await page.goto("/queue/join?flightId=flight-1&fromCity=Seattle&toCity=San%20Francisco&from=BFI&to=SFO&international=0");

  const continueButton = page.getByTestId("queue-continue-button");
  await expect(continueButton).toBeDisabled();

  for (const id of ["pet-policy", "cancellation-risk", "baggage-limit"]) {
    const acknowledgement = page.getByTestId(`queue-ack-${id}`);
    await expect(acknowledgement).toHaveAttribute("aria-checked", "false");
    await acknowledgement.click();
    await expect(acknowledgement).toHaveAttribute("aria-checked", "true");
    await expect(continueButton).toBeDisabled();
  }

  await page.getByTestId("queue-ack-punctuality").click();
  await page.getByTestId("bringing-pet-no").click();
  await expect(continueButton).toBeEnabled();
});

test("pet queue joining uses the server default passenger behavior", async ({ page }) => {
  const api = await mockFlightApi(page);
  await page.goto("/queue/join?flightId=flight-1&fromCity=Seattle&toCity=San%20Francisco&from=BFI&to=SFO&international=0");

  await acknowledgeJoin(page, { pet: true });
  await expect(page).toHaveURL(/\/queue\/joined/);
  expect(api.getJoinBody()).not.toHaveProperty("passengers");
  expect(api.getJoinBody()).toMatchObject({ bringingPet: true });
});

test("international fee navigation does not carry a passenger count", async ({ page }) => {
  await mockFlightApi(page, { cachedUser: baseUser });
  await page.goto("/queue/join?flightId=flight-1&fromCity=Seattle&toCity=San%20Francisco&from=BFI&to=SFO&international=1&feeUsd=1000");

  await acknowledgeJoin(page);
  await expect(page).toHaveURL(/\/queue\/intl-notice/);
  expect(new URL(page.url()).searchParams.has("passengers")).toBe(false);
});

test("an existing waiting queue entry opens its real status without submitting another join", async ({ page }) => {
  const existingEntry = {
    id: "queue-entry-existing",
    flightId: "flight-1",
    flight,
    position: 2,
    totalInQueue: 4,
    status: "waiting",
    usedLinePass: false,
    usedFamilyPass: false,
    createdAt: new Date().toISOString(),
    bringingPet: false,
    petFeeAcknowledged: false,
    petWeightLbs: null,
    petCrateLengthIn: null,
    petCrateWidthIn: null,
    petCrateHeightIn: null,
  };
  const api = await mockFlightApi(page, {
    status: { status: "waiting", queueEntryId: existingEntry.id, queuePosition: 2, totalInQueue: 4 },
    queueEntries: [existingEntry],
  });
  await page.goto("/queue/join?flightId=flight-1&fromCity=Seattle&toCity=San%20Francisco&from=BFI&to=SFO&international=0");

  const continueButton = page.getByTestId("queue-continue-button");
  await expect(continueButton).toHaveText("View Queue Status");
  await expect(page.getByText(/already in this queue/i)).toBeVisible();
  await continueButton.click();

  await expect(page).toHaveURL(/\/queue\/status\?entryId=queue-entry-existing/);
  await expect(page.getByText("Queue Movement", { exact: true })).toBeVisible();
  await expect(page.getByText("2/4", { exact: true })).toBeVisible();
  expect(api.getJoinRequestCount()).toBe(0);
});

test("a failed queue join stays on acknowledgements and shows an error", async ({ page }) => {
  const api = await mockFlightApi(page, { joinErrorStatus: 503 });
  await page.goto("/queue/join?flightId=flight-1&fromCity=Seattle&toCity=San%20Francisco&from=BFI&to=SFO&international=0");
  await acknowledgeJoin(page);

  await expect(page).toHaveURL(/\/queue\/join/);
  await expect(page.getByText("Queue service is temporarily unavailable.", { exact: true })).toBeVisible();
  expect(api.getJoinRequestCount()).toBe(1);
});

test("two rapid join taps submit one request and show confirmation only after the API responds", async ({ page }) => {
  const api = await mockFlightApi(page, { joinDelayMs: 400 });
  await page.goto("/queue/join?flightId=flight-1&fromCity=Seattle&toCity=San%20Francisco&from=BFI&to=SFO&international=0");
  await acknowledgeJoin(page, { submit: false });

  const button = page.getByTestId("queue-continue-button");
  await button.click();
  await expect(button).toBeDisabled();
  expect(api.getJoinRequestCount()).toBe(1);
  await expect(page).toHaveURL(/\/queue\/joined/);
  expect(api.getJoinRequestCount()).toBe(1);
});

test("Trips opens the selected pending queue entry in Queue Status", async ({ page }) => {
  const entry = {
    id: "queue-entry-trip-link",
    flightId: "flight-1",
    flight,
    position: 2,
    totalInQueue: 4,
    status: "waiting",
    usedLinePass: false,
    usedFamilyPass: false,
    createdAt: new Date().toISOString(),
    bringingPet: false,
    petFeeAcknowledged: false,
    petWeightLbs: null,
    petCrateLengthIn: null,
    petCrateWidthIn: null,
    petCrateHeightIn: null,
  };
  await mockFlightApi(page, { queueEntries: [entry] });
  await page.goto("/trips");
  await page.getByText("Pending", { exact: true }).click();
  await expect(page.getByText("IN QUEUE · #2", { exact: true })).toBeVisible();
  await page.getByTestId("trip-card-open-details").click();

  await expect(page).toHaveURL(/\/queue\/status\?entryId=queue-entry-trip-link/);
  await expect(page.getByText("Queue Movement", { exact: true })).toBeVisible();
});