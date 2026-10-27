import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  launchExpo,
  runPreviewLauncher,
} from "../scripts/production-preview-launcher.mjs";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const artifactConfig = await readFile(
  new URL("../.replit-artifact/artifact.toml", import.meta.url),
  "utf8",
);
const launcherSource = await readFile(
  new URL("../scripts/production-preview-launcher.mjs", import.meta.url),
  "utf8",
);

test("the artifact's Development Preview offers Expo Go with isolated Membership mock mode", () => {
  const devCommand = packageJson.scripts.dev;
  assert.match(
    devCommand,
    /^if \[ "\$BLUEBIRD_PRODUCTION_CLERK_DEBUG" = "true" \]; then sh scripts\/dev-production-clerk-debug\.sh; else /,
  );
  assert.match(devCommand, /EXPO_PUBLIC_DOMAIN=\$REPLIT_DEV_DOMAIN/);
  assert.match(devCommand, /EXPO_PUBLIC_BLUEBIRD_FLIGHT_READ_MODE=local/);
  assert.match(devCommand, /EXPO_PUBLIC_REPL_ID=\$REPL_ID/);
  assert.match(devCommand, /pnpm exec expo start --dev-client --web --host lan --port \$PORT; fi$/);
  assert.match(
    artifactConfig,
    /\[services\.development\]\s+run = "pnpm --filter @workspace\/bluebird run preview:expo-go"/,
  );
  const expoGoCommand = packageJson.scripts["preview:expo-go"];
  const normalPreviewPrefix =
    'if [ "$BLUEBIRD_PRODUCTION_CLERK_DEBUG" = "true" ]; then sh scripts/dev-production-clerk-debug.sh; else ';
  assert.ok(expoGoCommand.startsWith(normalPreviewPrefix));
  assert.equal(
    expoGoCommand.slice(normalPreviewPrefix.length, -4),
    "sh -c 'if [ -n \"$REPLIT_EXPO_SESSION_SECRET\" ]; then pnpm exec create-launch login --session \"$REPLIT_EXPO_SESSION_SECRET\" || true; fi' && BROWSER=none EXPO_PACKAGER_PROXY_URL=https://$REPLIT_EXPO_DEV_DOMAIN EXPO_PUBLIC_DOMAIN=$REPL_DEV_DOMAIN EXPO_PUBLIC_ENABLE_CLERK_AUTH=false EXPO_PUBLIC_BLUEBIRD_FULL_APP_DEMO=true EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT=production EXPO_PUBLIC_BLUEBIRD_FLIGHT_READ_MODE=local EXPO_PUBLIC_BLUEBIRD_MEMBERSHIP_DATA_MODE=mock EXPO_PUBLIC_REPL_ID=$REPL_ID REACT_NATIVE_PACKAGER_HOSTNAME=$REPLIT_EXPO_DEV_DOMAIN pnpm exec expo start --go --web --host lan --port $PORT",
  );
  assert.match(
    packageJson.scripts["preview:membership-mock-web"],
    /EXPO_PUBLIC_BLUEBIRD_MEMBERSHIP_DATA_MODE=mock/,
  );
  assert.doesNotMatch(packageJson.scripts["preview:membership-mock-web"], /--no-dev|--minify/);
  assert.match(artifactConfig, /\[services\.production\]\s+build = \[ "pnpm", "--filter", "@workspace\/bluebird", "run", "build" \]/);
  assert.match(
    artifactConfig,
    /\[services\.production\][\s\S]*?run = \[ "pnpm", "--filter", "@workspace\/bluebird", "run", "serve" \]/,
  );
});

test("Production Preview inherits the Production Clerk gate without setting or removing it", () => {
  const command = packageJson.scripts["preview:production-web-managed"];
  assert.ok(command);
  assert.doesNotMatch(command, /env -u EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH/);
  assert.doesNotMatch(command, /EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH=/);
});

test("Production Preview passes the caller's approval flag to its Expo command unchanged", async () => {
  const command = packageJson.scripts["preview:production-web-managed"];
  const tempDirectory = await mkdtemp(join(tmpdir(), "bluebird-production-preview-"));
  const fakeBinDirectory = join(tempDirectory, "bin");
  const fakePnpmPath = join(fakeBinDirectory, "pnpm");
  await mkdir(fakeBinDirectory);
  await writeFile(
    fakePnpmPath,
    '#!/bin/sh\nprintf "%s" "${EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH-<unset>}"\n',
  );
  await chmod(fakePnpmPath, 0o755);

  try {
    for (const [flag, expected] of [
      ["true", "true"],
      ["false", "false"],
      [undefined, "<unset>"],
    ]) {
      const environment = {
        ...process.env,
        PATH: `${fakeBinDirectory}:${process.env.PATH ?? ""}`,
        PORT: "43127",
      };
      if (flag === undefined) {
        delete environment.EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH;
      } else {
        environment.EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH = flag;
      }
      const result = spawnSync("sh", ["-c", command], {
        encoding: "utf8",
        env: environment,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, expected);
    }
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("Production Preview retains production API reads and the current production web bundle options", () => {
  const command = packageJson.scripts["preview:production-web-managed"];
  assert.ok(command);
  assert.match(command, /EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT=production/);
  assert.match(command, /EXPO_PUBLIC_BLUEBIRD_FLIGHT_READ_MODE=production/);
  assert.match(command, /PORT=20104/);
  assert.match(command, /production-preview-launcher\.mjs/);
  assert.match(
    launcherSource,
    /"start",\s*"--no-dev",\s*"--minify",\s*"--web",\s*"--localhost",\s*"--port"/,
  );
  assert.match(launcherSource, /CI: "1"/);
  assert.match(launcherSource, /EXPO_UNSTABLE_HEADLESS: "1"/);
  assert.doesNotMatch(command, /EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL=/);
  assert.doesNotMatch(command, /EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY=/);
  assert.match(artifactConfig, /previewPath = "\/bluebird\/"/);
  assert.match(artifactConfig, /paths = \[ "\/bluebird\/" \]/);
  assert.match(artifactConfig, /localPort = 20104/);
  assert.match(artifactConfig, /PORT = "20104"/);
});

test("Expo launches headlessly with inherited Production environment and managed PORT intact", async () => {
  const child = new EventEmitter();
  child.pid = 81234;
  let observed;
  const environment = {
    EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH: "true",
    EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL: "https://api.example.invalid",
    EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT: "production",
    PORT: "incorrect-inherited-port",
    KEEP_ME: "inherited",
    EXPO_UNSTABLE_HEADLESS: "0",
  };
  const originalEnvironment = { ...environment };
  const signals = new EventEmitter();
  const launch = launchExpo(43130, {
    environment,
    signalSource: signals,
    spawnProcess: (...args) => {
      observed = args;
      return child;
    },
  });

  assert.equal(observed[0], "pnpm");
  assert.deepEqual(observed[1], [
    "exec",
    "expo",
    "start",
    "--no-dev",
    "--minify",
    "--web",
    "--localhost",
    "--port",
    "43130",
  ]);
  assert.equal(observed[2].env.PORT, "43130");
  assert.equal(observed[2].env.CI, "1");
  assert.equal(observed[2].env.EXPO_UNSTABLE_HEADLESS, "1");
  assert.equal(observed[2].env.EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH, "true");
  assert.equal(
    observed[2].env.EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL,
    "https://api.example.invalid",
  );
  assert.equal(observed[2].env.EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT, "production");
  assert.equal(observed[2].env.KEEP_ME, "inherited");
  assert.deepEqual(environment, originalEnvironment, "launch must not mutate inherited variables");
  assert.equal(observed[2].detached, true);

  child.emit("exit", 0, null);
  assert.equal(await launch, 0);
});

test("Expo launcher forwards termination to the process group and waits for child shutdown", async () => {
  const child = new EventEmitter();
  child.pid = 81235;
  const signals = new EventEmitter();
  const forwardedSignals = [];
  let settled = false;
  const launch = launchExpo(43131, {
    signalSource: signals,
    spawnProcess: () => child,
    killProcess: (...args) => forwardedSignals.push(args),
    environment: {},
  }).then((code) => {
    settled = true;
    return code;
  });

  assert.equal(settled, false, "the launcher stays attached while Expo is serving");
  signals.emit("SIGTERM");
  assert.deepEqual(forwardedSignals, [[-child.pid, "SIGTERM"]]);
  assert.equal(settled, false, "signal forwarding must not resolve before Expo exits");

  child.emit("exit", null, "SIGTERM");
  assert.equal(await launch, 0, "the signal forwarded by Replit is a clean stop");
  assert.equal(settled, true);
  assert.equal(signals.listenerCount("SIGTERM"), 0);
  assert.equal(signals.listenerCount("SIGINT"), 0);
  assert.equal(signals.listenerCount("SIGHUP"), 0);
});

test("repeated Expo launches remove signal handlers and preserve each child's failure status", async () => {
  const signals = new EventEmitter();
  const children = [];
  const launchOnce = () => {
    const child = new EventEmitter();
    child.pid = 81236 + children.length;
    children.push(child);
    return launchExpo(43132, {
      signalSource: signals,
      spawnProcess: () => child,
      environment: {},
    });
  };

  const firstLaunch = launchOnce();
  assert.equal(signals.listenerCount("SIGTERM"), 1);
  children[0].emit("exit", 7, null);
  assert.equal(await firstLaunch, 7);
  assert.equal(signals.listenerCount("SIGTERM"), 0);

  const secondLaunch = launchOnce();
  assert.equal(signals.listenerCount("SIGTERM"), 1);
  children[1].emit("exit", 0, null);
  assert.equal(await secondLaunch, 0);
  assert.equal(signals.listenerCount("SIGTERM"), 0);
});

async function createProcFixture({ port, pid, inode, commandLine, projectRoot }) {
  const procRoot = await mkdtemp(join(tmpdir(), "bluebird-preview-proc-"));
  const encodedPort = port.toString(16).toUpperCase().padStart(4, "0");
  const tcpRow =
    `  0: 0100007F:${encodedPort} 00000000:0000 0A ` +
    `00000000:00000000 00:00000000 00000000 1000 0 ${inode}`;
  await mkdir(join(procRoot, "net"), { recursive: true });
  await mkdir(join(procRoot, String(pid), "fd"), { recursive: true });
  await writeFile(
    join(procRoot, "net", "tcp"),
    `sl local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode\n${tcpRow}\n`,
  );
  await writeFile(join(procRoot, String(pid), "cmdline"), commandLine.join("\0"));
  await symlink(projectRoot, join(procRoot, String(pid), "cwd"));
  await symlink(`socket:[${inode}]`, join(procRoot, String(pid), "fd", "3"));
  return procRoot;
}

test("an occupied port already owned by this Bluebird Preview is left running without relaunching Expo", async () => {
  const port = 43128;
  const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
  const procRoot = await createProcFixture({
    port,
    pid: 43210,
    inode: 918273,
    projectRoot,
    commandLine: [
      "/usr/bin/node",
      "/workspace/node_modules/.bin/expo",
      "start",
      "--no-dev",
      "--minify",
      "--web",
      "--localhost",
      "--port",
      String(port),
    ],
  });
  let launchCalled = false;

  try {
    const result = await runPreviewLauncher({
      port,
      procRoot,
      projectRoot,
      launch: () => {
        launchCalled = true;
      },
      log: () => {},
    });
    assert.equal(result, 0);
    assert.equal(launchCalled, false, "an already-running preview must not trigger Expo's port prompt");
  } finally {
    await rm(procRoot, { recursive: true, force: true });
  }
});

test("an occupied port owned by an unrelated process fails promptly with a useful diagnostic", async () => {
  const port = 43129;
  const projectRoot = new URL("..", import.meta.url).pathname;
  const procRoot = await createProcFixture({
    port,
    pid: 43211,
    inode: 918274,
    projectRoot: tmpdir(),
    commandLine: ["/usr/bin/node", "unrelated-server.js", "--port", String(port)],
  });
  let launchCalled = false;
  const messages = [];

  try {
    const result = await runPreviewLauncher({
      port,
      procRoot,
      projectRoot,
      launch: () => {
        launchCalled = true;
      },
      log: (message) => messages.push(message),
    });
    assert.equal(result, 1);
    assert.equal(launchCalled, false, "Expo must not start on an occupied port");
    assert.match(messages.join("\n"), new RegExp(`port ${port} is occupied`));
    assert.match(messages.join("\n"), /unrelated|cannot verify/i);
    assert.doesNotMatch(messages.join("\n"), /switch.*port|press.*return/i);
  } finally {
    await rm(procRoot, { recursive: true, force: true });
  }
});
