import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { JpeError } from "../core/errors.js";

export interface NetDeps {
  fetch: typeof fetch;
  /** Resolves a host name to its IP addresses. Injected so tests never touch DNS. */
  resolve: (host: string) => Promise<string[]>;
}

export function defaultNetDeps(): NetDeps {
  return {
    fetch: (input, init) => fetch(input, init),
    resolve: async (host) => (await lookup(host, { all: true })).map((a) => a.address),
  };
}

/** True for loopback, private, link-local, carrier-grade NAT, multicast and other non-public addresses. */
export function isPrivateAddress(address: string): boolean {
  const lower = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped?.[1]) return isPrivateAddress(mapped[1]);
  if (isIP(lower) === 4) {
    const [a = 0, b = 0] = lower.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0)
    );
  }
  if (isIP(lower) === 6) {
    return lower === "::" || lower === "::1" || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith("ff");
  }
  return true; // not an IP at all: refuse
}

export interface RequestOptions {
  url: string;
  method?: "GET" | "POST";
  body?: string;
  accept?: string;
  /** If set, the host must equal or be a subdomain of one of these. */
  allowedHosts?: readonly string[];
  timeoutMs: number;
  maxBytes?: number;
}

export interface HttpText {
  url: string;
  status: number;
  contentType: string;
  text: string;
}

const MAX_REDIRECTS = 3;

function hostAllowed(host: string, allowed: readonly string[] | undefined): boolean {
  if (!allowed) return true;
  return allowed.some((a) => host === a || host.endsWith(`.${a}`));
}

async function assertSafeUrl(raw: string, options: RequestOptions, deps: NetDeps): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch (cause) {
    throw new JpeError("INVALID_INPUT", "That is not a valid web address.", { cause });
  }
  if (url.protocol !== "https:") throw new JpeError("NOT_PERMITTED", "Only https addresses are fetched.");
  if (url.username || url.password) throw new JpeError("NOT_PERMITTED", "Addresses containing credentials are refused.");
  if (url.port !== "" && url.port !== "443") throw new JpeError("NOT_PERMITTED", "Only the standard https port is allowed.");
  const host = url.hostname.toLowerCase();
  if (isIP(host.replace(/^\[|\]$/g, "")) !== 0 || host === "localhost" || host.endsWith(".localhost")) {
    throw new JpeError("NOT_PERMITTED", "Fetching IP addresses or localhost is refused.");
  }
  if (!hostAllowed(host, options.allowedHosts)) throw new JpeError("NOT_PERMITTED", `The host "${host}" is not on the allowed list for this source.`);
  const addresses = await deps.resolve(host);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new JpeError("NOT_PERMITTED", `"${host}" resolves to a non-public address, so it will not be fetched.`);
  }
  return url;
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new JpeError("PROVIDER_FAILED", "The response was larger than the allowed limit.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Guarded HTTPS request: https only, no credentials in the URL, standard port, host allow-list,
 * every redirect re-checked, public IPs only, hard timeout and size cap. Known limit: a hostile
 * DNS server could change its answer between this check and the connection (DNS rebinding).
 */
export async function safeRequest(options: RequestOptions, deps: NetDeps): Promise<HttpText> {
  const maxBytes = options.maxBytes ?? 1024 * 1024;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    let current = options.url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const url = await assertSafeUrl(current, options, deps);
      const headers: Record<string, string> = { "user-agent": "jpe-for-claude", accept: options.accept ?? "text/html,text/plain,application/json" };
      if (options.body !== undefined) headers["content-type"] = "application/json";
      const response = await deps.fetch(url, {
        method: options.method ?? "GET",
        redirect: "manual",
        signal: controller.signal,
        headers,
        ...(options.body !== undefined ? { body: options.body } : {}),
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new JpeError("PROVIDER_FAILED", "A redirect had no destination.");
        current = new URL(location, url).toString();
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        throw new JpeError("PROVIDER_FAILED", `${url.hostname} answered with HTTP ${response.status}.`);
      }
      return { url: url.toString(), status: response.status, contentType: response.headers.get("content-type") ?? "", text: await readCapped(response, maxBytes) };
    }
    throw new JpeError("PROVIDER_FAILED", "Too many redirects.");
  } catch (error) {
    if (error instanceof JpeError) throw error;
    if ((error as { name?: string }).name === "AbortError") throw new JpeError("TIMEOUT", "The documentation source took too long to answer.", { cause: error });
    throw new JpeError("PROVIDER_FAILED", "The documentation source could not be reached.", { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

const ENTITIES: Readonly<Record<string, string>> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

/** Reduces a web page to readable text (scripts, styles and navigation removed). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|nav|header|footer|svg|noscript)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|pre|tr|br)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}
