#!/usr/bin/env node
/**
 * Starts Expo for local macOS development, and keeps the Replit start flags
 * when Replit env is present so `pnpm --filter @workspace/bluebird run dev`
 * still works in that environment.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
  const metroPort = process.env.EXPO_PORT || "8081";
  env.PORT = metroPort;
  args.push("--port", metroPort);
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
