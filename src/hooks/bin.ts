import { createContext } from "../cli/context.js";
import { runHook } from "./run.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buf = Buffer.from(chunk as Buffer);
    size += buf.length;
    if (size > 4 * 1024 * 1024) break;
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// Hooks must never fail Claude Code's turn: whatever happens, exit with code 0.
runHook(process.argv[2] ?? "", {
  readStdin,
  makeContext: (cwd) => createContext({ cwd }),
  write: (text) => void process.stdout.write(text),
  deadlineMs: Number(process.env["JPE_HOOK_DEADLINE_MS"]) || 25_000,
  debug: process.env["JPE_DEBUG"] === "1",
}).finally(() => {
  process.exitCode = 0;
});
