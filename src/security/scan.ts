import { SECRET_RULES } from "../core/redact.js";

export interface SecretFinding {
  rule: string;
  file: string;
  line: number;
}

const SENSITIVE_NAME = /^(\.env(\..+)?|id_(rsa|dsa|ecdsa|ed25519)|.+\.(pem|p12|pfx|key)|credentials\.json|\.npmrc|\.pypirc|\.netrc)$/i;
const TEMPLATE_NAME = /\.(example|sample|template|dist)$/i;

/** True for files that normally hold credentials and must never be read into reports or committed. */
export function isSensitiveFileName(fileName: string): boolean {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  return SENSITIVE_NAME.test(base) && !TEMPLATE_NAME.test(base);
}

/**
 * Finds credential-shaped text. Findings carry the rule name and line only; the matched
 * value is deliberately never returned so a scan report cannot itself leak the secret.
 */
export function scanText(text: string, file: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const { name, pattern } of SECRET_RULES) {
    for (const match of text.matchAll(pattern)) {
      const line = text.slice(0, match.index ?? 0).split("\n").length;
      findings.push({ rule: name, file, line });
    }
  }
  return findings.sort((a, b) => a.line - b.line);
}
