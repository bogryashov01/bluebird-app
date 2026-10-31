import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  clearMemberConnectionsCache,
  connectionMemberLabel,
  createMemberConnectionsClient,
  discoverConnectionQuery,
  isMemberConnectionsIntegrationEnabled,
  MEMBER_CONNECTION_PATHS,
  parseAcceptedConnections,
  parseConnectionDiscovery,
  parseIncomingConnectionRequests,
  readMemberConnectionsSnapshot,
  rememberMemberConnectionsSnapshot,
  retainMemberConnectionsForAccount,
} from "../scripts/.member-connections.test.mjs";

process.env.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST = "false";

const projectRoot = resolve(import.meta.dirname, "..");
const baseUrl = "https://bluebirdjets.com/api";

function member(userId, firstName, lastName) {
  return { userId, firstName, lastName };
}

function relationship(id, status = "pending") {
  return {
    id,
    requester: member("user_from", "Ava", "Stone"),
    recipient: member("user_to", "Noah", "Bennett"),
    status,
    createdAt: "2026-10-29T12:00:00.000Z",
    updatedAt: "2026-10-29T12:00:00.000Z",
    respondedAt: null,
    removedAt: null,
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test("the connections integration is off unless explicitly enabled", () => {
  assert.equal(isMemberConnectionsIntegrationEnabled({ flag: undefined, nativeAuthTest: false }), false);
  assert.equal(isMemberConnectionsIntegrationEnabled({ flag: "false", nativeAuthTest: false }), false);
  assert.equal(isMemberConnectionsIntegrationEnabled({ flag: "true", nativeAuthTest: true }), false);
  assert.equal(isMemberConnectionsIntegrationEnabled({ flag: "true", nativeAuthTest: false }), true);
});

test("a disabled client does not read a token or call fetch", async () => {
  let tokenReads = 0;
  let fetches = 0;
  const client = createMemberConnectionsClient({
    enabled: false,
    environment: "production",
    baseUrl,
    getAccessToken: async () => {
      tokenReads += 1;
      return "clerk-token";
    },
    fetcher: async () => {
      fetches += 1;
      throw new Error("fetch");
    },
  });
  assert.equal((await client.listAccepted()).kind, "disabled");
  assert.equal((await client.listIncoming()).kind, "disabled");
  assert.equal((await client.discover({ email: "member@example.com" })).kind, "disabled");
  assert.equal((await client.createRequest("user_to")).kind, "disabled");
  assert.equal((await client.accept(4)).kind, "disabled");
  assert.equal((await client.decline(4)).kind, "disabled");
  assert.equal((await client.remove(4)).kind, "disabled");
  assert.equal(tokenReads, 0);
  assert.equal(fetches, 0);
});

test("native auth test stays disabled even when the flag is true", async () => {
  let fetches = 0;
  const client = createMemberConnectionsClient({
    enabled: true,
    nativeAuthTest: true,
    environment: "production",
    baseUrl,
    getAccessToken: async () => "clerk-token",
    fetcher: async () => {
      fetches += 1;
      throw new Error("fetch");
    },
  });
  assert.equal((await client.listAccepted()).kind, "disabled");
  assert.equal(fetches, 0);
});

test("discovery requires exactly one verified contact and does not call fetch otherwise", async () => {
  assert.equal(discoverConnectionQuery({}).ok, false);
  assert.equal(discoverConnectionQuery({ email: "a@b.com", phoneE164: "+15551234567" }).ok, false);
  assert.equal(discoverConnectionQuery({ phoneE164: "5551234567" }).ok, false);
  const email = discoverConnectionQuery({ email: " Member@Example.com " });
  assert.equal(email.ok, true);
  assert.equal(email.path, `${MEMBER_CONNECTION_PATHS.discover}?email=member%40example.com`);
  let fetches = 0;
  const client = createMemberConnectionsClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl,
    getAccessToken: async () => "clerk-token",
    fetcher: async () => {
      fetches += 1;
      return jsonResponse({ member: null });
    },
  });
  const rejected = await client.discover({ email: "member@example.com", phoneE164: "+15551234567" });
  assert.equal(rejected.kind, "error");
  assert.equal(rejected.code, "invalid_contact");
  assert.equal(fetches, 0);
});

test("enabled reads and writes use the Clerk bearer token and the contract paths", async () => {
  const calls = [];
  const client = createMemberConnectionsClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl,
    getAccessToken: async () => "clerk-token",
    fetcher: async (url, init) => {
      calls.push({ url, init });
      const path = String(url).slice(baseUrl.length);
      if (path.startsWith(MEMBER_CONNECTION_PATHS.discover)) {
        return jsonResponse({ member: member("user_to", "Noah", null) });
      }
      if (init.method === "POST" && path === MEMBER_CONNECTION_PATHS.requests) {
        return jsonResponse({ connection: relationship(9) }, 201);
      }
      if (path === MEMBER_CONNECTION_PATHS.incoming) {
        return jsonResponse({ requests: [relationship(4)] });
      }
      if (path === MEMBER_CONNECTION_PATHS.accept(4)) {
        return jsonResponse({ connection: relationship(4, "accepted") });
      }
      if (path === MEMBER_CONNECTION_PATHS.list) {
        return jsonResponse({
          connections: [{ id: 4, member: member("user_from", "Ava", "Stone"), connectedAt: "2026-10-29T12:00:00.000Z" }],
        });
      }
      if (init.method === "DELETE") {
        return jsonResponse({ connection: relationship(4, "removed") });
      }
      return jsonResponse({ error: "nope", code: "not_found" }, 404);
    },
  });

  const found = await client.discover({ email: "member@example.com" });
  assert.equal(found.kind, "loaded");
  assert.equal(found.data.member.userId, "user_to");
  assert.equal(found.data.member.lastName, null);
  const created = await client.createRequest("user_to");
  assert.equal(created.kind, "loaded");
  assert.equal(created.data.connection.id, 9);
  const incoming = await client.listIncoming();
  assert.equal(incoming.data.requests[0].requester.firstName, "Ava");
  const accepted = await client.accept(4);
  assert.equal(accepted.data.connection.status, "accepted");
  const listed = await client.listAccepted();
  assert.equal(listed.data.connections[0].member.firstName, "Ava");
  const removed = await client.remove(4);
  assert.equal(removed.data.connection.status, "removed");

  assert.equal(calls.length, 6);
  for (const call of calls) {
    assert.equal(call.init.credentials, "omit");
    assert.equal(call.init.headers.Authorization, "Bearer clerk-token");
    assert.equal(String(call.url).startsWith(baseUrl), true);
  }
  assert.equal(calls[1].init.method, "POST");
  assert.equal(calls[1].init.body, JSON.stringify({ targetUserId: "user_to" }));
  assert.equal(calls[3].url, `${baseUrl}${MEMBER_CONNECTION_PATHS.accept(4)}`);
  assert.equal(calls[5].init.method, "DELETE");
  assert.equal(calls[5].url, `${baseUrl}${MEMBER_CONNECTION_PATHS.remove(4)}`);
});

test("membership and schema failures stay on the contract codes", async () => {
  const client = createMemberConnectionsClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl,
    getAccessToken: async () => "clerk-token",
    fetcher: async () => jsonResponse({ error: "An active Bluebird membership is required.", code: "active_membership_required" }, 403),
  });
  const denied = await client.listAccepted();
  assert.equal(denied.kind, "error");
  assert.equal(denied.code, "membership_required");
  assert.equal(JSON.stringify(denied).includes("membership is required"), false);

  const broken = createMemberConnectionsClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl,
    getAccessToken: async () => "clerk-token",
    fetcher: async () => jsonResponse({ connections: [{ id: 1 }] }),
  });
  const invalid = await broken.listAccepted();
  assert.equal(invalid.code, "schema");
  assert.throws(() => parseConnectionDiscovery({}));
  assert.equal(parseIncomingConnectionRequests({ requests: [] }).requests.length, 0);
  assert.equal(parseAcceptedConnections({ connections: [] }).connections.length, 0);
});

test("connection snapshots stay with the signed-in account", () => {
  clearMemberConnectionsCache();
  rememberMemberConnectionsSnapshot({
    clerkUserId: "user_a",
    environment: "production",
    apiBaseUrl: baseUrl,
    incoming: [relationship(1)],
    accepted: [],
  });
  assert.equal(readMemberConnectionsSnapshot({
    clerkUserId: "user_b",
    environment: "production",
    apiBaseUrl: baseUrl,
  }), null);
  retainMemberConnectionsForAccount("user_b");
  assert.equal(readMemberConnectionsSnapshot({
    clerkUserId: "user_a",
    environment: "production",
    apiBaseUrl: baseUrl,
  }), null);
  clearMemberConnectionsCache();
  assert.equal(connectionMemberLabel(member("user_to", null, null)), "Bluebird member");
  assert.equal(connectionMemberLabel(member("user_to", "Noah", "Bennett")), "Noah Bennett");
});

test("the connections screen does not present demo members as real people", () => {
  const screen = readFileSync(resolve(projectRoot, "components/MemberConnectionsScreen.tsx"), "utf8");
  const tab = readFileSync(resolve(projectRoot, "app/(tabs)/connections.tsx"), "utf8");
  const auth = readFileSync(resolve(projectRoot, "context/AuthContext.tsx"), "utf8");
  assert.match(screen, /member-connections-unavailable/);
  assert.match(screen, /Messages are not available yet/);
  assert.match(screen, /member-connections-discover/);
  assert.doesNotMatch(screen, /Avery Lang|demo-avery|useListNetworking|\/api\/networking|\/networking\/connections/);
  assert.match(tab, /MemberConnectionsScreen/);
  assert.doesNotMatch(tab, /ConnectionsHome/);
  assert.match(auth, /clearMemberConnectionsCache\(\)/);
});
