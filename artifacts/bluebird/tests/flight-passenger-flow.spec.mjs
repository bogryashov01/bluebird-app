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

async function mockFlightApi(page, { status = { status: "none" }, cachedUser = user } = {}) {
  let joinBody;

  await page.addInitScript(({ cachedUser }) => {
    localStorage.setItem("bluebird_token", "mobile-flight-flow-test-token");
    localStorage.setItem("bluebird_user", JSON.stringify(cachedUser));
  }, { cachedUser });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === "/api/auth/me") return route.fulfill({ json: cachedUser });
    if (path === "/api/queue/status") return route.fulfill({ json: [] });
    if (path === "/api/flights/flight-1") return route.fulfill({ json: flight });
    if (path === "/api/flights/flight-1/my-status") return route.fulfill({ json: status });
    if (path === "/api/networking/flights/flight-1/front-member") {
      return route.fulfill({ json: { eligible: false } });
    }
    if (path === "/api/trips/trip-1/manifest") {
      return route.fulfill({
        json: {
          tripId: "trip-1",
          requiredCount: 1,
          passengers: [],
          pet: null,
          bringingPet: false,
        },
      });
    }
    if (path === "/api/passengers") return route.fulfill({ json: [] });
    if (path === "/api/queue/join" && request.method() === "POST") {
      joinBody = request.postDataJSON();
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

  return { getJoinBody: () => joinBody };
}

test("flight details defer passenger selection until after confirmation", async ({ page }) => {
  await mockFlightApi(page);
  await page.goto("/flight/flight-1");

  await expect(page.getByText("Citation CJ3", { exact: true })).toBeVisible();
  await expect(page.getByText("Passengers", { exact: true })).toHaveCount(0);
  await expect(page.getByText("View Flight Policy & Terms", { exact: true })).toBeVisible();

  await page.getByText("Request to Join", { exact: true }).click();
  await expect(page).toHaveURL(/\/queue\/join/);
  expect(new URL(page.url()).searchParams.has("passengers")).toBe(false);
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

async function acknowledgeJoin(page, { pet = false } = {}) {
  await page.getByText("Flights may be cancelled or changed due to operational requirements.", { exact: true }).click();
  await page.getByText("Baggage allowance is 25 kg per passenger, subject to aircraft capacity and operational limitations.", { exact: true }).click();
  await page.getByRole("checkbox").first().click();
  await page.getByTestId(`bringing-pet-${pet ? "yes" : "no"}`).click();

  if (pet) {
    await page.getByTestId("pet-weight-lbs").fill("25");
    await page.getByTestId("pet-fee-acknowledgement").click();
  }

  await page.getByText("I Acknowledge — Continue", { exact: true }).click();
}

test("pet queue joining uses the server default passenger behavior", async ({ page }) => {
  const api = await mockFlightApi(page);
  await page.goto("/queue/join?flightId=flight-1&fromCity=Seattle&toCity=San%20Francisco&from=BFI&to=SFO&international=0");

  await acknowledgeJoin(page, { pet: true });
  await expect(page).toHaveURL(/\/queue\/joined/);
  expect(api.getJoinBody()).not.toHaveProperty("passengers");
  expect(api.getJoinBody()).toMatchObject({ bringingPet: true });
});

test("international hold navigation does not carry a passenger count", async ({ page }) => {
  await mockFlightApi(page, { cachedUser: baseUser });
  await page.goto("/queue/join?flightId=flight-1&fromCity=Seattle&toCity=San%20Francisco&from=BFI&to=SFO&international=1&feeUsd=1000");

  await acknowledgeJoin(page);
  await expect(page).toHaveURL(/\/queue\/intl-notice/);
  expect(new URL(page.url()).searchParams.has("passengers")).toBe(false);
});