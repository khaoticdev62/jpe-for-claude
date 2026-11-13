import { z } from "zod";

export const CONFIG_SCHEMA_VERSION = 1;

const explanation = z
  .strictObject({
    timing: z.enum(["before", "after", "before-and-after"]).default("before-and-after"),
    depth: z.enum(["adaptive", "brief", "standard", "deep"]).default("adaptive"),
    format: z.enum(["hybrid", "prose", "structured"]).default("hybrid"),
    translateJargon: z.boolean().default(true),
    examples: z.enum(["always", "when-useful", "never"]).default("when-useful"),
    explainChanges: z.boolean().default(true),
    explainArchitecture: z.boolean().default(true),
    teachConcepts: z.boolean().default(true),
  })
  .prefault({});

const docProviderName = z.enum(["context7", "official", "local-package", "repo-release", "osv"]);

const docs = z
  .strictObject({
    providers: z.array(docProviderName).min(1).default(["local-package", "context7", "official", "repo-release", "osv"]),
    /** Extra user-defined providers, referenced by an https base URL. Never holds credentials. */
    additionalProviders: z
      .array(z.strictObject({ name: z.string().min(1).max(64), baseUrl: z.url({ protocol: /^https$/ }) }))
      .max(10)
      .default([]),
    cacheTtlHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 365)
      .default(24 * 7),
    requestTimeoutMs: z.number().int().min(1000).max(120_000).default(15_000),
    showSources: z.boolean().default(true),
  })
  .prefault({});

const lsp = z
  .strictObject({
    autoDetect: z.boolean().default(true),
    offerInstall: z.boolean().default(true),
    continuousDiagnostics: z.boolean().default(true),
    diagnosticsTimeoutMs: z.number().int().min(1000).max(300_000).default(30_000),
  })
  .prefault({});

const engineering = z
  .strictObject({
    planning: z.enum(["adaptive", "always", "never"]).default("adaptive"),
    maxRepairAttempts: z.number().int().min(0).max(10).default(3),
    commandTimeoutMs: z.number().int().min(1000).max(1_800_000).default(300_000),
    backups: z.boolean().default(true),
    rollback: z.boolean().default(true),
    approval: z.enum(["risk-based", "always", "never-auto"]).default("risk-based"),
  })
  .prefault({});

const security = z
  .strictObject({
    scanForCredentials: z.boolean().default(true),
    treatDocsAsUntrusted: z.boolean().default(true),
    allowExternalUploads: z.boolean().default(false),
  })
  .prefault({});

const runtime = z
  .strictObject({
    offline: z.boolean().default(false),
    logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  })
  .prefault({});

export const configSchema = z.strictObject({
  schemaVersion: z.literal(CONFIG_SCHEMA_VERSION).default(CONFIG_SCHEMA_VERSION),
  explanation,
  docs,
  lsp,
  engineering,
  security,
  runtime,
});

export type JpeConfig = z.infer<typeof configSchema>;

/** A partial config as written by a user: every key optional, still strictly validated. */
export const partialConfigSchema = configSchema.partial();
