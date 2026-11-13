export const REDACTED = "[REDACTED_SECRET_FOUND]";

export interface SecretRule {
  name: string;
  /** Global regex. Rules with two capture groups keep the key and separator and hide only the value. */
  pattern: RegExp;
}

/** Single source of truth for credential shapes; used by the redactor and the secret scanner. */
export const SECRET_RULES: readonly SecretRule[] = [
  { name: "anthropic-or-openai-key", pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { name: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: "aws-access-key-id", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "bearer-token", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi },
  { name: "private-key-block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  {
    name: "key-value-secret",
    pattern: /\b(api[_-]?key|secret|token|password|passwd)(["']?\s*[:=]\s*["']?)[^\s"',;]{6,}/gi,
  },
];

/** Replaces credential-looking substrings so reports and logs never contain them. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const { pattern } of SECRET_RULES) {
    out = out.replace(pattern, (_match: string, key: unknown, sep: unknown) =>
      typeof key === "string" && typeof sep === "string" ? `${key}${sep}${REDACTED}` : REDACTED,
    );
  }
  return out;
}
