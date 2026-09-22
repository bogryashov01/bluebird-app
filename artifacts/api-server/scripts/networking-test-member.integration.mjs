/**
 * End-to-end coverage for the deterministic development networking fixture.
 *
 * Run with the development API server up:
 *   pnpm run test:networking-test-member
 */
import { createRequire } from "node:module";

const requireDb = createRequire(new URL("../../../lib/db/package.json", import.meta.url));
const pg = requireDb("pg");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const BASE = process.env.API_BASE
  ?? (process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}/api`
    : "http://localhost:3001/api");

const DEMO_MEMBER_PHONE = "+15555550100";
const TEST_MEMBER_ID = "networking-test-member";
const TEST_MEMBER_PHONE = "+15555550101";
const FLIGHT_ID = "demo-flight-DEN-ASP";

let failures = 0;

function check(name, condition, details = "") {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${condition ? "" : `  ${details}`}`);
  if (!condition) failures += 1;
}

async function req(path, { method = "GET", token, body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    headers: response.headers,
    json: await response.json().catch(() => null),
  };
}

async function devLogin(phone) {
  const response = await fetch(
    `${BASE}/dev/autologin?phone=${encodeURIComponent(phone)}&redirect=/`,
    { redirect: "manual" },
  );
  const location = response.headers.get("location") ?? "";
  const code = location ? new URL(location).searchParams.get("code") : null;
  const exchange = code ? await req(`/dev/exchange/${code}`) : null;
  return { response, exchange };
}

async function main() {
  const restored = await req("/dev/networking-test-member/restore", { method: "POST" });
  check("development restore route is available", restored.status === 200, JSON.stringify(restored.json));

  const { response: autologin, exchange } = await devLogin(TEST_MEMBER_PHONE);
  let exchangedUser = null;
  try {
    exchangedUser = exchange?.json?.user ? JSON.parse(exchange.json.user) : null;
  } catch {
    exchangedUser = null;
  }
  check(
    "test member is discoverable through dev sign-in lookup",
    (autologin.status === 302 || autologin.status === 200) &&
      (exchange?.status === 200 ? exchangedUser?.id === TEST_MEMBER_ID : autologin.status === 200),
    JSON.stringify({ autologin: autologin.status, exchange: exchange?.status }),
  );
  const { response: demoAutologin, exchange: demoExchange } = await devLogin(DEMO_MEMBER_PHONE);
  const demoToken = demoExchange?.json?.token;
  const testToken = exchange?.json?.token;
  check(
    "regular demo member is discoverable through dev sign-in lookup",
    demoAutologin.status === 302 && demoExchange?.status === 200 && !!demoToken,
    JSON.stringify({ autologin: demoAutologin.status, exchange: demoExchange?.status }),
  );

  const front = await req(`/networking/flights/${FLIGHT_ID}/front-member`, { token: demoToken });
  check(
    "demo member discovers the test member at queue position one",
    front.status === 200 && front.json?.eligible === true && front.json?.member?.userId === TEST_MEMBER_ID,
    JSON.stringify(front.json),
  );

  const request = await req("/networking/requests", {
    method: "POST",
    token: demoToken,
    body: { flightId: FLIGHT_ID, message: "Hello before the flight." },
  });
  check("demo member can send Ask to connect", request.status === 201, JSON.stringify(request.json));

  const incoming = await req("/networking/requests/incoming", { token: testToken });
  check(
    "test member receives the connection request",
    incoming.status === 200 && incoming.json?.some((row) => row.id === request.json?.id),
    JSON.stringify(incoming.json),
  );

  const accepted = await req(`/networking/requests/${request.json?.id}/decision`, {
    method: "POST",
    token: testToken,
    body: { action: "accept" },
  });
  const connectionId = accepted.json?.connection?.id;
  check(
    "test member can accept the request",
    accepted.status === 200 && accepted.json?.status === "accepted" && !!connectionId,
    JSON.stringify(accepted.json),
  );

  const firstMessage = await req(`/networking/connections/${connectionId}/messages`, {
    method: "POST",
    token: demoToken,
    body: { content: "Nice to meet you.", clientMessageId: "fixture-demo-message" },
  });
  const secondMessage = await req(`/networking/connections/${connectionId}/messages`, {
    method: "POST",
    token: testToken,
    body: { content: "Likewise—see you onboard.", clientMessageId: "fixture-test-message" },
  });
  const demoRead = await req(`/networking/connections/${connectionId}/messages`, { token: demoToken });
  const testRead = await req(`/networking/connections/${connectionId}/messages`, { token: testToken });
  check(
    "both members can send and read one-to-one chat messages",
    firstMessage.status === 201 &&
      secondMessage.status === 201 &&
      demoRead.status === 200 &&
      testRead.status === 200 &&
      demoRead.json?.length === 2 &&
      testRead.json?.length === 2,
    JSON.stringify({ firstMessage: firstMessage.json, secondMessage: secondMessage.json, demoRead: demoRead.json, testRead: testRead.json }),
  );

  const restoredAgain = await req("/dev/networking-test-member/restore", { method: "POST" });
  const { rows: [stable] } = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM users WHERE id = $1) AS users,
      (SELECT count(*)::int FROM networking_profiles WHERE user_id = $1) AS profiles,
      (SELECT count(*)::int FROM queue_entries WHERE user_id = $1 AND flight_id = $2 AND status = 'waiting' AND position = 1) AS front_entries,
      (SELECT count(*)::int FROM networking_requests WHERE requester_id = $1 OR recipient_id = $1) AS requests,
      (SELECT count(*)::int FROM networking_connections WHERE member_a_id = $1 OR member_b_id = $1) AS connections,
      (SELECT count(*)::int FROM networking_messages WHERE sender_id = $1) AS messages
  `, [TEST_MEMBER_ID, FLIGHT_ID]);
  check(
    "repeated fixture restore resets activity and keeps one front entry",
    restoredAgain.status === 200 &&
      stable.users === 1 &&
      stable.profiles === 1 &&
      stable.front_entries === 1 &&
      stable.requests === 0 &&
      stable.connections === 0 &&
      stable.messages === 0,
    JSON.stringify({ restoredAgain: restoredAgain.json, stable }),
  );

  const deleted = await req("/dev/networking-test-member", { method: "DELETE" });
  const { rows: [afterDelete] } = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM users WHERE id = $1) AS test_user,
      (SELECT count(*)::int FROM networking_profiles WHERE user_id = $1) AS test_profile,
      (SELECT count(*)::int FROM queue_entries WHERE user_id = $1) AS test_queue,
      (SELECT count(*)::int FROM networking_requests WHERE requester_id = $1 OR recipient_id = $1) AS test_requests,
      (SELECT count(*)::int FROM networking_connections WHERE member_a_id = $1 OR member_b_id = $1) AS test_connections,
      (SELECT count(*)::int FROM users WHERE phone = $2) AS demo_user,
      (SELECT count(*)::int FROM queue_entries WHERE flight_id = $3 AND status = 'waiting') AS waiting_count,
      (SELECT count(*)::int FROM queue_entries WHERE flight_id = $3 AND status = 'waiting' AND position > 0) AS positive_positions
  `, [TEST_MEMBER_ID, DEMO_MEMBER_PHONE, FLIGHT_ID]);
  check(
    "dev delete removes fixture data and protects demo data and queue state",
    deleted.status === 200 &&
      deleted.json?.deleted === true &&
      afterDelete.test_user === 0 &&
      afterDelete.test_profile === 0 &&
      afterDelete.test_queue === 0 &&
      afterDelete.test_requests === 0 &&
      afterDelete.test_connections === 0 &&
      afterDelete.demo_user === 1 &&
      afterDelete.waiting_count === afterDelete.positive_positions,
    JSON.stringify({ deleted: deleted.json, afterDelete }),
  );

  const arbitrary = await req("/dev/networking-test-member/other-user", { method: "DELETE" });
  check("arbitrary user deletion is not exposed", arbitrary.status === 404);

  // Leave the local development server with the fixture available for the
  // next manual networking run.
  await req("/dev/networking-test-member/restore", { method: "POST" });
}

try {
  await main();
} finally {
  await pool.end();
}

process.exitCode = failures ? 1 : 0;