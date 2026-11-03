import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";
import {
  acceptMessagingGatewayUrl,
  createMemberMessageRealtimeSession,
  defaultMessagingGatewayOrigin,
  isMemberMessageRealtimeEnabled,
  memberMessageAuthCloseHalts,
  memberMessageAuthFrame,
  memberMessagePollIntervalMs,
  parseMemberMessageRealtimeFrame,
  realtimeHintRequestsHistory,
  realtimeReconnectDelayMs,
  resolveMessagingGatewayOrigin,
  startMemberMessageRealtime,
  stopMemberMessageRealtime,
  subscribeMemberMessageHints,
} from "../scripts/.member-message-realtime.test.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const GATEWAY = "wss://gateway.example.test/ws";
const JWT = "clerk-session-jwt";
const REFRESHED_JWT = "clerk-session-jwt-refreshed";

function socketDouble(url) {
  return {
    url,
    origin: null,
    sent: [],
    closed: false,
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    send(data) { this.sent.push(data); },
    close() {
      this.closed = true;
      this.onclose?.();
    },
  };
}

function deferredSchedule() {
  const timers = [];
  return {
    timers,
    pending() {
      return timers.filter((timer) => !timer.cancelled);
    },
    schedule(callback, delayMs) {
      const timer = { delayMs, callback, cancelled: false, cancel() { this.cancelled = true; } };
      timers.push(timer);
      return timer;
    },
    flush() {
      const timer = timers.find((item) => !item.cancelled);
      if (!timer) return false;
      timer.cancelled = true;
      timer.callback();
      return true;
    },
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

function session(overrides = {}) {
  const hints = [];
  const live = [];
  const sockets = [];
  const clock = deferredSchedule();
  const created = createMemberMessageRealtimeSession({
    gatewayUrl: GATEWAY,
    clerkUserId: "user_a",
    origin: null,
    getAccessToken: async () => JWT,
    createSocket: (url, origin) => {
      const socket = socketDouble(url);
      socket.origin = origin;
      sockets.push(socket);
      return socket;
    },
    onHint: (hint) => hints.push(hint),
    onLive: (value) => live.push(value),
    schedule: clock.schedule,
    random: () => 0,
    ...overrides,
  });
  return { hints, live, sockets, clock, created };
}

async function authenticate(socket) {
  socket.onopen();
  await settle();
  socket.onmessage({ data: JSON.stringify({ type: "authenticated" }) });
}

const createdEvent = {
  type: "message.created",
  data: { conversationId: 42, messageId: 19, createdAt: "2026-10-30T10:00:00.000Z" },
};

test("realtime stays off unless the flag and member messages are both enabled", () => {
  assert.equal(isMemberMessageRealtimeEnabled({ flag: undefined, messagesEnabled: true, nativeAuthTest: false }), false);
  assert.equal(isMemberMessageRealtimeEnabled({ flag: "false", messagesEnabled: true, nativeAuthTest: false }), false);
  assert.equal(isMemberMessageRealtimeEnabled({ flag: "true", messagesEnabled: false, nativeAuthTest: false }), false);
  assert.equal(isMemberMessageRealtimeEnabled({ flag: "true", messagesEnabled: true, nativeAuthTest: true }), false);
  assert.equal(isMemberMessageRealtimeEnabled({ flag: "true", messagesEnabled: true, nativeAuthTest: false }), true);
  assert.equal(acceptMessagingGatewayUrl(GATEWAY), GATEWAY);
  assert.equal(acceptMessagingGatewayUrl("wss://gateway.example.test/member/ws/"), "wss://gateway.example.test/member/ws");
  assert.equal(acceptMessagingGatewayUrl("ws://gateway.example.test/ws"), null);
  assert.equal(acceptMessagingGatewayUrl("wss://bluebirdjets.com/api/me/messages/stream"), null);
  assert.equal(acceptMessagingGatewayUrl(`${GATEWAY}?token=${JWT}`), null);
  assert.equal(memberMessageAuthFrame(` ${JWT}`), null);
  assert.equal(memberMessageAuthFrame(JWT), JSON.stringify({ type: "authenticate", token: JWT }));
  assert.equal(memberMessagePollIntervalMs({ realtimeEnabled: false, socketLive: false }), 15000);
  assert.equal(memberMessagePollIntervalMs({ realtimeEnabled: true, socketLive: false }), 15000);
  assert.equal(memberMessagePollIntervalMs({ realtimeEnabled: true, socketLive: true }), null);
  assert.equal(realtimeReconnectDelayMs(1, 0), 1000);
  assert.equal(realtimeReconnectDelayMs(2, 0), 2000);
  assert.equal(realtimeReconnectDelayMs(1, 0.5), 1100);
  assert.equal(realtimeReconnectDelayMs(20, 0), 30000);
  assert.equal(memberMessageAuthCloseHalts(1008, "Authentication failed"), true);
  assert.equal(memberMessageAuthCloseHalts(1008, "Authentication required"), true);
  assert.equal(memberMessageAuthCloseHalts(1008, "Connection limit reached"), false);
  assert.equal(defaultMessagingGatewayOrigin(GATEWAY), "https://gateway.example.test");
  assert.equal(defaultMessagingGatewayOrigin("wss://gateway.example.test:8443/ws"), "https://gateway.example.test:8443");
  assert.deepEqual(resolveMessagingGatewayOrigin(undefined), { status: "platform-default" });
  assert.deepEqual(resolveMessagingGatewayOrigin("https://members.example.test/"), {
    status: "configured",
    origin: "https://members.example.test",
  });
  assert.deepEqual(resolveMessagingGatewayOrigin("http://members.example.test"), { status: "invalid" });
  assert.deepEqual(resolveMessagingGatewayOrigin("https://members.example.test/app"), { status: "invalid" });
});

test("the handshake sends authenticate and accepts authenticated without a user id", async () => {
  const { sockets, hints, live } = session();
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].url, GATEWAY);
  assert.equal(sockets[0].origin, null);
  assert.equal(sockets[0].url.includes(JWT), false);
  sockets[0].onopen();
  await settle();
  assert.deepEqual(JSON.parse(sockets[0].sent[0]), { type: "authenticate", token: JWT });
  sockets[0].onmessage({ data: JSON.stringify({ type: "auth.ok", userId: "user_a" }) });
  sockets[0].onmessage({ data: JSON.stringify({ type: "authenticated" }) });
  assert.deepEqual(hints, [{ kind: "auth", clerkUserId: "user_a" }]);
  assert.deepEqual(live, [true]);
  assert.equal(parseMemberMessageRealtimeFrame("{"), null);
  assert.equal(parseMemberMessageRealtimeFrame(JSON.stringify({ type: "authenticated", userId: "user_b" })).type, "authenticated");
  assert.equal(parseMemberMessageRealtimeFrame(JSON.stringify({ type: "membership.updated" })), null);
  assert.equal(memberMessagePollIntervalMs({ realtimeEnabled: true, socketLive: live.at(-1) === true }), null);
});

test("gateway events refresh the matching conversation and a duplicate message id is ignored", async () => {
  const { sockets, hints } = session();
  await authenticate(sockets[0]);
  sockets[0].onmessage({ data: JSON.stringify(createdEvent) });
  sockets[0].onmessage({ data: JSON.stringify(createdEvent) });
  sockets[0].onmessage({
    data: JSON.stringify({
      type: "message.created",
      data: { conversationId: 8, messageId: 42, createdAt: "2026-10-30T10:00:01.000Z" },
    }),
  });
  sockets[0].onmessage({
    data: JSON.stringify({
      type: "conversation.updated",
      data: { conversationId: 42, updatedAt: "2026-10-30T10:00:00.000Z" },
    }),
  });
  sockets[0].onmessage({
    data: JSON.stringify({ type: "unread.changed", data: { conversationId: 42, unreadCount: 1 } }),
  });
  sockets[0].onmessage({ data: JSON.stringify({ type: "message.created", conversationId: 42, messageId: 19 }) });
  sockets[0].onmessage({ data: JSON.stringify({ type: "ping" }) });
  assert.deepEqual(hints.map((hint) => hint.kind), ["auth", "message", "message", "conversation", "unread"]);
  assert.equal(hints[1].conversationId, 42);
  assert.equal(hints[1].messageId, 19);
  assert.equal(hints[1].clerkUserId, "user_a");
  assert.equal(hints[2].conversationId, 8);
  assert.equal(realtimeHintRequestsHistory(hints[1], 42), true);
  assert.equal(realtimeHintRequestsHistory(hints[1], 8), false);
  assert.equal(realtimeHintRequestsHistory(hints[3], 42), true);
  assert.equal(realtimeHintRequestsHistory(hints[4], 42), false);
  assert.deepEqual(sockets[0].sent.map((frame) => JSON.parse(frame).type), ["authenticate"]);
});

test("an unavailable gateway keeps HTTP polling and a dropped socket reconnects", async () => {
  const clock = deferredSchedule();
  createMemberMessageRealtimeSession({
    gatewayUrl: GATEWAY,
    clerkUserId: "user_a",
    getAccessToken: async () => JWT,
    createSocket: () => {
      throw new Error("offline");
    },
    onHint: () => assert.fail("unavailable gateway must not emit hints"),
    schedule: clock.schedule,
    random: () => 0,
  });
  assert.equal(clock.pending().length, 1);
  assert.equal(clock.pending()[0].delayMs, 1000);
  assert.equal(memberMessagePollIntervalMs({ realtimeEnabled: true, socketLive: false }), 15000);

  const live = session();
  await authenticate(live.sockets[0]);
  live.sockets[0].onclose({ code: 1006, reason: "" });
  assert.deepEqual(live.live, [true, false]);
  assert.equal(memberMessagePollIntervalMs({ realtimeEnabled: true, socketLive: false }), 15000);
  assert.equal(live.clock.pending().length, 1);
  assert.equal(live.clock.pending()[0].delayMs, 1000);
  live.clock.flush();
  assert.equal(live.sockets.length, 2);
  live.sockets[1].onopen();
  await settle();
  assert.equal(JSON.parse(live.sockets[1].sent[0]).type, "authenticate");
  live.sockets[1].onmessage({ data: JSON.stringify({ type: "authenticated" }) });
  assert.equal(live.hints.filter((hint) => hint.kind === "auth").length, 2);
});

test("close code 1008 does not reuse the rejected token", async () => {
  let token = JWT;
  const { sockets, hints, clock, live } = session({
    getAccessToken: async () => token,
  });
  await authenticate(sockets[0]);
  sockets[0].onclose({ code: 1008, reason: "Authentication failed" });
  assert.equal(hints.some((hint) => hint.kind === "message"), false);
  assert.equal(live.at(-1), false);
  assert.equal(clock.pending().length, 1);
  clock.flush();
  await settle();
  assert.equal(sockets.length, 1);
  token = REFRESHED_JWT;
  clock.flush();
  await settle();
  assert.equal(sockets.length, 2);
  sockets[1].onopen();
  await settle();
  assert.equal(JSON.parse(sockets[1].sent[0]).token, REFRESHED_JWT);
  assert.equal(sockets[0].onclose, null);
  assert.equal(sockets.length, 2);
});

test("a connection limit backs off and foreground recovery can try the same token again", async () => {
  const first = session();
  await authenticate(first.sockets[0]);
  first.sockets[0].onclose({ code: 1008, reason: "Connection limit reached" });
  assert.equal(first.clock.pending().length, 1);
  first.clock.flush();
  assert.equal(first.sockets.length, 2);

  let token = JWT;
  const halted = session({ getAccessToken: async () => token });
  await authenticate(halted.sockets[0]);
  halted.sockets[0].onclose({ code: 1008, reason: "Authentication required" });
  halted.created.stop();
  assert.equal(halted.sockets[0].onmessage, null);
  assert.equal(halted.clock.pending().length, 0);

  const restarted = [];
  startMemberMessageRealtime({
    clerkUserId: "user_a",
    gatewayUrl: GATEWAY,
    getAccessToken: async () => token,
    createSocket: (url, origin) => {
      const socket = socketDouble(url);
      socket.origin = origin;
      restarted.push(socket);
      return socket;
    },
    schedule: deferredSchedule().schedule,
    random: () => 0,
  });
  assert.equal(restarted.length, 1);
  assert.equal(restarted[0].origin, null);
  stopMemberMessageRealtime();
});

test("sign-out and an account switch ignore the previous socket", async () => {
  const first = session();
  await authenticate(first.sockets[0]);
  first.created.stop();
  assert.equal(first.sockets[0].closed, true);
  assert.equal(first.sockets[0].onmessage, null);
  assert.equal(first.clock.pending().length, 0);

  const switched = [];
  const hints = [];
  const clock = deferredSchedule();
  const open = (clerkUserId) => startMemberMessageRealtime({
    clerkUserId,
    gatewayUrl: GATEWAY,
    getAccessToken: async () => JWT,
    createSocket: (url) => {
      const socket = socketDouble(url);
      switched.push(socket);
      return socket;
    },
    schedule: clock.schedule,
    random: () => 0,
  });
  const unsubscribe = subscribeMemberMessageHints((hint) => hints.push(hint));
  open("user_a");
  open("user_a");
  assert.equal(switched.length, 1);
  await authenticate(switched[0]);
  const stale = switched[0].onmessage;
  open("user_b");
  assert.equal(switched[0].closed, true);
  assert.equal(switched[0].onmessage, null);
  assert.equal(switched.length, 2);
  stale({ data: JSON.stringify(createdEvent) });
  await authenticate(switched[1]);
  switched[1].onmessage({
    data: JSON.stringify({
      type: "message.created",
      data: { conversationId: 9, messageId: 3, createdAt: "2026-10-30T10:00:00.000Z" },
    }),
  });
  assert.equal(hints.some((hint) => hint.clerkUserId === "user_a" && hint.kind === "message"), false);
  assert.equal(hints.some((hint) => hint.kind === "message" && hint.conversationId === 9 && hint.clerkUserId === "user_b"), true);
  stopMemberMessageRealtime();
  assert.equal(switched[1].closed, true);
  unsubscribe();
});

test("a configured origin is sent and an invalid origin does not connect", () => {
  const configured = session({ origin: "https://members.example.test" });
  assert.equal(configured.sockets[0].origin, "https://members.example.test");
  configured.created.stop();

  const opened = [];
  startMemberMessageRealtime({
    clerkUserId: "user_a",
    gatewayUrl: GATEWAY,
    gatewayOrigin: "https://members.example.test/app",
    getAccessToken: async () => JWT,
    createSocket: () => {
      opened.push(true);
      return socketDouble(GATEWAY);
    },
    schedule: deferredSchedule().schedule,
    random: () => 0,
  });
  assert.equal(opened.length, 0);
  stopMemberMessageRealtime();
});

test("the production profile does not enable the gateway and HTTP sending stays in place", () => {
  const eas = readFileSync(resolve(projectRoot, "eas.json"), "utf8");
  assert.equal(eas.includes("EXPO_PUBLIC_BLUEBIRD_MESSAGING_REALTIME"), false);
  assert.equal(eas.includes("EXPO_PUBLIC_BLUEBIRD_MESSAGING_GATEWAY_URL"), false);
  assert.equal(eas.includes("EXPO_PUBLIC_BLUEBIRD_MESSAGING_GATEWAY_ORIGIN"), false);
  const messages = readFileSync(resolve(projectRoot, "lib/memberMessages.ts"), "utf8");
  const hook = readFileSync(resolve(projectRoot, "lib/useMemberMessages.ts"), "utf8");
  const realtime = readFileSync(resolve(projectRoot, "lib/memberMessageRealtime.ts"), "utf8");
  assert.equal(messages.includes("WebSocket"), false);
  assert.equal(hook.includes("WebSocket"), false);
  assert.match(messages, /messages: \(conversationId: number\)/);
  assert.match(hook, /client\.send\(conversationId, body\)/);
  assert.equal(realtime.includes("console."), false);
  assert.equal(realtime.includes("type: 'pong'"), false);
  assert.equal(realtime.includes("type: 'auth',"), false);
  assert.equal(realtime.includes("auth.ok"), false);
  assert.match(realtime, /type: 'authenticate'/);
  assert.match(realtime, /SocketRocket 0\.7\.1/);
  assert.match(realtime, /headers: \{ Origin: origin \}/);
  assert.equal(realtime.includes("https://bluebird"), false);
  assert.match(readFileSync(resolve(projectRoot, "app/_layout.tsx"), "utf8"), /MemberMessageRealtime/);
});
