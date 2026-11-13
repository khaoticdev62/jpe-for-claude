import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { JpeError } from "../core/errors.js";

export interface RunOptions {
  /** Executable name or path. Never a shell command line. */
  file: string;
  /** Arguments passed verbatim; the shell never interprets them. */
  args: readonly string[];
  cwd: string;
  timeoutMs: number;
  /** Per-stream cap. The tail is kept because failures usually appear last. Default 1 MiB. */
  maxOutputBytes?: number;
  /** Extra environment variables for this one command. */
  env?: Readonly<Record<string, string>>;
  /** Text written to the program's standard input, which is then closed. */
  input?: string;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
}

/** Only these variables reach child processes, so ambient secrets (API keys, tokens) do not leak into tools. */
const ENV_ALLOWLIST: readonly string[] = [
  "PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "windir", "COMSPEC", "ComSpec",
  "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "ProgramData", "ProgramFiles", "ProgramFiles(x86)",
  "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "TERM", "CI", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE",
];

/** On Windows these ship as .cmd shims, which cannot be spawned without a shell. */
const WINDOWS_SHIM_COMMANDS: ReadonlySet<string> = new Set(["npm", "npx", "pnpm", "yarn"]);
const SAFE_SHELL_ARG = /^[A-Za-z0-9_@./:=+,\\-]+$/;

/** A resolved executable path headed for the Windows shell: no shell metacharacters or quotes. */
const SAFE_SHELL_PATH = /^[A-Za-z0-9_@./:=+,\\ ()-]+$/;

function needsWindowsShell(file: string): boolean {
  if (process.platform !== "win32") return false;
  const base = path.basename(file).toLowerCase();
  return /\.(cmd|bat)$/.test(base) || WINDOWS_SHIM_COMMANDS.has(base);
}

export function buildChildEnv(extra: Readonly<Record<string, string>> | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...extra };
}

export function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", () => child.kill());
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

function keepTail(current: string, chunk: string, max: number): { text: string; truncated: boolean } {
  const joined = current + chunk;
  return joined.length > max ? { text: joined.slice(-max), truncated: true } : { text: joined, truncated: false };
}

export interface SpawnOptions {
  cwd: string;
  env?: Readonly<Record<string, string>> | undefined;
}

/**
 * Starts one program without a shell and with a minimal environment. Arguments are never
 * concatenated into a command line, which removes command injection. The single exception is
 * Windows .cmd/.bat shims (npm, npx, pnpm, yarn and npm-installed tools), which need a shell;
 * there the path and every argument must match a strict allow-list or the call is refused.
 */
export function spawnSafely(file: string, args: readonly string[], options: SpawnOptions): ChildProcess {
  if (file.includes("\0") || args.some((a) => a.includes("\0"))) {
    throw new JpeError("INVALID_INPUT", "A command argument contained an invalid character.");
  }
  const useShim = needsWindowsShell(file);
  if (useShim && (!SAFE_SHELL_PATH.test(file) || !args.every((a) => SAFE_SHELL_ARG.test(a)))) {
    throw new JpeError("INVALID_INPUT", "A command or argument contains characters that are not safe to pass through the Windows shell.");
  }
  const spawnOptions = { cwd: options.cwd, env: buildChildEnv(options.env), windowsHide: true, detached: process.platform !== "win32" };
  try {
    return useShim
      ? spawn([file.includes(" ") ? `"${file}"` : file, ...args].join(" "), { ...spawnOptions, shell: true })
      : spawn(file, [...args], { ...spawnOptions, shell: false });
  } catch (cause) {
    throw new JpeError("TOOL_UNAVAILABLE", `Could not start "${file}".`, { cause });
  }
}

/** Runs one program to completion, with a timeout, bounded output (the tail is kept) and a minimal environment. */
export function runCommand(options: RunOptions): Promise<RunResult> {
  const { file, args, cwd, timeoutMs } = options;
  const maxBytes = options.maxOutputBytes ?? 1024 * 1024;

  return new Promise<RunResult>((resolve, reject) => {
    const started = Date.now();
    let child: ChildProcess;
    try {
      child = spawnSafely(file, args, { cwd, env: options.env });
    } catch (error) {
      reject(error);
      return;
    }
    if (options.input !== undefined) {
      child.stdin?.on("error", () => undefined); // the program may exit before reading everything
      child.stdin?.end(options.input);
    }

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      const next = keepTail(stdout, chunk, maxBytes);
      stdout = next.text;
      truncated ||= next.truncated;
    });
    child.stderr?.on("data", (chunk: string) => {
      const next = keepTail(stderr, chunk, maxBytes);
      stderr = next.text;
      truncated ||= next.truncated;
    });

    child.on("error", (cause) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new JpeError("TOOL_UNAVAILABLE", `Could not start "${file}". Is it installed and on your PATH?`, { cause }));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code ?? -1, stdout, stderr, timedOut, truncated, durationMs: Date.now() - started });
    });
  });
}
