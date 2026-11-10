import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";
import {
  AI_CONCIERGE_SEND_TIMEOUT_MS,
  acceptAiConciergeSupportUrl,
  aiConciergeFailureCopy,
  aiConciergeHistoryPath,
  canSubmitAiConciergeSend,
  clearAiConciergeCache,
  createAiConciergeClient,
  createAiConciergeClientMessageId,
  isAiConciergeIntegrationEnabled,
  mergeAiConciergeMessages,
  parseAiConciergeHistoryPage,
  parseAiConciergeSendResult,
  readAiConciergeSnapshot,
  rememberAiConciergeSnapshot,
  retainAiConciergeForAccount,
} from "../scripts/.ai-concierge.test.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const CLIENT_MESSAGE_ID = "11111111-1111-4111-8111-111111111111";

const previousNativeAuthTest = process.env.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST;
delete process.env.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST;
test.after(() => {
  if (previousNativeAuthTest === undefined) delete process.env.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST;
  else process.env.EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST = previousNativeAuthTest;
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function message(overrides = {}) {
  return {
    id: 10,
    conversationId: 7,
    clientMessageId: CLIENT_MESSAGE_ID,
    role: "user",
    body: "Are there any flights from Dallas next week?",
    status: "sent",
    createdAt: "2026-11-09T16:00:00.000Z",
    ...overrides,
  };
}

function assistant(overrides = {}) {
  return message({
    id: 11,
    clientMessageId: null,
    role: "assistant",
    body: "I can help with published empty-leg flights.",
    status: "answered",
    createdAt: "2026-11-09T16:00:01.000Z",
    ...overrides,
  });
}

test("the AI Concierge integration stays off unless explicitly enabled", () => {
  const previous = process.env.EXPO_PUBLIC_BLUEBIRD_AI_CONCIERGE;
  delete process.env.EXPO_PUBLIC_BLUEBIRD_AI_CONCIERGE;
  assert.equal(isAiConciergeIntegrationEnabled({ nativeAuthTest: false }), false);
  assert.equal(isAiConciergeIntegrationEnabled({ flag: undefined, nativeAuthTest: false }), false);
  assert.equal(isAiConciergeIntegrationEnabled({ flag: "false", nativeAuthTest: false }), false);
  assert.equal(isAiConciergeIntegrationEnabled({ flag: "TRUE", nativeAuthTest: false }), false);
  assert.equal(isAiConciergeIntegrationEnabled({ flag: "true", nativeAuthTest: true }), false);
  assert.equal(isAiConciergeIntegrationEnabled({ flag: "true", nativeAuthTest: false }), true);
  if (previous === undefined) delete process.env.EXPO_PUBLIC_BLUEBIRD_AI_CONCIERGE;
  else process.env.EXPO_PUBLIC_BLUEBIRD_AI_CONCIERGE = previous;

  const eas = readFileSync(resolve(projectRoot, "eas.json"), "utf8");
  assert.equal(eas.includes("EXPO_PUBLIC_BLUEBIRD_AI_CONCIERGE"), false);
  assert.equal(AI_CONCIERGE_SEND_TIMEOUT_MS >= 30_000, true);
});

test("history loads oldest-first pages and paginates with nextBefore", async () => {
  const calls = [];
  const client = createAiConciergeClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl: "https://bluebirdjets.com/api",
    getAccessToken: async () => "clerk-session-jwt",
    fetcher: async (url, init) => {
      const headers = init.headers ?? {};
      const auth = typeof headers.get === "function"
        ? headers.get("Authorization")
        : headers.Authorization;
      calls.push({ url: String(url), method: init.method, auth });
      return jsonResponse({
        messages: [
          message({ id: 8, body: "Older", clientMessageId: null }),
          message({ id: 9, body: "Newer", role: "assistant", status: "answered", clientMessageId: null }),
        ],
        nextBefore: "8",
      });
    },
  });
  const page = await client.history({ limit: 50 });
  assert.equal(page.kind, "loaded");
  assert.equal(page.data.messages[0].body, "Older");
  assert.equal(page.data.messages[1].body, "Newer");
  assert.equal(page.data.nextBefore, "8");
  assert.match(calls[0].url, /\/api\/me\/ai-concierge\/messages\?limit=50$/);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].auth, "Bearer clerk-session-jwt");

  const olderPath = aiConciergeHistoryPath({ before: "8", limit: 50 });
  assert.equal(olderPath.ok, true);
  assert.match(olderPath.path, /before=8/);
  assert.equal(aiConciergeHistoryPath({ before: "0" }).ok, false);
  assert.deepEqual(
    mergeAiConciergeMessages(
      [message({ id: 8, body: "Older", clientMessageId: null })],
      [message({ id: 9, body: "Newer", role: "assistant", status: "answered", clientMessageId: null })],
    ).map((item) => item.id),
    [8, 9],
  );
  assert.equal(parseAiConciergeHistoryPage({
    messages: [message({ id: 8, clientMessageId: null })],
    nextBefore: null,
  }).nextBefore, null);
});

test("a successful send posts a UUID clientMessageId and returns both messages", async () => {
  const bodies = [];
  const client = createAiConciergeClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl: "https://bluebirdjets.com/api",
    getAccessToken: async () => "clerk-session-jwt",
    fetcher: async (url, init) => {
      bodies.push(JSON.parse(init.body));
      return jsonResponse({
        conversationId: 7,
        userMessage: message(),
        assistantMessage: assistant(),
        replayed: false,
        supportUrl: null,
      });
    },
  });
  const result = await client.send({
    clientMessageId: CLIENT_MESSAGE_ID,
    body: "Are there any flights from Dallas next week?",
  });
  assert.equal(result.kind, "loaded");
  assert.equal(result.data.conversationId, 7);
  assert.equal(result.data.userMessage.id, 10);
  assert.equal(result.data.assistantMessage.status, "answered");
  assert.equal(result.data.replayed, false);
  assert.deepEqual(bodies[0], {
    clientMessageId: CLIENT_MESSAGE_ID,
    body: "Are there any flights from Dallas next week?",
  });
  assert.equal(canSubmitAiConciergeSend({ inFlight: false, body: "Hello" }), true);
  assert.equal(canSubmitAiConciergeSend({ inFlight: true, body: "Hello" }), false);
  assert.equal(canSubmitAiConciergeSend({ inFlight: false, body: "   " }), false);
});

test("retries keep the same clientMessageId and duplicate submits are refused", async () => {
  const first = createAiConciergeClientMessageId(() => CLIENT_MESSAGE_ID);
  const second = createAiConciergeClientMessageId(() => CLIENT_MESSAGE_ID);
  assert.equal(first, CLIENT_MESSAGE_ID);
  assert.equal(second, CLIENT_MESSAGE_ID);
  assert.equal(canSubmitAiConciergeSend({ inFlight: true, body: "Retry me" }), false);

  const ids = [];
  const client = createAiConciergeClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl: "https://bluebirdjets.com/api",
    getAccessToken: async () => "clerk-session-jwt",
    fetcher: async (_url, init) => {
      ids.push(JSON.parse(init.body).clientMessageId);
      return jsonResponse({
        conversationId: 7,
        userMessage: message({ clientMessageId: CLIENT_MESSAGE_ID }),
        assistantMessage: assistant(),
        replayed: ids.length > 1,
        supportUrl: null,
      });
    },
  });
  const once = await client.send({ clientMessageId: CLIENT_MESSAGE_ID, body: "Retry me" });
  const twice = await client.send({ clientMessageId: CLIENT_MESSAGE_ID, body: "Retry me" });
  assert.equal(once.kind, "loaded");
  assert.equal(twice.kind, "loaded");
  assert.equal(twice.data.replayed, true);
  assert.deepEqual(ids, [CLIENT_MESSAGE_ID, CLIENT_MESSAGE_ID]);
});

test("slow responses, membership restrictions, and rate limits stay fail-closed", async () => {
  const slow = createAiConciergeClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl: "https://bluebirdjets.com/api",
    getAccessToken: async () => "clerk-session-jwt",
    sendTimeoutMs: 20,
    fetcher: async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return jsonResponse({
        conversationId: 7,
        userMessage: message(),
        assistantMessage: assistant(),
        replayed: false,
        supportUrl: null,
      });
    },
  });
  assert.equal((await slow.send({ clientMessageId: CLIENT_MESSAGE_ID, body: "Hello" })).code, "timeout");
  assert.match(aiConciergeFailureCopy("timeout"), /longer than expected/);

  const membership = createAiConciergeClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl: "https://bluebirdjets.com/api",
    getAccessToken: async () => "clerk-session-jwt",
    fetcher: async () => jsonResponse({ code: "active_membership_required" }, 403),
  });
  assert.equal((await membership.send({ clientMessageId: CLIENT_MESSAGE_ID, body: "Hello" })).code, "membership_required");
  assert.match(aiConciergeFailureCopy("membership_required"), /active Bluebird membership/);

  const limited = createAiConciergeClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl: "https://bluebirdjets.com/api",
    getAccessToken: async () => "clerk-session-jwt",
    fetcher: async () => jsonResponse({ code: "rate_limited" }, 429),
  });
  assert.equal((await limited.send({ clientMessageId: CLIENT_MESSAGE_ID, body: "Hello" })).code, "rate_limited");
  assert.match(aiConciergeFailureCopy("rate_limited"), /Too many Concierge requests/);

  const conflict = createAiConciergeClient({
    enabled: true,
    nativeAuthTest: false,
    environment: "production",
    baseUrl: "https://bluebirdjets.com/api",
    getAccessToken: async () => "clerk-session-jwt",
    fetcher: async () => jsonResponse({ code: "idempotency_conflict" }, 409),
  });
  assert.equal((await conflict.send({ clientMessageId: CLIENT_MESSAGE_ID, body: "Hello" })).code, "conflict");
});

test("needs_support returns a verified support URL and never claims an automatic handoff", async () => {
  const supportUrl = "https://bluebirdjets.com/contact";
  const parsed = parseAiConciergeSendResult({
    conversationId: 7,
    userMessage: message(),
    assistantMessage: assistant({ status: "needs_support", body: "Please contact support." }),
    replayed: false,
    supportUrl,
  });
  assert.equal(parsed.assistantMessage.status, "needs_support");
  assert.equal(parsed.supportUrl, supportUrl);
  assert.equal(acceptAiConciergeSupportUrl(supportUrl), supportUrl);
  assert.equal(acceptAiConciergeSupportUrl("https://evil.example/contact"), null);
  assert.equal(acceptAiConciergeSupportUrl("https://bluebirdjets.com/api/secret"), null);

  const screen = readFileSync(resolve(projectRoot, "components/ProductionAiConciergeChat.tsx"), "utf8");
  assert.match(screen, /Contact Support/);
  assert.match(screen, /No staff handoff was created automatically/);
  assert.doesNotMatch(screen, /Callback Requested|A team member will contact you/);
  assert.doesNotMatch(screen, /anthropic|openai|apiKey|OPENAI|ANTHROPIC/i);
});

test("logout and account switch clear the Concierge cache", () => {
  clearAiConciergeCache();
  rememberAiConciergeSnapshot({
    clerkUserId: "user_a",
    environment: "production",
    apiBaseUrl: "https://bluebirdjets.com/api",
    messages: [message({ clientMessageId: null })],
    nextBefore: null,
  });
  rememberAiConciergeSnapshot({
    clerkUserId: "user_b",
    environment: "production",
    apiBaseUrl: "https://bluebirdjets.com/api",
    messages: [message({ id: 20, clientMessageId: null })],
    nextBefore: "20",
  });
  retainAiConciergeForAccount("user_a");
  assert.equal(readAiConciergeSnapshot({
    environment: "production",
    apiBaseUrl: "https://bluebirdjets.com/api",
    clerkUserId: "user_a",
  })?.messages[0].id, 10);
  assert.equal(readAiConciergeSnapshot({
    environment: "production",
    apiBaseUrl: "https://bluebirdjets.com/api",
    clerkUserId: "user_b",
  }), null);
  clearAiConciergeCache();
  assert.equal(readAiConciergeSnapshot({
    environment: "production",
    apiBaseUrl: "https://bluebirdjets.com/api",
    clerkUserId: "user_a",
  }), null);

  const auth = readFileSync(resolve(projectRoot, "context/AuthContext.tsx"), "utf8");
  assert.equal(auth.match(/clearAiConciergeCache\(\)/g).length, 3);
});

test("production Concierge stays gated and demo chat stays isolated", () => {
  const concierge = readFileSync(resolve(projectRoot, "app/concierge.tsx"), "utf8");
  const production = readFileSync(resolve(projectRoot, "components/ProductionAiConciergeChat.tsx"), "utf8");
  const demo = readFileSync(resolve(projectRoot, "components/DemoConciergeChat.tsx"), "utf8");
  const engine = readFileSync(resolve(projectRoot, "lib/demoConcierge.ts"), "utf8");
  const client = readFileSync(resolve(projectRoot, "lib/aiConcierge.ts"), "utf8");
  const hook = readFileSync(resolve(projectRoot, "lib/useAiConcierge.ts"), "utf8");
  assert.match(concierge, /if \(demoMode\) \{\s*return <DemoConciergeChat \/>;/);
  assert.match(concierge, /isAiConciergeIntegrationEnabled\(\)/);
  assert.match(concierge, /ProductionAiConciergeChat/);
  assert.match(concierge, /clerk-concierge-unavailable/);
  assert.match(production, /useAiConcierge/);
  assert.match(hook, /createAiConciergeClientMessageId/);
  assert.match(hook, /clientMessageId/);
  assert.match(hook, /retryFailed/);
  assert.match(client, /EXPO_PUBLIC_BLUEBIRD_AI_CONCIERGE/);
  assert.match(client, /\/me\/ai-concierge\/messages/);
  assert.doesNotMatch(client, /anthropic|openai|api[_-]?key|sk-/i);
  assert.doesNotMatch(production, /DemoConciergeChat|demoConcierge|useConciergeChat/);
  assert.doesNotMatch(demo, /aiConcierge|ProductionAiConciergeChat|fetch\(/);
  assert.doesNotMatch(engine, /fetch\(|aiConcierge|Authorization/);
  const disabled = createAiConciergeClient({
    enabled: false,
    nativeAuthTest: false,
    environment: "production",
    baseUrl: "https://bluebirdjets.com/api",
    getAccessToken: async () => {
      throw new Error("token must not be read");
    },
    fetcher: async () => {
      throw new Error("fetch must not run");
    },
  });
  return Promise.all([
    disabled.history(),
    disabled.send({ clientMessageId: CLIENT_MESSAGE_ID, body: "Hello" }),
  ]).then(([history, send]) => {
    assert.equal(history.kind, "disabled");
    assert.equal(send.kind, "disabled");
  });
});
