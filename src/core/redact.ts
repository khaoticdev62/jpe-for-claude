const REDACTED = "[REDACTED_SECRET_FOUND]";

const SECRET_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(api[_-]?key|secret|token|password|passwd)(["']?\s*[:=]\s*["']?)[^\s"',;]{6,}/gi,
];

/** Replaces credential-looking substrings so reports and logs never contain them. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (_match: string, key: unknown, sep: unknown) =>
      typeof key === "string" && typeof sep === "string" ? `${key}${sep}${REDACTED}` : REDACTED,
    );
  }
  return out;
}
