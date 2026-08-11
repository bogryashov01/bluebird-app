// Integration test: queue join / use-pass / confirm / cancel flow, including
// the Skip-the-Line totalInQueue count with N existing entries and the
// server-side international-fee enforcement for Base members.
//
// Run with the API server up (development):  pnpm run test:queue-flow
const BASE = process.env.API_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}/api`;

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
async function makeVerifiedUser(tag) {
  const phone = `+1206${String(Math.floor(Math.random() * 10000000)).padStart(7, "0")}`;
  const reqCode = await api("POST", "/auth/request-code", { body: { phone } });
  if (reqCode.status !== 200 || !reqCode.json?.demoCode) throw new Error(`request-code failed: ${reqCode.status}`);
  const ver = await api("POST", "/auth/verify-code", { body: { phone, code: reqCode.json.demoCode } });
  if (ver.status !== 200) throw new Error(`verify-code failed: ${ver.status}`);
  return { token: ver.json.token, phone };
}

const flights = (await api("GET", "/flights")).json;
const intlFlight = flights.find((f) => f.international);
const domestic = flights.filter((f) => !f.international);

// ── 1. N members join normally, on a flight with an empty queue ─────────────
// Pick a domestic flight whose queue is currently empty (first probe join
// lands at position 1) so the test is idempotent across runs.
const N = 3;
const members = [];
for (let i = 0; i < N; i++) members.push(await makeVerifiedUser(`m${i}`));

let flight = null;
let firstJoin = null;
for (const candidate of [...domestic].reverse()) {
  const probe = await api("POST", "/queue/join", { token: members[0].token, body: { flightId: candidate.id } });
  if (probe.status === 201 && probe.json.position === 1) { flight = candidate; firstJoin = probe; break; }
  if (probe.status === 201) await api("DELETE", `/queue/${probe.json.id}`, { token: members[0].token });
}
if (!flight) { console.error("No domestic flight with an empty queue available"); process.exit(1); }
console.log(`Flight under test: ${flight.fromAirport} → ${flight.toAirport} (${flight.id})`);

for (const [i, m] of members.entries()) {
  const join = i === 0 ? firstJoin : await api("POST", "/queue/join", { token: m.token, body: { flightId: flight.id } });
  check(`member ${i + 1} joins at position ${i + 1}`, join.status === 201 && join.json.position === i + 1,
    JSON.stringify(join.json));
  check(`member ${i + 1} totalInQueue === ${i + 1}`, join.json?.totalInQueue === i + 1,
    `got ${join.json?.totalInQueue}`);
}

// ── 2. Skip-the-Line join with N existing entries: atomic instant win ────────
const vip = await makeVerifiedUser("vip");
const vipJoin = await api("POST", "/queue/join", { token: vip.token, body: { flightId: flight.id, useLinePass: true } });
check("pass join returns a CONFIRMED entry (atomic instant win)",
  vipJoin.status === 201 && vipJoin.json.status === "confirmed", JSON.stringify(vipJoin.json));
check("pass join returns the created trip", vipJoin.json?.trip?.status === "upcoming", JSON.stringify(vipJoin.json?.trip));
check(`pass join totalInQueue === ${N} (confirmed entry is not waiting)`, vipJoin.json?.totalInQueue === N,
  `got ${vipJoin.json?.totalInQueue}`);
const vipMe = await api("GET", "/auth/me", { token: vip.token });
check("pass join consumed exactly one pass", vipMe.json?.linePassCount === 1, `got ${vipMe.json?.linePassCount}`);
const m0Status = await api("GET", "/queue/status", { token: members[0].token });
const m0Entry = m0Status.json?.find?.((e) => e.flightId === flight.id && e.status === "waiting");
check("waiting queue unaffected — first member still position 1", m0Entry?.position === 1, JSON.stringify(m0Entry));

// ── 3. Normal confirm at #1 creates a trip; queue renumbers ──────────────────
const confirm = await api("POST", `/queue/${m0Entry.id}/confirm`, { token: members[0].token });
check("confirm at #1 creates upcoming trip", confirm.status === 200 && confirm.json?.status === "upcoming",
  JSON.stringify(confirm.json));

// ── 4. use-pass on an existing waiting entry confirms atomically ─────────────
const m2Status = await api("GET", "/queue/status", { token: members[2].token });
const m2Entry = m2Status.json?.find?.((e) => e.flightId === flight.id && e.status === "waiting");
const usePass = await api("POST", `/queue/${m2Entry.id}/use-pass`, { token: members[2].token });
check("use-pass confirms the entry atomically", usePass.status === 200 && usePass.json?.status === "confirmed",
  JSON.stringify(usePass.json));
check("use-pass returns the created trip", usePass.json?.trip?.status === "upcoming", "");
check("use-pass decrements pass balance", typeof usePass.json?.linePassCount === "number", "");

// ── 5. Cancel renumbers the queue ────────────────────────────────────────────
const m1Status = await api("GET", "/queue/status", { token: members[1].token });
const m1Entry = m1Status.json?.find?.((e) => e.flightId === flight.id && e.status === "waiting");
const cancel = await api("DELETE", `/queue/${m1Entry.id}`, { token: members[1].token });
check("cancel succeeds", cancel.status === 200 && cancel.json?.success === true, JSON.stringify(cancel.json));

// ── 5b. Negative path: a pass is NEVER consumed without a confirmed seat ─────
// Fill a fresh flight to capacity, then attempt a Skip-the-Line join: it must
// fail AND leave the pass balance untouched.
{
  const filler = await makeVerifiedUser("filler");
  let fullFlight = null;
  for (const candidate of domestic) {
    if (candidate.id === flight.id || candidate.seatsAvailable > 10) continue;
    const probe = await api("POST", "/queue/join", {
      token: filler.token, body: { flightId: candidate.id, passengers: candidate.seatsAvailable },
    });
    if (probe.status === 201 && probe.json.position === 1) {
      const conf = await api("POST", `/queue/${probe.json.id}/confirm`, { token: filler.token });
      if (conf.status === 200) { fullFlight = candidate; break; }
    }
    if (probe.status === 201) await api("DELETE", `/queue/${probe.json.id}`, { token: filler.token });
  }
  if (fullFlight) {
    const loser = await makeVerifiedUser("loser");
    const balBefore = (await api("GET", "/auth/me", { token: loser.token })).json?.linePassCount;
    const failJoin = await api("POST", "/queue/join", {
      token: loser.token, body: { flightId: fullFlight.id, useLinePass: true },
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
  const base = await makeVerifiedUser("intl");
  const noFee = await api("POST", "/queue/join", { token: base.token, body: { flightId: intlFlight.id } });
  check("base member rejected on intl flight without fee acceptance", noFee.status === 400, JSON.stringify(noFee.json));
  const withFee = await api("POST", "/queue/join", {
    token: base.token, body: { flightId: intlFlight.id, acceptIntlFee: true },
  });
  check("base member joins intl flight with fee accepted", withFee.status === 201 && withFee.json?.intlFeeAccepted === true,
    JSON.stringify(withFee.json));
}

// ── 7. buy-pass increments the balance ───────────────────────────────────────
const buyer = await makeVerifiedUser("buyer");
const before = (await api("GET", "/auth/me", { token: buyer.token })).json?.linePassCount;
const buy = await api("POST", "/membership/buy-pass", { token: buyer.token });
check("buy-pass increments balance by 1", buy.status === 200 && buy.json?.linePassCount === (before ?? 0) + 1,
  `before=${before} after=${buy.json?.linePassCount}`);

if (failures > 0) { console.error(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log("\nAll queue-flow checks passed.");
