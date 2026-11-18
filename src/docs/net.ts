import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { JpeError } from "../core/errors.js";

/** Extra option carried to the connection layer: the one address the guard already validated. */
export type PinnedInit = RequestInit & { pinnedAddress?: string };

export interface NetDeps {
  /** Must connect to init.pinnedAddress (never re-resolve the host name) when it is provided. */
  fetch: (input: URL, init?: PinnedInit) => Promise<Response>;
  /** Resolves a host name to its IP addresses. Injected so tests never touch DNS. */
  resolve: (host: string) => Promise<string[]>;
}

type LookupAnswer = string | { address: string; family: number }[];
type LookupCallback = (error: NodeJS.ErrnoException | null, address: LookupAnswer, family?: number) => void;

/** A DNS lookup that ignores the host name and always answers with one pre-validated address. */
export function pinnedLookup(address: string): (hostname: string, options: { all?: boolean | undefined }, callback: LookupCallback) => void {
  const family = isIP(address);
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/**
 * HTTPS request that connects to a pinned IP address. The URL still carries the real host name, so TLS
 * certificate checks and SNI use it; only the address lookup is replaced. This closes the window in which
 * a hostile DNS server could answer differently for the safety check and for the connection (DNS rebinding).
 */
export function pinnedFetch(url: URL, init: PinnedInit = {}): Promise<Response> {
  const address = init.pinnedAddress;
  if (!address || isPrivateAddress(address)) {
    return Promise.reject(new JpeError("NOT_PERMITTED", "No validated public address was supplied for this request."));
  }
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((value, key) => {
    headers[key] = value;
  });
  return new Promise<Response>((resolve, reject) => {
    const req = httpsRequest(
      url,
      { method: init.method ?? "GET", headers, lookup: pinnedLookup(address), ...(init.signal ? { signal: init.signal } : {}) },
      (res) => {
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (Array.isArray(value)) {
            for (const v of value) responseHeaders.append(key, v);
          } else if (value !== undefined) {
            responseHeaders.set(key, value);
          }
        }
        const status = res.statusCode ?? 0;
        const body = NULL_BODY_STATUSES.has(status) ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>);
        resolve(new Response(body, { status, headers: responseHeaders }));
      },
    );
    req.on("error", reject);
    if (typeof init.body === "string") req.write(init.body);
    req.end();
  });
}

export function defaultNetDeps(): NetDeps {
  return {
    fetch: pinnedFetch,
    resolve: async (host) => (await lookup(host, { all: true })).map((a) => a.address),
  };
}

/** A network handle that refuses every request. Used in offline mode so that nothing can reach the network by mistake. */
export function blockedNetDeps(): NetDeps {
  const refuse = (): never => {
    throw new JpeError("PROVIDER_FAILED", "Offline mode is on, so no network request was made.");
  };
  return { fetch: async () => refuse(), resolve: async () => refuse() };
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

interface SafeTarget {
  url: URL;
  /** The single public address the connection must use. */
  address: string;
}

async function assertSafeUrl(raw: string, options: RequestOptions, deps: NetDeps): Promise<SafeTarget> {
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
  return { url, address: addresses[0] as string };
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
 * every redirect re-checked, public IPs only, hard timeout and size cap. The host is resolved once per
 * hop and the connection is pinned to the address that passed the check, so DNS rebinding cannot swap
 * in a private address between the check and the connection.
 */
export async function safeRequest(options: RequestOptions, deps: NetDeps): Promise<HttpText> {
  const maxBytes = options.maxBytes ?? 1024 * 1024;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    let current = options.url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const { url, address } = await assertSafeUrl(current, options, deps);
      const headers: Record<string, string> = { "user-agent": "jpe-for-claude", accept: options.accept ?? "text/html,text/plain,application/json" };
      if (options.body !== undefined) headers["content-type"] = "application/json";
      const response = await deps.fetch(url, {
        method: options.method ?? "GET",
        redirect: "manual",
        signal: controller.signal,
        pinnedAddress: address,
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
