import type { Ecosystem } from "../project/detect.js";
import type { ProjectFs } from "../project/fs.js";
import type { NetDeps } from "./net.js";

/** official = the project's own site/repo or a vulnerability database; registry = package registry metadata; local = read from the installed package; third-party = anything else. */
export type Trust = "official" | "registry" | "local" | "third-party";
export type ResultKind = "reference" | "api-signature" | "release-notes" | "advisory" | "metadata";
export type VersionMatch = "exact" | "same-minor" | "same-major" | "mismatch" | "unversioned" | "unknown-request";

export interface DocRequest {
  library: string;
  /** Exact installed version when known. A declared range is NOT an exact version. */
  version?: string;
  /** What the user or Claude needs to know (a function name, a concept). */
  topic: string;
  ecosystem: Ecosystem;
}

/** What a provider returns; the engine adds version matching, hashing and freshness. */
export interface DocDraft {
  provider: string;
  kind: ResultKind;
  title: string;
  url?: string | undefined;
  content: string;
  trust: Trust;
  /** The version this document describes, when the source states it. */
  docVersion?: string | undefined;
}

export interface DocResult extends DocDraft {
  versionMatch: VersionMatch;
  retrievedAt: string;
  /** fresh = fetched or read during this run. cached = served from the local cache and NOT re-verified. */
  verification: "fresh" | "cached";
  contentHash: string;
}

export interface ProviderContext {
  fs: ProjectFs;
  projectRoot: string;
  net: NetDeps;
  /** Extra https hosts (from configuration) whose pages may be fetched. */
  extraHosts: readonly string[];
  requestTimeoutMs: number;
}

export interface ProviderOutput {
  results: DocDraft[];
  /** Plain-English remarks about gaps (for example "no GitHub release found"). */
  notes: string[];
}

export interface DocProvider {
  readonly name: string;
  /** False for providers that only read local files; they keep working offline. */
  readonly needsNetwork: boolean;
  fetch(request: DocRequest, context: ProviderContext): Promise<ProviderOutput>;
}
