/**
 * Integration coverage for Family/Corporate membership ownership, invitations,
 * allocations, separate personal passes, and lifecycle access loss.
 *
 * Run with the API server up: pnpm run test:family-flow
 */
import { pool } from "@workspace/db";

const BASE = process.env.API_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}/api`;
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const familyFlight = `family-flow-${suffix}`;
let failures = 0;

function check(name, condition, detail = "") {
  if (condition) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function api(method, path, { token, body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

async function makeUser(tag, tier = null) {
  const phone = `+1206${String(Math.floor(Math.random() * 10000000)).padStart(7, "0")}`;
  const email = `family-${tag}-${suffix}@example.test`;
  const code = await api("POST", "/auth/request-code", { body: { phone } });
  const verified = await api("POST", "/auth/verify-code", { body: { phone, code: code.json?.demoCode } });
  const registration = await api("POST", "/auth/complete-registration", {
    body: { registrationGrant: verified.json?.registrationGrant, firstName: "Family", lastName: tag, email },
  });
  if (registration.status !== 200) throw new Error(`registration failed: ${registration.status} ${JSON.stringify(registration.json)}`);
  const result = { token: registration.json.token, email, userId: registration.json.user.id };
  if (tier) {
    const upgrade = await api("POST", "/membership/upgrade", { token: result.token, body: { tier } });
    if (upgrade.status !== 200) throw new Error(`upgrade failed: ${upgrade.status} ${JSON.stringify(upgrade.json)}`);
  }
  return result;
}

async function main() {
try {
  await pool.query(`DELETE FROM trips WHERE flight_id = $1`, [familyFlight]);
  await pool.query(`DELETE FROM queue_entries WHERE flight_id = $1`, [familyFlight]);
  await pool.query(`DELETE FROM flights WHERE id = $1`, [familyFlight]);
  await pool.query(`
    INSERT INTO flights (
      id, from_airport, from_city, to_airport, to_city, aircraft_type,
      aircraft_capacity, departure_date, departure_time, duration,
      seats_available, international, international_fee_usd, status
    ) VALUES ($1, 'BFI', 'Seattle', 'PDX', 'Portland', 'Citation Latitude',
      20, '2099-01-01', '12:00', '0h 45m', 20, false, 0, 'available')
  `, [familyFlight]);

  const primary = await makeUser("primary");
  const invited = await makeUser("invited");
  const linked = await makeUser("linked");
  const conflict = await makeUser("conflict", "plus");

  const upgrade = await api("POST", "/membership/upgrade", { token: primary.token, body: { tier: "concierge" } });
  check("concierge checkout keeps the compatibility tier", upgrade.status === 200 && upgrade.json?.tier === "concierge");
  check("Family plan exposes four members and seven annual passes",
    upgrade.json?.plans?.find((plan) => plan.id === "concierge")?.membershipCount === 4
      && upgrade.json?.plans?.find((plan) => plan.id === "concierge")?.sharedAnnualPasses === 7);
  check("Family passes are not added to personal balance", upgrade.json?.linePassCount === 0);

  const initial = await api("GET", "/membership/family", { token: primary.token });
  check("primary sees the complete Family summary", initial.status === 200 && initial.json?.role === "primary" && initial.json?.pool?.total === 7);

  const invitation = await api("POST", "/membership/family/invitations", {
    token: primary.token, body: { email: invited.email },
  });
  check("primary can create a single-use invitation", invitation.status === 201 && invitation.json?.invitation?.acceptanceToken);

  const accepted = await api("POST", `/membership/family/invitations/${invitation.json?.invitation?.acceptanceToken}/accept`, { token: invited.token });
  check("invited member gains Family access only after acceptance", accepted.status === 200 && accepted.json?.family?.role === "member");
  check("linked member sees only their own membership row", accepted.json?.family?.members?.length === 1 && accepted.json?.family?.members?.[0]?.email === invited.email);

  const linkedResult = await api("POST", "/membership/family/invitations", {
    token: primary.token, body: { email: linked.email, linkExisting: true },
  });
  check("primary can link an existing non-member account", linkedResult.status === 201 && linkedResult.json?.status === "linked");

  const forbidden = await api("POST", "/membership/family/invitations", {
    token: invited.token, body: { email: `not-owner-${suffix}@example.test` },
  });
  check("linked members cannot invite other members", forbidden.status === 403 && forbidden.json?.code === "FAMILY_OWNER_REQUIRED");

  const conflictResult = await api("POST", "/membership/family/invitations", {
    token: primary.token, body: { email: conflict.email },
  });
  check("existing individual memberships remain staff-review conflicts",
    conflictResult.status === 409 && conflictResult.json?.code === "FAMILY_MEMBERSHIP_CONFLICT");

  const ownerSummary = await api("GET", "/membership/family", { token: primary.token });
  const linkedMember = ownerSummary.json?.members?.find((member) => member.email === linked.email);
  const allocation = await api("PATCH", `/membership/family/members/${linkedMember?.id}/allocation`, {
    token: primary.token, body: { allocatedPasses: 2 },
  });
  check("primary can allocate unused shared passes", allocation.status === 200 && allocation.json?.pool?.allocated === 7);
  check("allocation is visible only as that member's own balance",
    allocation.json?.members?.find((member) => member.email === linked.email)?.availablePasses === 2);

  const overAllocated = await api("PATCH", `/membership/family/members/${linkedMember?.id}/allocation`, {
    token: primary.token, body: { allocatedPasses: 8 },
  });
  check("allocation cannot exceed the seven-pass pool", overAllocated.status === 400);

  const familyJoin = await api("POST", "/queue/join", {
    token: linked.token, body: { flightId: familyFlight, useLinePass: true, bringingPet: false },
  });
  check("queue confirmation consumes the assigned Family pass", familyJoin.status === 201 && familyJoin.json?.usedFamilyPass === true);
  const usedAfterJoin = await pool.query(
    `SELECT used_passes FROM family_members WHERE user_id = $1 AND status = 'active'`, [linked.userId],
  );
  check("Family usage is recorded server-side", Number(usedAfterJoin.rows[0]?.used_passes) === 1);

  await pool.query(`UPDATE family_plans SET renewal_at = NOW() - INTERVAL '1 minute' WHERE primary_user_id = $1`, [primary.userId]);
  const renewed = await api("GET", "/membership/family", { token: primary.token });
  check("renewal starts a fresh Family pass cycle and expires prior usage",
    renewed.status === 200 && renewed.json?.pool?.used === 0 && renewed.json?.renewalDate > new Date().toISOString().slice(0, 10));
  const cancelled = await api("POST", `/trips/${familyJoin.json?.trip?.id}/cancel`, { token: linked.token });
  check("a booking from an expired Family cycle is not refunded into the new pool",
    cancelled.status === 200 && cancelled.json?.passRefunded === false);
  const usedAfterCancel = await pool.query(
    `SELECT used_passes FROM family_members WHERE user_id = $1 AND status = 'active'`, [linked.userId],
  );
  check("Family cycle expiration leaves the new pool untouched", Number(usedAfterCancel.rows[0]?.used_passes) === 0);

  const invitedMember = ownerSummary.json?.members?.find((member) => member.email === invited.email);
  await api("PATCH", `/membership/family/members/${invitedMember?.id}/allocation`, {
    token: primary.token, body: { allocatedPasses: 1 },
  });
  const [concurrentJoinA, concurrentJoinB] = await Promise.all([
    api("POST", "/queue/join", { token: linked.token, body: { flightId: familyFlight, useLinePass: true, bringingPet: false } }),
    api("POST", "/queue/join", { token: invited.token, body: { flightId: familyFlight, useLinePass: true, bringingPet: false } }),
  ]);
  const concurrentSuccesses = [concurrentJoinA, concurrentJoinB]
    .filter((join) => join.status === 201 && join.json?.usedFamilyPass === true);
  check("concurrent Family redemption never over-consumes assigned passes",
    concurrentSuccesses.length >= 1 && concurrentSuccesses.length <= 2);
  await Promise.all(
    [[concurrentJoinA, linked.token], [concurrentJoinB, invited.token]]
      .filter(([join]) => join.status === 201 && join.json?.trip?.id)
      .map(([join, token]) => api("POST", `/trips/${join.json.trip.id}/cancel`, { token })),
  );
  const familyAfterConcurrent = await api("GET", "/membership/family", { token: primary.token });
  check("a concurrent Family failure does not lose a pass",
    familyAfterConcurrent.status === 200 && familyAfterConcurrent.json?.pool?.used === 0);

  await api("PATCH", `/membership/family/members/${linkedMember?.id}/allocation`, {
    token: primary.token, body: { allocatedPasses: 0 },
  });
  await api("POST", "/membership/buy-pass", { token: linked.token });
  const personalJoin = await api("POST", "/queue/join", {
    token: linked.token, body: { flightId: familyFlight, useLinePass: true, bringingPet: false },
  });
  check("personal passes remain separate when Family allocation is empty",
    personalJoin.status === 201 && personalJoin.json?.usedFamilyPass === false,
    JSON.stringify(personalJoin.json));

  await api("POST", "/membership/change", { token: primary.token, body: { action: "cancel" } });
  await pool.query(`UPDATE family_plans SET renewal_at = NOW() - INTERVAL '1 minute' WHERE primary_user_id = $1`, [primary.userId]);
  const ended = await api("GET", "/membership/family", { token: invited.token });
  check("ending the primary plan removes linked Family access", ended.status === 404);
} finally {
  await pool.query(`DELETE FROM trips WHERE flight_id = $1`, [familyFlight]).catch(() => {});
  await pool.query(`DELETE FROM queue_entries WHERE flight_id = $1`, [familyFlight]).catch(() => {});
  await pool.query(`DELETE FROM flights WHERE id = $1`, [familyFlight]).catch(() => {});
  await pool.end();
}

console.log(failures ? `Family flow failed with ${failures} failure(s)` : "Family flow passed");
if (failures) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(error);
  await pool.end().catch(() => {});
  process.exitCode = 1;
});