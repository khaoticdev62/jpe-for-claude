import { JpeError } from "./errors.js";
import { evidenceSchema, type CheckName, type Evidence } from "./evidence.js";
import { redactSecrets } from "./redact.js";

export const MAX_EXCERPT_CHARS = 2000;

export interface LedgerDeps {
  now: () => Date;
  newId: () => string;
}

export interface CommandResultInput {
  check: CheckName;
  command: string;
  exitCode: number;
  durationMs: number;
  timedOut?: boolean;
  preexisting?: boolean;
  warnings?: number;
  output?: string;
}

/** Keeps the tail of the output (where failures usually appear), after redaction. */
function excerpt(output: string): string {
  const safe = redactSecrets(output);
  return safe.length <= MAX_EXCERPT_CHARS ? safe : `...${safe.slice(-MAX_EXCERPT_CHARS)}`;
}

/**
 * Append-only record of what JPE actually ran and observed. Entries are validated and frozen.
 * Status is never stored here; it is derived from these entries by `deriveStatus`.
 */
export class EvidenceLedger {
  private readonly items: Evidence[] = [];

  constructor(private readonly deps: LedgerDeps) {}

  get entries(): readonly Evidence[] {
    return this.items;
  }

  private push(candidate: unknown): Evidence {
    const parsed = evidenceSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new JpeError("INVALID_INPUT", "Refused to record malformed verification evidence.", { cause: parsed.error });
    }
    const entry = Object.freeze(parsed.data);
    this.items.push(entry);
    return entry;
  }

  private stamp(): { id: string; at: string } {
    return { id: this.deps.newId(), at: this.deps.now().toISOString() };
  }

  recordCommand(input: CommandResultInput): Evidence {
    return this.push({
      ...this.stamp(),
      kind: "command",
      check: input.check,
      command: redactSecrets(input.command),
      exitCode: input.exitCode,
      durationMs: input.durationMs,
      timedOut: input.timedOut ?? false,
      preexisting: input.preexisting ?? false,
      warnings: input.warnings ?? 0,
      outputExcerpt: excerpt(input.output ?? ""),
    });
  }

  recordLsp(input: { server: string; available: boolean; errors: number; warnings: number }): Evidence {
    return this.push({ ...this.stamp(), kind: "lsp", ...input });
  }

  recordNotRun(check: CheckName, reason: string): Evidence {
    return this.push({ ...this.stamp(), kind: "not-run", check, reason });
  }

  recordBlocker(reason: string): Evidence {
    return this.push({ ...this.stamp(), kind: "blocker", reason: redactSecrets(reason) });
  }

  /** One JSON object per line, suitable for appending to a file. */
  toJsonLines(): string {
    return this.items.map((e) => JSON.stringify(e)).join("\n");
  }
}

/** Parses a JSON-lines evidence file, rejecting any line that fails validation. */
export function parseEvidenceLines(text: string): Evidence[] {
  const out: Evidence[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  lines.forEach((line, index) => {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (cause) {
      throw new JpeError("INVALID_INPUT", `Evidence line ${index + 1} is not valid JSON.`, { cause });
    }
    const parsed = evidenceSchema.safeParse(raw);
    if (!parsed.success) throw new JpeError("INVALID_INPUT", `Evidence line ${index + 1} failed validation.`, { cause: parsed.error });
    out.push(parsed.data);
  });
  return out;
}
