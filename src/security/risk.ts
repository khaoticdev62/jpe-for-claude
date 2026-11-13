export type RiskLevel = "safe" | "needs-approval" | "destructive";

export interface RiskAssessment {
  level: RiskLevel;
  reason: string;
}

const DESTRUCTIVE: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-[a-z]*r[a-z]*|--recursive)\b/i, reason: "recursive delete" },
  { pattern: /\b(rd|rmdir)\s+\/s\b/i, reason: "recursive folder delete" },
  { pattern: /\bdel\s+(\/[a-z]\s+)*\/s\b/i, reason: "recursive file delete" },
  { pattern: /\bremove-item\b[^|;\n]*-recurse\b/i, reason: "recursive delete" },
  { pattern: /\bgit\s+reset\s+--hard\b/i, reason: "discards uncommitted work" },
  { pattern: /\bgit\s+clean\b[^|;\n]*-[a-z]*f/i, reason: "deletes untracked files" },
  { pattern: /\bgit\s+push\b[^|;\n]*(--force\b|--force-with-lease\b|\s-f\b)/i, reason: "rewrites remote history" },
  { pattern: /\bgit\s+(checkout|restore)\s+(--\s|\.)/i, reason: "discards uncommitted changes" },
  { pattern: /\bgit\s+branch\s+-D\b/i, reason: "force-deletes a branch" },
  { pattern: /\bdrop\s+(table|database|schema)\b/i, reason: "drops database objects" },
  { pattern: /\b(mkfs|format\s+[a-z]:|dd\s+if=)/i, reason: "overwrites a disk" },
  { pattern: /\bchmod\s+-R\s+777\b/i, reason: "removes file protections" },
];

const NEEDS_APPROVAL: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(npm|pnpm|yarn|pip3?|cargo|go|gem|composer|dotnet)\s+(install|add|i|get|tool\s+install)\b/i, reason: "installs software" },
  { pattern: /\b(curl|wget|iwr|invoke-webrequest)\b[^|;\n]*\|\s*(sh|bash|zsh|iex|invoke-expression)\b/i, reason: "runs downloaded code" },
  { pattern: /\b(curl|wget)\b[^|;\n]*(-X\s*(POST|PUT|PATCH|DELETE)|--data|-d\s|-T\s|--upload-file)/i, reason: "sends data to the network" },
  { pattern: /\b(scp|rsync|sftp|ftp)\b/i, reason: "transfers files over the network" },
  { pattern: /\bgit\s+push\b/i, reason: "publishes commits" },
  { pattern: /\bsudo\b/i, reason: "runs with elevated privileges" },
  { pattern: /\.claude[\\/](settings|settings\.local)\.json/i, reason: "touches Claude Code settings" },
];

/** Classifies a command line so the risk-based approval policy knows whether to ask first. */
export function assessCommand(commandLine: string): RiskAssessment {
  for (const { pattern, reason } of DESTRUCTIVE) if (pattern.test(commandLine)) return { level: "destructive", reason };
  for (const { pattern, reason } of NEEDS_APPROVAL) if (pattern.test(commandLine)) return { level: "needs-approval", reason };
  return { level: "safe", reason: "no risky pattern recognised" };
}
