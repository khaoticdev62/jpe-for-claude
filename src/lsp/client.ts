import type { ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { JpeError } from "../core/errors.js";
import { killTree, spawnSafely } from "../security/run.js";

/** 1-based line and column, as people and compilers count. Converted to LSP's 0-based form internally. */
export interface Position {
  line: number;
  column: number;
}

export type Severity = "error" | "warning" | "info" | "hint";

export interface Diagnostic {
  /** Absolute file path. */
  file: string;
  line: number;
  column: number;
  severity: Severity;
  message: string;
  code?: string;
  source?: string;
}

export interface Location {
  file: string;
  line: number;
  column: number;
}

export interface SymbolInfo {
  name: string;
  kind: number;
  line: number;
  column: number;
  children: SymbolInfo[];
}

interface JsonRpcMessage {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

const SEVERITY: Record<number, Severity> = { 1: "error", 2: "warning", 3: "info", 4: "hint" };

export interface StartOptions {
  command: string;
  args: readonly string[];
  rootDir: string;
  /** Time allowed for the server to answer `initialize`. */
  startupTimeoutMs: number;
  requestTimeoutMs?: number;
}

/** Identity of a file path for matching server messages: normalised, and case-insensitive on Windows (drive letters differ). */
const fileKey = (file: string): string => (process.platform === "win32" ? path.normalize(file).toLowerCase() : path.normalize(file));
const toUri = (file: string): string => pathToFileURL(file).toString();
const fromUri = (uri: string): string => {
  try {
    return new URL(uri).protocol === "file:" ? path.normalize(decodeURIComponent(new URL(uri).pathname).replace(/^\/([A-Za-z]:)/, "$1")) : uri;
  } catch {
    return uri;
  }
};

/**
 * Minimal Language Server Protocol client over stdio: just enough to start a server, open files,
 * collect the diagnostics it publishes, and ask for symbols, definitions, references and hover text.
 * Everything it reports comes from the real server; if the server cannot start, `start` throws.
 */
export class LspClient {
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private readonly published = new Map<string, Diagnostic[]>();
  private readonly publishCount = new Map<string, number>();
  /** Key -> the path spelling we opened, so reports use the caller's own paths. */
  private readonly opened = new Map<string, string>();
  private lastPublishAt = 0;
  private closed = false;
  stderrTail = "";
  serverName: string | undefined;

  private constructor(
    private readonly child: ChildProcess,
    private readonly requestTimeoutMs: number,
  ) {
    child.stdout?.on("data", (chunk: Buffer) => this.onData(chunk));
    child.stderr?.on("data", (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString("utf8")).slice(-2000);
    });
    child.on("close", () => this.onClose());
    child.on("error", () => this.onClose());
  }

  /** Starts the server and completes the `initialize` handshake. */
  static async start(options: StartOptions): Promise<LspClient> {
    const child = spawnSafely(options.command, options.args, { cwd: options.rootDir });
    const client = new LspClient(child, options.requestTimeoutMs ?? 30_000);
    try {
      const init = (await client.request(
        "initialize",
        {
          processId: process.pid,
          rootUri: toUri(options.rootDir),
          workspaceFolders: [{ uri: toUri(options.rootDir), name: path.basename(options.rootDir) }],
          capabilities: {
            workspace: { configuration: true, workspaceFolders: true },
            textDocument: {
              synchronization: { didSave: false },
              publishDiagnostics: {},
              documentSymbol: { hierarchicalDocumentSymbolSupport: true },
              hover: { contentFormat: ["plaintext", "markdown"] },
              definition: {},
              references: {},
            },
          },
        },
        options.startupTimeoutMs,
      )) as { serverInfo?: { name?: string }; capabilities?: unknown } | null;
      client.serverName = init?.serverInfo?.name;
      client.notify("initialized", {});
      return client;
    } catch (error) {
      await client.dispose();
      throw error;
    }
  }

  private send(message: object): void {
    if (this.closed || !this.child.stdin?.writable) return;
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }), "utf8");
    this.child.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]));
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const match = /Content-Length:\s*(\d+)/i.exec(this.buffer.subarray(0, headerEnd).toString("ascii"));
      if (!match?.[1]) {
        this.buffer = this.buffer.subarray(headerEnd + 4); // malformed header: skip it
        continue;
      }
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (this.buffer.length < start + length) return;
      const body = this.buffer.subarray(start, start + length).toString("utf8");
      this.buffer = this.buffer.subarray(start + length);
      try {
        this.handle(JSON.parse(body) as JsonRpcMessage);
      } catch {
        // ignore a single malformed message; the next one is independent
      }
    }
  }

  private handle(message: JsonRpcMessage): void {
    if (message.method !== undefined) {
      if (message.id !== undefined) this.answerServerRequest(message);
      else if (message.method === "textDocument/publishDiagnostics") this.onPublish(message.params);
      return;
    }
    if (typeof message.id !== "number") return;
    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new JpeError("PROVIDER_FAILED", `The language server rejected a request: ${message.error.message}`));
    else entry.resolve(message.result ?? null);
  }

  /** Servers sometimes ask the client questions; answer neutrally so they never wait on us. */
  private answerServerRequest(message: JsonRpcMessage): void {
    let result: unknown = null;
    if (message.method === "workspace/configuration") {
      const items = (message.params as { items?: unknown[] } | undefined)?.items;
      result = Array.isArray(items) ? items.map(() => null) : [];
    } else if (message.method === "workspace/workspaceFolders") {
      result = [];
    }
    this.send({ id: message.id, result });
  }

  private onPublish(params: unknown): void {
    const p = params as { uri?: string; diagnostics?: Array<{ range?: { start?: { line?: number; character?: number } }; severity?: number; message?: string; code?: string | number; source?: string }> } | undefined;
    if (!p?.uri) return;
    const key = fileKey(fromUri(p.uri));
    const file = this.opened.get(key) ?? fromUri(p.uri);
    const list: Diagnostic[] = (p.diagnostics ?? []).map((d) => ({
      file,
      line: (d.range?.start?.line ?? 0) + 1,
      column: (d.range?.start?.character ?? 0) + 1,
      severity: SEVERITY[d.severity ?? 1] ?? "error",
      message: String(d.message ?? ""),
      ...(d.code !== undefined ? { code: String(d.code) } : {}),
      ...(d.source ? { source: d.source } : {}),
    }));
    this.published.set(key, list);
    this.publishCount.set(key, (this.publishCount.get(key) ?? 0) + 1);
    this.lastPublishAt = Date.now();
  }

  private onClose(): void {
    this.closed = true;
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new JpeError("PROVIDER_FAILED", `The language server stopped unexpectedly.${this.stderrTail ? ` Last output: ${this.stderrTail.trim().slice(-300)}` : ""}`));
    }
    this.pending.clear();
  }

  request(method: string, params: unknown, timeoutMs = this.requestTimeoutMs): Promise<unknown> {
    if (this.closed) return Promise.reject(new JpeError("PROVIDER_FAILED", "The language server is not running."));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new JpeError("TIMEOUT", `The language server did not answer "${method}" in time.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.send({ method, params });
  }

  /** Tells the server about a file's contents (the file on disk is not modified). */
  openFile(file: string, languageId: string, text: string): void {
    const key = fileKey(file);
    this.opened.set(key, file);
    this.published.delete(key);
    this.publishCount.delete(key);
    this.notify("textDocument/didOpen", { textDocument: { uri: toUri(file), languageId, version: 1, text } });
  }

  /**
   * Waits until every file has had diagnostics published and the server has been quiet for
   * `settleMs` (servers often publish an empty list first and the real one later).
   */
  async waitForDiagnostics(files: readonly string[], settleMs: number, maxWaitMs: number): Promise<{ diagnostics: Diagnostic[]; settled: boolean }> {
    const targets = files.map(fileKey);
    const deadline = Date.now() + maxWaitMs;
    let settled = false;
    while (Date.now() < deadline && !this.closed) {
      const allPublished = targets.every((f) => (this.publishCount.get(f) ?? 0) > 0);
      if (allPublished && Date.now() - this.lastPublishAt >= settleMs) {
        settled = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    return { diagnostics: targets.flatMap((f) => this.published.get(f) ?? []), settled };
  }

  async documentSymbols(file: string): Promise<SymbolInfo[]> {
    const raw = (await this.request("textDocument/documentSymbol", { textDocument: { uri: toUri(file) } })) as unknown[] | null;
    const convert = (s: Record<string, unknown>): SymbolInfo => {
      const range = (s["selectionRange"] ?? s["range"] ?? (s["location"] as Record<string, unknown> | undefined)?.["range"]) as { start?: { line?: number; character?: number } } | undefined;
      const children = Array.isArray(s["children"]) ? (s["children"] as Array<Record<string, unknown>>).map(convert) : [];
      return { name: String(s["name"] ?? ""), kind: Number(s["kind"] ?? 0), line: (range?.start?.line ?? 0) + 1, column: (range?.start?.character ?? 0) + 1, children };
    };
    return Array.isArray(raw) ? (raw as Array<Record<string, unknown>>).map(convert) : [];
  }

  private toLocations(raw: unknown): Location[] {
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return (list as Array<Record<string, unknown>>).flatMap((l) => {
      const uri = (l["uri"] ?? l["targetUri"]) as string | undefined;
      const range = (l["range"] ?? l["targetSelectionRange"]) as { start?: { line?: number; character?: number } } | undefined;
      return uri ? [{ file: fromUri(uri), line: (range?.start?.line ?? 0) + 1, column: (range?.start?.character ?? 0) + 1 }] : [];
    });
  }

  private textPosition(file: string, pos: Position): object {
    return { textDocument: { uri: toUri(file) }, position: { line: Math.max(0, pos.line - 1), character: Math.max(0, pos.column - 1) } };
  }

  async definition(file: string, pos: Position): Promise<Location[]> {
    return this.toLocations(await this.request("textDocument/definition", this.textPosition(file, pos)));
  }

  async references(file: string, pos: Position): Promise<Location[]> {
    const params = { ...this.textPosition(file, pos), context: { includeDeclaration: false } };
    return this.toLocations(await this.request("textDocument/references", params));
  }

  /** Type / documentation text for the symbol at a position, or undefined when the server has none. */
  async hover(file: string, pos: Position): Promise<string | undefined> {
    const raw = (await this.request("textDocument/hover", this.textPosition(file, pos))) as { contents?: unknown } | null;
    const c = raw?.contents;
    const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((x) => (typeof x === "string" ? x : String((x as { value?: string }).value ?? ""))).join("\n") : String((c as { value?: string } | undefined)?.value ?? "");
    return text.trim() === "" ? undefined : text;
  }

  /** Reads a file from disk and opens it on the server. */
  async openFromDisk(file: string, languageId: string): Promise<string> {
    const text = await readFile(file, "utf8");
    this.openFile(file, languageId, text);
    return text;
  }

  /** Politely shuts the server down; forces it after a short grace period. */
  async dispose(): Promise<void> {
    if (!this.closed) {
      try {
        await this.request("shutdown", null, 2000);
        this.notify("exit", null);
      } catch {
        // the server is unresponsive or already gone; fall through to the forced stop
      }
    }
    await new Promise<void>((resolve) => {
      const force = setTimeout(() => {
        killTree(this.child);
        resolve();
      }, 1500);
      if (this.closed || this.child.exitCode !== null) {
        clearTimeout(force);
        resolve();
        return;
      }
      this.child.once("close", () => {
        clearTimeout(force);
        resolve();
      });
    });
    this.closed = true;
  }
}
