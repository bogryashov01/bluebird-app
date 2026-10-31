import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { shouldRedirectClerkRoute } from "../scripts/.connections-preview-session.test.mjs";
import {
  CONNECTIONS_INVITE_WITHOUT_LINK,
  MESSAGE_CHARACTER_LIMIT,
  createLocalConnectionsClient,
  createMemoryKeyValueStorage,
  formatPreviewTimestamp,
  initialConnectionsPane,
  matchDemoMemberByName,
  memberProfileAction,
  rememberConnectionsPane,
  searchDemoMembers,
  shouldApplyConnectionsResult,
} from "../scripts/.connections-preview.test.mjs";

const projectRoot = resolve(import.meta.dirname, "..");

function clock() {
  let sequence = 0;
  let time = Date.parse("2026-10-29T12:00:00.000Z");
  return {
    now: () => new Date(time).toISOString(),
    nextId: (prefix) => {
      sequence += 1;
      time += 1000;
      return `demo-${prefix}-${sequence}`;
    },
  };
}

function client(accountId, storage = createMemoryKeyValueStorage()) {
  return { storage, api: createLocalConnectionsClient(storage, accountId, clock()) };
}

test("member search matches demo display names and does not invent profiles", () => {
  assert.deepEqual(searchDemoMembers("lang").map((member) => member.displayName), ["Avery Lang"]);
  assert.deepEqual(searchDemoMembers("AVERY").map((member) => member.id), ["demo-avery-lang"]);
  assert.deepEqual(searchDemoMembers("zzz"), []);
  assert.equal(searchDemoMembers("").length, 5);
  for (const member of searchDemoMembers("")) {
    assert.match(member.headline, /^Demo profile/);
    assert.match(member.id, /^demo-/);
  }
});

test("requests require both intents and do not accept duplicates", async () => {
  const { api } = client("user_alpha");
  const members = await api.listMembers("");
  assert.equal(members.ok, true);
  assert.equal(members.data.find((member) => member.id === "demo-blake-ortiz").relationship, "none");
  assert.equal(members.data.find((member) => member.id === "demo-avery-lang").relationship, "incoming");
  const sent = await api.createRequest("demo-blake-ortiz");
  assert.equal(sent.ok, true);
  const duplicate = await api.createRequest("demo-blake-ortiz");
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.reason, "duplicate");
  const pendingIncoming = await api.createRequest("demo-avery-lang");
  assert.equal(pendingIncoming.reason, "duplicate");
  const requests = await api.listRequests();
  assert.equal(requests.data.outgoing.length, 1);
  assert.equal(requests.data.outgoing[0].member.displayName, "Blake Ortiz");
  const connections = await api.listConnections();
  assert.equal(connections.data.some((item) => item.member.id === "demo-blake-ortiz"), false);
  const cancelled = await api.cancelRequest(requests.data.outgoing[0].id);
  assert.equal(cancelled.ok, true);
  const again = await api.createRequest("demo-blake-ortiz");
  assert.equal(again.ok, true);
});

test("incoming requests can be accepted or declined without becoming connections on their own", async () => {
  const acceptedAccount = client("user_accept");
  const incoming = await acceptedAccount.api.listRequests();
  const requestId = incoming.data.incoming[0].id;
  const accepted = await acceptedAccount.api.acceptRequest(requestId);
  assert.equal(accepted.ok, true);
  const connected = await acceptedAccount.api.listConnections();
  assert.deepEqual(connected.data.map((item) => item.member.id).sort(), ["demo-avery-lang", "demo-ellis-morgan"]);
  const repeat = await acceptedAccount.api.acceptRequest(requestId);
  assert.equal(repeat.reason, "not-incoming");

  const declinedAccount = client("user_decline");
  const declineTarget = (await declinedAccount.api.listRequests()).data.incoming[0].id;
  const declined = await declinedAccount.api.declineRequest(declineTarget);
  assert.equal(declined.ok, true);
  const remaining = await declinedAccount.api.listRequests();
  assert.equal(remaining.data.incoming.length, 0);
  const members = await declinedAccount.api.listMembers("");
  assert.equal(members.data.find((member) => member.id === "demo-avery-lang").relationship, "none");
  assert.equal((await declinedAccount.api.listConnections()).data.some((item) => item.member.id === "demo-avery-lang"), false);
});

test("removing or blocking a connection prevents another message", async () => {
  const { api } = client("user_remove");
  const connections = await api.listConnections();
  const ellis = connections.data.find((item) => item.member.id === "demo-ellis-morgan");
  const opened = await api.openConversation(ellis.id);
  assert.equal(opened.data.conversationId, "demo-conversation-ellis");
  const removed = await api.removeConnection(ellis.id);
  assert.equal(removed.ok, true);
  const afterRemove = await api.sendMessage(opened.data.conversationId, "Hello after removal");
  assert.equal(afterRemove.reason, "not-connected");
  assert.equal((await api.listConnections()).data.some((item) => item.id === ellis.id), false);

  const blockedAccount = client("user_block");
  const blockedEllis = (await blockedAccount.api.listConnections()).data.find((item) => item.member.id === "demo-ellis-morgan");
  const blocked = await blockedAccount.api.blockMember(blockedEllis.id);
  assert.equal(blocked.ok, true);
  const blockedSend = await blockedAccount.api.sendMessage("demo-conversation-ellis", "Hello after block");
  assert.equal(blockedSend.reason, "not-connected");
  assert.equal((await blockedAccount.api.listMembers("")).data.find((member) => member.id === "demo-ellis-morgan").relationship, "blocked");
});

test("messages persist on this device, order by activity, and track unread samples", async () => {
  const { api, storage } = client("user_messages");
  const before = await api.unreadCount();
  assert.equal(before.data, 1);
  const sent = await api.sendMessage("demo-conversation-ellis", "  Saved locally  ");
  assert.equal(sent.ok, true);
  assert.equal(sent.data.message.author, "you");
  assert.equal(sent.data.message.body, "Saved locally");
  const empty = await api.sendMessage("demo-conversation-ellis", "   ");
  assert.equal(empty.reason, "empty-message");
  const tooLong = await api.sendMessage("demo-conversation-ellis", "a".repeat(MESSAGE_CHARACTER_LIMIT + 1));
  assert.equal(tooLong.reason, "message-too-long");
  const exact = await api.sendMessage("demo-conversation-ellis", "b".repeat(MESSAGE_CHARACTER_LIMIT));
  assert.equal(exact.ok, true);
  assert.equal((await api.unreadCount()).data, 1);

  const accepted = await api.acceptRequest("demo-request-avery");
  const avery = (await api.listConnections()).data.find((item) => item.member.id === "demo-avery-lang");
  const opened = await api.openConversation(avery.id);
  assert.equal((await api.listMessages(opened.data.conversationId)).data.length, 0);
  await api.sendMessage(opened.data.conversationId, "Newer local note");
  const conversations = await api.listConversations();
  assert.equal(conversations.data[0].id, opened.data.conversationId);
  assert.equal(conversations.data[0].unreadCount, 0);
  assert.ok(conversations.data.find((item) => item.id === "demo-conversation-ellis").unreadCount > 0);

  const reloaded = createLocalConnectionsClient(storage, "user_messages", clock());
  const persisted = await reloaded.listMessages("demo-conversation-ellis");
  assert.equal(persisted.data.some((message) => message.body === "Saved locally"), true);
  const read = await reloaded.markConversationRead("demo-conversation-ellis");
  assert.equal(read.ok, true);
  assert.equal((await reloaded.unreadCount()).data, 0);
  assert.equal((await reloaded.listMessages("demo-conversation-ellis")).data.every((message) => message.author !== "device-sample" || message.readAt), true);
});

test("account switching keeps demo connections and messages isolated", async () => {
  const storage = createMemoryKeyValueStorage();
  const alpha = createLocalConnectionsClient(storage, "user_alpha", clock());
  const beta = createLocalConnectionsClient(storage, "user_beta", clock());
  assert.equal((await alpha.createRequest("demo-casey-nguyen")).ok, true);
  await alpha.sendMessage("demo-conversation-ellis", "Alpha only");
  const alphaMembers = await alpha.listMembers("");
  const betaMembers = await beta.listMembers("");
  assert.equal(alphaMembers.data.find((member) => member.id === "demo-casey-nguyen").relationship, "outgoing");
  assert.equal(betaMembers.data.find((member) => member.id === "demo-casey-nguyen").relationship, "none");
  const betaMessages = await beta.listMessages("demo-conversation-ellis");
  assert.equal(betaMessages.data.some((message) => message.body === "Alpha only"), false);
  assert.equal(storage.records.size, 2);
  assert.equal(shouldApplyConnectionsResult({
    requestedAccountId: "user_alpha",
    requestedGeneration: 1,
    activeAccountId: "user_beta",
    activeGeneration: 2,
  }), false);
  assert.equal(shouldApplyConnectionsResult({
    requestedAccountId: "user_beta",
    requestedGeneration: 2,
    activeAccountId: "user_beta",
    activeGeneration: 2,
  }), true);
});

test("the connections pane starts from saved conversations and stays with the account that chose it", () => {
  assert.equal(initialConnectionsPane({ ready: false, conversationCount: 2 }), null);
  assert.equal(initialConnectionsPane({ ready: true, conversationCount: 1 }), "chats");
  assert.equal(initialConnectionsPane({ ready: true, conversationCount: 0 }), "connections");
  assert.equal(rememberConnectionsPane({
    accountId: "user_alpha",
    selectedAccountId: "user_alpha",
    selectedPane: "connections",
    ready: true,
    conversationCount: 3,
  }), "connections");
  assert.equal(rememberConnectionsPane({
    accountId: "user_beta",
    selectedAccountId: "user_alpha",
    selectedPane: "connections",
    ready: true,
    conversationCount: 1,
  }), "chats");
});

test("member profile actions and contact invites stay local", () => {
  assert.equal(memberProfileAction("none"), "connect");
  assert.equal(memberProfileAction("outgoing"), "pending");
  assert.equal(memberProfileAction("incoming"), "incoming");
  assert.equal(memberProfileAction("connected"), "message");
  assert.equal(memberProfileAction("blocked"), "unavailable");
  assert.equal(matchDemoMemberByName("avery lang")?.id, "demo-avery-lang");
  assert.equal(matchDemoMemberByName("Someone Else"), null);
  assert.equal(CONNECTIONS_INVITE_WITHOUT_LINK.includes("http"), false);
  const now = new Date(2026, 9, 29, 16, 20).getTime();
  const sameDay = new Date(2026, 9, 29, 9, 5).toISOString();
  const yesterday = new Date(2026, 9, 28, 9, 5).toISOString();
  assert.equal(formatPreviewTimestamp(sameDay, now), "9:05 AM");
  assert.equal(formatPreviewTimestamp(yesterday, now), "Yesterday");
  assert.equal(formatPreviewTimestamp("not-a-time", now), "");
});

test("the preview does not call production, networking, or staff comms APIs", () => {
  const files = [
    "lib/connectionsPreview.ts",
    "lib/useConnectionsPreview.ts",
    "components/ConnectionsPreviewHub.tsx",
    "components/ConnectionsPreviewChat.tsx",
    "components/ConnectionsPreviewMember.tsx",
    "components/ConnectionsPreviewChrome.tsx",
    "app/connections-preview/index.tsx",
    "app/connections-preview/member/[id].tsx",
    "app/connections-preview/chat/[id].tsx",
  ];
  for (const file of files) {
    const source = readFileSync(resolve(projectRoot, file), "utf8");
    assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|\/api\/connections|\/api\/conversations|\/api\/comms|\/api\/networking|useListNetworking|getMembership|joinEmptyLegQueue/);
  }
  const profile = readFileSync(resolve(projectRoot, "app/(tabs)/profile/index.tsx"), "utf8");
  const clerkProfile = profile.split("if (authMode === 'clerk') {")[1]?.split("const initials")[0] ?? "";
  assert.match(clerkProfile, /label: 'Connections'/);
  assert.match(clerkProfile, /Not available yet/);
  assert.match(clerkProfile, /isMemberConnectionsIntegrationEnabled/);
  assert.match(clerkProfile, /router\.navigate\('\/\(tabs\)\/connections'/);
  assert.doesNotMatch(clerkProfile, /useListNetworking|\/networking\/requests/);
  const tabs = readFileSync(resolve(projectRoot, "app/(tabs)/_layout.tsx"), "utf8");
  const tabScreen = readFileSync(resolve(projectRoot, "app/(tabs)/connections.tsx"), "utf8");
  assert.match(tabs, /title: 'Connections'/);
  assert.doesNotMatch(tabs, /name="connections" options=\{\{ href: null \}\}/);
  assert.match(tabScreen, /<MemberConnectionsScreen \/>/);
  assert.doesNotMatch(tabScreen, /ConnectionsHome|Avery Lang|demo-avery/);
  assert.doesNotMatch(tabScreen, /useListNetworking|fetch\(|\/api\/networking|\/api\/membership|\/api\/comms/);
  assert.equal(shouldRedirectClerkRoute(["connections-preview"], false, true), true);
  assert.equal(shouldRedirectClerkRoute(["connections-preview"], false, true, "", true), false);
  assert.equal(shouldRedirectClerkRoute(["(tabs)", "connections"], false, true), false);
  assert.equal(shouldRedirectClerkRoute(["(tabs)", "discover"], false, true), false);
  const hub = readFileSync(resolve(projectRoot, "components/ConnectionsPreviewHub.tsx"), "utf8");
  assert.match(hub, /Find Members/);
  assert.match(hub, /Find Contacts/);
  assert.match(hub, /Incoming requests/);
  assert.match(hub, /Sent requests/);
  assert.match(hub, /Bluebird Member/);
  assert.match(hub, /Invite to Bluebird/);
  assert.match(hub, /CONNECTIONS_INVITE_WITHOUT_LINK/);
  assert.match(hub, /connections-preview-loading/);
  assert.match(hub, /connections-preview-error/);
  assert.match(hub, /connections-preview-empty/);
  assert.match(hub, /connections-pane-\$\{item\}/);
  assert.match(hub, /item === 'chats' \? 'Chats' : 'Connections'/);
  assert.doesNotMatch(hub, /Event Chat|Flight Chat|useListNetworking|getMembership|\/api\/membership|\/api\/comms|presentContactPickerAsync\(\);\s*\n\s*useEffect/);
  const chat = readFileSync(resolve(projectRoot, "components/ConnectionsPreviewChat.tsx"), "utf8");
  assert.match(chat, />Send</);
  assert.match(chat, /MESSAGE_CHARACTER_LIMIT/);
  assert.match(chat, /connections-chat-empty/);
  assert.match(chat, /KeyboardAvoidingView/);
  assert.doesNotMatch(chat, /Delivered|Read receipt|typing|Event Chat|Flight Chat/);
});
