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
  parseConnectionRelationshipConflict,
  parseDiscoveredConnectionMember,
  parseIncomingConnectionRequests,
  parseOutgoingConnectionRequest,
  parseOutgoingConnectionRequests,
  presentConnectionRequestConflict,
  reconcilePendingOutgoingRecipients,
  projectOutgoingConnectionRequest,
  outgoingRecipientLabel,
  parseQueueConnectionStatus,
  parseQueueTargetPreview,
  readMemberConnectionsSnapshot,
  rememberMemberConnectionsSnapshot,
  retainMemberConnectionsForAccount,
} from "../scripts/.member-connections.test.mjs";
import {
  discoveredStateFromDiscoveryMember,
  discoveredStateFromRelationshipConflict,
  formatMemberActivityTime,
  inferDiscoveredStateFromConnectionLists,
  memberInitials,
  presentDiscoveredMember,
  resolveConflictDiscoveredState,
} from "../scripts/.member-connect-presentation.test.mjs";

process.env.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST = "false";

const projectRoot = resolve(import.meta.dirname, "..");
const baseUrl = "https://bluebirdjets.com/api";

function member(userId, firstName, lastName) {
  return { userId, firstName, lastName };
}

function redactedOutgoing(id = 9) {
  return {
    id,
    status: "pending",
    createdAt: "2026-10-29T12:00:00.000Z",
    recipient: { firstName: "Noah", lastName: "Bennett" },
  };
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
  assert.equal((await client.listOutgoing()).kind, "disabled");
  assert.equal((await client.discover({ email: "member@example.com" })).kind, "disabled");
  assert.equal((await client.createRequest("user_to")).kind, "disabled");
  assert.equal((await client.createQueueRequest("8f99b61f-5c0b-44e9-93bf-55fbb2a0b925")).kind, "disabled");
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
      if (path === MEMBER_CONNECTION_PATHS.outgoing) {
        return jsonResponse({ requests: [redactedOutgoing(9)] });
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
  const outgoing = await client.listOutgoing();
  assert.equal(outgoing.kind, "loaded");
  assert.equal(outgoing.data.requests[0].recipient.firstName, "Noah");
  assert.equal(outgoing.data.requests[0].recipient.lastName, "Bennett");
  assert.equal(Object.prototype.hasOwnProperty.call(outgoing.data.requests[0].recipient, "userId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(outgoing.data.requests[0], "requester"), false);
  const accepted = await client.accept(4);
  assert.equal(accepted.data.connection.status, "accepted");
  const listed = await client.listAccepted();
  assert.equal(listed.data.connections[0].member.firstName, "Ava");
  const removed = await client.remove(4);
  assert.equal(removed.data.connection.status, "removed");

  assert.equal(calls.length, 7);
  for (const call of calls) {
    assert.equal(call.init.credentials, "omit");
    assert.equal(call.init.headers.Authorization, "Bearer clerk-token");
    assert.equal(String(call.url).startsWith(baseUrl), true);
  }
  assert.equal(calls[1].init.method, "POST");
  assert.equal(calls[1].init.body, JSON.stringify({ targetUserId: "user_to" }));
  assert.equal(calls[3].url, `${baseUrl}${MEMBER_CONNECTION_PATHS.outgoing}`);
  assert.equal(calls[4].url, `${baseUrl}${MEMBER_CONNECTION_PATHS.accept(4)}`);
  assert.equal(calls[6].init.method, "DELETE");
  assert.equal(calls[6].url, `${baseUrl}${MEMBER_CONNECTION_PATHS.remove(4)}`);
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
  assert.equal(parseOutgoingConnectionRequests({ requests: [] }).requests.length, 0);
  assert.equal(parseAcceptedConnections({ connections: [] }).connections.length, 0);
});

test("connection snapshots stay with the signed-in account", () => {
  clearMemberConnectionsCache();
  rememberMemberConnectionsSnapshot({
    clerkUserId: "user_a",
    environment: "production",
    apiBaseUrl: baseUrl,
    incoming: [relationship(1)],
    outgoing: [],
    pendingOutgoingRecipientUserIds: [],
    accepted: [],
    outgoingSupported: false,
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
  assert.equal(memberInitials("Amber Moore"), "AM");
  assert.equal(memberInitials("Bluebird member"), "BM");
  assert.equal(memberInitials(""), "B");
  const noon = new Date(2026, 9, 2, 15, 0).getTime();
  assert.equal(formatMemberActivityTime(new Date(2026, 9, 2, 10, 15).toISOString(), noon), "10:15 AM");
  assert.equal(formatMemberActivityTime(new Date(2026, 9, 1, 18, 0).toISOString(), noon), "Yesterday");
  assert.equal(formatMemberActivityTime(new Date(2026, 8, 29, 18, 0).toISOString(), noon), "Tue");
  assert.equal(formatMemberActivityTime(new Date(2026, 8, 3, 18, 0).toISOString(), noon), "Sep 3");
  assert.equal(formatMemberActivityTime("not-a-date", noon), "");
});

test("the connections screen does not present demo members as real people", () => {
  const screen = readFileSync(resolve(projectRoot, "components/MemberConnectionsScreen.tsx"), "utf8");
  const tab = readFileSync(resolve(projectRoot, "app/(tabs)/connections.tsx"), "utf8");
  const auth = readFileSync(resolve(projectRoot, "context/AuthContext.tsx"), "utf8");
  assert.match(screen, /member-connections-unavailable/);
  assert.match(screen, /messagesEnabled \|\| connections\.enabled/);
  assert.match(screen, /member-connections-discover/);
  assert.match(screen, /MemberProfileSheet/);
  assert.match(screen, /Find Member/);
  assert.match(screen, /Incoming Requests/);
  assert.match(screen, /My Connections/);
  assert.match(screen, /discover\(\{ phoneE164: phone \}\)/);
  assert.match(screen, /connections\.decline\(request\.id\)/);
  assert.match(screen, /connection-queue-status/);
  assert.match(screen, /member-connections-requests-badge/);
  assert.match(screen, /member-connections-incoming-empty/);
  assert.doesNotMatch(screen, /keyboardType="email-address"|member-connections-email|Exact email address/);
  assert.equal(presentDiscoveredMember({
    userId: "user_a",
    acceptedUserIds: ["user_a"],
    incomingRequesterIds: [],
  }), "connected");
  assert.equal(presentDiscoveredMember({
    userId: "user_b",
    acceptedUserIds: [],
    incomingRequesterIds: ["user_b"],
  }), "incoming");
  assert.equal(presentDiscoveredMember({
    userId: "user_c",
    acceptedUserIds: ["user_a"],
    incomingRequesterIds: ["user_b"],
  }), "available");
  assert.equal(presentDiscoveredMember({
    userId: "user_d",
    acceptedUserIds: [],
    incomingRequesterIds: [],
    outgoingRecipientIds: ["user_d"],
  }), "outgoing");
  assert.match(screen, /Sent Requests/);
  assert.match(screen, /member-connections-request-pending/);
  assert.match(screen, /Request pending/);
  assert.match(screen, /pendingOutgoingRecipientUserIds/);
  assert.doesNotMatch(screen, /request\.recipient\.userId/);
  assert.doesNotMatch(screen, /Find contacts|RSVP|skill level|EVENT CHATS|favorite/);
  assert.doesNotMatch(screen, /Avery Lang|demo-avery|useListNetworking|\/api\/networking|\/networking\/connections/);
  assert.match(tab, /MemberConnectionsScreen/);
  assert.doesNotMatch(tab, /ConnectionsHome/);
  assert.match(auth, /clearMemberConnectionsCache\(\)/);
});

test("queue connection requests post only the opaque reference and keep the connection id", async () => {
  const calls = [];
  const reference = "8F99B61F-5C0B-44E9-93BF-55FBB2A0B925";
  const client = createMemberConnectionsClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl,
    getAccessToken: async () => "clerk-token",
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        connection: {
          id: 73,
          status: "pending",
          createdAt: "2026-02-18T17:42:00.000Z",
          updatedAt: "2026-02-18T17:42:00.000Z",
          respondedAt: null,
          removedAt: null,
          requester: { userId: "user_secret", firstName: "Ada", lastName: "Member" },
        },
      }, 201);
    },
  });
  const invalid = await client.createQueueRequest("user_secret");
  assert.equal(invalid.kind, "error");
  assert.equal(invalid.code, "invalid_body");
  assert.equal(calls.length, 0);
  const created = await client.createQueueRequest(reference);
  assert.equal(created.kind, "loaded");
  assert.equal(created.data.connection.id, 73);
  assert.equal(created.data.connection.status, "pending");
  assert.equal(JSON.stringify(created.data).includes("user_secret"), false);
  assert.equal(JSON.stringify(created.data).includes("Ada"), false);
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body, { queueTargetReference: reference.toLowerCase() });
  assert.equal(Object.prototype.hasOwnProperty.call(body, "targetUserId"), false);
  assert.equal(calls[0].init.headers.Authorization, "Bearer clerk-token");
  assert.equal(calls[0].url, `${baseUrl}${MEMBER_CONNECTION_PATHS.requests}`);
});

test("queue status restores every relationship without member identities", async () => {
  const calls = [];
  const client = createMemberConnectionsClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl,
    getAccessToken: async () => "clerk-token",
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        relationships: [
          {
            connectionId: 73,
            emptyLegId: 456,
            status: "pending",
            direction: "outgoing",
            updatedAt: "2026-11-05T12:00:00.000Z",
            userId: "user_secret",
            email: "member@example.test",
          },
          {
            connectionId: 74,
            emptyLegId: 456,
            status: "accepted",
            direction: "incoming",
            updatedAt: "2026-11-05T12:05:00.000Z",
          },
        ],
      });
    },
  });
  const loaded = await client.listQueueStatus();
  assert.equal(loaded.kind, "loaded");
  assert.deepEqual(loaded.data.relationships, [
    {
      connectionId: 73,
      emptyLegId: 456,
      status: "pending",
      direction: "outgoing",
      updatedAt: "2026-11-05T12:00:00.000Z",
    },
    {
      connectionId: 74,
      emptyLegId: 456,
      status: "accepted",
      direction: "incoming",
      updatedAt: "2026-11-05T12:05:00.000Z",
    },
  ]);
  assert.equal(JSON.stringify(loaded.data).includes("user_secret"), false);
  assert.equal(JSON.stringify(loaded.data).includes("@"), false);
  assert.equal(calls[0].url, `${baseUrl}${MEMBER_CONNECTION_PATHS.queueStatus}`);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.body, undefined);
  assert.throws(() => parseQueueConnectionStatus({
    relationships: [{
      connectionId: 73,
      emptyLegId: 456,
      status: "declined",
      direction: "outgoing",
      updatedAt: "2026-11-05T12:00:00.000Z",
    }],
  }));
});

test("queue target preview loads only first name, last name, and position", async () => {
  const reference = "8f99b61f-5c0b-44e9-93bf-55fbb2a0b925";
  const calls = [];
  const client = createMemberConnectionsClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl,
    getAccessToken: async () => "clerk-token",
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        firstName: "Ada",
        lastName: "Lovelace",
        position: 1,
        userId: "user_secret",
        email: "ada@example.test",
        phoneE164: "+15555550100",
      });
    },
  });
  const loaded = await client.previewQueueTarget(reference);
  assert.equal(loaded.kind, "loaded");
  assert.deepEqual(loaded.data, {
    firstName: "Ada",
    lastName: "Lovelace",
    position: 1,
  });
  assert.equal(JSON.stringify(loaded.data).includes("user_secret"), false);
  assert.equal(JSON.stringify(loaded.data).includes("@"), false);
  assert.equal(JSON.stringify(loaded.data).includes("+1555"), false);
  assert.equal(calls[0].url, `${baseUrl}${MEMBER_CONNECTION_PATHS.queueTargetPreview(reference)}`);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.body, undefined);
  assert.throws(() => parseQueueTargetPreview({
    firstName: "Ada",
    lastName: "",
    position: 1,
  }));
  const denied = await createMemberConnectionsClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl,
    getAccessToken: async () => "clerk-token",
    fetcher: async () => jsonResponse({ code: "queue_target_unavailable" }, 404),
  }).previewQueueTarget(reference);
  assert.equal(denied.kind, "error");
  assert.equal(denied.code, "queue_target_unavailable");
});

test("queue connection request errors use the contract codes", async () => {
  const cases = [
    [400, "invalid_body", "invalid_body"],
    [400, "self_request", "self_request"],
    [401, "unauthorized", "unauthorized"],
    [403, "active_membership_required", "active_membership_required"],
    [403, "first_in_queue_required", "first_in_queue_required"],
    // Privacy opt-out on queue path is 404 queue_target_unavailable, not a privacy leak.
    [403, "incoming_requests_disabled", "unavailable"],
    [404, "queue_target_unavailable", "queue_target_unavailable"],
    [409, "relationship_exists", "relationship_exists"],
    [500, "relationship_exists", "unavailable"],
  ];
  for (const [status, serverCode, expected] of cases) {
    const client = createMemberConnectionsClient({
      enabled: true,
      nativeAuthTest: false,
      environment: "production",
      baseUrl,
      getAccessToken: async () => "clerk-token",
      fetcher: async () => jsonResponse({ code: serverCode }, status),
    });
    const result = await client.createQueueRequest("8f99b61f-5c0b-44e9-93bf-55fbb2a0b925");
    assert.equal(result.kind, "error");
    assert.equal(result.code, expected);
    assert.equal(JSON.stringify(result).includes("user_"), false);
  }
});

test("direct createRequest maps incoming_requests_disabled from HTTP 403", async () => {
  const privacyBlocked = await createMemberConnectionsClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl,
    getAccessToken: async () => "clerk-token",
    fetcher: async () => jsonResponse({ code: "incoming_requests_disabled" }, 403),
  }).createRequest("user_to");
  assert.equal(privacyBlocked.kind, "error");
  assert.equal(privacyBlocked.code, "incoming_requests_disabled");

  const membership = await createMemberConnectionsClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl,
    getAccessToken: async () => "clerk-token",
    fetcher: async () => jsonResponse({ code: "active_membership_required" }, 403),
  }).createRequest("user_to");
  assert.equal(membership.kind, "error");
  assert.equal(membership.code, "membership_required");

  const conflict = await createMemberConnectionsClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl,
    getAccessToken: async () => "clerk-token",
    fetcher: async () => jsonResponse({ code: "relationship_exists" }, 409),
  }).createRequest("user_to");
  assert.equal(conflict.kind, "error");
  assert.equal(conflict.code, "conflict");
  assert.equal(conflict.relationship, undefined);

  // Uppercase local codes are not accepted by the Main API parser.
  const uppercase = await createMemberConnectionsClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl,
    getAccessToken: async () => "clerk-token",
    fetcher: async () => jsonResponse({ code: "INCOMING_REQUESTS_DISABLED" }, 403),
  }).createRequest("user_to");
  assert.equal(uppercase.kind, "error");
  assert.equal(uppercase.code, "unavailable");

  const hook = readFileSync(resolve(projectRoot, "lib/useMemberConnections.ts"), "utf8");
  assert.match(hook, /incoming_requests_disabled: 'This member is not accepting connection requests\.'/);
});

test("relationship lifecycle: hub loads incoming, outgoing, and accepted; Find Member hides Send when outgoing pending", () => {
  assert.equal(MEMBER_CONNECTION_PATHS.outgoing, "/me/connections/requests/outgoing");
  assert.equal(MEMBER_CONNECTION_PATHS.incoming, "/me/connections/requests/incoming");
  assert.equal(MEMBER_CONNECTION_PATHS.list, "/me/connections");

  const hook = readFileSync(resolve(projectRoot, "lib/useMemberConnections.ts"), "utf8");
  assert.match(hook, /client\.listIncoming\(\)/);
  assert.match(hook, /client\.listOutgoing\(\)/);
  assert.match(hook, /client\.listAccepted\(\)/);
  assert.match(hook, /outgoing_unsupported/);
  assert.match(hook, /createdOutgoing/);
  assert.match(hook, /presentConnectionRequestConflict/);
  assert.match(hook, /relationshipOverrides/);
  assert.match(hook, /kind: 'connection-accepted'/);
  assert.match(hook, /publishMemberMessageHint/);

  assert.equal(presentDiscoveredMember({
    userId: "user_pending_outgoing",
    acceptedUserIds: [],
    incomingRequesterIds: [],
    outgoingRecipientIds: ["user_pending_outgoing"],
  }), "outgoing");
  assert.equal(presentDiscoveredMember({
    userId: "user_available",
    acceptedUserIds: [],
    incomingRequesterIds: [],
    outgoingRecipientIds: [],
  }), "available");
  assert.equal(presentDiscoveredMember({
    userId: "user_available",
    acceptedUserIds: [],
    incomingRequesterIds: [],
    outgoingRecipientIds: [],
    relationshipOverride: "connected",
  }), "connected");

  const screen = readFileSync(resolve(projectRoot, "components/MemberConnectionsScreen.tsx"), "utf8");
  assert.match(screen, /discoveredState === 'available'/);
  assert.match(screen, /discoveredState === 'outgoing'/);
  assert.match(screen, /relationshipOverrides/);
  assert.match(screen, /Send request/);
  assert.match(screen, /Request pending/);
  assert.match(screen, /Sent Requests/);
  assert.match(screen, /member-connections-incoming-empty/);
  assert.doesNotMatch(screen, /Cancel request|cancelOutgoing/);
  // Accept → Messages must use the requester Clerk userId, never the connection row id.
  assert.match(screen, /requesterUserIdFromIncoming/);
  assert.match(screen, /acceptIncoming/);
  assert.match(screen, /request\.requester\.userId/);
  assert.match(screen, /messages\.open\(memberUserId\)|messages\.open\(requesterUserId\)/);
  assert.match(screen, /setPane\('chats'\)/);
  assert.doesNotMatch(screen, /messages\.open\(incoming\.id\)|messages\.open\(request\.id\)/);
  assert.doesNotMatch(screen, /participantUserId/);
});

test("direct createRequest: structured HTTP 409 relationship facts drive conflict copy", async () => {
  const pending = await createMemberConnectionsClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl,
    getAccessToken: async () => "clerk-token",
    fetcher: async () => jsonResponse({
      code: "relationship_exists",
      relationshipStatus: "pending",
      relationshipDirection: "outgoing",
    }, 409),
  }).createRequest("user_to");
  assert.equal(pending.kind, "error");
  assert.equal(pending.code, "conflict");
  assert.deepEqual(pending.relationship, { status: "pending", direction: "outgoing" });
  assert.match(presentConnectionRequestConflict(pending.relationship), /already pending/i);

  const accepted = await createMemberConnectionsClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl,
    getAccessToken: async () => "clerk-token",
    fetcher: async () => jsonResponse({
      code: "relationship_exists",
      relationshipStatus: "accepted",
      relationshipDirection: "outgoing",
    }, 409),
  }).createRequest("user_to");
  assert.deepEqual(accepted.relationship, { status: "accepted", direction: "outgoing" });
  assert.match(presentConnectionRequestConflict(accepted.relationship), /already connected/i);
  assert.equal(discoveredStateFromRelationshipConflict(accepted.relationship), "connected");

  const declined = await createMemberConnectionsClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl,
    getAccessToken: async () => "clerk-token",
    fetcher: async () => jsonResponse({
      code: "relationship_exists",
      relationshipStatus: "declined",
      relationshipDirection: "outgoing",
    }, 409),
  }).createRequest("user_to");
  assert.deepEqual(declined.relationship, { status: "declined", direction: "outgoing" });
  assert.match(presentConnectionRequestConflict(declined.relationship), /declined/i);
  assert.match(presentConnectionRequestConflict(declined.relationship), /Sent Requests/);
  assert.equal(discoveredStateFromRelationshipConflict(declined.relationship), null);

  const removed = await createMemberConnectionsClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl,
    getAccessToken: async () => "clerk-token",
    fetcher: async () => jsonResponse({
      code: "relationship_exists",
      relationshipStatus: "removed",
    }, 409),
  }).createRequest("user_to");
  assert.deepEqual(removed.relationship, { status: "removed", direction: null });
  assert.match(presentConnectionRequestConflict(removed.relationship), /removed/i);
  assert.equal(discoveredStateFromRelationshipConflict(removed.relationship), null);

  const schemaOutOfDate = await createMemberConnectionsClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl,
    getAccessToken: async () => "clerk-token",
    fetcher: async () => jsonResponse({ code: "relationship_exists" }, 409),
  }).createRequest("user_to");
  assert.equal(schemaOutOfDate.kind, "error");
  assert.equal(schemaOutOfDate.code, "conflict");
  assert.equal(schemaOutOfDate.relationship, undefined);
  assert.match(presentConnectionRequestConflict(null), /Connection status unavailable/i);
  assert.equal(parseConnectionRelationshipConflict({ code: "relationship_exists" }), null);
  // Unspecified 409 must NOT invent Request pending.
  assert.equal(resolveConflictDiscoveredState({
    relationship: null,
    userId: "user_to",
    acceptedUserIds: [],
    incomingRequesterIds: [],
    blockUnspecifiedConflict: true,
  }), "unavailable");
  assert.equal(presentDiscoveredMember({
    userId: "user_to",
    acceptedUserIds: [],
    incomingRequesterIds: [],
    relationshipOverride: "unavailable",
  }), "unavailable");
  assert.equal(resolveConflictDiscoveredState({
    relationship: null,
    userId: "user_to",
    acceptedUserIds: ["user_to"],
    incomingRequesterIds: [],
    blockUnspecifiedConflict: true,
  }), "connected");
  assert.equal(inferDiscoveredStateFromConnectionLists({
    userId: "user_to",
    acceptedUserIds: [],
    incomingRequesterIds: ["user_to"],
  }), "incoming");
  // Server discover pending is confirmed outgoing — not unavailable.
  assert.equal(resolveConflictDiscoveredState({
    relationship: null,
    userId: "user_to",
    acceptedUserIds: [],
    incomingRequesterIds: [],
    outgoingRequestPending: true,
    blockUnspecifiedConflict: true,
  }), "outgoing");
  // Create-confirmed recipient ID remains outgoing.
  assert.equal(resolveConflictDiscoveredState({
    relationship: null,
    userId: "user_to",
    acceptedUserIds: [],
    incomingRequesterIds: [],
    outgoingRecipientIds: ["user_to"],
    blockUnspecifiedConflict: true,
  }), "outgoing");

  const snakeCase = await createMemberConnectionsClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl,
    getAccessToken: async () => "clerk-token",
    fetcher: async () => jsonResponse({
      code: "relationship_exists",
      relationship_status: "accepted",
      relationship_direction: "outgoing",
    }, 409),
  }).createRequest("user_to");
  assert.deepEqual(snakeCase.relationship, { status: "accepted", direction: "outgoing" });

  const nested = await createMemberConnectionsClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl,
    getAccessToken: async () => "clerk-token",
    fetcher: async () => jsonResponse({
      error: "relationship_exists",
      relationship: { status: "pending", direction: "incoming" },
    }, 409),
  }).createRequest("user_to");
  assert.deepEqual(nested.relationship, { status: "pending", direction: "incoming" });

  const schemaCode = await createMemberConnectionsClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl,
    getAccessToken: async () => "clerk-token",
    fetcher: async () => jsonResponse({ code: "connection_schema_out_of_date" }, 409),
  }).createRequest("user_to");
  assert.equal(schemaCode.kind, "error");
  assert.equal(schemaCode.code, "conflict");
  assert.equal(schemaCode.relationship, undefined);

  const incoming = await createMemberConnectionsClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl,
    getAccessToken: async () => "clerk-token",
    fetcher: async () => jsonResponse({
      code: "relationship_exists",
      relationshipStatus: "pending",
      relationshipDirection: "incoming",
    }, 409),
  }).createRequest("user_to");
  assert.deepEqual(incoming.relationship, { status: "pending", direction: "incoming" });
  assert.equal(discoveredStateFromRelationshipConflict(incoming.relationship), "incoming");
  assert.match(presentConnectionRequestConflict(incoming.relationship), /Open Requests/i);

  const privacy = await createMemberConnectionsClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl,
    getAccessToken: async () => "clerk-token",
    fetcher: async () => jsonResponse({ code: "incoming_requests_disabled" }, 403),
  }).createRequest("user_to");
  assert.equal(privacy.kind, "error");
  assert.equal(privacy.code, "incoming_requests_disabled");

  // Declined/removed keep Send available (null override).
  assert.equal(resolveConflictDiscoveredState({
    relationship: { status: "declined", direction: "outgoing" },
    userId: "user_to",
    acceptedUserIds: [],
    incomingRequesterIds: [],
    blockUnspecifiedConflict: true,
  }), null);
  assert.equal(resolveConflictDiscoveredState({
    relationship: { status: "removed", direction: null },
    userId: "user_to",
    acceptedUserIds: [],
    incomingRequesterIds: [],
    blockUnspecifiedConflict: true,
  }), null);

  const hook = readFileSync(resolve(projectRoot, "lib/useMemberConnections.ts"), "utf8");
  assert.match(hook, /presentConnectionRequestConflict/);
  assert.match(hook, /incoming_requests_disabled: 'This member is not accepting connection requests\.'/);
  assert.match(hook, /resolveConflictDiscoveredState/);
  assert.match(hook, /blockUnspecifiedConflict/);
  assert.match(hook, /listIncoming\(\)/);
  assert.match(hook, /listAccepted\(\)/);
  assert.match(hook, /listOutgoing\(\)/);
  assert.match(hook, /override === 'unavailable'/);
  assert.match(hook, /Clear any previously invented session pending/);
  const screen = readFileSync(resolve(projectRoot, "components/MemberConnectionsScreen.tsx"), "utf8");
  assert.match(screen, /Connection status unavailable/);
  assert.match(screen, /member-connections-status-unavailable/);
  assert.match(screen, /discoveredState === 'unavailable'/);
});

test("remove uses DELETE /me/connections/{id} then the hub reloads incoming + accepted", async () => {
  const calls = [];
  const client = createMemberConnectionsClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl,
    getAccessToken: async () => "clerk-token",
    fetcher: async (url, init) => {
      calls.push({ method: init.method, path: String(url).replace(baseUrl, "") });
      if (init.method === "DELETE") {
        return jsonResponse({
          connection: relationship(4, "removed"),
        });
      }
      throw new Error(`unexpected ${init.method} ${url}`);
    },
  });
  const removed = await client.remove(4);
  assert.equal(removed.kind, "loaded");
  assert.equal(removed.data.connection.status, "removed");
  assert.deepEqual(calls, [{ method: "DELETE", path: MEMBER_CONNECTION_PATHS.remove(4) }]);

  const hook = readFileSync(resolve(projectRoot, "lib/useMemberConnections.ts"), "utf8");
  assert.match(hook, /remove: \(connectionId: number\) => runMutation/);
  assert.match(hook, /client\.remove\(connectionId\)/);
  // Successful mutations (including remove) reload incoming + accepted via runMutation → load.
  assert.match(hook, /await load\(requestedAccountId, requestedGeneration/);
  assert.match(hook, /clearMemberConnectionsCache|retainMemberConnectionsForAccount|generationRef/);
});

test("queue relationship_exists stays independent of direct conflict copy", () => {
  const presentation = readFileSync(resolve(projectRoot, "lib/flightQueuePresentation.ts"), "utf8");
  assert.match(presentation, /relationship_exists.*A connection with this member already exists/);
  const hook = readFileSync(resolve(projectRoot, "lib/useMemberConnections.ts"), "utf8");
  const client = readFileSync(resolve(projectRoot, "lib/memberConnections.ts"), "utf8");
  assert.match(hook, /presentConnectionRequestConflict/);
  assert.match(client, /You’re already connected with this member/);
  assert.doesNotMatch(hook, /A connection with this member already exists/);
  assert.doesNotMatch(client, /A connection with this member already exists\./);
});

test("listOutgoing parses redacted responses and maps missing endpoint / network / auth distinctly", async () => {
  const missing = await createMemberConnectionsClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl,
    getAccessToken: async () => "clerk-token",
    fetcher: async () => jsonResponse({ error: "not found" }, 404),
  }).listOutgoing();
  assert.equal(missing.kind, "error");
  assert.equal(missing.code, "outgoing_unsupported");

  const network = await createMemberConnectionsClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl,
    getAccessToken: async () => "clerk-token",
    fetcher: async () => {
      throw new TypeError("network down");
    },
  }).listOutgoing();
  assert.equal(network.kind, "error");
  assert.equal(network.code, "network");

  const unauthorized = await createMemberConnectionsClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl,
    getAccessToken: async () => "clerk-token",
    fetcher: async () => jsonResponse({ code: "unauthorized" }, 401),
  }).listOutgoing();
  assert.equal(unauthorized.kind, "error");
  assert.equal(unauthorized.code, "unauthorized");

  const parsed = parseOutgoingConnectionRequests({
    requests: [
      {
        id: 11,
        status: "pending",
        createdAt: "2026-10-29T12:00:00.000Z",
        recipient: { firstName: "Noah", lastName: "Bennett", userId: "user_secret", email: "n@example.test" },
        requester: { userId: "user_from", firstName: "Ava", lastName: "Stone" },
        updatedAt: "2026-10-29T12:00:00.000Z",
      },
    ],
  });
  assert.equal(parsed.requests.length, 1);
  assert.equal(parsed.requests[0].id, 11);
  assert.equal(parsed.requests[0].status, "pending");
  assert.equal(parsed.requests[0].createdAt, "2026-10-29T12:00:00.000Z");
  assert.equal(parsed.requests[0].recipient.firstName, "Noah");
  assert.equal(parsed.requests[0].recipient.lastName, "Bennett");
  assert.deepEqual(Object.keys(parsed.requests[0]).sort(), ["createdAt", "id", "recipient", "status"]);
  assert.deepEqual(Object.keys(parsed.requests[0].recipient).sort(), ["firstName", "lastName"]);
  assert.equal(outgoingRecipientLabel(parsed.requests[0].recipient), "Noah Bennett");

  assert.throws(() => parseOutgoingConnectionRequest({
    id: 11,
    status: "pending",
    createdAt: "2026-10-29T12:00:00.000Z",
  }, "outgoingRequests.requests.0"));
  assert.throws(() => parseOutgoingConnectionRequest({
    id: 11,
    status: "pending",
    createdAt: "2026-10-29T12:00:00.000Z",
    recipient: { firstName: "Noah" },
  }, "outgoingRequests.requests.0"));

  const projected = projectOutgoingConnectionRequest(relationship(12));
  assert.deepEqual(Object.keys(projected.recipient).sort(), ["firstName", "lastName"]);
  assert.equal(Object.prototype.hasOwnProperty.call(projected.recipient, "userId"), false);

  const hook = readFileSync(resolve(projectRoot, "lib/useMemberConnections.ts"), "utf8");
  assert.match(hook, /outgoingResult\.code === 'outgoing_unsupported'/);
  assert.match(hook, /pendingOutgoingRecipientUserIds/);
  assert.match(hook, /rememberLocalOutgoing/);
  assert.match(hook, /generationRef/);
  assert.match(hook, /clearMemberConnectionsCache/);
  assert.match(hook, /retainMemberConnectionsForAccount/);
});

test("Find Member pending uses create-confirmed user IDs only — never recipient names", () => {
  assert.equal(presentDiscoveredMember({
    userId: "user_x",
    acceptedUserIds: ["user_x"],
    incomingRequesterIds: [],
    outgoingRecipientIds: ["user_x"],
  }), "connected");
  assert.equal(presentDiscoveredMember({
    userId: "user_y",
    acceptedUserIds: [],
    incomingRequesterIds: [],
    outgoingRecipientIds: ["user_y"],
  }), "outgoing");
  assert.equal(presentDiscoveredMember({
    userId: "user_z",
    acceptedUserIds: [],
    incomingRequesterIds: [],
    outgoingRecipientIds: [],
  }), "available");
  // Names are not matching keys.
  assert.equal(presentDiscoveredMember({
    userId: "user_same_name",
    acceptedUserIds: [],
    incomingRequesterIds: [],
    outgoingRecipientIds: ["Noah Bennett"],
  }), "available");

  const screen = readFileSync(resolve(projectRoot, "components/MemberConnectionsScreen.tsx"), "utf8");
  assert.match(screen, /discoveredState === 'outgoing'/);
  assert.match(screen, /member-connections-request-pending/);
  assert.match(screen, /pendingOutgoingRecipientUserIds/);
  assert.match(screen, /outgoingRecipientLabel/);
  assert.match(screen, /outgoingRequestPending/);
  assert.doesNotMatch(screen, /409|relationship_exists/);
  assert.doesNotMatch(screen, /request\.recipient\.userId/);
  const hook = readFileSync(resolve(projectRoot, "lib/useMemberConnections.ts"), "utf8");
  assert.match(hook, /pendingOutgoingRecipientUserIdsRef\.current\.includes/);
  assert.match(hook, /createdOutgoing: result\.data\.connection/);
  assert.match(hook, /projectOutgoingConnectionRequest/);
  assert.match(hook, /outgoingRequestPending === true/);
});

test("discover outgoingRequestPending: true, false, and missing field", async () => {
  const pendingTrue = parseConnectionDiscovery({
    member: { userId: "user_to", firstName: "Noah", lastName: "Bennett", outgoingRequestPending: true },
  });
  assert.equal(pendingTrue.member.outgoingRequestPending, true);
  assert.equal(presentDiscoveredMember({
    userId: "user_to",
    acceptedUserIds: [],
    incomingRequesterIds: [],
    outgoingRecipientIds: [],
    outgoingRequestPending: true,
  }), "outgoing");

  const productionEligible = parseConnectionDiscovery({
    member: {
      userId: "user_to",
      firstName: "Noah",
      lastName: "Bennett",
      outgoingRequestPending: false,
      relationshipDirection: null,
      relationshipStatus: null,
    },
  });
  assert.equal(productionEligible.member.relationshipStatus, null);
  assert.equal(productionEligible.member.relationshipDirection, null);
  assert.equal(productionEligible.member.outgoingRequestPending, false);
  assert.equal(discoveredStateFromDiscoveryMember(productionEligible.member), "available");
  // Fresh discover eligibility replaces a stale unclassified 409 and a local pending mark.
  assert.equal(presentDiscoveredMember({
    userId: "user_to",
    acceptedUserIds: [],
    incomingRequesterIds: [],
    outgoingRecipientIds: ["user_to"],
    outgoingRequestPending: false,
    relationshipOverride: "unavailable",
    serverDiscoveryState: discoveredStateFromDiscoveryMember(productionEligible.member),
  }), "available");
  assert.equal(discoveredStateFromDiscoveryMember({
    userId: "user_to",
    outgoingRequestPending: false,
  }), null);

  const pendingFalse = parseConnectionDiscovery({
    member: { userId: "user_to", firstName: "Noah", lastName: "Bennett", outgoingRequestPending: false },
  });
  assert.equal(pendingFalse.member.outgoingRequestPending, false);
  assert.equal(presentDiscoveredMember({
    userId: "user_to",
    acceptedUserIds: [],
    incomingRequesterIds: [],
    outgoingRecipientIds: [],
    outgoingRequestPending: false,
  }), "available");
  // Session-local pending wins over discover false (stale protection).
  assert.equal(presentDiscoveredMember({
    userId: "user_to",
    acceptedUserIds: [],
    incomingRequesterIds: [],
    outgoingRecipientIds: ["user_to"],
    outgoingRequestPending: false,
  }), "outgoing");

  const missing = parseConnectionDiscovery({
    member: { userId: "user_to", firstName: "Noah", lastName: null },
  });
  assert.equal(Object.prototype.hasOwnProperty.call(missing.member, "outgoingRequestPending"), false);
  assert.equal(presentDiscoveredMember({
    userId: "user_to",
    acceptedUserIds: [],
    incomingRequesterIds: [],
    outgoingRecipientIds: [],
  }), "available");
  assert.equal(presentDiscoveredMember({
    userId: "user_to",
    acceptedUserIds: [],
    incomingRequesterIds: [],
    outgoingRecipientIds: ["user_to"],
  }), "outgoing");

  assert.throws(() => parseDiscoveredConnectionMember({
    userId: "user_to",
    firstName: "Noah",
    lastName: "Bennett",
    outgoingRequestPending: "yes",
  }, "discovery.member"));

  const live = await createMemberConnectionsClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl,
    getAccessToken: async () => "clerk-token",
    fetcher: async () => jsonResponse({
      member: { userId: "user_to", firstName: "Noah", lastName: "Bennett", outgoingRequestPending: true },
    }),
  }).discover({ phoneE164: "+15551234567" });
  assert.equal(live.kind, "loaded");
  assert.equal(live.data.member.outgoingRequestPending, true);

  // Connected / incoming still win over discover pending.
  assert.equal(presentDiscoveredMember({
    userId: "user_to",
    acceptedUserIds: ["user_to"],
    incomingRequesterIds: [],
    outgoingRequestPending: true,
  }), "connected");
  assert.equal(presentDiscoveredMember({
    userId: "user_to",
    acceptedUserIds: [],
    incomingRequesterIds: ["user_to"],
    outgoingRequestPending: true,
  }), "incoming");

  const discoveryError = await createMemberConnectionsClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl,
    getAccessToken: async () => "clerk-token",
    fetcher: async () => jsonResponse({ code: "unauthorized" }, 401),
  }).discover({ phoneE164: "+15551234567" });
  assert.equal(discoveryError.kind, "error");
  assert.equal(discoveryError.code, "unauthorized");

  const hook = readFileSync(resolve(projectRoot, "lib/useMemberConnections.ts"), "utf8");
  assert.match(hook, /Never clear session-local pending on discover false/);
  assert.match(hook, /clearMessage: result\.data\.member != null/);
  assert.match(hook, /discoveryState === 'available'/);
  assert.match(hook, /discoveredStateFromDiscoveryMember/);
  assert.match(hook, /generationRef/);
  assert.match(hook, /accountRef\.current !== accountId/);
});

test("declined outgoing request releases the create-confirmed pending mark", () => {
  const sent = (id, status = "pending") => ({
    id,
    status,
    createdAt: "2026-11-16T10:00:00.000Z",
    recipient: { firstName: "Noah", lastName: "Bennett" },
  });
  const receipt = { recipientUserId: "user_to", requestId: 41, confirmedAt: 1_000 };

  // Still pending in a newer list: stay "Request sent".
  const stillPending = reconcilePendingOutgoingRecipients({
    recipientUserIds: ["user_to"],
    receipts: [receipt],
    outgoing: [sent(41)],
    listRequestedAt: 2_000,
  });
  assert.deepEqual(stillPending.recipientUserIds, ["user_to"]);
  assert.deepEqual(stillPending.receipts, [receipt]);

  // Recipient declined: request gone from a list requested after the create.
  const declined = reconcilePendingOutgoingRecipients({
    recipientUserIds: ["user_to"],
    receipts: [receipt],
    outgoing: [],
    listRequestedAt: 2_000,
  });
  assert.deepEqual(declined.recipientUserIds, []);
  assert.deepEqual(declined.receipts, []);
  assert.equal(presentDiscoveredMember({
    userId: "user_to",
    acceptedUserIds: [],
    incomingRequesterIds: [],
    outgoingRecipientIds: declined.recipientUserIds,
    outgoingRequestPending: false,
  }), "available");

  // Non-pending status in the list also releases.
  assert.deepEqual(reconcilePendingOutgoingRecipients({
    recipientUserIds: ["user_to"],
    receipts: [receipt],
    outgoing: [sent(41, "declined")],
    listRequestedAt: 2_000,
  }).recipientUserIds, []);

  // Stale list (requested before/at the create) never releases.
  for (const listRequestedAt of [500, 1_000]) {
    assert.deepEqual(reconcilePendingOutgoingRecipients({
      recipientUserIds: ["user_to"],
      receipts: [receipt],
      outgoing: [],
      listRequestedAt,
    }).recipientUserIds, ["user_to"]);
  }

  // IDs without a create receipt are dropped (no invented "Request pending").
  assert.deepEqual(reconcilePendingOutgoingRecipients({
    recipientUserIds: ["user_to", "user_discovered"],
    receipts: [receipt],
    outgoing: [],
    listRequestedAt: 2_000,
  }).recipientUserIds, []);

  // A newer re-send to the same member keeps the mark.
  const resend = { recipientUserId: "user_to", requestId: 42, confirmedAt: 3_000 };
  const afterResend = reconcilePendingOutgoingRecipients({
    recipientUserIds: ["user_to"],
    receipts: [receipt, resend],
    outgoing: [],
    listRequestedAt: 2_500,
  });
  assert.deepEqual(afterResend.recipientUserIds, ["user_to"]);
  assert.deepEqual(afterResend.receipts, [resend]);

  const hook = readFileSync(resolve(projectRoot, "lib/useMemberConnections.ts"), "utf8");
  assert.match(hook, /const listRequestedAt = Date\.now\(\);[\s\S]*client\.listOutgoing\(\)/);
  assert.match(hook, /reconcilePendingOutgoingRecipients\(/);
  assert.match(hook, /requestId: created\.id, confirmedAt: Date\.now\(\)/);
});

test("Find Member is phone-only and its validation copy says so", () => {
  const hook = readFileSync(resolve(projectRoot, "lib/useMemberConnections.ts"), "utf8");
  const screen = readFileSync(resolve(projectRoot, "components/MemberConnectionsScreen.tsx"), "utf8");
  assert.match(hook, /invalid_contact: 'Enter a valid phone number\.'/);
  assert.match(screen, /connections\.discover\(\{ phoneE164: phone \}\)/);
  assert.doesNotMatch(screen, /connections\.discover\(\{[^}]*email/);
});
