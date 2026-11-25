import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  MEMBER_MESSAGE_COMPOSER_WARN_REMAINING,
  MEMBER_MESSAGE_MAX_LENGTH,
  MEMBER_MESSAGE_PAGE_SIZE,
  MEMBER_MESSAGE_PATHS,
  MEMBER_MESSAGE_POLL_MS,
  MEMBER_MESSAGE_SCROLL_NEAR_BOTTOM_PX,
  classifyMemberMessageThreadScrollChange,
  clearMemberMessagesCache,
  conversationTitle,
  createMemberMessagesClient,
  formatMemberMessageDaySeparator,
  formatMemberMessagesUnreadBadge,
  isMemberMessageThreadNearBottom,
  isMemberMessagesIntegrationEnabled,
  limitMemberMessageBody,
  memberMessageBodyIssue,
  memberMessageComposerLengthWarning,
  memberMessageDayKey,
  memberMessageThreadPreserveScrollAfterPrepend,
  memberMessageThreadShouldAutoScroll,
  memberMessageThreadShowJumpButton,
  memberMessagesSnapshotConfirmsConversations,
  messageHistoryPath,
  nextMemberMessageSend,
  parseMessageConversation,
  parseMessageHistory,
  presentMemberConversationsView,
  projectOutboundMessageOntoConversations,
  readMemberMessagesSnapshot,
  refreshMemberMessageThreadLatest,
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
    conversationsLoaded: true,
  });
  rememberMemberMessagesSnapshot({
    clerkUserId: "user_b",
    environment: "production",
    apiBaseUrl: baseUrl,
    conversations: [conversation(2, 0)],
    unreadCount: 0,
    conversationsLoaded: true,
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
  assert.equal(hook.match(/setInterval\(/g).length, 3);
  assert.match(hook, /AppState/);
  assert.match(hook, /memberMessagePollIntervalMs/);
  assert.match(hook, /refreshMemberMessageThreadLatest/);
  assert.match(hook, /historyInFlight/);
  assert.match(hook, /markReadInFlight/);
  assert.match(hook, /useMemberMessagesUnreadCount/);
  assert.match(hook, /rememberUnreadFromReadState|publishMemberMessageHint/);
  assert.match(readFileSync(resolve(projectRoot, "lib/memberMessageRealtime.ts"), "utf8"), /MEMBER_MESSAGE_POLL_MS/);
  assert.match(hook, /if \(!active \|\| !focused \|\| !foreground\) return;/);
  assert.match(hook, /clearMemberMessagesCache\(\)/);
  const auth = readFileSync(resolve(projectRoot, "context/AuthContext.tsx"), "utf8");
  assert.equal(auth.match(/clearMemberMessagesCache\(\)/g).length, 3);
  const screen = readFileSync(resolve(projectRoot, "components/MemberConnectionsScreen.tsx"), "utf8");
  assert.match(screen, /Connections aren’t available yet/);
  assert.match(screen, /connection\.member\.userId/);
  assert.match(screen, /messages\.open|useOpenAcceptedConversation/);
  assert.doesNotMatch(screen, /participantUserId/);
  const list = readFileSync(resolve(projectRoot, "components/MemberConversationList.tsx"), "utf8");
  assert.doesNotMatch(list, /member-messages-unread-total|unread messages/);
  assert.match(list, /formatMemberMessagesUnreadBadge/);
  assert.match(list, /member-messages-skeleton/);
  assert.match(list, /inbox\.view/);
  assert.match(hook, /listConfirmed/);
  assert.match(hook, /presentMemberConversationsView/);
  assert.match(hook, /memberMessagesSnapshotConfirmsConversations/);
  const thread = readFileSync(resolve(projectRoot, "components/MemberMessageThread.tsx"), "utf8");
  assert.match(thread, /memberMessageComposerLengthWarning/);
  assert.match(thread, /formatMemberMessageDaySeparator/);
  assert.match(thread, /maxWidth: '80%'/);
  assert.match(thread, /arrow-up/);
  assert.match(thread, /member-message-jump-latest/);
  assert.match(thread, /scrollToEnd/);
  assert.match(thread, /classifyMemberMessageThreadScrollChange/);
  assert.match(thread, /memberMessageThreadPreserveScrollAfterPrepend/);
  assert.doesNotMatch(thread, /\{Array\.from\(draft\)\.length\}\/\{MEMBER_MESSAGE_MAX_LENGTH\}/);
  const tabs = readFileSync(resolve(projectRoot, "app/(tabs)/_layout.tsx"), "utf8");
  assert.match(tabs, /useMemberMessagesUnreadCount/);
  assert.match(tabs, /connections-tab-unread-badge|NativeTabs\.Trigger\.Badge/);
  assert.match(tabs, /formatMemberMessagesUnreadBadge/);
  const policy = readFileSync(resolve(projectRoot, "lib/nativeAuthTestPolicy.ts"), "utf8");
  assert.doesNotMatch(policy, /\/me\/messages/);
  assert.equal(MEMBER_MESSAGE_POLL_MS, 10000);
});

test("outbound send projects onto the inbox conversation preview without inventing rows", () => {
  const existing = conversation();
  const sent = message(12, 7);
  const other = { ...conversation(8), participantUserId: "user_other" };
  const next = projectOutboundMessageOntoConversations({
    conversations: [existing, other],
    conversationId: 7,
    message: sent,
  });
  assert.equal(next[0].id, 7);
  assert.equal(next[0].latestMessage?.id, 12);
  assert.equal(next[0].latestMessage?.body, sent.body);
  assert.equal(next[0].unreadCount, 0);
  assert.equal(next[0].updatedAt, sent.createdAt);
  assert.equal(next[1].id, 8);

  const unknown = projectOutboundMessageOntoConversations({
    conversations: [existing],
    conversationId: 99,
    message: sent,
  });
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].latestMessage?.id, existing.latestMessage?.id);

  const hook = readFileSync(resolve(projectRoot, "lib/useMemberMessages.ts"), "utf8");
  assert.match(hook, /rememberOutboundMessageInInbox/);
  assert.match(hook, /projectOutboundMessageOntoConversations/);
  assert.match(hook, /kind: 'conversation'/);
  assert.match(hook, /publishMemberMessageHint/);
});

test("conversation inbox presentation never treats unconfirmed empty cache as empty", () => {
  assert.equal(memberMessagesSnapshotConfirmsConversations(null), false);
  assert.equal(memberMessagesSnapshotConfirmsConversations({
    clerkUserId: "user_a",
    environment: "production",
    apiBaseUrl: baseUrl,
    conversations: [],
    unreadCount: 2,
    conversationsLoaded: false,
  }), false);
  assert.equal(memberMessagesSnapshotConfirmsConversations({
    clerkUserId: "user_a",
    environment: "production",
    apiBaseUrl: baseUrl,
    conversations: [],
    unreadCount: 0,
    conversationsLoaded: true,
  }), true);
  assert.equal(presentMemberConversationsView({
    enabled: true,
    status: "loading",
    conversations: [],
    listConfirmed: false,
    refreshing: false,
    message: null,
  }).kind, "skeleton");
  assert.equal(presentMemberConversationsView({
    enabled: true,
    status: "ready",
    conversations: [],
    listConfirmed: false,
    refreshing: false,
    message: null,
  }).kind, "skeleton");
  assert.equal(presentMemberConversationsView({
    enabled: true,
    status: "ready",
    conversations: [],
    listConfirmed: true,
    refreshing: false,
    message: null,
  }).kind, "empty");
  assert.equal(presentMemberConversationsView({
    enabled: true,
    status: "error",
    conversations: [],
    listConfirmed: false,
    refreshing: false,
    message: "Messages could not be loaded. Try again.",
  }).kind, "error");
  const refreshing = presentMemberConversationsView({
    enabled: true,
    status: "ready",
    conversations: [conversation(3)],
    listConfirmed: true,
    refreshing: true,
    message: null,
  });
  assert.equal(refreshing.kind, "list");
  if (refreshing.kind === "list") {
    assert.equal(refreshing.refreshing, true);
    assert.equal(refreshing.conversations.length, 1);
  }
  clearMemberMessagesCache();
  rememberMemberMessagesSnapshot({
    clerkUserId: "user_flash",
    environment: "production",
    apiBaseUrl: baseUrl,
    conversations: [],
    unreadCount: 3,
    conversationsLoaded: false,
  });
  assert.equal(memberMessagesSnapshotConfirmsConversations(readMemberMessagesSnapshot({
    environment: "production",
    apiBaseUrl: baseUrl,
    clerkUserId: "user_flash",
  })), false);
  retainMemberMessagesForAccount("user_other");
  assert.equal(readMemberMessagesSnapshot({
    environment: "production",
    apiBaseUrl: baseUrl,
    clerkUserId: "user_flash",
  }), null);
});

test("thread auto-scroll follows the bottom unless the reader scrolled away", () => {
  assert.equal(MEMBER_MESSAGE_SCROLL_NEAR_BOTTOM_PX, 96);
  assert.equal(isMemberMessageThreadNearBottom({
    contentHeight: 1000,
    layoutHeight: 400,
    scrollOffset: 520,
  }), true);
  assert.equal(isMemberMessageThreadNearBottom({
    contentHeight: 1000,
    layoutHeight: 400,
    scrollOffset: 200,
  }), false);
  assert.equal(classifyMemberMessageThreadScrollChange({
    previous: null,
    newestId: 3,
    oldestId: 1,
    count: 3,
  }), "open");
  assert.equal(classifyMemberMessageThreadScrollChange({
    previous: { newestId: 3, oldestId: 1, count: 3 },
    newestId: 4,
    oldestId: 1,
    count: 4,
  }), "append");
  assert.equal(classifyMemberMessageThreadScrollChange({
    previous: { newestId: 4, oldestId: 2, count: 3 },
    newestId: 4,
    oldestId: 1,
    count: 4,
  }), "prepend");
  assert.equal(classifyMemberMessageThreadScrollChange({
    previous: { newestId: 4, oldestId: 1, count: 4 },
    newestId: 4,
    oldestId: 1,
    count: 4,
  }), "unchanged");
  assert.equal(classifyMemberMessageThreadScrollChange({
    previous: { newestId: 4, oldestId: 1, count: 4 },
    newestId: 4,
    oldestId: 1,
    count: 4,
    forceSendFollow: true,
  }), "send");
  assert.equal(memberMessageThreadShouldAutoScroll({ change: "open", nearBottom: false }), true);
  assert.equal(memberMessageThreadShouldAutoScroll({ change: "send", nearBottom: false }), true);
  assert.equal(memberMessageThreadShouldAutoScroll({ change: "append", nearBottom: true }), true);
  assert.equal(memberMessageThreadShouldAutoScroll({ change: "append", nearBottom: false }), false);
  assert.equal(memberMessageThreadShouldAutoScroll({ change: "prepend", nearBottom: true }), false);
  assert.equal(memberMessageThreadShouldAutoScroll({ change: "unchanged", nearBottom: true }), false);
  assert.equal(memberMessageThreadShowJumpButton({ nearBottom: false, hasMessages: true }), true);
  assert.equal(memberMessageThreadShowJumpButton({ nearBottom: true, hasMessages: true }), false);
  assert.equal(memberMessageThreadShowJumpButton({ nearBottom: false, hasMessages: false }), false);
  assert.equal(memberMessageThreadPreserveScrollAfterPrepend({
    previousContentHeight: 800,
    nextContentHeight: 1100,
    previousScrollOffset: 120,
  }), 420);
});

test("unread badges hide at zero and cap at 9+", () => {
  assert.equal(formatMemberMessagesUnreadBadge(0), null);
  assert.equal(formatMemberMessagesUnreadBadge(-1), null);
  assert.equal(formatMemberMessagesUnreadBadge(1), "1");
  assert.equal(formatMemberMessagesUnreadBadge(9), "9");
  assert.equal(formatMemberMessagesUnreadBadge(10), "9+");
  assert.equal(formatMemberMessagesUnreadBadge(99), "9+");
});

test("composer length warning appears only near the limit", () => {
  assert.equal(memberMessageComposerLengthWarning(""), null);
  assert.equal(memberMessageComposerLengthWarning("a".repeat(MEMBER_MESSAGE_MAX_LENGTH - MEMBER_MESSAGE_COMPOSER_WARN_REMAINING - 1)), null);
  assert.equal(
    memberMessageComposerLengthWarning("a".repeat(MEMBER_MESSAGE_MAX_LENGTH - MEMBER_MESSAGE_COMPOSER_WARN_REMAINING)),
    `${MEMBER_MESSAGE_MAX_LENGTH - MEMBER_MESSAGE_COMPOSER_WARN_REMAINING}/${MEMBER_MESSAGE_MAX_LENGTH}`,
  );
  assert.equal(
    memberMessageComposerLengthWarning("a".repeat(MEMBER_MESSAGE_MAX_LENGTH)),
    `${MEMBER_MESSAGE_MAX_LENGTH}/${MEMBER_MESSAGE_MAX_LENGTH}`,
  );
  assert.equal(limitMemberMessageBody("a".repeat(MEMBER_MESSAGE_MAX_LENGTH + 20)).length, MEMBER_MESSAGE_MAX_LENGTH);
});

test("message day separators use createdAt when present", () => {
  const now = new Date(2026, 10, 13, 12, 0, 0);
  const today = new Date(2026, 10, 13, 9, 0, 0).toISOString();
  const laterToday = new Date(2026, 10, 13, 18, 0, 0).toISOString();
  const yesterday = new Date(2026, 10, 12, 9, 0, 0).toISOString();
  const older = new Date(2026, 9, 1, 12, 0, 0).toISOString();
  assert.equal(memberMessageDayKey(today), memberMessageDayKey(laterToday));
  assert.notEqual(memberMessageDayKey(today), memberMessageDayKey(yesterday));
  assert.equal(memberMessageDayKey("not-a-date"), null);
  assert.equal(formatMemberMessageDaySeparator(today, now.getTime()), "Today");
  assert.equal(formatMemberMessageDaySeparator(yesterday, now.getTime()), "Yesterday");
  // Older days use the device locale; compare against the runtime's own
  // formatting so the test passes on any machine locale (e.g. uk-UA, en-US).
  const olderLabel = formatMemberMessageDaySeparator(older, now.getTime());
  assert.equal(
    olderLabel,
    new Date(older).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
  );
  assert.notEqual(olderLabel, "Today");
  assert.notEqual(olderLabel, "Yesterday");
});

test("markRead success can refresh shared unread snapshot state", async () => {
  clearMemberMessagesCache();
  rememberMemberMessagesSnapshot({
    clerkUserId: "user_a",
    environment: "production",
    apiBaseUrl: baseUrl,
    unreadCount: 4,
    conversationsLoaded: true,
    conversations: [conversation(7, 2), conversation(8, 2)],
  });
  const state = threadPollState();
  await refreshMemberMessageThreadLatest({
    ...state,
    isCurrent: () => true,
    isActive: () => true,
    fetchHistory: async () => ({
      kind: "loaded",
      data: { messages: [message(71)], nextCursor: null, hasMore: false },
    }),
    applyDisabled: () => {},
    applyError: () => {},
    applyLoaded: (page) => page.messages[page.messages.length - 1]?.id ?? null,
    markRead: async () => ({
      kind: "loaded",
      data: { conversationId: 7, lastReadMessageId: 71, unreadCount: 2 },
    }),
    onReadState: (readState) => {
      const existing = readMemberMessagesSnapshot({
        environment: "production",
        apiBaseUrl: baseUrl,
        clerkUserId: "user_a",
      });
      rememberMemberMessagesSnapshot({
        clerkUserId: "user_a",
        environment: "production",
        apiBaseUrl: baseUrl,
        unreadCount: readState.unreadCount,
        conversationsLoaded: existing?.conversationsLoaded === true,
        conversations: (existing?.conversations ?? []).map((item) => (
          item.id === 7 ? { ...item, unreadCount: 0 } : item
        )),
      });
    },
  });
  const snapshot = readMemberMessagesSnapshot({
    environment: "production",
    apiBaseUrl: baseUrl,
    clerkUserId: "user_a",
  });
  assert.equal(snapshot?.unreadCount, 2);
  assert.equal(snapshot?.conversations.find((item) => item.id === 7)?.unreadCount, 0);
  assert.equal(snapshot?.conversations.find((item) => item.id === 8)?.unreadCount, 2);
  assert.equal(formatMemberMessagesUnreadBadge(snapshot?.unreadCount ?? 0), "2");
  assert.equal(formatMemberMessagesUnreadBadge(0), null);
});

function threadPollState() {
  return {
    historyInFlight: { current: false },
    markReadInFlight: { current: false },
    historyLockGeneration: { current: 0 },
    markReadLockGeneration: { current: 0 },
    markedId: { current: null },
  };
}

test("a slow markRead cannot block the next history poll", async () => {
  const state = threadPollState();
  let historyCalls = 0;
  let markReadCalls = 0;
  let releaseMarkRead;
  const markReadGate = new Promise((resolve) => {
    releaseMarkRead = resolve;
  });
  const loaded = [];
  const first = refreshMemberMessageThreadLatest({
    ...state,
    isCurrent: () => true,
    isActive: () => true,
    fetchHistory: async () => {
      historyCalls += 1;
      return {
        kind: "loaded",
        data: { messages: [message(11)], nextCursor: null, hasMore: false },
      };
    },
    applyDisabled: () => {},
    applyError: () => {},
    applyLoaded: (page) => {
      loaded.push(...page.messages.map((item) => item.id));
      return page.messages[page.messages.length - 1]?.id ?? null;
    },
    markRead: async () => {
      markReadCalls += 1;
      await markReadGate;
      return { kind: "loaded", data: { conversationId: 7, lastReadMessageId: 11, unreadCount: 0 } };
    },
  });
  await Promise.resolve();
  assert.equal(historyCalls, 1);
  assert.equal(state.historyInFlight.current, false);
  assert.equal(state.markReadInFlight.current, true);

  const second = await refreshMemberMessageThreadLatest({
    ...state,
    isCurrent: () => true,
    isActive: () => true,
    fetchHistory: async () => {
      historyCalls += 1;
      return {
        kind: "loaded",
        data: { messages: [message(11), message(12)], nextCursor: null, hasMore: false },
      };
    },
    applyDisabled: () => {},
    applyError: () => {},
    applyLoaded: (page) => {
      loaded.push(...page.messages.map((item) => item.id));
      return page.messages[page.messages.length - 1]?.id ?? null;
    },
    markRead: async () => {
      markReadCalls += 1;
      return { kind: "loaded", data: { conversationId: 7, lastReadMessageId: 12, unreadCount: 0 } };
    },
  });
  assert.equal(second, "ran");
  assert.equal(historyCalls, 2);
  assert.equal(markReadCalls, 1);
  assert.deepEqual(loaded, [11, 11, 12]);
  releaseMarkRead();
  assert.equal(await first, "ran");
  assert.equal(state.markedId.current, 11);
  assert.equal(state.markReadInFlight.current, false);
});

test("a failed markRead still leaves history polling free and retries later", async () => {
  const state = threadPollState();
  let markReadCalls = 0;
  const first = await refreshMemberMessageThreadLatest({
    ...state,
    isCurrent: () => true,
    isActive: () => true,
    fetchHistory: async () => ({
      kind: "loaded",
      data: { messages: [message(21)], nextCursor: null, hasMore: false },
    }),
    applyDisabled: () => {},
    applyError: () => {},
    applyLoaded: (page) => page.messages[page.messages.length - 1]?.id ?? null,
    markRead: async () => {
      markReadCalls += 1;
      return { kind: "error", code: "network" };
    },
  });
  assert.equal(first, "ran");
  assert.equal(state.historyInFlight.current, false);
  assert.equal(state.markReadInFlight.current, false);
  assert.equal(state.markedId.current, null);
  assert.equal(markReadCalls, 1);

  const second = await refreshMemberMessageThreadLatest({
    ...state,
    isCurrent: () => true,
    isActive: () => true,
    fetchHistory: async () => ({
      kind: "loaded",
      data: { messages: [message(21)], nextCursor: null, hasMore: false },
    }),
    applyDisabled: () => {},
    applyError: () => {},
    applyLoaded: (page) => page.messages[page.messages.length - 1]?.id ?? null,
    markRead: async () => {
      markReadCalls += 1;
      return { kind: "loaded", data: { conversationId: 7, lastReadMessageId: 21, unreadCount: 0 } };
    },
  });
  assert.equal(second, "ran");
  assert.equal(markReadCalls, 2);
  assert.equal(state.markedId.current, 21);
});

test("overlapping history polls are skipped while one history request is active", async () => {
  const state = threadPollState();
  let historyCalls = 0;
  let releaseHistory;
  const historyGate = new Promise((resolve) => {
    releaseHistory = resolve;
  });
  const first = refreshMemberMessageThreadLatest({
    ...state,
    isCurrent: () => true,
    isActive: () => true,
    fetchHistory: async () => {
      historyCalls += 1;
      await historyGate;
      return {
        kind: "loaded",
        data: { messages: [message(31)], nextCursor: null, hasMore: false },
      };
    },
    applyDisabled: () => {},
    applyError: () => {},
    applyLoaded: (page) => page.messages[page.messages.length - 1]?.id ?? null,
    markRead: async () => ({ kind: "loaded", data: { conversationId: 7, lastReadMessageId: 31, unreadCount: 0 } }),
  });
  await Promise.resolve();
  assert.equal(state.historyInFlight.current, true);
  assert.equal(
    await refreshMemberMessageThreadLatest({
      ...state,
      isCurrent: () => true,
      isActive: () => true,
      fetchHistory: async () => {
        historyCalls += 1;
        return {
          kind: "loaded",
          data: { messages: [message(32)], nextCursor: null, hasMore: false },
        };
      },
      applyDisabled: () => {},
      applyError: () => {},
      applyLoaded: () => 32,
      markRead: async () => ({ kind: "loaded", data: { conversationId: 7, lastReadMessageId: 32, unreadCount: 0 } }),
    }),
    "skipped",
  );
  releaseHistory();
  assert.equal(await first, "ran");
  assert.equal(historyCalls, 1);
});

test("unmount or stale generation suppresses history and markRead side effects", async () => {
  const state = threadPollState();
  let current = true;
  let applied = 0;
  let marked = 0;
  let releaseHistory;
  const historyGate = new Promise((resolve) => {
    releaseHistory = resolve;
  });
  const pending = refreshMemberMessageThreadLatest({
    ...state,
    isCurrent: () => current,
    isActive: () => true,
    fetchHistory: async () => {
      await historyGate;
      return {
        kind: "loaded",
        data: { messages: [message(41)], nextCursor: null, hasMore: false },
      };
    },
    applyDisabled: () => {
      applied += 1;
    },
    applyError: () => {
      applied += 1;
    },
    applyLoaded: () => {
      applied += 1;
      return 41;
    },
    markRead: async () => {
      marked += 1;
      return { kind: "loaded", data: { conversationId: 7, lastReadMessageId: 41, unreadCount: 0 } };
    },
  });
  current = false;
  releaseHistory();
  assert.equal(await pending, "ran");
  assert.equal(applied, 0);
  assert.equal(marked, 0);
  assert.equal(state.markedId.current, null);
  assert.equal(state.historyInFlight.current, false);
});

test("conversation switching invalidates in-flight locks and allows a fresh poll", async () => {
  const state = threadPollState();
  let generation = 0;
  let historyCalls = 0;
  let appliedIds = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const first = refreshMemberMessageThreadLatest({
    ...state,
    isCurrent: () => generation === 0,
    isActive: () => true,
    fetchHistory: async () => {
      historyCalls += 1;
      await firstGate;
      return {
        kind: "loaded",
        data: { messages: [message(51, 7)], nextCursor: null, hasMore: false },
      };
    },
    applyDisabled: () => {},
    applyError: () => {},
    applyLoaded: (page) => {
      appliedIds.push(page.messages[0].id);
      return page.messages[0].id;
    },
    markRead: async () => ({ kind: "loaded", data: { conversationId: 7, lastReadMessageId: 51, unreadCount: 0 } }),
  });
  await Promise.resolve();
  assert.equal(state.historyInFlight.current, true);

  generation = 1;
  state.historyLockGeneration.current += 1;
  state.markReadLockGeneration.current += 1;
  state.historyInFlight.current = false;
  state.markReadInFlight.current = false;
  state.markedId.current = null;

  const second = await refreshMemberMessageThreadLatest({
    ...state,
    isCurrent: () => generation === 1,
    isActive: () => true,
    fetchHistory: async () => {
      historyCalls += 1;
      return {
        kind: "loaded",
        data: { messages: [message(61, 8)], nextCursor: null, hasMore: false },
      };
    },
    applyDisabled: () => {},
    applyError: () => {},
    applyLoaded: (page) => {
      appliedIds.push(page.messages[0].id);
      return page.messages[0].id;
    },
    markRead: async () => ({ kind: "loaded", data: { conversationId: 8, lastReadMessageId: 61, unreadCount: 0 } }),
  });
  assert.equal(second, "ran");
  assert.deepEqual(appliedIds, [61]);
  assert.equal(state.markedId.current, 61);

  releaseFirst();
  assert.equal(await first, "ran");
  assert.deepEqual(appliedIds, [61]);
  assert.equal(historyCalls, 2);
  assert.equal(state.historyInFlight.current, false);
});
