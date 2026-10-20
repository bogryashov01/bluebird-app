import { spawn } from "node:child_process";
import { readFile, readdir, readlink, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = fileURLToPath(new URL(".", import.meta.url));
const defaultProjectRoot = resolve(scriptDirectory, "..");

async function listeningSocketInodes(port, procRoot) {
  const inodes = new Set();
  let foundTable = false;

  for (const table of ["net/tcp", "net/tcp6"]) {
    let content;
    try {
      content = await readFile(resolve(procRoot, table), "utf8");
      foundTable = true;
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw new Error(`cannot inspect ${resolve(procRoot, table)}: ${error.message}`);
    }

    for (const row of content.trim().split("\n").slice(1)) {
      const columns = row.trim().split(/\s+/);
      const localAddress = columns[1];
      const state = columns[3];
      const inode = columns[9];
      if (
        localAddress?.endsWith(`:${port.toString(16).toUpperCase().padStart(4, "0")}`) &&
        state === "0A" &&
        inode
      ) {
        inodes.add(inode);
      }
    }
  }

  if (!foundTable) {
    throw new Error(`cannot inspect the system's listening ports in ${procRoot}`);
  }
  return inodes;
}

async function socketOwners(inodes, procRoot) {
  if (inodes.size === 0) return [];

  const owners = [];
  const entries = await readdir(procRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const fdDirectory = resolve(procRoot, entry.name, "fd");
    let descriptors;
    try {
      descriptors = await readdir(fdDirectory);
    } catch {
      continue;
    }

    for (const descriptor of descriptors) {
      try {
        const target = await readlink(resolve(fdDirectory, descriptor));
        const match = /^socket:\[(\d+)\]$/.exec(target);
        if (match && inodes.has(match[1])) {
          owners.push(Number(entry.name));
          break;
        }
      } catch {
        // The process may exit while its file descriptors are being inspected.
      }
    }
  }
  return [...new Set(owners)];
}

async function isBluebirdPreviewProcess(pid, port, procRoot, projectRoot) {
  try {
    const [commandLine, workingDirectory] = await Promise.all([
      readFile(resolve(procRoot, String(pid), "cmdline"), "utf8"),
      realpath(resolve(procRoot, String(pid), "cwd")),
    ]);
    const args = commandLine.split("\0").filter(Boolean);
    const hasArg = (value) => args.includes(value);
    return (
      workingDirectory === projectRoot &&
      args.some((arg) => /(?:^|[/\\])(?:@expo\/cli|expo)(?:$|[/\\.-])/.test(arg)) &&
      hasArg("start") &&
      hasArg("--no-dev") &&
      hasArg("--minify") &&
      hasArg("--web") &&
      hasArg("--localhost") &&
      hasArg("--port") &&
      args[args.indexOf("--port") + 1] === String(port)
    );
  } catch {
    return false;
  }
}

export function launchExpo(port, {
  spawnProcess = spawn,
  signalSource = process,
  killProcess = process.kill.bind(process),
  environment = process.env,
} = {}) {
  return new Promise((resolveExit, reject) => {
    const child = spawnProcess(
      "pnpm",
      [
        "exec",
        "expo",
        "start",
        "--no-dev",
        "--minify",
        "--web",
        "--localhost",
        "--port",
        String(port),
      ],
      {
        env: {
          ...environment,
          PORT: String(port),
          CI: "1",
          EXPO_UNSTABLE_HEADLESS: "1",
        },
        stdio: "inherit",
        detached: true,
      },
    );

    const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
    let finished = false;
    let requestedSignal = false;
    const signalHandlers = new Map(
      signals.map((signal) => [signal, () => onSignal(signal)]),
    );
    const cleanup = () => {
      for (const [signal, handler] of signalHandlers) {
        signalSource.removeListener(signal, handler);
      }
    };
    const settle = (callback, value) => {
      if (finished) return;
      finished = true;
      cleanup();
      callback(value);
    };
    const onSignal = (signal) => {
      if (requestedSignal) return;
      requestedSignal = signal;
      try {
        if (child.pid) {
          killProcess(-child.pid, signal);
        } else {
          child.kill(signal);
        }
      } catch (error) {
        if (error.code !== "ESRCH") {
          // The launcher still waits for the child before returning. Its exit
          // status remains authoritative if forwarding raced with shutdown.
        }
      }
    };

    for (const [signal, handler] of signalHandlers) {
      signalSource.on(signal, handler);
    }
    child.once("error", (error) => settle(reject, error));
    child.once("exit", (code, signal) => {
      const exitCode =
        code ?? (signal ? (requestedSignal === signal ? 0 : 1) : 0);
      settle(resolveExit, exitCode);
    });
  });
}

export async function runPreviewLauncher({
  port: portValue,
  procRoot = "/proc",
  projectRoot = defaultProjectRoot,
  launch = launchExpo,
  log = console.error,
}) {
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    log(`Bluebird Preview requires a valid PORT; received ${JSON.stringify(portValue)}.`);
    return 1;
  }

  let inodes;
  try {
    inodes = await listeningSocketInodes(port, procRoot);
  } catch (error) {
    log(`Bluebird Preview cannot safely check port ${port}: ${error.message}`);
    return 1;
  }

  if (inodes.size > 0) {
    let owners;
    try {
      owners = await socketOwners(inodes, procRoot);
    } catch (error) {
      log(`Bluebird Preview cannot safely identify the listener on port ${port}: ${error.message}`);
      return 1;
    }
    if (
      owners.length > 0 &&
      (await Promise.all(
        owners.map((pid) => isBluebirdPreviewProcess(pid, port, procRoot, projectRoot)),
      )).every(Boolean)
    ) {
      log(`Bluebird Preview is already serving on port ${port}; leaving that process running.`);
      return 0;
    }

    const ownerDescription = owners.length
      ? `owner PID${owners.length > 1 ? "s" : ""} ${owners.join(", ")} belongs to a listener unrelated to this Bluebird Preview or could not be verified`
      : "the listener's process could not be identified";
    log(
      `Bluebird Preview cannot start: port ${port} is occupied, and ${ownerDescription}. ` +
        "The existing listener was left untouched.",
    );
    return 1;
  }

  try {
    return await launch(port);
  } catch (error) {
    log(`Bluebird Preview could not launch on port ${port}: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runPreviewLauncher({ port: process.env.PORT, projectRoot: defaultProjectRoot }).then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
  );
}
