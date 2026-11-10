import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  MEMBER_MESSAGE_MAX_LENGTH,
  MEMBER_MESSAGE_PAGE_SIZE,
  MEMBER_MESSAGE_PATHS,
  MEMBER_MESSAGE_POLL_MS,
  clearMemberMessagesCache,
  conversationTitle,
  createMemberMessagesClient,
  isMemberMessagesIntegrationEnabled,
  limitMemberMessageBody,
  memberMessageBodyIssue,
  messageHistoryPath,
  nextMemberMessageSend,
  parseMessageConversation,
  parseMessageHistory,
  readMemberMessagesSnapshot,
  rememberMemberMessagesSnapshot,
  retainMemberMessagesForAccount,
} from "../scripts/.member-messages.test.mjs";

process.env.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST = "false";

const projectRoot = resolve(import.meta.dirname, "..");
const baseUrl = "https://bluebirdjets.com/api";

function message(id, conversationId = 7, body = "Hello") {
  return {
    id,
    conversationId,
    senderUserId: "user_from",
    body,
    createdAt: "2026-10-29T12:00:00.000Z",
  };
}

function conversation(id = 7, unreadCount = 1) {
  return {
    id,
    participantUserId: "user_from",
    createdAt: "2026-10-29T12:00:00.000Z",
    updatedAt: "2026-10-29T12:05:00.000Z",
    latestMessage: message(4, id),
    unreadCount,
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function client(fetcher, getAccessToken = async () => "clerk-token") {
  return createMemberMessagesClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl,
    getAccessToken,
    fetcher,
  });
}

test("the messages integration is off unless explicitly enabled", () => {
  const previous = process.env.EXPO_PUBLIC_BLUEBIRD_MEMBER_MESSAGES;
  delete process.env.EXPO_PUBLIC_BLUEBIRD_MEMBER_MESSAGES;
  assert.equal(isMemberMessagesIntegrationEnabled({ nativeAuthTest: false }), false);
  assert.equal(isMemberMessagesIntegrationEnabled({ flag: undefined, nativeAuthTest: false }), false);
  assert.equal(isMemberMessagesIntegrationEnabled({ flag: "false", nativeAuthTest: false }), false);
  assert.equal(isMemberMessagesIntegrationEnabled({ flag: "true", nativeAuthTest: true }), false);
  assert.equal(isMemberMessagesIntegrationEnabled({ flag: "true", nativeAuthTest: false }), true);
  if (previous === undefined) delete process.env.EXPO_PUBLIC_BLUEBIRD_MEMBER_MESSAGES;
  else process.env.EXPO_PUBLIC_BLUEBIRD_MEMBER_MESSAGES = previous;
  const env = readFileSync(resolve(projectRoot, "../../.env"), "utf8");
  const enabledInEnv = env.split("\n").some((line) => line.trim() === "EXPO_PUBLIC_BLUEBIRD_MEMBER_MESSAGES=true");
  assert.equal(enabledInEnv, false);
});

test("a disabled client does not read a token or call fetch", async () => {
  let tokenReads = 0;
  let fetches = 0;
  const disabled = createMemberMessagesClient({
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
  assert.equal((await disabled.listConversations()).kind, "disabled");
  assert.equal((await disabled.unreadCount()).kind, "disabled");
  assert.equal((await disabled.history({ conversationId: 7 })).kind, "disabled");
  assert.equal((await disabled.createConversation("user_from")).kind, "disabled");
  assert.equal((await disabled.send(7, "Hello")).kind, "disabled");
  assert.equal((await disabled.markRead(7)).kind, "disabled");
  assert.equal(tokenReads, 0);
  assert.equal(fetches, 0);

  const authTest = createMemberMessagesClient({
    enabled: true,
    nativeAuthTest: true,
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
  assert.equal((await authTest.listConversations()).kind, "disabled");
  assert.equal(tokenReads, 0);
  assert.equal(fetches, 0);
});

test("missing or blank authentication does not call fetch", async () => {
  for (const token of [null, "", "   ", "clerk token"]) {
    let fetches = 0;
    const api = client(async () => {
      fetches += 1;
      throw new Error("fetch");
    }, async () => token);
    const result = await api.listConversations();
    assert.equal(result.kind, "error");
    assert.equal(result.code, "token");
    assert.equal(fetches, 0);
  }
});

test("conversation parsing keeps the contract fields", () => {
  const parsed = parseMessageConversation(conversation(), "conversation");
  assert.equal(parsed.id, 7);
  assert.equal(parsed.participantUserId, "user_from");
  assert.equal(parsed.latestMessage.id, 4);
  assert.equal(parsed.latestMessage.body, "Hello");
  assert.equal(parsed.unreadCount, 1);
  const empty = parseMessageConversation({ ...conversation(), latestMessage: null, unreadCount: 0 }, "conversation");
  assert.equal(empty.latestMessage, null);
  assert.throws(() => parseMessageConversation({ ...conversation(), unreadCount: -1 }, "conversation"));
  const nested = { ...message(4, 7) };
  delete nested.conversationId;
  const listed = parseMessageConversation({ ...conversation(), latestMessage: nested }, "conversation");
  assert.equal(listed.latestMessage.conversationId, 7);
  const history = parseMessageHistory({
    messages: [nested],
    nextCursor: null,
    hasMore: false,
  }, 7);
  assert.equal(history.messages[0].conversationId, 7);
  assert.throws(() => parseMessageHistory({
    messages: [nested],
    nextCursor: null,
    hasMore: false,
  }));
  assert.equal(conversationTitle("user_from", new Map([["user_from", "Ava Stone"]])), "Ava Stone");
  assert.equal(conversationTitle("user_other", new Map()), "Bluebird member");
});

test("message history uses cursor pagination", async () => {
  const calls = [];
  const api = client(async (url) => {
    calls.push(String(url));
    const address = new URL(String(url));
    if (address.searchParams.get("before") === "3") {
      return jsonResponse({
        messages: [message(1), message(2)],
        nextCursor: null,
        hasMore: false,
      });
    }
    return jsonResponse({
      messages: [message(3), message(4)],
      nextCursor: "3",
      hasMore: true,
    });
  });
  const first = messageHistoryPath({ conversationId: 7 });
  assert.equal(first.ok, true);
  assert.equal(first.path, `${MEMBER_MESSAGE_PATHS.history}?conversationId=7&limit=${MEMBER_MESSAGE_PAGE_SIZE}`);
  const page = await api.history({ conversationId: 7 });
  assert.equal(page.kind, "loaded");
  assert.deepEqual(page.data.messages.map((item) => item.id), [3, 4]);
  assert.equal(page.data.nextCursor, "3");
  assert.equal(page.data.hasMore, true);
  const older = await api.history({ conversationId: 7, before: page.data.nextCursor });
  assert.equal(older.kind, "loaded");
  assert.deepEqual(older.data.messages.map((item) => item.id), [1, 2]);
  assert.equal(older.data.hasMore, false);
  assert.equal(older.data.nextCursor, null);
  assert.match(calls[0], /\/me\/messages\/history\?conversationId=7&limit=50$/);
  assert.match(calls[1], /before=3/);
  assert.equal(messageHistoryPath({ conversationId: 7, before: "0" }).ok, false);
  assert.equal(messageHistoryPath({ conversationId: 7, limit: 101 }).code, "invalid_page_size");
  let fetches = 0;
  const guarded = client(async () => {
    fetches += 1;
    throw new Error("fetch");
  });
  assert.equal((await guarded.history({ conversationId: 7, before: "abc" })).code, "invalid_cursor");
  assert.equal(fetches, 0);
  const parsed = parseMessageHistory({ messages: [message(1)], nextCursor: null, hasMore: false });
  assert.equal(parsed.messages[0].id, 1);
  const withoutConversationId = { ...message(9) };
  delete withoutConversationId.conversationId;
  const nested = client(async () => jsonResponse({
    messages: [withoutConversationId],
    nextCursor: null,
    hasMore: false,
  }));
  const nestedPage = await nested.history({ conversationId: 7 });
  assert.equal(nestedPage.kind, "loaded");
  assert.equal(nestedPage.data.messages[0].conversationId, 7);
});

test("sending uses the text body contract and the Unicode length limit", async () => {
  const calls = [];
  const api = client(async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/messages")) {
      return jsonResponse({ message: message(8, 7, JSON.parse(init.body).body) }, 201);
    }
    return jsonResponse({ conversation: conversation() }, 201);
  });
  const sent = await api.send(7, "  Hello  ");
  assert.equal(sent.kind, "loaded");
  assert.equal(sent.data.message.body, "  Hello  ");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.credentials, "omit");
  assert.equal(calls[0].init.headers.Authorization, "Bearer clerk-token");
  assert.equal(calls[0].init.body, JSON.stringify({ body: "  Hello  " }));
  assert.equal(calls[0].url, `${baseUrl}${MEMBER_MESSAGE_PATHS.messages(7)}`);

  const created = await api.createConversation(" user_from ");
  assert.equal(created.kind, "loaded");
  assert.equal(calls[1].init.body, JSON.stringify({ participantUserId: "user_from" }));
  assert.equal(calls[1].url, `${baseUrl}${MEMBER_MESSAGE_PATHS.conversations}`);

  let fetches = 0;
  const guarded = client(async () => {
    fetches += 1;
    throw new Error("fetch");
  });
  assert.equal(memberMessageBodyIssue("   "), "empty");
  assert.equal(memberMessageBodyIssue("hi\u0000"), "invalid");
  assert.equal(memberMessageBodyIssue("a".repeat(MEMBER_MESSAGE_MAX_LENGTH + 1)), "too_long");
  assert.equal(memberMessageBodyIssue("😀".repeat(MEMBER_MESSAGE_MAX_LENGTH)), null);
  assert.equal(memberMessageBodyIssue("😀".repeat(MEMBER_MESSAGE_MAX_LENGTH + 1)), "too_long");
  assert.equal((await guarded.send(7, "   ")).code, "invalid_message");
  assert.equal((await guarded.send(7, "hi\u0000")).code, "invalid_message");
  assert.equal((await guarded.send(7, "😀".repeat(MEMBER_MESSAGE_MAX_LENGTH + 1))).code, "invalid_message");
  assert.equal((await guarded.send(0, "Hello")).code, "invalid_conversation");
  assert.equal((await guarded.createConversation("")).code, "invalid_participant");
  assert.equal(fetches, 0);
  assert.equal(Array.from(limitMemberMessageBody("😀".repeat(MEMBER_MESSAGE_MAX_LENGTH + 5))).length, MEMBER_MESSAGE_MAX_LENGTH);
});

test("unread counts and read markers use their contract routes", async () => {
  const calls = [];
  const api = client(async (url, init) => {
    calls.push({ url: String(url), method: init.method, body: init.body });
    if (String(url).endsWith(MEMBER_MESSAGE_PATHS.unreadCount)) {
      return jsonResponse({ unreadCount: 2 });
    }
    if (init.method === "PUT") {
      return jsonResponse({ conversationId: 7, lastReadMessageId: 4, unreadCount: 0 });
    }
    return jsonResponse({ conversations: [conversation(7, 2)] });
  });
  const unread = await api.unreadCount();
  assert.equal(unread.kind, "loaded");
  assert.equal(unread.data.unreadCount, 2);
  const listed = await api.listConversations();
  assert.equal(listed.data.conversations[0].unreadCount, 2);
  const read = await api.markRead(7);
  assert.equal(read.kind, "loaded");
  assert.equal(read.data.conversationId, 7);
  assert.equal(read.data.lastReadMessageId, 4);
  assert.equal(read.data.unreadCount, 0);
  assert.equal(calls[0].url, `${baseUrl}${MEMBER_MESSAGE_PATHS.unreadCount}`);
  assert.equal(calls[2].method, "PUT");
  assert.equal(calls[2].body, undefined);
  assert.equal(calls[2].url, `${baseUrl}${MEMBER_MESSAGE_PATHS.read(7)}`);

  const emptyRead = client(async () => jsonResponse({
    conversationId: 7,
    lastReadMessageId: null,
    unreadCount: 0,
  }));
  assert.equal((await emptyRead.markRead(7)).data.lastReadMessageId, null);

  const denied = client(async () => jsonResponse({
    error: "Messages require an accepted connection.",
    code: "connection_required",
  }, 403));
  const blocked = await denied.markRead(7);
  assert.equal(blocked.kind, "error");
  assert.equal(blocked.code, "connection_required");
  assert.equal(JSON.stringify(blocked).includes("accepted connection"), false);

  const membership = client(async () => jsonResponse({
    error: "An active Bluebird membership is required.",
    code: "active_membership_required",
  }, 403));
  assert.equal((await membership.listConversations()).code, "membership_required");
});

test("message cache is scoped to the signed-in account", () => {
  clearMemberMessagesCache();
  rememberMemberMessagesSnapshot({
    clerkUserId: "user_a",
    environment: "production",
    apiBaseUrl: baseUrl,
    conversations: [conversation(1)],
    unreadCount: 1,
  });
  rememberMemberMessagesSnapshot({
    clerkUserId: "user_b",
    environment: "production",
    apiBaseUrl: baseUrl,
    conversations: [conversation(2, 0)],
    unreadCount: 0,
  });
  retainMemberMessagesForAccount("user_b");
  assert.equal(readMemberMessagesSnapshot({
    clerkUserId: "user_a",
    environment: "production",
    apiBaseUrl: baseUrl,
  }), null);
  assert.equal(readMemberMessagesSnapshot({
    clerkUserId: "user_b",
    environment: "production",
    apiBaseUrl: baseUrl,
  }).conversations[0].id, 2);
  clearMemberMessagesCache();
  assert.equal(readMemberMessagesSnapshot({
    clerkUserId: "user_b",
    environment: "production",
    apiBaseUrl: baseUrl,
  }), null);
});

test("a second send is refused while the first send is in flight", async () => {
  let fetches = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const api = client(async () => {
    fetches += 1;
    await gate;
    return jsonResponse({ message: message(9) }, 201);
  });
  let inFlight = false;
  const send = async (body) => {
    if (!nextMemberMessageSend({ inFlight, body })) return false;
    inFlight = true;
    try {
      const result = await api.send(7, body);
      return result.kind === "loaded";
    } finally {
      inFlight = false;
    }
  };
  const first = send("Hello");
  const second = send("Hello again");
  assert.equal(await second, false);
  release();
  assert.equal(await first, true);
  assert.equal(fetches, 1);
  assert.equal(nextMemberMessageSend({ inFlight: true, body: "Hello" }), false);
  assert.equal(nextMemberMessageSend({ inFlight: false, body: "   " }), false);
});

test("the messages screens stay off the demo store and the networking API", () => {
  const files = [
    "lib/memberMessages.ts",
    "lib/useMemberMessages.ts",
    "components/MemberConversationList.tsx",
    "components/MemberMessageThread.tsx",
    "components/MemberConnectionsScreen.tsx",
    "app/messages/[conversationId].tsx",
  ];
  for (const file of files) {
    const source = readFileSync(resolve(projectRoot, file), "utf8");
    assert.doesNotMatch(source, /AsyncStorage|console\.|WebSocket|Avery Lang|demo-avery|\/api\/networking|useListNetworking/);
  }
  const hook = readFileSync(resolve(projectRoot, "lib/useMemberMessages.ts"), "utf8");
  assert.equal(hook.match(/setInterval\(/g).length, 2);
  assert.match(hook, /AppState/);
  assert.match(hook, /memberMessagePollIntervalMs/);
  assert.match(readFileSync(resolve(projectRoot, "lib/memberMessageRealtime.ts"), "utf8"), /MEMBER_MESSAGE_POLL_MS/);
  assert.match(hook, /if \(!active \|\| !focused \|\| !foreground\) return;/);
  assert.match(hook, /clearMemberMessagesCache\(\)/);
  const auth = readFileSync(resolve(projectRoot, "context/AuthContext.tsx"), "utf8");
  assert.equal(auth.match(/clearMemberMessagesCache\(\)/g).length, 3);
  const screen = readFileSync(resolve(projectRoot, "components/MemberConnectionsScreen.tsx"), "utf8");
  assert.match(screen, /Connections are not available yet/);
  assert.match(screen, /connection\.member\.userId/);
  assert.match(screen, /messages\.open|useOpenAcceptedConversation/);
  assert.doesNotMatch(screen, /participantUserId/);
  const policy = readFileSync(resolve(projectRoot, "lib/nativeAuthTestPolicy.ts"), "utf8");
  assert.doesNotMatch(policy, /\/me\/messages/);
  assert.equal(MEMBER_MESSAGE_POLL_MS, 15000);
});
