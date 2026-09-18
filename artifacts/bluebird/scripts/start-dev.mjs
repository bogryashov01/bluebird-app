#!/usr/bin/env node
/**
 * Starts Expo for local macOS development, and keeps the Replit start flags
 * when Replit env is present so `pnpm --filter @workspace/bluebird run dev`
 * still works in that environment.
 *
 * Default (non-Replit) is LAN mode so Expo Go on a physical phone can load
 * the bundle. Loopback-only: EXPO_DEV_HOST=localhost (see `dev:localhost`).
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(projectDir, "../..");

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  for (const rawLine of readFileSync(filePath, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function detectLanIp() {
  const ifaces = os.networkInterfaces();
  const preferred = ["en0", "en1", "eth0", "wlan0"];
  const isV4 = (addr) =>
    !addr.internal && (addr.family === "IPv4" || addr.family === 4);

  for (const name of preferred) {
    const found = (ifaces[name] || []).find(isV4);
    if (found?.address) return found.address;
  }
  for (const addrs of Object.values(ifaces)) {
    const found = (addrs || []).find(isV4);
    if (found?.address) return found.address;
  }
  return null;
}

function isLoopbackHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

/**
 * Expo inlines EXPO_PUBLIC_* at bundle time. A physical phone cannot call
 * localhost on the Mac, so loopback API URLs are rewritten to the LAN IP
 * in LAN mode. An already-explicit non-loopback URL is left unchanged.
 */
function resolveApiUrlForLan(existing, lanIp, apiPort) {
  if (!existing?.trim()) {
    return `http://${lanIp}:${apiPort}`;
  }
  try {
    const url = new URL(existing.trim());
    if (isLoopbackHost(url.hostname) && lanIp) {
      url.hostname = lanIp;
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return existing.replace(/\/+$/, "");
  }
}

loadEnvFile(path.join(workspaceRoot, ".env"));

const isReplit = Boolean(
  process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_EXPO_DEV_DOMAIN,
);

const env = { ...process.env };
const args = ["exec", "expo", "start"];

if (isReplit) {
  if (process.env.REPLIT_EXPO_DEV_DOMAIN) {
    env.EXPO_PACKAGER_PROXY_URL = `https://${process.env.REPLIT_EXPO_DEV_DOMAIN}`;
  }
  if (process.env.REPLIT_DEV_DOMAIN) {
    env.EXPO_PUBLIC_DOMAIN = process.env.REPLIT_DEV_DOMAIN;
    env.REACT_NATIVE_PACKAGER_HOSTNAME = process.env.REPLIT_DEV_DOMAIN;
  }
  if (process.env.REPL_ID) {
    env.EXPO_PUBLIC_REPL_ID = process.env.REPL_ID;
  }
  args.push("--localhost", "--port", process.env.PORT || "20104");
} else {
  // Root .env uses PORT for the API (8080). Do not reuse that for Metro.
  const apiPort = process.env.API_PORT || process.env.PORT || "8080";
  const metroPort = process.env.EXPO_PORT || "8081";
  const wantLocalhost =
    process.env.EXPO_DEV_HOST === "localhost" ||
    process.env.EXPO_DEV_HOST === "loopback";

  env.PORT = metroPort;

  if (wantLocalhost) {
    args.push("--localhost", "--port", metroPort);
    console.log(
      `[bluebird] Expo localhost mode. API ${env.EXPO_PUBLIC_API_URL || "(unset)"}. ` +
        `Web/simulator loopback preserved. Metro :${metroPort}`,
    );
  } else {
    const lanIp = detectLanIp();
    if (lanIp) {
      env.REACT_NATIVE_PACKAGER_HOSTNAME = lanIp;
      env.EXPO_PUBLIC_API_URL = resolveApiUrlForLan(
        env.EXPO_PUBLIC_API_URL,
        lanIp,
        apiPort,
      );
      console.log(`[bluebird] LAN IP ${lanIp}`);
      console.log(`[bluebird] EXPO_PUBLIC_API_URL ${env.EXPO_PUBLIC_API_URL}`);
      console.log(`[bluebird] Expo Go exp://${lanIp}:${metroPort}`);
    } else {
      console.warn(
        "[bluebird] No LAN IPv4 address found; Expo will still start with --lan. " +
          "Set EXPO_PUBLIC_API_URL to http://<mac-lan-ip>:8080 if Expo Go cannot reach the API.",
      );
    }
    args.push("--lan", "--port", metroPort);
  }
}

for (const extra of process.argv.slice(2)) {
  args.push(extra);
}

const child = spawn("pnpm", args, {
  cwd: projectDir,
  env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
