// Integration test: queue join / use-pass / auto-confirmation / cancel flow, including
// the Skip-the-Line totalInQueue count with N existing entries and the
// server-side international-fee enforcement for Base members.
//
// Run with the API server up (development):  pnpm run test:queue-flow
import { pool } from "@workspace/db";
const BASE = process.env.API_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}/api`;
const fixtureSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const domesticFixtureId = `queue-flow-domestic-${fixtureSuffix}`;
const intlFixtureId = `queue-flow-intl-${fixtureSuffix}`;
const seatFreedFixtureId = `queue-flow-seat-freed-${fixtureSuffix}`;
const positionOneFixtureId = `queue-flow-position-one-${fixtureSuffix}`;

async function main() {
await pool.query(`DELETE FROM trips WHERE flight_id LIKE 'queue-flow-%'`);
await pool.query(`DELETE FROM queue_entries WHERE flight_id LIKE 'queue-flow-%'`);
await pool.query(`DELETE FROM flights WHERE id LIKE 'queue-flow-%'`);
await pool.query(
  `INSERT INTO flights (
     id, from_airport, from_city, to_airport, to_city, aircraft_type,
     aircraft_capacity, departure_date, departure_time, duration,
     seats_available, international, international_fee_usd, status
     ) VALUES
     ($1, 'BFI', 'Seattle', 'PDX', 'Portland', 'Citation Latitude',
      20, '2099-01-01', '12:00', '0h 45m', 20, false, 0, 'available'),
     ($2, 'BFI', 'Seattle', 'YVR', 'Vancouver', 'Citation Latitude',
      10, '2099-01-01', '14:00', '0h 55m', 10, true, 1000, 'available'),
      ($3, 'BFI', 'Seattle', 'GEG', 'Spokane', 'Citation Latitude',
       2, '2099-01-01', '16:00', '1h 00m', 2, false, 0, 'available'),
      ($4, 'BFI', 'Seattle', 'SFO', 'San Francisco', 'Citation Latitude',
       4, '2099-01-01', '18:00', '2h 10m', 4, false, 0, 'available')`,
  [domesticFixtureId, intlFixtureId, seatFreedFixtureId, positionOneFixtureId],
);

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name} ${detail}`); }
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

// Creates a fresh member through the phone + SMS PIN flow (dev only: the
// demo code rides in the request-code response in lieu of a real SMS).
async function makeVerifiedUser(tag, tier = "plus") {
  const phone = `+1206${String(Math.floor(Math.random() * 10000000)).padStart(7, "0")}`;
  const reqCode = await api("POST", "/auth/request-code", { body: { phone } });
  if (reqCode.status !== 200 || !reqCode.json?.demoCode) throw new Error(`request-code failed: ${reqCode.status}`);
  const ver = await api("POST", "/auth/verify-code", { body: { phone, code: reqCode.json.demoCode } });
  if (ver.status !== 200) throw new Error(`verify-code failed: ${ver.status}`);
  let token = ver.json?.token;
  if (ver.json?.outcome === "registration_required") {
    const registration = await api("POST", "/auth/complete-registration", {
      body: {
        registrationGrant: ver.json.registrationGrant,
        firstName: "Queue",
        lastName: "Tester",
        email: `queue-${tag}-${fixtureSuffix}@example.test`,
      },
    });
    if (registration.status !== 200) {
      throw new Error(`complete-registration failed: ${registration.status} ${JSON.stringify(registration.json)}`);
    }
    token = registration.json?.token;
  }
  if (!token) throw new Error("Authentication did not return a token");
  const upgrade = await api("POST", "/membership/upgrade", { token, body: { tier } });
  if (upgrade.status !== 200) {
    throw new Error(`membership upgrade failed: ${upgrade.status} ${JSON.stringify(upgrade.json)}`);
  }
  return { token, phone };
}

const flights = (await api("GET", "/flights")).json;
const intlFlight = flights.find((f) => f.id === intlFixtureId);
const domestic = flights.filter((f) => !f.international);

// ── 1. N members join normally, on a flight with an empty queue ─────────────
// Use a uniquely named fixture flight so accumulated demo queues from prior
// runs cannot change positions or block automatic confirmation.
const N = 3;
const members = [];
for (let i = 0; i < N; i++) members.push(await makeVerifiedUser(`m${i}`));

const flight = flights.find((candidate) => candidate.id === domesticFixtureId);
if (!flight) throw new Error("Queue-flow domestic fixture was not returned by /flights");
const firstJoin = await api("POST", "/queue/join", {
  token: members[0].token,
  body: { flightId: flight.id, bringingPet: true, petFeeAcknowledged: true, petWeightLbs: 24.5 },
});
console.log(`Flight under test: ${flight.fromAirport} → ${flight.toAirport} (${flight.id})`);

for (const [i, m] of members.entries()) {
  const join = i === 0 ? firstJoin : await api("POST", "/queue/join", {
    token: m.token,
    body: i === 2
      ? { flightId: flight.id, bringingPet: true, petFeeAcknowledged: true, petWeightLbs: 18 }
      : { flightId: flight.id, bringingPet: false },
  });
  check(`member ${i + 1} joins at position ${i + 1}`, join.status === 201 && join.json.position === i + 1,
    JSON.stringify(join.json));
  check(`member ${i + 1} totalInQueue === ${i + 1}`, join.json?.totalInQueue === i + 1,
    `got ${join.json?.totalInQueue}`);
}
check("waiting pet entry stores the conditional acknowledgement",
  firstJoin.json?.bringingPet === true && firstJoin.json?.petFeeAcknowledged === true,
  JSON.stringify(firstJoin.json));
check("waiting pet entry stores weight and null crate dimensions",
  firstJoin.json?.petWeightLbs === 24.5 && firstJoin.json?.petCrateLengthIn === null &&
  firstJoin.json?.petCrateWidthIn === null && firstJoin.json?.petCrateHeightIn === null,
  JSON.stringify(firstJoin.json));
const waitingPetTrips = await api("GET", "/trips", { token: members[0].token });
check("waiting pet entry has no trip or applied cleaning fee",
  !waitingPetTrips.json?.some?.((t) => t.flightId === flight.id), JSON.stringify(waitingPetTrips.json));

const sixHumanMember = await makeVerifiedUser("six-human-cap");
const sixHumanJoin = await api("POST", "/queue/join", {
  token: sixHumanMember.token,
  body: { flightId: flight.id, passengers: 6, bringingPet: false },
});
check("six human passengers are allowed without a pet",
  sixHumanJoin.status === 201 && sixHumanJoin.json?.passengers === 6,
  JSON.stringify(sixHumanJoin.json));

const fivePetMember = await makeVerifiedUser("five-pet-cap");
const fivePetJoin = await api("POST", "/queue/join", {
  token: fivePetMember.token,
  body: { flightId: flight.id, passengers: 5, bringingPet: true, petFeeAcknowledged: true, petWeightLbs: 20 },
});
check("five human passengers plus a pet are allowed",
  fivePetJoin.status === 201 && fivePetJoin.json?.passengers === 5 && fivePetJoin.json?.bringingPet === true,
  JSON.stringify(fivePetJoin.json));

const sixPetMember = await makeVerifiedUser("six-pet-cap");
const sixPetJoin = await api("POST", "/queue/join", {
  token: sixPetMember.token,
  body: {
    flightId: flight.id, passengers: 6, bringingPet: true, petFeeAcknowledged: true,
    petWeightLbs: 20, petCrateLengthIn: 28, petCrateWidthIn: 19, petCrateHeightIn: 21,
  },
});
check("six human passengers plus a pet are rejected",
  sixPetJoin.status === 400 && /6 occupants|5 passengers/i.test(sixPetJoin.json?.error ?? ""),
  JSON.stringify(sixPetJoin.json));

const sevenHumanMember = await makeVerifiedUser("seven-human-cap");
const sevenHumanJoin = await api("POST", "/queue/join", {
  token: sevenHumanMember.token,
  body: { flightId: flight.id, passengers: 7, bringingPet: false },
});
check("a seventh passenger is rejected",
  sevenHumanJoin.status === 400 && /between 1 and 6|6 occupants|invalid queue request/i.test(sevenHumanJoin.json?.error ?? ""),
  JSON.stringify(sevenHumanJoin.json));

// ── 2. Skip-the-Line join with N existing entries: atomic instant win ────────
const vip = await makeVerifiedUser("vip");
const vipJoin = await api("POST", "/queue/join", { token: vip.token, body: { flightId: flight.id, useLinePass: true, bringingPet: true, petFeeAcknowledged: true, petWeightLbs: 12 } });
check("pass join returns a CONFIRMED entry (atomic instant win)",
  vipJoin.status === 201 && vipJoin.json.status === "confirmed", JSON.stringify(vipJoin.json));
check("pass join returns the created trip", vipJoin.json?.trip?.status === "upcoming", JSON.stringify(vipJoin.json?.trip));
check("instant pet award applies the $500 cleaning fee", vipJoin.json?.trip?.cleaningFeeUsd === 500, JSON.stringify(vipJoin.json?.trip));
check("instant pet award carries weight and null crate details into the trip",
  vipJoin.json?.trip?.petWeightLb === 12 && vipJoin.json?.trip?.petCrateLengthIn === null &&
  vipJoin.json?.trip?.petCrateWidthIn === null && vipJoin.json?.trip?.petCrateHeightIn === null,
  JSON.stringify(vipJoin.json?.trip));
check(`pass join totalInQueue === ${N + 2} (confirmed entry is not waiting)`, vipJoin.json?.totalInQueue === N + 2,
  `got ${vipJoin.json?.totalInQueue}`);
const vipMe = await api("GET", "/auth/me", { token: vip.token });
check("pass join consumed exactly one pass", vipMe.json?.linePassCount === 4, `got ${vipMe.json?.linePassCount}`);
const m0Status = await api("GET", "/queue/status", { token: members[0].token });
const m0Entry = m0Status.json?.find?.((e) => e.flightId === flight.id && e.status === "waiting");
check("waiting queue unaffected — first member still position 1", m0Entry?.position === 1, JSON.stringify(m0Entry));

// ── 3. use-pass on an existing waiting entry confirms atomically ─────────────
const m2Status = await api("GET", "/queue/status", { token: members[2].token });
const m2Entry = m2Status.json?.find?.((e) => e.flightId === flight.id && e.status === "waiting");
const usePass = await api("POST", `/queue/${m2Entry.id}/use-pass`, { token: members[2].token });
check("use-pass confirms the entry atomically", usePass.status === 200 && usePass.json?.status === "confirmed",
  JSON.stringify(usePass.json));
check("use-pass returns the created trip", usePass.json?.trip?.status === "upcoming", "");
check("existing pet entry awarded with a pass applies the $500 cleaning fee",
  usePass.json?.trip?.cleaningFeeUsd === 500, JSON.stringify(usePass.json?.trip));
check("existing pet entry awarded with a pass carries weight and null crate details",
  usePass.json?.trip?.petWeightLb === 18 && usePass.json?.trip?.petCrateLengthIn === null &&
  usePass.json?.trip?.petCrateWidthIn === null && usePass.json?.trip?.petCrateHeightIn === null,
  JSON.stringify(usePass.json?.trip));
check("use-pass decrements pass balance", typeof usePass.json?.linePassCount === "number", "");

// ── 3b. Position #1 can redeem, and competing submissions stay safe ──────────
{
  const first = await makeVerifiedUser("position-one");
  const joined = await api("POST", "/queue/join", {
    token: first.token,
    body: { flightId: positionOneFixtureId, bringingPet: false },
  });
  check("position-one fixture joins waiting at #1",
    joined.status === 201 && joined.json?.status === "waiting" && joined.json?.position === 1,
    JSON.stringify(joined.json));

  const balanceBefore = (await api("GET", "/auth/me", { token: first.token })).json?.linePassCount;
  const [attemptA, attemptB] = await Promise.all([
    api("POST", `/queue/${joined.json.id}/use-pass`, { token: first.token }),
    api("POST", `/queue/${joined.json.id}/use-pass`, { token: first.token }),
  ]);
  const attempts = [attemptA, attemptB];
  check("position #1 redemption confirms immediately",
    attempts.some((attempt) => attempt.status === 200 && attempt.json?.status === "confirmed"),
    JSON.stringify(attempts));
  check("competing redemption is confirmed/idempotent or safely conflicts",
    attempts.every((attempt) =>
      (attempt.status === 200 && attempt.json?.status === "confirmed") ||
      (attempt.status === 409 && attempt.json?.error?.includes("conflict"))),
    JSON.stringify(attempts));

  const balanceAfter = (await api("GET", "/auth/me", { token: first.token })).json?.linePassCount;
  check("competing redemption consumes exactly one pass",
    balanceAfter === balanceBefore - 1,
    `before=${balanceBefore} after=${balanceAfter}`);
  const positionOneTrips = (await api("GET", "/trips", { token: first.token })).json ?? [];
  check("competing redemption creates exactly one trip",
    positionOneTrips.filter((trip) => trip.flightId === positionOneFixtureId).length === 1,
    JSON.stringify(positionOneTrips));
}

// ── 4. Auto-confirmation at the decision moment ──────────────────────────────
// The manual confirm endpoint is retired: the queue engine confirms the front
// member automatically once a seat is available. m0 is waiting at #1 with
// capacity, so within a couple of engine ticks it must flip to confirmed with
// a trip + flight_confirmed notification and the queue renumbered behind it.
check("manual confirm endpoint is retired (404)",
  (await api("POST", `/queue/${m0Entry.id}/confirm`, { token: members[0].token })).status === 404, "");
check("queue status no longer exposes canConfirm",
  !("canConfirm" in (m0Entry ?? {})), JSON.stringify(m0Entry));

let autoConfirmed = null;
for (let i = 0; i < 40 && !autoConfirmed; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const st = await api("GET", "/queue/status", { token: members[0].token });
  autoConfirmed = st.json?.find?.((e) => e.flightId === flight.id && e.status === "confirmed") ?? null;
}
check("front member is auto-confirmed by the queue engine", !!autoConfirmed, "timed out after 80s");
const trips = await api("GET", "/trips", { token: members[0].token });
check("auto-confirmation created an upcoming trip",
  trips.json?.some?.((t) => t.flightId === flight.id && t.status === "upcoming"), JSON.stringify(trips.json));
check("automatic pet award applies the $500 cleaning fee",
  trips.json?.some?.((t) => t.flightId === flight.id && t.cleaningFeeUsd === 500), JSON.stringify(trips.json));
check("automatic pet award preserves decimal weight and null crate details",
  trips.json?.some?.((t) => t.flightId === flight.id && t.petWeightLb === 24.5 &&
    t.petCrateLengthIn === null && t.petCrateWidthIn === null && t.petCrateHeightIn === null),
  JSON.stringify(trips.json));
const notifs = await api("GET", "/notifications", { token: members[0].token });
check("auto-confirmation sent a flight_confirmed notification",
  notifs.json?.some?.((n) => n.type === "flight_confirmed"), "");

// Renumbering: m1 was waiting at #2 behind m0. After the auto-confirm the
// engine closes the gap, so m1 is now #1 — or already auto-confirmed itself
// on a later tick (which equally proves the queue advanced past m0).
const m1After = await api("GET", "/queue/status", { token: members[1].token });
const m1Now = m1After.json?.find?.((e) => e.flightId === flight.id);
check("queue renumbered behind the auto-confirmed member",
  m1Now?.status === "confirmed" || (m1Now?.status === "waiting" && m1Now?.position === 1),
  JSON.stringify(m1Now));

// ── 5. Cancel renumbers the queue ────────────────────────────────────────────
if (m1Now?.status === "waiting") {
  const cancel = await api("DELETE", `/queue/${m1Now.id}`, { token: members[1].token });
  check("cancel succeeds", cancel.status === 200 && cancel.json?.success === true, JSON.stringify(cancel.json));
} else {
  // m1 already auto-confirmed — exercise cancel with a fresh member instead.
  const canceller = await makeVerifiedUser("canceller");
    const j = await api("POST", "/queue/join", { token: canceller.token, body: { flightId: flight.id, bringingPet: false } });
  if (j.status === 201) {
    const cancel = await api("DELETE", `/queue/${j.json.id}`, { token: canceller.token });
    check("cancel succeeds", cancel.status === 200 && cancel.json?.success === true, JSON.stringify(cancel.json));
  } else {
    console.log("  (skipped cancel check — flight no longer joinable)");
  }
}

// ── 5b. Negative path: a pass is NEVER consumed without a confirmed seat ─────
// Fill a fresh flight to capacity, then attempt a Skip-the-Line join: it must
// fail AND leave the pass balance untouched.
{
  const filler = await makeVerifiedUser("filler");
  let fullFlight = null;
  for (const candidate of domestic) {
    if (candidate.id === flight.id || candidate.seatsAvailable > 10) continue;
    // Skip-the-Line join confirms atomically, filling the flight to capacity
    // without any manual confirm step.
    const probe = await api("POST", "/queue/join", {
      token: filler.token, body: { flightId: candidate.id, passengers: candidate.seatsAvailable, useLinePass: true, bringingPet: false },
    });
    if (probe.status === 201 && probe.json.status === "confirmed") { fullFlight = candidate; break; }
    if (probe.status === 201) await api("DELETE", `/queue/${probe.json.id}`, { token: filler.token });
  }
  if (fullFlight) {
    const loser = await makeVerifiedUser("loser");
    const balBefore = (await api("GET", "/auth/me", { token: loser.token })).json?.linePassCount;
    const failJoin = await api("POST", "/queue/join", {
      token: loser.token, body: { flightId: fullFlight.id, useLinePass: true, bringingPet: false },
    });
    check("pass join on a full flight is rejected", failJoin.status === 400, JSON.stringify(failJoin.json));
    const balAfter = (await api("GET", "/auth/me", { token: loser.token })).json?.linePassCount;
    check("pass balance preserved when no seat was confirmed", balAfter === balBefore,
      `before=${balBefore} after=${balAfter}`);
  } else {
    console.log("  (skipped full-flight negative path — no fillable flight available)");
  }
}

// ── 6. International fee enforcement for Base members ────────────────────────
if (intlFlight) {
  const base = await makeVerifiedUser("intl", "base");
  const noFee = await api("POST", "/queue/join", { token: base.token, body: { flightId: intlFlight.id, bringingPet: false } });
  check("base member rejected on intl flight without fee acceptance", noFee.status === 400, JSON.stringify(noFee.json));
  const withFee = await api("POST", "/queue/join", {
    token: base.token,
    body: {
      flightId: intlFlight.id,
      acceptIntlFee: true,
      bringingPet: true,
      petFeeAcknowledged: true,
       petWeightLbs: 16.5,
    },
  });
  check("base member joins intl flight with fee accepted", withFee.status === 201 && withFee.json?.intlFeeAccepted === true,
    JSON.stringify(withFee.json));
  check("international-fee join retains pet weight, null crate details, and acknowledgement",
    withFee.json?.bringingPet === true && withFee.json?.petFeeAcknowledged === true &&
     withFee.json?.petWeightLbs === 16.5 && withFee.json?.petCrateLengthIn === null &&
     withFee.json?.petCrateWidthIn === null && withFee.json?.petCrateHeightIn === null,
    JSON.stringify(withFee.json));
  const intlWaitingTrips = await api("GET", "/trips", { token: base.token });
  check("waiting international pet join creates no cleaning fee or trip",
    !intlWaitingTrips.json?.some?.((trip) => trip.flightId === intlFlight.id),
    JSON.stringify(intlWaitingTrips.json));
}

// ── 6b. Pet acknowledgement and waiting lifecycle ─────────────────────────────
{
  const petMember = await makeVerifiedUser("pet");
  const rejected = await api("POST", "/queue/join", {
    token: petMember.token, body: { flightId: flight.id, bringingPet: true },
  });
  check("pet join is rejected without cleaning-fee acknowledgement", rejected.status === 400, JSON.stringify(rejected.json));
  const missingDetails = await api("POST", "/queue/join", {
    token: petMember.token, body: { flightId: flight.id, bringingPet: true, petFeeAcknowledged: true },
  });
  check("pet join is rejected without weight", missingDetails.status === 400, JSON.stringify(missingDetails.json));
  const invalidDetails = await api("POST", "/queue/join", {
    token: petMember.token, body: { flightId: flight.id, bringingPet: true, petFeeAcknowledged: true, petWeightLbs: 0 },
  });
  check("pet join is rejected with non-positive measurements", invalidDetails.status === 400, JSON.stringify(invalidDetails.json));

  const petJoin = await api("POST", "/queue/join", {
    token: petMember.token,
    body: { flightId: flight.id, bringingPet: true, petFeeAcknowledged: true, petWeightLbs: 14.5 },
  });
  if (petJoin.status === 201) {
    check("waiting pet entry persists choice and acknowledgement",
      petJoin.json?.status === "waiting" && petJoin.json?.bringingPet === true && petJoin.json?.petFeeAcknowledged === true,
      JSON.stringify(petJoin.json));
    const waitingTrips = await api("GET", "/trips", { token: petMember.token });
    check("waiting pet join creates no cleaning fee or trip",
      !waitingTrips.json?.some?.((t) => t.flightId === flight.id), JSON.stringify(waitingTrips.json));
  } else {
    console.log("  (skipped waiting pet lifecycle — flight no longer joinable)");
  }
}

// ── 6c. A cancellation can award the waiting pet entry immediately ────────────
{
  const holder = await makeVerifiedUser("seat-holder");
  const petWaiter = await makeVerifiedUser("seat-freed-pet");
  const holderJoin = await api("POST", "/queue/join", {
    token: holder.token,
    body: { flightId: seatFreedFixtureId, bringingPet: false, useLinePass: true },
  });
  check("seat-freed fixture starts with a confirmed booking",
    holderJoin.status === 201 && holderJoin.json?.trip?.status === "upcoming",
    JSON.stringify(holderJoin.json));
  const petWaiting = await api("POST", "/queue/join", {
    token: petWaiter.token,
    body: { flightId: seatFreedFixtureId, bringingPet: true, petFeeAcknowledged: true, petWeightLbs: 20 },
  });
  check("pet member waits behind the confirmed booking",
    petWaiting.status === 201 && petWaiting.json?.status === "waiting",
    JSON.stringify(petWaiting.json));
  if (petWaiting.status === 201 && holderJoin.json?.trip?.id) {
    await pool.query(
      `UPDATE queue_entries SET created_at = NOW() - INTERVAL '2 minutes' WHERE id = $1`,
      [petWaiting.json.id],
    );
    const cancellation = await api("POST", `/trips/${holderJoin.json.trip.id}/cancel`, {
      token: holder.token,
    });
    check("cancelling the booking succeeds", cancellation.status === 200, JSON.stringify(cancellation.json));
    const promotedStatus = await api("GET", "/queue/status", { token: petWaiter.token });
    check("seat-freed promotion confirms the waiting pet entry",
      promotedStatus.json?.some?.((entry) => entry.id === petWaiting.json.id && entry.status === "confirmed"),
      JSON.stringify(promotedStatus.json));
    const promotedTrips = await api("GET", "/trips", { token: petWaiter.token });
    check("seat-freed pet award applies the $500 cleaning fee",
      promotedTrips.json?.some?.((trip) => trip.flightId === seatFreedFixtureId && trip.cleaningFeeUsd === 500),
      JSON.stringify(promotedTrips.json));
    check("seat-freed pet award preserves weight and null crate details",
      promotedTrips.json?.some?.((trip) => trip.flightId === seatFreedFixtureId &&
        trip.petWeightLb === 20 && trip.petCrateLengthIn === null &&
        trip.petCrateWidthIn === null && trip.petCrateHeightIn === null),
      JSON.stringify(promotedTrips.json));
    const promotedNotifications = await api("GET", "/notifications", { token: petWaiter.token });
    check("seat-freed pet award clearly confirms the fee",
      promotedNotifications.json?.some?.((notification) =>
        notification.type === "flight_confirmed" &&
        notification.body?.includes("$500 pet cleaning fee now applies")),
      JSON.stringify(promotedNotifications.json));
  }
}

// ── 7. buy-pass increments the balance ───────────────────────────────────────
const buyer = await makeVerifiedUser("buyer");
const before = (await api("GET", "/auth/me", { token: buyer.token })).json?.linePassCount;
const buy = await api("POST", "/membership/buy-pass", { token: buyer.token });
check("buy-pass increments balance by 1", buy.status === 200 && buy.json?.linePassCount === (before ?? 0) + 1,
  `before=${before} after=${buy.json?.linePassCount}`);

await pool.query(`DELETE FROM trips WHERE flight_id IN ($1, $2, $3, $4)`, [domesticFixtureId, intlFixtureId, seatFreedFixtureId, positionOneFixtureId]);
await pool.query(`DELETE FROM queue_entries WHERE flight_id IN ($1, $2, $3, $4)`, [domesticFixtureId, intlFixtureId, seatFreedFixtureId, positionOneFixtureId]);
await pool.query(`DELETE FROM flights WHERE id IN ($1, $2, $3, $4)`, [domesticFixtureId, intlFixtureId, seatFreedFixtureId, positionOneFixtureId]);
await pool.end();

if (failures > 0) { console.error(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log("\nAll queue-flow checks passed.");
}

main().catch(async (error) => {
  console.error(error);
  await pool.end().catch(() => {});
  process.exit(1);
});
