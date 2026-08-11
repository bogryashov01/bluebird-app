/**
 * Integration test for the production SMS delivery boundary.
 *
 * Boots the BUILT api-server with NODE_ENV=production twice:
 *  1. With SMS_WEBHOOK_URL pointing at a local capture server — proves a
 *     request-code call dispatches the code through the provider, the
 *     response/logs never expose the raw code, and the delivered code
 *     completes sign-in.
 *  2. With no provider configured — proves the endpoint fails closed (503).
 *
 * Run:  pnpm run build && pnpm run test:sms-provider   (needs DATABASE_URL)
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";

let failures = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  ${extra}`}`);
  if (!cond) failures++;
}

// ── Local SMS capture "provider" ─────────────────────────────────────────────
const received = [];
const capture = createServer((req, res) => {
  let data = "";
  req.on("data", (c) => (data += c));
  req.on("end", () => { received.push(JSON.parse(data)); res.writeHead(200).end("{}"); });
});
capture.listen(0);
await once(capture, "listening");
const webhookUrl = `http://127.0.0.1:${capture.address().port}/sms`;

async function startServer(extraEnv) {
  const port = 30000 + Math.floor(Math.random() * 2000);
  const child = spawn("node", ["./dist/index.mjs"], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      JWT_SECRET: process.env.JWT_SECRET || "sms-provider-test-secret",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (c) => (logs += c));
  child.stderr.on("data", (c) => (logs += c));
  // Wait for the port to accept requests
  const base = `http://127.0.0.1:${port}/api`;
  for (let i = 0; i < 60; i++) {
    try { await fetch(`${base}/flights`); break; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  return { child, base, getLogs: () => logs };
}

const phone = `+1425${String(Math.floor(Math.random() * 10000000)).padStart(7, "0")}`;

// ── 1. Production with a configured provider ────────────────────────────────
{
  const { child, base, getLogs } = await startServer({ SMS_WEBHOOK_URL: webhookUrl });
  try {
    const res = await fetch(`${base}/auth/request-code`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    const json = await res.json();
    check("prod request-code succeeds with provider configured", res.status === 200, JSON.stringify(json));
    check("prod response never exposes the code", !("demoCode" in json), JSON.stringify(json));
    check("provider received exactly one SMS", received.length === 1, JSON.stringify(received));
    const sms = received[0];
    check("SMS went to the requested number", sms?.to === phone, JSON.stringify(sms));
    const code = sms?.body?.match(/\b(\d{6})\b/)?.[1];
    check("SMS body contains a 6-digit code", typeof code === "string");
    check("prod logs never expose the code", !getLogs().includes(`[sms-code]`) && (code ? !getLogs().includes(code) : true));

    const verify = await fetch(`${base}/auth/verify-code`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, code }),
    });
    const vjson = await verify.json();
    check("delivered code completes sign-in", verify.status === 200 && typeof vjson.token === "string", JSON.stringify(vjson));
  } finally {
    child.kill("SIGKILL");
  }
}

// ── 2. Production with NO provider: fails closed ────────────────────────────
{
  const { child, base } = await startServer({ SMS_WEBHOOK_URL: "", TWILIO_ACCOUNT_SID: "" });
  try {
    const res = await fetch(`${base}/auth/request-code`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+14255551234" }),
    });
    check("prod without provider fails closed with 503", res.status === 503, String(res.status));
  } finally {
    child.kill("SIGKILL");
  }
}

capture.close();
console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
