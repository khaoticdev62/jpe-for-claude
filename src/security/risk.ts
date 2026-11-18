export type RiskLevel = "safe" | "needs-approval" | "destructive";

export interface RiskAssessment {
  level: RiskLevel;
  reason: string;
}

// Recursive deletes and forced pushes are judged word by word in assessWords, not by patterns here.
const DESTRUCTIVE: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bgit\s+reset\s+--hard\b/i, reason: "discards uncommitted work" },
  { pattern: /\bgit\s+clean\b[^|;\n]*-[a-z]*f/i, reason: "deletes untracked files" },
  { pattern: /\bgit\s+(checkout|restore)\s+(--\s|\.)/i, reason: "discards uncommitted changes" },
  { pattern: /\bgit\s+branch\s+-D\b/i, reason: "force-deletes a branch" },
  { pattern: /\bdrop\s+(table|database|schema)\b/i, reason: "drops database objects" },
  { pattern: /\b(mkfs|format\s+[a-z]:|dd\s+if=)/i, reason: "overwrites a disk" },
  { pattern: /\bchmod\s+-R\s+777\b/i, reason: "removes file protections" },
  { pattern: /\b(?:jpe|cli\.js)["']?\s+data\b(?=[^|;\n]*\bremove\b)(?=[^|;\n]*--confirm\b)/i, reason: "permanently deletes JPE's saved data (records, backups or cache)" },
];

const NEEDS_APPROVAL: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(npm|pnpm|yarn|pip3?|cargo|go|gem|composer|dotnet)\s+(install|add|i|get|tool\s+install)\b/i, reason: "installs software" },
  { pattern: /\b(curl|wget|iwr|invoke-webrequest)\b[^|;\n]*\|\s*(sh|bash|zsh|iex|invoke-expression)\b/i, reason: "runs downloaded code" },
  { pattern: /\b(curl|wget)\b[^|;\n]*(-X\s*(POST|PUT|PATCH|DELETE)|--data|-d\s|-T\s|--upload-file)/i, reason: "sends data to the network" },
  { pattern: /\b(scp|rsync|sftp|ftp)\b/i, reason: "transfers files over the network" },
  { pattern: /\bgit\s+push\b/i, reason: "publishes commits" },
  { pattern: /\bsudo\b/i, reason: "runs with elevated privileges" },
  { pattern: /\.claude[\\/](settings|settings\.local)\.json/i, reason: "touches Claude Code settings" },
];

/** Commands that delete files; PowerShell aliases and cmd.exe names are included. */
const DELETE_COMMANDS: ReadonlySet<string> = new Set(["rm", "ri", "del", "erase", "rd", "rmdir", "remove-item"]);
/** Programs that run another command line given as a string argument. */
const SHELL_WRAPPERS: ReadonlySet<string> = new Set(["bash", "sh", "zsh", "cmd", "powershell", "pwsh"]);

const MAX_WRAPPER_DEPTH = 2;
const MAX_SHORT_FLAG_LETTERS = 4;

/** Splits a command line into commands (at ; | & and newlines outside quotes) and each command into unquoted, lower-cased words. */
export function tokenizeCommandLine(commandLine: string): string[][] {
  const commands: string[][] = [];
  let words: string[] = [];
  let word = "";
  let quote: string | undefined;
  const endWord = (): void => {
    if (word !== "") words.push(word.toLowerCase());
    word = "";
  };
  const endCommand = (): void => {
    endWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };
  for (const ch of commandLine) {
    if (quote) {
      if (ch === quote) quote = undefined;
      else word += ch;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ";" || ch === "|" || ch === "&" || ch === "\n" || ch === "\r") endCommand();
    else if (ch === " " || ch === "\t") endWord();
    else word += ch;
  }
  endCommand();
  return commands;
}

/** The program name without folders or a Windows extension: C:\Windows\System32\cmd.EXE -> cmd. */
const programName = (word: string): string => (word.split(/[\\/]/).at(-1) ?? word).replace(/\.(exe|cmd|bat|com)$/, "");

/** `-r`, `-rf`, `-fr`, `--recursive` and PowerShell's unambiguous prefixes of -Recurse (`-r`, `-rec`), but not `-force`. */
function isRecursiveFlag(word: string): boolean {
  if (word === "--recursive") return true;
  if (!word.startsWith("-") || word.startsWith("--")) return false;
  const letters = word.slice(1);
  if (letters !== "" && "recurse".startsWith(letters)) return true;
  return /^[a-z]+$/.test(letters) && letters.length <= MAX_SHORT_FLAG_LETTERS && letters.includes("r");
}

/** `-f`, `-uf`, `--force`, `--force-with-lease`, `--mirror`, or a `+branch` refspec. */
function isForcePushWord(word: string): boolean {
  if (word.startsWith("--force") || word === "--mirror") return true;
  if (word.startsWith("+") && word.length > 1) return true;
  return /^-[a-z]+$/.test(word) && word.length <= MAX_SHORT_FLAG_LETTERS + 1 && word.includes("f");
}

/** Index (within the words after `git`) of the sub-command, skipping global options such as `-C dir` and `-c key=value`. */
function gitSubcommandIndex(args: string[]): number {
  for (let i = 0; i < args.length; i++) {
    const w = args[i] ?? "";
    if (w === "-c") i++; // words are lower-cased, so this covers both -c and -C
    else if (!w.startsWith("-")) return i;
  }
  return -1;
}

/** Looks at every word of one command as a possible program, so `xargs rm -rf` and `sudo bash -c "..."` are seen too. */
function assessWords(words: string[], depth: number): RiskAssessment | undefined {
  let found: RiskAssessment | undefined;
  for (let i = 0; i < words.length; i++) {
    const program = programName(words[i] ?? "");
    const args = words.slice(i + 1);
    let verdict: RiskAssessment | undefined;

    if (DELETE_COMMANDS.has(program)) {
      if (args.some((a) => isRecursiveFlag(a) || a === "/s")) verdict = { level: "destructive", reason: "recursive delete" };
    } else if (program === "git") {
      const sub = gitSubcommandIndex(args);
      if (sub >= 0 && args[sub] === "push" && args.slice(sub + 1).some(isForcePushWord)) verdict = { level: "destructive", reason: "rewrites remote history" };
    } else if (SHELL_WRAPPERS.has(program)) {
      const isPowerShell = program === "powershell" || program === "pwsh";
      if (isPowerShell && args.some((a) => a === "-encodedcommand" || a === "-enc" || a === "-ec" || a === "-e")) {
        verdict = { level: "needs-approval", reason: "runs an encoded command that cannot be inspected" };
      } else if (depth < MAX_WRAPPER_DEPTH) {
        const flag = args.findIndex((a) => a === "-c" || a === "-command" || a === "/c" || a === "-lc");
        const innerText = flag >= 0 ? args.slice(flag + 1).join(" ") : "";
        if (innerText !== "") verdict = assessInner(innerText, depth + 1);
      }
    }
    if (verdict?.level === "destructive") return verdict;
    found ??= verdict;
  }
  return found;
}

function assessInner(commandLine: string, depth: number): RiskAssessment | undefined {
  let found: RiskAssessment | undefined;
  for (const words of tokenizeCommandLine(commandLine)) {
    const verdict = assessWords(words, depth);
    if (verdict?.level === "destructive") return verdict;
    found ??= verdict;
  }
  return found;
}

/** Classifies a command line so the risk-based approval policy knows whether to ask first. */
export function assessCommand(commandLine: string): RiskAssessment {
  for (const { pattern, reason } of DESTRUCTIVE) if (pattern.test(commandLine)) return { level: "destructive", reason };
  const structured = assessInner(commandLine, 0);
  if (structured?.level === "destructive") return structured;
  for (const { pattern, reason } of NEEDS_APPROVAL) if (pattern.test(commandLine)) return { level: "needs-approval", reason };
  return structured ?? { level: "safe", reason: "no risky pattern recognised" };
}
