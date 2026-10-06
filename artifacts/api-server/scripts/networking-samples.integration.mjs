/**
 * Exercises the repeatable demo networking sample fixture through the live API.
 *
 * Run with the development API server up:
 *   pnpm --filter @workspace/api-server run test:networking-samples
 */
import { createRequire } from "node:module";

const requireDb = createRequire(new URL("../../../lib/db/package.json", import.meta.url));
const pg = requireDb("pg");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const BASE = (process.env.API_BASE
  ?? (process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}/api`
    : "http://localhost:8080/api")).replace(/\/+$/, "");

const DEMO_MEMBER_PHONE = "+15555550100";
const TEST_MEMBER_ID = "networking-test-member";
const PENDING_REQUEST_IDS = [
  "networking-sample-request-casey",
  "networking-sample-request-morgan",
  "networking-sample-request-taylor",
];
const ACCEPTED_CONNECTION_IDS = [
  "networking-sample-connection-riley",
  "networking-sample-connection-jordan",
];
const SAMPLE_REQUEST_IDS = [
  ...PENDING_REQUEST_IDS,
  "networking-sample-request-riley",
  "networking-sample-request-jordan",
];

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
  if (response.status === 302) {
    const location = response.headers.get("location") ?? "";
    const code = location ? new URL(location).searchParams.get("code") : null;
    const exchange = code ? await req(`/dev/exchange/${code}`) : null;
    let user = null;
    try {
      user = exchange?.json?.user ? JSON.parse(exchange.json.user) : null;
    } catch {
      user = null;
    }
    return { token: exchange?.json?.token, user };
  }

  if (response.status === 200) {
    const html = await response.text();
    const values = new Map();
    for (const match of html.matchAll(
      /localStorage\.setItem\('([^']+)',("(?:\\.|[^"])*")\);/g,
    )) {
      values.set(match[1], JSON.parse(match[2]));
    }
    let user = null;
    try {
      user = values.has("bluebird_user") ? JSON.parse(values.get("bluebird_user")) : null;
    } catch {
      user = null;
    }
    return { token: values.get("bluebird_token"), user };
  }
  return { token: null, user: null };
}

async function queueFixtureSnapshot() {
  const { rows: [snapshot] } = await pool.query(`
    SELECT
      (SELECT to_jsonb(u) FROM users u WHERE u.id = $1) AS user,
      (SELECT to_jsonb(p) FROM networking_profiles p WHERE p.user_id = $1) AS profile,
      (SELECT COALESCE(json_agg(to_jsonb(q) ORDER BY q.id), '[]'::json)
         FROM queue_entries q WHERE q.user_id = $1) AS queue_rows,
      (SELECT COALESCE(json_agg(to_jsonb(r) ORDER BY r.id), '[]'::json)
         FROM networking_requests r WHERE r.requester_id = $1 OR r.recipient_id = $1) AS requests,
      (SELECT COALESCE(json_agg(to_jsonb(c) ORDER BY c.id), '[]'::json)
         FROM networking_connections c WHERE c.member_a_id = $1 OR c.member_b_id = $1) AS connections
  `, [TEST_MEMBER_ID]);
  return JSON.stringify(snapshot);
}

async function demoNetworkingSnapshot(demoMemberId) {
  const { rows: [snapshot] } = await pool.query(`
    SELECT
      (SELECT COALESCE(json_agg(to_jsonb(r) ORDER BY r.id), '[]'::json)
         FROM networking_requests r
        WHERE (r.requester_id = $1 OR r.recipient_id = $1)
          AND r.id <> ALL($2::text[])) AS requests,
      (SELECT COALESCE(json_agg(to_jsonb(c) ORDER BY c.id), '[]'::json)
         FROM networking_connections c
        WHERE (c.member_a_id = $1 OR c.member_b_id = $1)
          AND c.id <> ALL($3::text[])) AS connections,
      (SELECT COALESCE(json_agg(to_jsonb(m) ORDER BY m.id), '[]'::json)
         FROM networking_messages m
        WHERE m.connection_id IN (
          SELECT c.id FROM networking_connections c
           WHERE (c.member_a_id = $1 OR c.member_b_id = $1)
             AND c.id <> ALL($3::text[])
        )) AS messages
  `, [demoMemberId, SAMPLE_REQUEST_IDS, ACCEPTED_CONNECTION_IDS]);
  return JSON.stringify(snapshot);
}

async function main() {
  const session = await devLogin(DEMO_MEMBER_PHONE);
  check("development demo account can sign in", !!session.token && !!session.user?.id);
  if (!session.token || !session.user?.id) return;

  const demoToken = session.token;
  const demoMemberId = session.user.id;
  const beforeQueue = await queueFixtureSnapshot();
  const beforeDemoNetworking = await demoNetworkingSnapshot(demoMemberId);

  try {
    const firstRestore = await req("/dev/networking-samples/restore", { method: "POST" });
    check(
      "development restore route restores the demo networking samples",
      firstRestore.status === 200 &&
        firstRestore.json?.restored === true &&
        firstRestore.json?.demoMemberId === demoMemberId &&
        firstRestore.json?.pendingRequests === 3 &&
        firstRestore.json?.acceptedConnections === 2 &&
        firstRestore.json?.seededMessages === 2,
      JSON.stringify(firstRestore.json),
    );

    const [incoming, connections, demoRows] = await Promise.all([
      req("/networking/requests/incoming", { token: demoToken }),
      req("/networking/connections", { token: demoToken }),
      demoNetworkingSnapshot(demoMemberId),
    ]);
    check(
      "restore produces three pending incoming requests",
      incoming.status === 200 &&
        JSON.stringify(incoming.json?.map((row) => row.id).filter((id) => PENDING_REQUEST_IDS.includes(id)).sort()) ===
          JSON.stringify([...PENDING_REQUEST_IDS].sort()),
      JSON.stringify(incoming.json),
    );
    const sampleConnections = connections.json?.filter((row) =>
      ACCEPTED_CONNECTION_IDS.includes(row.id),
    ) ?? [];
    const riley = sampleConnections.find((row) => row.id === ACCEPTED_CONNECTION_IDS[0]);
    const jordan = sampleConnections.find((row) => row.id === ACCEPTED_CONNECTION_IDS[1]);
    check(
      "restore exposes one populated and one empty accepted conversation",
      connections.status === 200 &&
        sampleConnections.length === 2 &&
        riley?.member?.firstName === "Riley" &&
        riley?.lastMessage?.content === "Yes, looking forward to it. Thanks for reaching out!" &&
        jordan?.member?.firstName === "Jordan" &&
        jordan?.lastMessage === null,
      JSON.stringify(sampleConnections),
    );

    if (riley && jordan) {
      const [rileyMessages, jordanMessages] = await Promise.all([
        req(`/networking/connections/${riley.id}/messages`, { token: demoToken }),
        req(`/networking/connections/${jordan.id}/messages`, { token: demoToken }),
      ]);
      check(
        "populated conversation includes messages from both members and the quiet thread is empty",
        rileyMessages.status === 200 &&
          rileyMessages.json?.length === 2 &&
          new Set(rileyMessages.json.map((message) => message.senderId)).has(demoMemberId) &&
          new Set(rileyMessages.json.map((message) => message.senderId)).has("networking-sample-riley") &&
          jordanMessages.status === 200 &&
          jordanMessages.json?.length === 0,
        JSON.stringify({ rileyMessages: rileyMessages.json, jordanMessages: jordanMessages.json }),
      );

      const sent = await req(`/networking/connections/${riley.id}/messages`, {
        method: "POST",
        token: demoToken,
        body: {
          content: "A message sent through the networking API.",
          clientMessageId: "networking-samples-integration-message",
        },
      });
      const afterSend = await req(`/networking/connections/${riley.id}/messages`, { token: demoToken });
      check(
        "demo member can send and read a message through the normal conversation endpoint",
        sent.status === 201 &&
          afterSend.json?.some((message) => message.content === "A message sent through the networking API."),
        JSON.stringify({ sent: sent.json, messages: afterSend.json }),
      );
    }

    const accepted = await req(`/networking/requests/${PENDING_REQUEST_IDS[0]}/decision`, {
      method: "POST",
      token: demoToken,
      body: { action: "accept" },
    });
    const declined = await req(`/networking/requests/${PENDING_REQUEST_IDS[1]}/decision`, {
      method: "POST",
      token: demoToken,
      body: { action: "decline" },
    });
    const removed = await req(`/networking/requests/${PENDING_REQUEST_IDS[2]}/decision`, {
      method: "POST",
      token: demoToken,
      body: { action: "ignore" },
    });
    const requestsAfterDecisions = await req("/networking/requests/incoming", { token: demoToken });
    check(
      "sample requests support accept, decline, and remove through normal endpoints",
      accepted.status === 200 &&
        accepted.json?.status === "accepted" &&
        declined.status === 200 &&
        declined.json?.status === "declined" &&
        removed.status === 200 &&
        removed.json?.status === "ignored" &&
        requestsAfterDecisions.status === 200 &&
        requestsAfterDecisions.json?.length === 0,
      JSON.stringify({ accepted: accepted.json, declined: declined.json, removed: removed.json }),
    );

    const secondRestore = await req("/dev/networking-samples/restore", { method: "POST" });
    const [restoredIncoming, restoredConnections, restoredRileyMessages] = await Promise.all([
      req("/networking/requests/incoming", { token: demoToken }),
      req("/networking/connections", { token: demoToken }),
      req(`/networking/connections/${ACCEPTED_CONNECTION_IDS[0]}/messages`, { token: demoToken }),
    ]);
    check(
      "repeated restore resets decisions and sent messages to the original baseline",
      secondRestore.status === 200 &&
        restoredIncoming.json?.filter((row) => PENDING_REQUEST_IDS.includes(row.id)).length === 3 &&
        restoredConnections.json?.filter((row) => ACCEPTED_CONNECTION_IDS.includes(row.id)).length === 2 &&
        restoredRileyMessages.json?.length === 2 &&
        restoredRileyMessages.json?.every((message) => message.id.startsWith("networking-sample-message-")),
      JSON.stringify({
        secondRestore: secondRestore.json,
        incoming: restoredIncoming.json,
        connections: restoredConnections.json,
        messages: restoredRileyMessages.json,
      }),
    );

    const afterDemoNetworking = await demoNetworkingSnapshot(demoMemberId);
    const afterQueue = await queueFixtureSnapshot();
    check(
      "restore preserves unrelated demo networking records and the queue-based test member",
      beforeDemoNetworking === afterDemoNetworking && beforeQueue === afterQueue,
      JSON.stringify({
        unrelatedDemoDataUnchanged: beforeDemoNetworking === afterDemoNetworking,
        queueFixtureUnchanged: beforeQueue === afterQueue,
      }),
    );
  } finally {
    // Leave development ready for the next manual app run.
    await req("/dev/networking-samples/restore", { method: "POST" }).catch(() => null);
  }
}

try {
  await main();
} catch (error) {
  console.error("Networking sample integration failed:", error);
  failures += 1;
} finally {
  await pool.end();
}

process.exitCode = failures ? 1 : 0;
