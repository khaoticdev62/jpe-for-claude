import { z } from "zod";

export const CHECK_NAMES = [
  "typecheck",
  "lint",
  "format",
  "unit-test",
  "integration-test",
  "e2e-test",
  "build",
  "dependency-audit",
  "static-analysis",
  "security-scan",
  "regression",
] as const;

export const checkNameSchema = z.enum(CHECK_NAMES);
export type CheckName = z.infer<typeof checkNameSchema>;

const base = { id: z.string().min(1), at: z.iso.datetime() };

/** A command that actually ran, with its real exit code. */
const commandEvidence = z.strictObject({
  ...base,
  kind: z.literal("command"),
  check: checkNameSchema,
  command: z.string().min(1),
  exitCode: z.number().int(),
  durationMs: z.number().int().min(0),
  timedOut: z.boolean(),
  /** Failure that existed before this change. Reported as a warning, never hidden. */
  preexisting: z.boolean(),
  /** Warning count reported by the tool (for example lint warnings). */
  warnings: z.number().int().min(0),
  /** Redacted, length-limited tail of the tool output. */
  outputExcerpt: z.string(),
});

/** Language-server diagnostics for the changed files. `available: false` means NOT verified by LSP. */
const lspEvidence = z.strictObject({
  ...base,
  kind: z.literal("lsp"),
  server: z.string().min(1),
  available: z.boolean(),
  errors: z.number().int().min(0),
  warnings: z.number().int().min(0),
});

/** A check that was deliberately not run. Recorded so the gap is visible, but it is never proof. */
const notRunEvidence = z.strictObject({
  ...base,
  kind: z.literal("not-run"),
  check: checkNameSchema,
  reason: z.string().min(1),
});

/** Something outside JPE's control stopped the work (missing credential, tool, approval). */
const blockerEvidence = z.strictObject({
  ...base,
  kind: z.literal("blocker"),
  reason: z.string().min(1),
});

export const evidenceSchema = z.discriminatedUnion("kind", [commandEvidence, lspEvidence, notRunEvidence, blockerEvidence]);

export type Evidence = z.infer<typeof evidenceSchema>;
export type CommandEvidence = Extract<Evidence, { kind: "command" }>;
