export interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string | true>;
}

/** Flags that never take a value. Anything else written as `--name value` consumes the next word. */
const BOOLEAN_FLAGS: ReadonlySet<string> = new Set(["json", "offline", "force", "stdin", "dependents", "baseline", "help", "project", "global", "deep", "repair", "screen-reader", "collapse", "all"]);

/** Small, dependency-free parser for `--flag`, `--flag value` and `--flag=value`. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith("--") || arg.length === 2) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      flags.set(arg.slice(2, eq), arg.slice(eq + 1));
      continue;
    }
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (BOOLEAN_FLAGS.has(name) || next === undefined || next.startsWith("--")) flags.set(name, true);
    else {
      flags.set(name, next);
      i++;
    }
  }
  return { positionals, flags };
}

export function flagString(args: ParsedArgs, name: string): string | undefined {
  const v = args.flags.get(name);
  return typeof v === "string" ? v : undefined;
}

export const flagBool = (args: ParsedArgs, name: string): boolean => args.flags.get(name) !== undefined && args.flags.get(name) !== "false";
