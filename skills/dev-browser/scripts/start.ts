import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";

import { formatHttpUrl, parseEntrypointArgs, resolveHostForProbe } from "@/entrypoint.js";
import {
  commandExists,
  findAvailablePackageManager,
  getMissingPackageDependencies,
  isPlaywrightChromiumInstalled,
  resolveSkillDirFromEntrypoint,
  resolveRuntimePaths,
  shouldUseShellForPackageCommands,
} from "@/runtime.js";
import {
  ensurePlaywrightChromium,
  preflightStandaloneStartup,
  runEntrypoint,
} from "@/startup.js";

const runtimePaths = resolveRuntimePaths(resolveSkillDirFromEntrypoint(import.meta.url));
const useShell = shouldUseShellForPackageCommands(process.platform);

async function main() {
  const args = parseEntrypointArgs(process.argv.slice(2));
  await ensureSkillDependencies();

  await runEntrypoint(args, {
    runtimePaths,
    mkdir: mkdirSync,
    serveStandalone: async (options) => {
      const { serve } = await import("@/index.js");
      return serve(options);
    },
    serveExtension: async (options) => {
      const { serveRelay } = await import("@/relay.js");
      return serveRelay(options);
    },
    registerShutdown,
    keepAlive: () => new Promise(() => {}),
    log: (line) => console.log(line),
    ensureBrowser: () =>
      ensurePlaywrightChromium({
        isInstalled: () =>
          isPlaywrightChromiumInstalled({
            skillDir: runtimePaths.skillDir,
            platform: process.platform,
            env: process.env,
            exists: existsSync,
            readDir: readdirSync,
          }),
        findPackageManager: () =>
          findAvailablePackageManager((command) =>
            commandExists(command, (candidate) =>
              spawnSync(candidate, ["--version"], {
                stdio: "ignore",
                shell: useShell,
                windowsHide: useShell,
              })
            )
          ),
        runCommand,
        log: (line) => console.log(line),
      }),
    preflightStandalone: () =>
      preflightStandaloneStartup(args, {
        checkServer: async (host, port) => {
          try {
            const response = await fetch(formatHttpUrl(resolveHostForProbe(host), port), {
              signal: AbortSignal.timeout(1000),
            });
            if (!response.ok) {
              return { ok: false };
            }
            const info = (await response.json()) as { wsEndpoint?: string };
            return { ok: true, info };
          } catch {
            return { ok: false };
          }
        },
        isPortInUse,
        browserDataDir: runtimePaths.browserDataDir,
        recoverStaleBrowser: ({ cdpPort, browserDataDir }) =>
          recoverStaleDevBrowserChromium({
            cdpPort,
            browserDataDir,
            isPortInUse,
            log: (line) => console.log(line),
          }),
        log: (line) => console.log(line),
      }),
  });
}

async function ensureSkillDependencies() {
  const packageJson = JSON.parse(readFileSync(join(runtimePaths.skillDir, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const missingDependencies = getMissingPackageDependencies({
    skillDir: runtimePaths.skillDir,
    dependencies: Object.keys(packageJson.dependencies ?? {}),
    exists: existsSync,
  });

  if (missingDependencies.length === 0) {
    return;
  }

  console.log("dev-browser dependencies not found. Installing local packages...");
  await runCommand("npm", ["install"]);
  console.log("dev-browser dependencies installed.");
}

async function runCommand(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: runtimePaths.skillDir,
      stdio: "inherit",
      shell: useShell,
      windowsHide: useShell,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function isPortInUse(port: number) {
  const socket = await import("node:net");
  return await new Promise<boolean>((resolve) => {
    const server = socket.createServer();
    server.once("error", () => resolve(true));
    server.once("listening", () => {
      server.close(() => resolve(false));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function recoverStaleDevBrowserChromium({
  cdpPort,
  browserDataDir,
  isPortInUse,
  log,
}: {
  cdpPort: number;
  browserDataDir: string;
  isPortInUse: (port: number) => Promise<boolean>;
  log: (line: string) => void;
}) {
  const pid = findListeningPid(cdpPort);
  if (!pid) {
    return false;
  }

  const commandLine = readProcessCommandLine(pid);
  if (!commandLine || !isOwnedDevBrowserProcess(commandLine, browserDataDir, cdpPort)) {
    return false;
  }

  log(`Cleaning up stale dev-browser Chromium on CDP port ${cdpPort} (PID: ${pid})`);
  if (!terminateProcess(pid)) {
    return false;
  }

  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (!(await isPortInUse(cdpPort))) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return !(await isPortInUse(cdpPort));
}

function findListeningPid(port: number): number | null {
  if (process.platform === "win32") {
    const result = runCapture("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -First 1`,
    ]);
    return parsePid(result.stdout);
  }

  const result = runCapture("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
  return parsePid(result.stdout);
}

function readProcessCommandLine(pid: number): string | null {
  if (process.platform === "win32") {
    const result = runCapture("powershell.exe", [
      "-NoProfile",
      "-Command",
      `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`,
    ]);
    return normalizeOutput(result.stdout);
  }

  const result = runCapture("ps", ["-p", String(pid), "-o", "args="]);
  return normalizeOutput(result.stdout);
}

function isOwnedDevBrowserProcess(commandLine: string, browserDataDir: string, cdpPort: number): boolean {
  const normalizedCommandLine = normalizePathLike(commandLine);
  const normalizedBrowserDataDir = normalizePathLike(browserDataDir);

  return (
    normalizedCommandLine.includes(`--remote-debugging-port=${cdpPort}`) &&
    normalizedCommandLine.includes("--user-data-dir=") &&
    normalizedCommandLine.includes(normalizedBrowserDataDir)
  );
}

function terminateProcess(pid: number): boolean {
  if (process.platform === "win32") {
    return runCapture("taskkill", ["/PID", String(pid), "/T", "/F"]).status === 0;
  }

  try {
    process.kill(pid, "SIGKILL");
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "ESRCH";
  }
}

function runCapture(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    cwd: runtimePaths.skillDir,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });

  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
  };
}

function parsePid(stdout: string): number | null {
  const value = normalizeOutput(stdout);
  if (!value) {
    return null;
  }

  const pid = Number.parseInt(value.split(/\s+/)[0] ?? "", 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function normalizeOutput(stdout: string): string | null {
  const value = stdout.trim();
  return value.length > 0 ? value : null;
}

function normalizePathLike(value: string): string {
  return value.replaceAll("\\", "/").toLowerCase();
}

function registerShutdown(stop: () => Promise<void>) {
  const shutdown = async () => {
    await stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Failed to start dev-browser:", error);
  process.exit(1);
});
