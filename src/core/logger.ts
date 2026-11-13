import { redactSecrets } from "./redact.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogSink {
  write(line: string): void;
}

export interface Logger {
  log(level: LogLevel, message: string, fields?: Record<string, unknown>): void;
}

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/**
 * Structured JSON-lines logger. Writes go to an injected sink (hooks must use stderr,
 * because stdout is reserved for hook JSON). Every line is redacted before writing.
 */
export function createLogger(sink: LogSink, minLevel: LogLevel = "info", now: () => Date = () => new Date()): Logger {
  return {
    log(level, message, fields) {
      if (ORDER[level] < ORDER[minLevel]) return;
      const line = JSON.stringify({ ts: now().toISOString(), level, message, ...fields });
      sink.write(redactSecrets(line));
    },
  };
}

export const stderrSink: LogSink = { write: (line) => process.stderr.write(`${line}\n`) };
